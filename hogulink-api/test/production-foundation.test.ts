import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Repository } from '../src/repository.js';
import { CustomerAuth } from '../src/customer-auth.js';
import { NotificationWorker, enqueueEmail, type Email, type Outbox } from '../src/notifications.js';
import { RateLimiter } from '../src/rate-limit.js';
import { DomainError } from '../src/errors.js';
import { seal, unseal } from '../src/secrets.js';
import {
  saveEvidence,
  loadEvidence,
  migrateEvidence,
  bundleEvidence,
  restoreEvidence,
} from '../src/evidence-storage.js';
import { queueContentReview, ContentReviewService, contentRuleIds } from '../src/content-review.js';
import { Engine } from '../src/engine.js';
import { seed } from '../src/seed.js';
import type { Actor, Booking } from '@hogulink/contracts';
const code = (name: string) => (error: unknown) =>
  error instanceof DomainError && error.code === name;
async function fixture(
  fn: (f: {
    repo: Repository;
    auth: CustomerAuth;
    worker: NotificationWorker;
    emails: Email[];
    clock: { now: number };
  }) => Promise<void>,
) {
  const repo = new Repository('', ':memory:');
  await repo.init();
  const clock = { now: Date.UTC(2026, 9, 19) },
    emails: Email[] = [];
  const worker = new NotificationWorker(
    repo,
    async (email) => {
      emails.push(email);
      return `provider-${emails.length}`;
    },
    () => clock.now,
  );
  try {
    await fn({ repo, auth: new CustomerAuth(repo, () => clock.now), worker, emails, clock });
  } finally {
    await repo.close();
  }
}
const registration = (email = 'guest@example.com') => ({
  email,
  password: 'a very strong passphrase',
  name: 'Guest',
  locale: 'zh-cn',
  termsAccepted: true,
});
function token(email: Email) {
  const link = email.text.split('\n').find((line) => line.startsWith('http'))!;
  return new URLSearchParams(new URL(link).hash.slice(1)).get('token')!;
}
async function verified(
  f: Parameters<Parameters<typeof fixture>[0]>[0],
  email = 'guest@example.com',
) {
  await f.auth.register(registration(email));
  await f.worker.tick();
  await f.auth.confirm({ token: token(f.emails.at(-1)!) }, 'verify');
  return f.auth.login({ email, password: registration().password });
}
test('AUTH-01 signup is private and unverified customers cannot sign in', () =>
  fixture(async (f) => {
    assert.deepEqual(await f.auth.register(registration()), { accepted: true });
    await assert.rejects(
      f.auth.login({ email: 'guest@example.com', password: registration().password }),
      code('EMAIL_NOT_VERIFIED'),
    );
    const rows = await f.repo.read((tx) => tx.list<Outbox>('outbox'));
    assert.ok(rows[0].payloadSealed);
    assert.ok(!JSON.stringify(rows[0]).includes('guest@example.com'));
    const raw = await f.repo.snapshot();
    assert.ok(!JSON.stringify(raw).includes('a very strong passphrase'));
    assert.ok(!JSON.stringify(raw).includes('guest@example.com'));
  }));
test('AUTH-02 verified customers have separate IDs and no shared addresses', () =>
  fixture(async (f) => {
    const first = await verified(f, 'first@example.com'),
      second = await verified(f, 'second@example.com');
    assert.notEqual(first.id, second.id);
    assert.equal(first.verificationLevel, 1);
    await f.repo.transaction((tx) =>
      tx.put('addressBooks', {
        id: first.id,
        version: 1,
        items: [{ id: 'addr1', detail: 'private room 900' }],
      }),
    );
    assert.equal(await f.repo.read((tx) => tx.get('addressBooks', second.id)), undefined);
    assert.ok(!JSON.stringify(await f.repo.snapshot()).includes('private room 900'));
    assert.equal((await f.auth.resolve(first)).id, first.id);
  }));
test('AUTH-03 tokens are single use, purpose bound, and expire', () =>
  fixture(async (f) => {
    await f.auth.register(registration());
    await f.worker.tick();
    const value = token(f.emails[0]);
    await assert.rejects(
      f.auth.confirm({ token: value, password: 'new strong password here' }, 'reset'),
      code('TOKEN_INVALID'),
    );
    await f.auth.confirm({ token: value }, 'verify');
    await assert.rejects(f.auth.confirm({ token: value }, 'verify'), code('TOKEN_INVALID'));
    await f.auth.request({ email: 'guest@example.com' }, 'reset');
    await f.worker.tick();
    f.clock.now += 16 * 60000;
    await assert.rejects(
      f.auth.confirm(
        { token: token(f.emails.at(-1)!), password: 'new strong password here' },
        'reset',
      ),
      code('TOKEN_INVALID'),
    );
  }));
test('AUTH-04 resend invalidates older links without changing the password', () =>
  fixture(async (f) => {
    await f.auth.register(registration());
    await f.worker.tick();
    const old = token(f.emails[0]);
    await f.auth.request({ email: 'guest@example.com' }, 'verify');
    await f.worker.tick();
    await assert.rejects(f.auth.confirm({ token: old }, 'verify'), code('TOKEN_INVALID'));
    await f.auth.confirm({ token: token(f.emails.at(-1)!) }, 'verify');
    assert.equal(
      (await f.auth.login({ email: 'GUEST@example.com', password: registration().password })).role,
      'CUSTOMER',
    );
  }));
test('AUTH-05 reset revokes all old customer sessions and rejects the old password', () =>
  fixture(async (f) => {
    const actor = await verified(f);
    await f.auth.request({ email: 'guest@example.com' }, 'reset');
    await f.worker.tick();
    await f.auth.confirm(
      { token: token(f.emails.at(-1)!), password: 'brand new strong password' },
      'reset',
    );
    await assert.rejects(f.auth.resolve(actor), code('UNAUTHENTICATED'));
    await assert.rejects(
      f.auth.login({ email: 'guest@example.com', password: registration().password }),
      code('INVALID_CREDENTIALS'),
    );
    const next = await f.auth.login({
      email: 'guest@example.com',
      password: 'brand new strong password',
    });
    assert.equal(next.id, actor.id);
    assert.notEqual(next.customerSessionVersion, actor.customerSessionVersion);
  }));
test('AUTH-06 duplicate signup cannot replace credentials and forgot does not enumerate accounts', () =>
  fixture(async (f) => {
    await verified(f);
    assert.deepEqual(
      await f.auth.register({ ...registration(), password: 'an attacker chosen password' }),
      { accepted: true },
    );
    await f.auth.login({ email: 'guest@example.com', password: registration().password });
    assert.deepEqual(await f.auth.request({ email: 'missing@example.com' }, 'reset'), {
      accepted: true,
    });
    assert.deepEqual(await f.auth.request({ email: 'guest@example.com' }, 'reset'), {
      accepted: true,
    });
  }));
test('AUTH-07 disabled customer and weak passwords fail closed', () =>
  fixture(async (f) => {
    await assert.rejects(f.auth.register({ ...registration(), password: 'short' }));
    const actor = await verified(f);
    await f.repo.transaction(async (tx) => {
      const a = await tx.get<any>('customerAccounts', actor.id);
      await tx.put('customerAccounts', { ...a, status: 'DISABLED' });
    });
    await assert.rejects(f.auth.resolve(actor), code('UNAUTHENTICATED'));
    await assert.rejects(
      f.auth.login({ email: 'guest@example.com', password: registration().password }),
      code('INVALID_CREDENTIALS'),
    );
  }));
test('AUTH-08 rate limits persist across limiter instances and reset at the deadline', () =>
  fixture(async (f) => {
    const a = new RateLimiter(f.repo, () => f.clock.now),
      b = new RateLimiter(f.repo, () => f.clock.now);
    await a.check('test', 'private@example.com', 1);
    await assert.rejects(b.check('test', 'private@example.com', 1), code('RATE_LIMITED'));
    assert.ok(!JSON.stringify(await f.repo.snapshot()).includes('private@example.com'));
    f.clock.now += 60000;
    await b.check('test', 'private@example.com', 1);
  }));
test('NOTIFY-01 failed requests retry, accept once, and never expose payloads to the dashboard', () =>
  fixture(async (f) => {
    await f.repo.transaction((tx) =>
      enqueueEmail(
        tx,
        { to: 'guest@example.com', subject: 'test', text: 'private email body' },
        'TEST',
        f.clock.now,
      ),
    );
    let calls = 0;
    const worker = new NotificationWorker(
      f.repo,
      async () => {
        calls++;
        if (calls === 1) throw new Error('provider secret');
        return 'accepted-1';
      },
      () => f.clock.now,
    );
    await worker.tick();
    let jobs = await f.repo.read((tx) => tx.list<Outbox>('outbox'));
    assert.equal(jobs[0].status, 'RETRY');
    assert.equal(jobs[0].lastError, 'DELIVERY_FAILED');
    await worker.tick();
    assert.equal(calls, 1);
    f.clock.now += 30001;
    await worker.tick();
    await worker.tick();
    assert.equal(calls, 2);
    const snapshot = await worker.snapshot({ id: 'owner', role: 'ADMIN', verificationLevel: 3 });
    assert.equal(snapshot.counts.SENT, 1);
    assert.ok(!JSON.stringify(snapshot).includes('private email body'));
    assert.ok(!JSON.stringify(snapshot).includes('payloadSealed'));
    assert.equal(snapshot.jobs[0].delivery, 'PROVIDER_ACCEPTED');
  }));
test('NOTIFY-02 disabled provider preserves pending work, missing recipients block truthfully', () =>
  fixture(async (f) => {
    await f.repo.transaction((tx) =>
      tx.put('outbox', {
        id: 'job-1',
        type: 'BOOKING_CREATED',
        createdAt: f.clock.now,
        status: 'PENDING',
      }),
    );
    await new NotificationWorker(f.repo).tick();
    assert.equal((await f.repo.read((tx) => tx.get<Outbox>('outbox', 'job-1')))!.status, 'PENDING');
    await f.worker.tick();
    assert.equal((await f.repo.read((tx) => tx.get<Outbox>('outbox', 'job-1')))!.status, 'BLOCKED');
    assert.equal(f.emails.length, 0);
  }));
test('NOTIFY-03 two workers claim a notification only once', () =>
  fixture(async (f) => {
    await f.repo.transaction((tx) =>
      enqueueEmail(
        tx,
        { to: 'guest@example.com', subject: 'one', text: 'one' },
        'TEST',
        f.clock.now,
      ),
    );
    let calls = 0;
    const send = async () => {
      calls++;
      return 'one';
    };
    await Promise.all([
      new NotificationWorker(f.repo, send, () => f.clock.now).tick(),
      new NotificationWorker(f.repo, send, () => f.clock.now).tick(),
    ]);
    assert.equal(calls, 1);
  }));
test('DATA-01 filtered reads and due index survive inserts, updates and deletes', () =>
  fixture(async (f) => {
    await f.repo.transaction(async (tx) => {
      await tx.put('holds', {
        id: 'h',
        active: true,
        phase: 'CHECKOUT_HOLD',
        expiresAt: f.clock.now + 10,
      });
      await tx.put('holds', { id: 'old', active: false, expiresAt: f.clock.now - 100 });
    });
    assert.equal(await f.repo.hasDue(f.clock.now), false);
    assert.equal(await f.repo.hasDue(f.clock.now + 10), true);
    assert.equal(
      (
        await f.repo.read((tx) =>
          tx.find('holds', { active: true, expiresAt: { lte: f.clock.now + 10 } }),
        )
      ).length,
      1,
    );
    await f.repo.transaction((tx) => tx.remove('holds', 'h'));
    assert.equal(await f.repo.hasDue(f.clock.now + 10), false);
    await assert.rejects(
      f.repo.read((tx) => tx.put('test', { id: 'no' })),
      /read-only/,
    );
  }));
test('DATA-02 encrypted backup restores records and booking intervals into an empty database', () =>
  fixture(async (f) => {
    await verified(f);
    await f.repo.transaction(async (tx) => {
      await tx.put('messages', { id: 'm', bookingId: 'b', text: 'private conversation' });
      await tx.interval({ id: 'i', staffId: 's', startAt: 10, endAt: 20, expiresAt: 100 });
    });
    const encrypted = seal(JSON.stringify(await f.repo.snapshot()), 'backup:v1');
    assert.ok(!encrypted.includes('private conversation'));
    const destination = new Repository('', ':memory:');
    await destination.init();
    try {
      await destination.restore(JSON.parse(unseal(encrypted, 'backup:v1').toString()));
      assert.equal(
        (await destination.read((tx) => tx.get<any>('messages', 'm'))).text,
        'private conversation',
      );
      assert.equal(await destination.read((tx) => tx.conflicts('s', 15, 18)), true);
      await assert.rejects(destination.restore(await f.repo.snapshot()), /empty database/);
    } finally {
      await destination.close();
    }
  }));
test('DATA-03 encrypted records detect tampering and context substitution', () => {
  const value = seal('private', 'a');
  assert.equal(unseal(value, 'a').toString(), 'private');
  assert.throws(() => unseal(value, 'b'));
  const bytes = Buffer.from(value, 'base64');
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => unseal(bytes.toString('base64'), 'a'));
});
test('FILE-01 evidence bytes are encrypted outside the database and legacy migration is repeatable', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'hogu-evidence-')),
    old = process.env.EVIDENCE_DIRECTORY;
  process.env.EVIDENCE_DIRECTORY = folder;
  const repo = new Repository('', ':memory:');
  await repo.init();
  try {
    const id = 'evidence_11111111-1111-4111-8111-111111111111',
      bytes = Buffer.from('%PDF-private document');
    await repo.transaction((tx) =>
      tx.put('partnerEvidence', { id, data: bytes.toString('base64') }),
    );
    assert.deepEqual(await migrateEvidence(repo), { migrated: 1 });
    assert.deepEqual(await migrateEvidence(repo), { migrated: 0 });
    const record = await repo.read((tx) => tx.get<any>('partnerEvidence', id));
    assert.equal(record.data, undefined);
    assert.deepEqual(await loadEvidence(record), bytes);
    assert.ok(!(await readFile(join(folder, `${id}.enc`), 'utf8')).includes('private document'));
    const snapshot = await repo.snapshot(),
      files = await bundleEvidence(
        snapshot.records as { kind: string; id: string; body: string }[],
      );
    assert.equal(files.length, 1);
    process.env.EVIDENCE_DIRECTORY = join(folder, 'restored');
    await restoreEvidence(files, snapshot.records as { kind: string; id: string; body: string }[]);
    assert.deepEqual(await loadEvidence(record), bytes);
    await assert.rejects(
      restoreEvidence([], snapshot.records as { kind: string; id: string; body: string }[]),
      /missing evidence/,
    );
    await assert.rejects(saveEvidence('../escape', bytes), /Invalid evidence/);
  } finally {
    await repo.close();
    if (old === undefined) delete process.env.EVIDENCE_DIRECTORY;
    else process.env.EVIDENCE_DIRECTORY = old;
    if (!resolve(folder).startsWith(resolve(tmpdir(), 'hogu-evidence-')))
      throw new Error('Unexpected temporary directory');
    await rm(folder, { recursive: true, force: true });
  }
});
test('PERF-01 discovery does not enumerate archived bookings or write without due work', () =>
  fixture(async (f) => {
    await seed(f.repo);
    const e = new Engine(f.repo, () => f.clock.now);
    await e.run(async () => {});
    const transaction = f.repo.transaction.bind(f.repo);
    let writes = 0;
    f.repo.transaction = async (fn) => {
      writes++;
      return transaction(fn);
    };
    const a = await e.publicCatalog();
    await e.availability(a.listings[0].id);
    assert.equal(writes, 0);
  }));
test('CONTENT-01 blocked messages persist in a private queue and only safety reviewers can read them', () =>
  fixture(async (f) => {
    const customer: Actor = { id: 'c', role: 'CUSTOMER', verificationLevel: 1 },
      owner: Actor = { id: 'admin', role: 'ADMIN', verificationLevel: 3 },
      support: Actor = {
        id: 'support',
        role: 'ADMIN',
        adminRole: 'SUPPORT',
        adminTeams: ['CUSTOMER_SUPPORT'],
        verificationLevel: 3,
      };
    const service = new ContentReviewService(f.repo, () => f.clock.now);
    const text = 'please provide a happy ending';
    await f.repo.transaction((tx) =>
      queueContentReview(tx, customer, 'booking-1', text, contentRuleIds(text), f.clock.now),
    );
    await assert.rejects(service.list(support), code('FORBIDDEN'));
    await assert.rejects(service.list(customer), code('FORBIDDEN'));
    const rows = await service.list(owner);
    assert.equal(rows.length, 1);
    assert.ok(!JSON.stringify(rows).includes('happy ending'));
    assert.ok(!JSON.stringify(await f.repo.snapshot()).includes('happy ending'));
    assert.equal((await service.detail(owner, rows[0].id)).text, text);
    await service.review(owner, rows[0].id, {
      decision: 'POLICY_CONFIRMED',
      note: 'Safety review completed privately.',
    });
    await assert.rejects(
      service.review(owner, rows[0].id, {
        decision: 'FALSE_POSITIVE',
        note: 'another review attempt',
      }),
      code('INVALID_STATE'),
    );
    assert.equal((await f.repo.read((tx) => tx.list('messages'))).length, 0);
  }));
test('CONTENT-02 policy rules cover all three languages and normalize common obfuscation', () => {
  for (const text of [
    'happy ending',
    'ｈａｐｐｙ ending',
    'happy\u200bending',
    '特殊服務',
    '全套',
    'ヌキ',
    '性的サービス',
  ])
    assert.ok(contentRuleIds(text).length, text);
  assert.deepEqual(contentRuleIds('Please arrive at the hotel lobby.'), []);
});
test('DATA-04 standard subscriptions do not continually force public discovery into writes', () =>
  fixture(async (f) => {
    await f.repo.transaction((tx) =>
      tx.put('merchantSubscriptions', {
        id: 'store-old',
        status: 'STANDARD',
        trialEndsAt: f.clock.now - 86400000,
        annualEndsAt: f.clock.now - 86400000,
      }),
    );
    assert.equal(await f.repo.hasDue(f.clock.now), false);
  }));
test('DATA-05 automatic acceptance counts include cancelled service-day usage and legacy rows', () =>
  fixture(async (f) => {
    await f.repo.transaction(async (tx) => {
      await tx.put('bookings', {
        id: 'new',
        storeId: 's',
        status: 'CANCELLED',
        quote: { startAt: f.clock.now },
        acceptanceDecision: { outcome: 'AUTO_ACCEPTED' },
      });
      await tx.put('bookings', {
        id: 'legacy',
        storeId: 's',
        status: 'CANCELLED',
        quote: { startAt: f.clock.now },
        merchantAcceptance: 'AUTO_ACCEPTED',
      });
      await tx.put('bookings', {
        id: 'manual',
        storeId: 's',
        quote: { startAt: f.clock.now },
        acceptanceDecision: { outcome: 'MANUAL' },
        merchantAcceptance: 'AUTO_ACCEPTED',
      });
    });
    assert.equal(
      await f.repo.read((tx) =>
        tx.count('bookings', { storeId: 's', 'acceptanceDecision.outcome': 'AUTO_ACCEPTED' }),
      ),
      1,
    );
    assert.equal(
      await f.repo.read((tx) =>
        tx.count('bookings', {
          storeId: 's',
          acceptanceDecision: null,
          merchantAcceptance: 'AUTO_ACCEPTED',
        }),
      ),
      1,
    );
  }));
test('NOTIFY-04 account emails are not starved by a historical event backlog and expired links are not sent', () =>
  fixture(async (f) => {
    await f.repo.transaction(async (tx) => {
      for (let i = 0; i < 8; i++)
        await tx.put('outbox', {
          id: `old-${i}`,
          type: 'OLD_EVENT',
          status: 'PENDING',
          createdAt: f.clock.now - 1000,
        });
      await enqueueEmail(
        tx,
        { to: 'new@example.test', subject: 'verify', text: 'token' },
        'CUSTOMER_VERIFY',
        f.clock.now,
      );
    });
    await f.worker.tick();
    assert.ok(f.emails.some((email) => email.to === 'new@example.test'));
    await f.repo.transaction((tx) =>
      enqueueEmail(
        tx,
        { to: 'expired@example.test', subject: 'reset', text: 'expired token' },
        'CUSTOMER_RESET',
        f.clock.now,
      ),
    );
    f.clock.now += 16 * 60000;
    await f.worker.tick();
    assert.ok(!f.emails.some((email) => email.to === 'expired@example.test'));
  }));
test('NOTIFY-05 private safety notifications are not disclosed to the customer', () =>
  fixture(async (f) => {
    const actor = await verified(f);
    f.emails.length = 0;
    await f.repo.transaction(async (tx) => {
      await tx.put('bookings', { id: 'booking', storeId: 'shop', customerId: actor.id });
      await tx.put('outbox', {
        id: 'safety-event',
        type: 'STAFF_SAFETY_REPORTED',
        bookingId: 'booking',
        status: 'PENDING',
        createdAt: f.clock.now,
      });
    });
    await f.worker.tick();
    assert.equal(f.emails.length, 0);
  }));
test('PUBLIC-01 catalog and both favorite views omit private shop settings and identifiers', () =>
  fixture(async (f) => {
    await seed(f.repo);
    const e = new Engine(f.repo, () => f.clock.now),
      customer: Actor = { id: 'public-customer', role: 'CUSTOMER', verificationLevel: 1 };
    await e.engagement.favorite(customer, 'store-nagi', { version: 0, active: true });
    await e.experience.favorite(customer, 'listing-aoi', { version: 0, active: true });
    const catalog = await e.publicCatalog(),
      shops = await e.engagement.favorites(customer),
      staff = await e.experience.favorites(customer);
    for (const store of [...catalog.stores, shops[0].store!, staff[0].store!])
      for (const key of [
        'merchantId',
        'ruleVersion',
        'billingBlocked',
        'acceptanceRule',
        'pspAccount',
        'emergencyContact',
        'plan',
        'ownerStaffId',
        'moderationVersion',
      ])
        assert.equal((store as any)[key], undefined, key);
    assert.equal(
      shops[0].store!.bookingRules?.nominationFee,
      catalog.stores.find((s) => s.id === 'store-nagi')!.bookingRules?.nominationFee,
    );
  }));
