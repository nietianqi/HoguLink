import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Actor,
  BillingStanding,
  Booking,
  Listing,
  MoneyEntry,
  MoneyReport,
  MerchantSubscription,
  Offering,
  PlanInvoice,
  Store,
  SubscriptionEvent,
  SubscriptionWorkspace,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { currentAdmin, requireAdmin } from './admin-access.js';
import { ensure } from './errors.js';
import { config } from './config.js';
const day = 86400000;
const uid = (p: string) => `${p}_${randomUUID()}`;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const note = z.string().trim().min(10).max(1500);
const version = z.number().int().positive();
// Calendar anniversary in Japan; February 29 clamps to February 28.
export function annualEnd(at: number) {
  const d = new Date(at + 9 * 3600000),
    month = d.getUTCMonth(),
    date = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCMonth(month);
  d.setUTCDate(Math.min(date, new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate()));
  return d.getTime() - 9 * 3600000;
}
async function event(
  tx: Records,
  storeId: string,
  action: string,
  at: number,
  actor?: Actor,
  invoiceId?: string,
  text?: string,
  eventId = uid('plan_event'),
) {
  if (await tx.get('subscriptionEvents', eventId)) return;
  await tx.put<SubscriptionEvent>('subscriptionEvents', {
    id: eventId,
    storeId,
    action,
    at,
    role: actor ? (actor.role as 'MERCHANT' | 'ADMIN') : 'SYSTEM',
    ...(invoiceId ? { invoiceId } : {}),
    ...(text ? { note: text } : {}),
  });
  await tx.put('audit', {
    id: uid('audit'),
    actorId: actor?.id ?? 'system',
    action,
    detail: invoiceId ?? storeId,
    at,
  });
  await tx.put('outbox', {
    id: uid('outbox'),
    type: action,
    storeId,
    target: invoiceId ?? storeId,
    createdAt: at,
    status: 'PENDING',
    delivery: 'DEMO_LOCAL_ONLY',
  });
}
async function invoice(
  tx: Records,
  s: MerchantSubscription,
  purpose: PlanInvoice['purpose'],
  now: number,
) {
  const existing = (await tx.list<PlanInvoice>('planInvoices')).find(
    (i) => i.storeId === s.id && i.status === 'OPEN',
  );
  if (existing) return existing;
  const dueAt = purpose === 'RENEWAL' ? s.annualEndsAt! : now + config.planGraceDays * day;
  const i: PlanInvoice = {
    id: uid('plan_invoice'),
    storeId: s.id,
    version: 1,
    kind: 'ANNUAL_PLAN_FEE',
    purpose,
    amount: config.annualPlanPrice,
    currency: 'JPY',
    taxMode: 'EXCLUSIVE_UNASSESSED',
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
    dueAt,
    graceEndsAt: dueAt + config.planGraceDays * day,
    attempts: [],
  };
  await tx.put('planInvoices', i);
  await event(tx, s.id, 'PLAN_INVOICE_CREATED', now, undefined, i.id);
  return i;
}
export async function billingStanding(tx: Records, store: Store): Promise<BillingStanding> {
  const s = (await tx.get<MerchantSubscription>('merchantSubscriptions', store.id))!;
  const entries = (await tx.list<MoneyEntry>('moneyEntries')).filter((e) => e.storeId === store.id),
    reports = await tx.list<MoneyReport>('moneyReports');
  const feeDiscrepancy = entries.some((e) =>
    reports.some((r) => r.id === e.id && r.platformFee !== e.platformFee),
  );
  return {
    plan: store.plan,
    status: s.status,
    newBookingsBlocked: s.status === 'SUSPENDED' || feeDiscrepancy,
    feeDiscrepancy,
    openAnnualAmount: (await tx.list<PlanInvoice>('planInvoices'))
      .filter((i) => i.storeId === store.id && i.status === 'OPEN')
      .reduce((n, i) => n + i.amount, 0),
    trialEndsAt: s.trialEndsAt,
    annualEndsAt: s.annualEndsAt,
  };
}
export async function sweepSubscriptions(tx: Records, now: number) {
  const listings = await tx.list<Listing>('listings'),
    offerings = await tx.list<Offering>('offerings');
  for (const store of await tx.list<Store>('stores')) {
    let s = await tx.get<MerchantSubscription>('merchantSubscriptions', store.id);
    if (!s) {
      // Existing annual access is imported, never represented as a paid receipt.
      s = {
        id: store.id,
        version: 1,
        status:
          store.plan === 'ANNUAL'
            ? 'ANNUAL_ACTIVE'
            : store.plan === 'STANDARD'
              ? 'STANDARD'
              : 'WAITING_PUBLICATION',
        renewal: 'STANDARD',
        overdueAction: 'DOWNGRADE',
        legacy: store.plan !== 'TRIAL',
        createdAt: now,
        updatedAt: now,
        ...(store.plan === 'ANNUAL' ? { annualStartedAt: now, annualEndsAt: annualEnd(now) } : {}),
      };
      await tx.put('merchantSubscriptions', s);
      await event(tx, store.id, 'PLAN_INITIALIZED', now);
    }
    const before = JSON.stringify(s);
    const publicReady =
      store.active &&
      store.approved &&
      !!store.pspAccount &&
      listings.some(
        (l) =>
          l.storeId === store.id &&
          l.membershipActive &&
          l.portraitConsent &&
          l.identityVerified &&
          l.publicationStatus === 'PUBLISHED_INDEXABLE' &&
          offerings.some(
            (o) =>
              o.storeId === store.id &&
              l.offeringIds.includes(o.id) &&
              o.active !== false &&
              o.approved &&
              o.regulatoryCategory === 'RELAXATION',
          ),
      );
    if (s.status === 'WAITING_PUBLICATION' && publicReady) {
      s.status = 'TRIALING';
      s.trialStartedAt = now;
      s.trialEndsAt = now + config.trialDays * day;
      await event(tx, store.id, 'TRIAL_STARTED', now);
    }
    if (s.status === 'TRIALING' && s.trialEndsAt! <= now) {
      s.status = 'STANDARD';
      await event(tx, store.id, 'TRIAL_ENDED', now);
    }
    if (s.status === 'TRIALING' && s.trialEndsAt! - now <= 7 * day)
      await event(
        tx,
        store.id,
        'TRIAL_ENDING',
        now,
        undefined,
        undefined,
        undefined,
        `trial_reminder_${store.id}`,
      );
    let open = (await tx.list<PlanInvoice>('planInvoices')).find(
      (i) => i.storeId === store.id && i.status === 'OPEN',
    );
    if (open?.purpose === 'START' && open.dueAt <= now) {
      open.status = 'VOID';
      open.version++;
      open.updatedAt = now;
      await tx.put('planInvoices', open);
      await event(tx, store.id, 'PLAN_OFFER_EXPIRED', now, undefined, open.id);
      open = undefined;
    }
    if (s.annualEndsAt && s.annualEndsAt - now <= 30 * day && s.renewal === 'ANNUAL' && !open) {
      // One invoice per annual period, including long idle intervals.
      const exists = (await tx.list<PlanInvoice>('planInvoices')).some(
        (i) => i.storeId === store.id && i.purpose === 'RENEWAL' && i.dueAt === s!.annualEndsAt,
      );
      if (!exists) open = await invoice(tx, s, 'RENEWAL', now);
    }
    if (
      s.annualEndsAt &&
      s.annualEndsAt <= now &&
      ['ANNUAL_ACTIVE', 'GRACE_PERIOD', 'SUSPENDED', 'STANDARD'].includes(s.status)
    ) {
      const late = open?.purpose === 'RENEWAL';
      s.status = late
        ? now < open!.graceEndsAt
          ? 'GRACE_PERIOD'
          : s.overdueAction === 'SUSPEND'
            ? 'SUSPENDED'
            : 'STANDARD'
        : 'STANDARD';
    }
    if (open?.purpose === 'RENEWAL' && open.dueAt <= now)
      await event(
        tx,
        store.id,
        'PLAN_PAYMENT_DUE',
        now,
        undefined,
        open.id,
        undefined,
        `due_${open.id}`,
      );
    if (open?.purpose === 'RENEWAL' && open.graceEndsAt <= now)
      await event(
        tx,
        store.id,
        'PLAN_OVERDUE',
        now,
        undefined,
        open.id,
        undefined,
        `overdue_${open.id}`,
      );
    if (s.annualEndsAt && s.annualEndsAt > now && s.annualEndsAt - now <= 30 * day)
      await event(
        tx,
        store.id,
        'ANNUAL_ENDING',
        now,
        undefined,
        undefined,
        undefined,
        `annual_reminder_${store.id}_${s.annualEndsAt}`,
      );
    if (before !== JSON.stringify(s)) {
      s.version++;
      s.updatedAt = now;
      await tx.put('merchantSubscriptions', s);
      await event(tx, store.id, 'PLAN_STATUS_UPDATED', now);
    }
    const plan: Store['plan'] =
      s.status === 'TRIALING' || s.status === 'WAITING_PUBLICATION'
        ? 'TRIAL'
        : s.status === 'ANNUAL_ACTIVE'
          ? 'ANNUAL'
          : 'STANDARD';
    const standing = await billingStanding(tx, { ...store, plan });
    if (store.plan !== plan || !!store.billingBlocked !== standing.newBookingsBlocked)
      await tx.put('stores', { ...store, plan, billingBlocked: standing.newBookingsBlocked });
  }
}
export class SubscriptionService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private async scope(tx: Records, actor: Actor, storeId?: string, write = false) {
    if (actor.role === 'ADMIN') {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, write ? 'finance.write' : 'finance.read');
    } else
      ensure(
        actor.role === 'MERCHANT' && actor.storeId,
        'FORBIDDEN',
        'Shop billing access required.',
        403,
      );
    const stores = await tx.list<Store>('stores'),
      id = actor.role === 'MERCHANT' ? actor.storeId! : (storeId ?? stores[0]?.id);
    ensure(
      actor.role !== 'MERCHANT' || !storeId || storeId === actor.storeId,
      'NOT_FOUND',
      'Shop not found.',
      404,
    );
    const store = stores.find((s) => s.id === id);
    ensure(store, 'NOT_FOUND', 'Shop not found.', 404);
    return { actor, store, stores: actor.role === 'ADMIN' ? stores : [store] };
  }
  private async replay(tx: Records, actor: Actor, action: string, key: string, input: unknown) {
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    const id = hash([actor.id, action, key]),
      fingerprint = hash(input),
      prior = await tx.get<{ id: string; fingerprint: string; result: unknown }>(
        'subscriptionRetries',
        id,
      );
    if (prior)
      ensure(
        prior.fingerprint === fingerprint,
        'IDEMPOTENCY_CONFLICT',
        'Retry key has different input.',
        409,
      );
    return { id, fingerprint, prior };
  }
  private async save(
    tx: Records,
    s: MerchantSubscription,
    retry: { id: string; fingerprint: string },
    result: unknown,
  ) {
    s.version++;
    s.updatedAt = this.now();
    await tx.put('merchantSubscriptions', s);
    await sweepSubscriptions(tx, this.now());
    await tx.put('subscriptionRetries', { ...retry, result });
    return result;
  }
  async workspace(actor: Actor, input: unknown = {}): Promise<SubscriptionWorkspace> {
    const d = z.object({ storeId: z.string().optional() }).strict().parse(input);
    return this.run(async (tx) => {
      const { store, stores } = await this.scope(tx, actor, d.storeId),
        s = (await tx.get<MerchantSubscription>('merchantSubscriptions', store.id))!;
      const orders = (
        await tx.find<Booking>('bookings', { storeId: store.id, status: 'COMPLETED' })
      )
        .filter((b) => b.capturedAmount > 0)
        .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
      let feeBase = 0,
        saving = 0,
        count = 0;
      for (const b of orders) {
        if (!b.completedAt || b.completedAt < this.now() - 90 * day || b.completedAt > this.now())
          continue;
        const base = Math.floor(
          Math.max(0, b.capturedAmount - b.quote.transportFee) *
            (1 - b.refundedAmount / b.capturedAmount),
        );
        if (!base) continue;
        const repeat = orders.some(
          (x) =>
            x.id !== b.id &&
            x.customerId === b.customerId &&
            (x.completedAt ?? 0) < b.completedAt! &&
            x.capturedAmount > x.refundedAmount,
        );
        const weight = repeat ? 0.5 : 1;
        feeBase += base;
        count++;
        saving +=
          Math.floor((base * config.standardFeeBps * weight) / 10000) -
          Math.floor((base * config.annualFeeBps * weight) / 10000);
      }
      return {
        now: this.now(),
        mode: 'DEMO',
        storeId: store.id,
        stores: await Promise.all(
          stores.map(async (st) => {
            const b = await billingStanding(tx, st);
            return {
              id: st.id,
              name: st.name,
              status: b.status,
              blocked: b.newBookingsBlocked,
              due: b.openAnnualAmount,
            };
          }),
        ),
        subscription: s,
        standing: await billingStanding(tx, store),
        invoices: (await tx.list<PlanInvoice>('planInvoices'))
          .filter((i) => i.storeId === store.id)
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)),
        history: (await tx.list<SubscriptionEvent>('subscriptionEvents'))
          .filter((e) => e.storeId === store.id)
          .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
          .slice(0, 100),
        rates: { TRIAL: 0, STANDARD: config.standardFeeBps, ANNUAL: config.annualFeeBps },
        annualPrice: config.annualPlanPrice,
        graceDays: config.planGraceDays,
        trialDays: config.trialDays,
        recommendation: {
          orders: count,
          feeBase,
          annualSaving: Math.floor((saving * 365) / 90),
          suggested: count
            ? (saving * 365) / 90 > config.annualPlanPrice
              ? 'ANNUAL'
              : 'STANDARD'
            : null,
        },
      };
    });
  }
  async change(actor: Actor, storeId: string, input: unknown, key: string) {
    const d = z
      .object({
        version,
        action: z.enum(['REQUEST_ANNUAL', 'SELECT_STANDARD', 'SET_OVERDUE_ACTION']),
        overdueAction: z.enum(['DOWNGRADE', 'SUSPEND']).optional(),
        note,
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const scope = await this.scope(tx, actor, storeId, true);
      actor = scope.actor;
      ensure(actor.role === 'MERCHANT', 'FORBIDDEN', 'Plan choices belong to the merchant.', 403);
      const retry = await this.replay(tx, actor, 'change', key, [storeId, d]);
      if (retry.prior) return retry.prior.result;
      const s = (await tx.get<MerchantSubscription>('merchantSubscriptions', storeId))!;
      ensure(
        s.version === d.version,
        'VERSION_CONFLICT',
        'The plan changed. Refresh before confirming.',
        409,
      );
      ensure(
        d.action === 'SET_OVERDUE_ACTION' ? !!d.overdueAction : !d.overdueAction,
        'INVALID_INPUT',
        'Choose an overdue policy only for its own action.',
      );
      let created: PlanInvoice | undefined;
      if (d.action === 'REQUEST_ANNUAL') {
        ensure(
          s.status !== 'WAITING_PUBLICATION',
          'PUBLICATION_REQUIRED',
          'Annual billing starts after first publication.',
          409,
        );
        ensure(
          !s.annualEndsAt || s.annualEndsAt - this.now() <= 30 * day,
          'RENEWAL_TOO_EARLY',
          'Renewal opens 30 days before expiry.',
          409,
        );
        const open = (await tx.list<PlanInvoice>('planInvoices')).find(
          (i) => i.storeId === storeId && i.status === 'OPEN',
        );
        ensure(!open, 'OPEN_PLAN_INVOICE', 'Use the existing open invoice.', 409);
        created = await invoice(
          tx,
          s,
          s.annualEndsAt && s.annualEndsAt > this.now() ? 'RENEWAL' : 'START',
          this.now(),
        );
        s.renewal = 'ANNUAL';
      } else if (d.action === 'SELECT_STANDARD') {
        s.renewal = 'STANDARD';
        if (s.annualEndsAt && s.annualEndsAt <= this.now()) s.overdueAction = 'DOWNGRADE';
        for (const i of (await tx.list<PlanInvoice>('planInvoices')).filter(
          (i) =>
            i.storeId === storeId &&
            i.status === 'OPEN' &&
            (i.purpose === 'START' || i.dueAt > this.now()),
        )) {
          i.status = 'VOID';
          i.version++;
          i.updatedAt = this.now();
          await tx.put('planInvoices', i);
          await event(tx, storeId, 'PLAN_INVOICE_VOIDED', this.now(), actor, i.id, d.note);
        }
        if (s.status === 'TRIALING') s.status = 'STANDARD';
      } else s.overdueAction = d.overdueAction!;
      await event(tx, storeId, d.action, this.now(), actor, created?.id, d.note);
      return this.save(tx, s, retry, { invoiceId: created?.id, changed: true });
    });
  }
  async invoiceAction(actor: Actor, id: string, input: unknown, key: string) {
    const d = z
      .object({
        version,
        subscriptionVersion: version,
        action: z.enum(['PAY_SUCCEEDED', 'PAY_FAILED', 'VOID', 'REMIND']),
        reference: z
          .string()
          .regex(/^plan_[A-Za-z0-9_-]{6,95}$/)
          .optional(),
        note,
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const i = await tx.get<PlanInvoice>('planInvoices', id);
      ensure(i, 'NOT_FOUND', 'Plan invoice not found.', 404);
      const scope = await this.scope(tx, actor, i.storeId, true);
      actor = scope.actor;
      ensure(
        !['VOID', 'REMIND'].includes(d.action) || actor.role === 'ADMIN',
        'FORBIDDEN',
        'Platform finance action required.',
        403,
      );
      const retry = await this.replay(tx, actor, 'invoice', key, [id, d]);
      if (retry.prior) return retry.prior.result;
      const s = (await tx.get<MerchantSubscription>('merchantSubscriptions', i.storeId))!;
      ensure(
        i.version === d.version && s.version === d.subscriptionVersion,
        'VERSION_CONFLICT',
        'This invoice or plan changed.',
        409,
      );
      ensure(i.status === 'OPEN', 'IMMUTABLE_PLAN_INVOICE', 'This invoice is final.', 409);
      ensure(
        d.action === 'PAY_SUCCEEDED' ? !!d.reference : !d.reference,
        'INVALID_INPUT',
        'A receipt reference belongs only to a successful payment.',
      );
      if (d.action === 'PAY_SUCCEEDED') {
        ensure(
          !(await tx.list<PlanInvoice>('planInvoices')).some((x) => x.reference === d.reference),
          'REFERENCE_USED',
          'This plan receipt was already recorded.',
          409,
        );
        const start = Math.max(this.now(), s.annualEndsAt ?? 0);
        i.status = 'PAID';
        i.paidAt = this.now();
        i.reference = d.reference;
        i.coverageStartAt = start;
        i.coverageEndAt = annualEnd(start);
        i.attempts.push({
          at: this.now(),
          outcome: 'SUCCEEDED',
          role: actor.role as 'MERCHANT' | 'ADMIN',
          reference: d.reference,
        });
        s.status = 'ANNUAL_ACTIVE';
        s.annualStartedAt = start;
        s.annualEndsAt = i.coverageEndAt;
        s.renewal = 'ANNUAL';
      } else if (d.action === 'PAY_FAILED') {
        ensure(
          i.attempts.length < 50,
          'HISTORY_LIMIT',
          'Review the attempts before trying again.',
          429,
        );
        i.attempts.push({
          at: this.now(),
          outcome: 'FAILED',
          role: actor.role as 'MERCHANT' | 'ADMIN',
        });
      } else if (d.action === 'VOID') {
        i.status = 'VOID';
        s.renewal = 'STANDARD';
        if (!s.annualEndsAt || s.annualEndsAt <= this.now())
          s.status = s.status === 'TRIALING' ? 'TRIALING' : 'STANDARD';
      } else {
        ensure(
          !(await tx.list<SubscriptionEvent>('subscriptionEvents')).some(
            (e) => e.invoiceId === id && e.action === 'REMIND' && e.at > this.now() - day,
          ),
          'REMINDER_RECENT',
          'A local reminder was already queued in the last day.',
          409,
        );
      }
      i.version++;
      i.updatedAt = this.now();
      await tx.put('planInvoices', i);
      await event(tx, i.storeId, d.action, this.now(), actor, i.id, d.note);
      return this.save(tx, s, retry, { ...i });
    });
  }
}
