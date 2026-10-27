import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { encodeRecord, decodeRecord } from './record-codec.js';
import { config } from './config.js';
import type { ListingStats } from '@hogulink/contracts';

type Row = { id: string; body: string };
type Scalar = string | number | boolean | null;
export type RecordFilter = Record<
  string,
  Scalar | Scalar[] | { lt?: number; lte?: number; gt?: number; gte?: number }
>;
const numericFields = new Set([
  'expiresAt',
  'createdAt',
  'updatedAt',
  'completedAt',
  'startAt',
  'endAt',
  'dueAt',
  'deadline',
  'quote.startAt',
  'quote.endAt',
  'validUntil',
  'endsAt',
  'nextAttemptAt',
  'leaseUntil',
  'resetAt',
]);
const indexedFields = [
  'status',
  'storeId',
  'customerId',
  'postId',
  'slug',
  'saved',
  'liked',
  'staffId',
  'assignedStaffId',
  'assignedListingId',
  'replacementConsent',
  'proposedListingId',
  'ticketId',
  'listingId',
  'bookingId',
  'holdId',
  'ownerId',
  'reporterId',
  'role',
  'email',
  'active',
  'phase',
  'type',
  'purpose',
  'acceptanceDecision',
  'acceptanceDecision.outcome',
  'merchantAcceptance',
  ...numericFields,
];
function expression(field: string, pg: boolean) {
  if (!indexedFields.includes(field)) throw new Error(`Unsupported record filter: ${field}`);
  const raw = pg
    ? `(body::jsonb #>> '{${field.split('.').join(',')}}')`
    : `json_extract(body,'$.${field}')`;
  return pg && numericFields.has(field) ? `CAST(${raw} AS DOUBLE PRECISION)` : raw;
}
function wakeup(kind: string, value: any): number | undefined {
  const times: number[] = [];
  if (kind === 'holds' && value.active && value.phase === 'CHECKOUT_HOLD')
    times.push(value.expiresAt);
  if (kind === 'bookings') {
    if (
      ['REQUESTED', 'ACCEPTED'].includes(value.status) ||
      (value.status === 'CONFIRMED' && value.staffTaskStatus !== 'ACKNOWLEDGED')
    )
      times.push(value.deadline);
    if (value.replacementConsent === 'PENDING') times.push(value.replacementDeadline);
    if (value.status === 'AWAITING_COMPLETION' && value.completion?.status === 'PENDING')
      times.push(value.completion.confirmBy);
    if (
      value.quote?.fulfillmentMode === 'IN_STORE' &&
      value.status === 'CONFIRMED' &&
      value.staffTaskStatus === 'ACKNOWLEDGED' &&
      !value.visitReminderAt
    )
      times.push(value.quote.startAt - 24 * 3600000);
    // Far-future bookings: the pre-visit authorization, then the renewal deadline if it failed.
    if (['REQUESTED', 'ACCEPTED', 'CONFIRMED'].includes(value.status) && !value.startedAt) {
      if (value.paymentStatus === 'METHOD_SAVED')
        times.push(value.quote.startAt - config.preAuthorizeHours * 3600000);
      if (value.paymentStatus === 'FAILED') times.push(value.paymentActionBy);
    }
  }
  if (kind === 'payments' && ['AUTHORIZED', 'METHOD_SAVED'].includes(value.status))
    times.push(value.expiresAt);
  if (kind === 'partnerApplications' && value.status === 'APPROVED')
    times.push(value.validUntil ?? 0);
  if (kind === 'portraitConsents' && value.status === 'GRANTED') times.push(value.endsAt);
  if (kind === 'timeBlocks' && value.active) times.push(value.endAt);
  if (kind === 'timeOffRequests' && value.status === 'PENDING') times.push(value.startAt);
  if (kind === 'supportTickets' && value.status === 'NEEDS_MERCHANT') times.push(value.dueAt);
  if (kind === 'merchantSubscriptions' && value.status === 'TRIALING')
    times.push(value.trialEndsAt);
  if (kind === 'merchantSubscriptions' && value.status === 'ANNUAL_ACTIVE')
    times.push(value.annualEndsAt);
  if (kind === 'planInvoices' && value.status === 'OPEN') times.push(value.graceEndsAt);
  if (kind === 'safetyCheckIns' && ['WAITING', 'SAFE'].includes(value.status))
    times.push(value.status === 'WAITING' ? value.escalateAt : value.dueAt);
  const valid = times.filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : undefined;
}
export interface Records {
  get<T>(kind: string, id: string): Promise<T | undefined>;
  list<T>(kind: string): Promise<T[]>;
  find<T>(
    kind: string,
    filters: RecordFilter,
    options?: { limit?: number; orderBy?: string; descending?: boolean },
  ): Promise<T[]>;
  remove(kind: string, id: string): Promise<void>;
  clearDue(now: number): Promise<void>;
  counts(kind: string, field: string): Promise<Record<string, number>>;
  count(kind: string, filters: RecordFilter): Promise<number>;
  listingStats(listingIds: string[], since: number): Promise<Record<string, ListingStats>>;
  /** Same facts per shop: approved shop reviews, completed shop visits and active shop saves. */
  storeStats(storeIds: string[], since: number): Promise<Record<string, ListingStats>>;
  assertEmpty(): Promise<void>;
  put<T extends { id: string }>(kind: string, value: T): Promise<void>;
  interval(value: {
    id: string;
    staffId: string;
    startAt: number;
    endAt: number;
    expiresAt: number;
  }): Promise<void>;
  releaseInterval(id: string): Promise<void>;
  conflicts(staffId: string, startAt: number, endAt: number, exceptId?: string): Promise<boolean>;
}
export class Repository {
  private sqlite?: DatabaseSync;
  private pool?: Pool;
  private tail = Promise.resolve();
  private active = new Set<Promise<unknown>>();
  constructor(
    private url = process.env.DATABASE_URL,
    private file = process.env.SQLITE_PATH ?? 'data/hogulink.sqlite',
  ) {}
  async init() {
    if (this.url) {
      this.pool = new Pool({ connectionString: this.url, max: 10 });
      await this.pool.query(`CREATE EXTENSION IF NOT EXISTS btree_gist;
        CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS busy_intervals (id TEXT PRIMARY KEY, staff_id TEXT NOT NULL, start_ms BIGINT NOT NULL, end_ms BIGINT NOT NULL, expires_ms BIGINT NOT NULL, CHECK (start_ms < end_ms), EXCLUDE USING gist (staff_id WITH =, int8range(start_ms,end_ms,'[)') WITH &&));`);
      await this.pool
        .query(`CREATE OR REPLACE FUNCTION protect_booking_identity() RETURNS trigger AS $$
        BEGIN IF OLD.kind = 'bookings' AND (NEW.body::jsonb->>'merchantId', NEW.body::jsonb->>'storeId', NEW.body::jsonb->>'selectedStaffId', NEW.body::jsonb->>'selectedStaffListingId', NEW.body::jsonb->'quote'->>'bookingMode', NEW.body::jsonb->'quote'->>'nominationType') IS DISTINCT FROM (OLD.body::jsonb->>'merchantId', OLD.body::jsonb->>'storeId', OLD.body::jsonb->>'selectedStaffId', OLD.body::jsonb->>'selectedStaffListingId', OLD.body::jsonb->'quote'->>'bookingMode', OLD.body::jsonb->'quote'->>'nominationType') THEN RAISE EXCEPTION 'Immutable booking identity'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS immutable_booking_identity ON records;
        CREATE TRIGGER immutable_booking_identity BEFORE UPDATE ON records FOR EACH ROW EXECUTE FUNCTION protect_booking_identity();`);
    } else {
      if (this.file !== ':memory:') mkdirSync(dirname(resolve(this.file)), { recursive: true });
      this.sqlite = new DatabaseSync(this.file);
      this.sqlite.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS busy_intervals (id TEXT PRIMARY KEY, staff_id TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, CHECK(start_ms < end_ms));
        CREATE INDEX IF NOT EXISTS interval_staff ON busy_intervals(staff_id,start_ms,end_ms);
        CREATE TRIGGER IF NOT EXISTS prevent_overlap BEFORE INSERT ON busy_intervals WHEN EXISTS(SELECT 1 FROM busy_intervals WHERE staff_id=NEW.staff_id AND start_ms<NEW.end_ms AND end_ms>NEW.start_ms) BEGIN SELECT RAISE(ABORT,'SLOT_CONFLICT'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_booking_identity BEFORE UPDATE ON records WHEN OLD.kind='bookings' AND (json_extract(NEW.body,'$.merchantId') IS NOT json_extract(OLD.body,'$.merchantId') OR json_extract(NEW.body,'$.storeId') IS NOT json_extract(OLD.body,'$.storeId') OR json_extract(NEW.body,'$.selectedStaffId') IS NOT json_extract(OLD.body,'$.selectedStaffId') OR json_extract(NEW.body,'$.selectedStaffListingId') IS NOT json_extract(OLD.body,'$.selectedStaffListingId') OR json_extract(NEW.body,'$.quote.bookingMode') IS NOT json_extract(OLD.body,'$.quote.bookingMode') OR json_extract(NEW.body,'$.quote.nominationType') IS NOT json_extract(OLD.body,'$.quote.nominationType')) BEGIN SELECT RAISE(ABORT,'Immutable booking identity'); END;`);
    }
    const execute = (sql: string) =>
      this.pool ? this.pool.query(sql) : Promise.resolve(this.sqlite!.exec(sql));
    await execute(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)',
    );
    await execute(
      'CREATE TABLE IF NOT EXISTS record_wakeups (kind TEXT NOT NULL,id TEXT NOT NULL,due_at BIGINT NOT NULL,PRIMARY KEY(kind,id))',
    );
    await execute('CREATE INDEX IF NOT EXISTS record_wakeups_due ON record_wakeups(due_at)');
    // Old rows without a mode are home visits. They must not be converted by later writes.
    if (this.pool)
      await execute(`CREATE OR REPLACE FUNCTION protect_service_mode() RETURNS trigger AS $$
      BEGIN IF OLD.kind='bookings' AND COALESCE(NEW.body::jsonb->'quote'->>'fulfillmentMode','HOME_VISIT') IS DISTINCT FROM COALESCE(OLD.body::jsonb->'quote'->>'fulfillmentMode','HOME_VISIT') THEN RAISE EXCEPTION 'Immutable service mode'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS immutable_service_mode ON records;
      CREATE TRIGGER immutable_service_mode BEFORE UPDATE ON records FOR EACH ROW EXECUTE FUNCTION protect_service_mode();`);
    else
      await execute(
        `CREATE TRIGGER IF NOT EXISTS immutable_service_mode BEFORE UPDATE ON records WHEN OLD.kind='bookings' AND COALESCE(json_extract(NEW.body,'$.quote.fulfillmentMode'),'HOME_VISIT') IS NOT COALESCE(json_extract(OLD.body,'$.quote.fulfillmentMode'),'HOME_VISIT') BEGIN SELECT RAISE(ABORT,'Immutable service mode'); END;`,
      );
    for (const field of indexedFields) {
      const name = field.replace(/\./g, '_');
      await execute(
        `CREATE INDEX IF NOT EXISTS records_${name} ON records(kind,${expression(field, !!this.pool)})`,
      );
    }
    // These indexes bound owner views and active/due work independently of archived order volume.
    for (const [name, fields] of Object.entries({
      status_due: ['status', 'dueAt'],
      status_expiry: ['status', 'expiresAt'],
      active_expiry: ['active', 'expiresAt'],
      shop_service: ['storeId', 'quote.startAt'],
      owner_created: ['customerId', 'createdAt'],
      listing_reviews: ['listingId', 'status'],
      listing_favorites: ['listingId', 'active'],
      listing_completions: ['assignedListingId', 'status', 'updatedAt'],
    }))
      await execute(
        `CREATE INDEX IF NOT EXISTS records_${name} ON records(kind,${fields.map((f) => expression(f, !!this.pool)).join(',')})`,
      );
    await execute(
      `INSERT INTO schema_migrations(version,applied_at) VALUES(1,${Date.now()}) ON CONFLICT(version) DO NOTHING`,
    );
    const migration = this.pool
      ? (await this.pool.query('SELECT version FROM schema_migrations WHERE version=2')).rowCount
      : this.sqlite!.prepare('SELECT version FROM schema_migrations WHERE version=2').get();
    if (!migration) {
      await this.transaction(async (tx) => {
        for (const kind of [
          'holds',
          'bookings',
          'payments',
          'partnerApplications',
          'portraitConsents',
          'timeBlocks',
          'timeOffRequests',
          'supportTickets',
          'merchantSubscriptions',
          'planInvoices',
          'safetyCheckIns',
        ])
          for (const record of await tx.list<{ id: string }>(kind)) await tx.put(kind, record);
      });
      await execute(
        `INSERT INTO schema_migrations(version,applied_at) VALUES(2,${Date.now()}) ON CONFLICT(version) DO NOTHING`,
      );
    }
  }
  async hasDue(now: number) {
    if (this.pool)
      return !!(
        await this.pool.query('SELECT 1 FROM record_wakeups WHERE due_at <= $1 LIMIT 1', [now])
      ).rowCount;
    await this.tail;
    return !!this.sqlite!.prepare('SELECT 1 FROM record_wakeups WHERE due_at <= ? LIMIT 1').get(
      now,
    );
  }
  async transaction<T>(fn: (records: Records) => Promise<T>): Promise<T> {
    return this.track(this.execute(fn, false));
  }
  async read<T>(fn: (records: Records) => Promise<T>): Promise<T> {
    return this.track(this.execute(fn, true));
  }
  private async track<T>(promise: Promise<T>) {
    this.active.add(promise);
    try {
      return await promise;
    } finally {
      this.active.delete(promise);
    }
  }
  private async execute<T>(fn: (records: Records) => Promise<T>, readOnly: boolean): Promise<T> {
    if (this.pool) {
      // SSI detects conflicting writes; retry the whole transaction, never an individual statement.
      for (let attempt = 0; ; attempt++) {
        const client = await this.pool.connect();
        try {
          await client.query(
            readOnly
              ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
              : 'BEGIN ISOLATION LEVEL SERIALIZABLE',
          );
          const result = await fn(this.records(client, readOnly));
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          if (attempt >= 4 || !['40001', '40P01'].includes((error as { code?: string }).code ?? ''))
            throw error;
        } finally {
          client.release();
        }
        await new Promise((resolve) => setTimeout(resolve, 5 * 2 ** attempt + Math.random() * 10));
      }
    }
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => {
      release = r;
    });
    await previous;
    let client: PoolClient | undefined;
    try {
      this.sqlite!.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
      const records = this.records(undefined, readOnly);
      const result = await fn(records);
      if (client) await client.query('COMMIT');
      else this.sqlite!.exec('COMMIT');
      return result;
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      else this.sqlite?.exec('ROLLBACK');
      throw error;
    } finally {
      client?.release();
      release();
    }
  }
  private records(client?: PoolClient, readOnly = false): Records {
    const writable = () => {
      if (readOnly) throw new Error('Cannot write in a read-only transaction');
    };
    const query = async <T = Row>(
      sql: string,
      args: (string | number | null)[] = [],
    ): Promise<T[]> => {
      if (client) {
        let n = 0;
        return (
          await client.query(
            sql.replace(/\?/g, () => `$${++n}`),
            args,
          )
        ).rows as T[];
      }
      const stmt = this.sqlite!.prepare(sql);
      if (/^SELECT/i.test(sql)) return stmt.all(...args) as unknown as T[];
      stmt.run(...args);
      return [];
    };
    const where = (kind: string, filters: RecordFilter) => {
      const clauses = ['kind=?'],
        args: (string | number | null)[] = [kind];
      const scalar = (v: Scalar) => (typeof v === 'boolean' ? (client ? String(v) : Number(v)) : v);
      for (const [field, value] of Object.entries(filters)) {
        const exp = expression(field, !!client);
        if (Array.isArray(value)) {
          if (!value.length) {
            clauses.push('1=0');
            continue;
          }
          clauses.push(`${exp} IN (${value.map(() => '?').join(',')})`);
          args.push(...value.map(scalar));
        } else if (value === null) {
          clauses.push(`${exp} IS NULL`);
        } else if (typeof value === 'object') {
          for (const [op, bound] of Object.entries(value)) {
            const operator = { lt: '<', lte: '<=', gt: '>', gte: '>=' }[op];
            if (!operator || !Number.isFinite(bound)) throw new Error('Invalid record filter');
            clauses.push(`${exp}${operator}?`);
            args.push(bound);
          }
        } else {
          clauses.push(`${exp}=?`);
          args.push(scalar(value));
        }
      }
      return { clauses, args };
    };
    // Read-only aggregates over indexed fields; review bodies and booking addresses are never decoded.
    const aggregateStats = async (
      keys: string[],
      since: number,
      by: { review: string; booking: string; favorite: [kind: string, field: string] },
    ) => {
      const ids = [...new Set(keys)];
      const result: Record<string, ListingStats> = Object.fromEntries(
        ids.map((id) => [
          id,
          {
            rating: null,
            reviewCount: 0,
            completed90d: 0,
            favorites: 0,
          },
        ]),
      );
      if (!ids.length) return result;
      const exp = (field: string) => expression(field, !!client);
      const grouped = async (
        kind: string,
        filters: RecordFilter,
        field: string,
        extra = '',
        average = false,
        extraArgs: number[] = [],
      ) => {
        const { clauses, args } = where(kind, filters);
        const score = client
          ? "CAST(body::jsonb #>> '{scores,overall}' AS DOUBLE PRECISION)"
          : "json_extract(body,'$.scores.overall')";
        return query<{ id: string; count: string | number; average: number | null }>(
          `SELECT ${exp(field)} AS id,COUNT(*) AS count${average ? `,AVG(${score}) AS average` : ''} FROM records WHERE ${clauses.join(' AND ')}${extra} GROUP BY ${exp(field)}`,
          [...args, ...extraArgs],
        );
      };
      for (const row of await grouped(
        'experienceReviews',
        { [by.review]: ids, status: 'APPROVED' },
        by.review,
        '',
        true,
      )) {
        result[row.id].reviewCount = Number(row.count);
        result[row.id].rating =
          row.average === null ? null : Math.round(Number(row.average) * 10) / 10;
      }
      for (const row of await grouped(
        'bookings',
        { [by.booking]: ids, status: 'COMPLETED', updatedAt: { gte: since } },
        by.booking,
        ` AND COALESCE(${exp('completedAt')},${exp('updatedAt')})>=?`,
        false,
        [since],
      ))
        result[row.id].completed90d = Number(row.count);
      for (const row of await grouped(
        by.favorite[0],
        { [by.favorite[1]]: ids, active: true },
        by.favorite[1],
      ))
        result[row.id].favorites = Number(row.count);
      return result;
    };
    return {
      get: async <T>(kind: string, id: string) => {
        const rows = await query('SELECT id,body FROM records WHERE kind=? AND id=?', [kind, id]);
        return rows[0] ? decodeRecord<T>(kind, rows[0].body) : undefined;
      },
      list: async <T>(kind: string) =>
        (await query('SELECT id,body FROM records WHERE kind=?', [kind])).map((row) =>
          decodeRecord<T>(kind, row.body),
        ),
      find: async <T>(
        kind: string,
        filters: RecordFilter,
        options = {} as { limit?: number; orderBy?: string; descending?: boolean },
      ) => {
        const { clauses, args } = where(kind, filters);
        const order = options.orderBy
          ? ` ORDER BY ${expression(options.orderBy, !!client)} ${options.descending ? 'DESC' : 'ASC'},id`
          : '';
        const limit = options.limit === undefined ? '' : ' LIMIT ?';
        if (options.limit !== undefined) {
          if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100000)
            throw new Error('Invalid query limit');
          args.push(options.limit);
        }
        return (
          await query(
            `SELECT id,body FROM records WHERE ${clauses.join(' AND ')}${order}${limit}`,
            args,
          )
        ).map((row) => decodeRecord<T>(kind, row.body));
      },
      remove: async (kind, id) => {
        writable();
        await query('DELETE FROM records WHERE kind=? AND id=?', [kind, id]);
        await query('DELETE FROM record_wakeups WHERE kind=? AND id=?', [kind, id]);
      },
      clearDue: async (now) => {
        writable();
        await query('DELETE FROM record_wakeups WHERE due_at<=?', [now]);
      },
      count: async (kind, filters) => {
        const { clauses, args } = where(kind, filters);
        return Number(
          (
            await query(`SELECT COUNT(*) AS body FROM records WHERE ${clauses.join(' AND ')}`, args)
          )[0].body,
        );
      },
      listingStats: (listingIds, since) =>
        aggregateStats(listingIds, since, {
          review: 'listingId',
          booking: 'assignedListingId',
          favorite: ['favorites', 'listingId'],
        }),
      storeStats: (storeIds, since) =>
        aggregateStats(storeIds, since, {
          review: 'storeId',
          booking: 'storeId',
          favorite: ['storeFavorites', 'storeId'],
        }),
      counts: async (kind, field) => {
        const exp = expression(field, !!client);
        const rows = await query(
          `SELECT ${exp} AS id,COUNT(*) AS body FROM records WHERE kind=? GROUP BY ${exp}`,
          [kind],
        );
        return Object.fromEntries(rows.map((row) => [String(row.id), Number(row.body)]));
      },
      assertEmpty: async () => {
        writable();
        if (client) await query('LOCK TABLE records,busy_intervals IN ACCESS EXCLUSIVE MODE');
        if ((await query('SELECT id FROM records LIMIT 1')).length)
          throw new Error('Restore requires an empty database');
      },
      put: async (kind, value) => {
        writable();
        await query(
          'INSERT INTO records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body',
          [kind, value.id, encodeRecord(kind, value as { id: string })],
        );
        const due = wakeup(kind, value);
        if (due !== undefined)
          await query(
            'INSERT INTO record_wakeups(kind,id,due_at) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET due_at=excluded.due_at',
            [kind, value.id, due],
          );
        else await query('DELETE FROM record_wakeups WHERE kind=? AND id=?', [kind, value.id]);
      },
      interval: async (value) => {
        writable();
        await query('DELETE FROM busy_intervals WHERE id=?', [value.id]);
        await query(
          'INSERT INTO busy_intervals(id,staff_id,start_ms,end_ms,expires_ms) VALUES(?,?,?,?,?)',
          [value.id, value.staffId, value.startAt, value.endAt, value.expiresAt],
        );
      },
      releaseInterval: async (id) => {
        writable();
        await query('DELETE FROM busy_intervals WHERE id=?', [id]);
      },
      conflicts: async (staffId, startAt, endAt, exceptId = '') =>
        (
          await query(
            'SELECT id FROM busy_intervals WHERE staff_id=? AND start_ms<? AND end_ms>? AND id<>?',
            [staffId, endAt, startAt, exceptId],
          )
        ).length > 0,
    };
  }
  async close() {
    await Promise.allSettled([...this.active]);
    await this.tail;
    this.sqlite?.close();
    await this.pool?.end();
  }
  async snapshot() {
    const read = async (client?: PoolClient) => {
      const records = client
        ? (await client.query('SELECT kind,id,body FROM records ORDER BY kind,id')).rows
        : this.sqlite!.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all();
      const intervals = client
        ? (await client.query('SELECT * FROM busy_intervals ORDER BY id')).rows
        : this.sqlite!.prepare('SELECT * FROM busy_intervals ORDER BY id').all();
      return { format: 'hogulink-backup-v1' as const, createdAt: Date.now(), records, intervals };
    };
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await read(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    return this.read(() => read());
  }
  async restore(snapshot: unknown) {
    const data = snapshot as {
      format: string;
      records: { kind: string; id: string; body: string }[];
      intervals: {
        id: string;
        staff_id: string;
        start_ms: number;
        end_ms: number;
        expires_ms: number;
      }[];
    };
    if (
      data?.format !== 'hogulink-backup-v1' ||
      !Array.isArray(data.records) ||
      !Array.isArray(data.intervals)
    )
      throw new Error('Invalid backup format');
    return this.transaction(async (tx) => {
      await tx.assertEmpty();
      for (const row of data.records) {
        if (
          typeof row.kind !== 'string' ||
          row.kind.length > 100 ||
          typeof row.id !== 'string' ||
          typeof row.body !== 'string'
        )
          throw new Error('Invalid backup record');
        const value = decodeRecord<{ id: string }>(row.kind, row.body);
        if (value.id !== row.id) throw new Error('Backup record identity mismatch');
        await tx.put(row.kind, value);
      }
      for (const interval of data.intervals)
        await tx.interval({
          id: interval.id,
          staffId: interval.staff_id,
          startAt: Number(interval.start_ms),
          endAt: Number(interval.end_ms),
          expiresAt: Number(interval.expires_ms),
        });
      return { records: data.records.length, intervals: data.intervals.length };
    });
  }
}
