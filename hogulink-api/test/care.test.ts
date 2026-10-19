import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, Booking, CustomerRestriction, SupportTicket } from '@hogulink/contracts';
import { Repository } from '../src/repository.js';
import { Engine } from '../src/engine.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';

const customer: Actor = { id: 'care-customer', role: 'CUSTOMER', verificationLevel: 1 };
const other: Actor = { id: 'other-customer', role: 'CUSTOMER', verificationLevel: 1 };
const owner: Actor = {
  id: 'owner-nagi',
  role: 'MERCHANT',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const otherOwner: Actor = {
  id: 'owner-mori',
  role: 'MERCHANT',
  storeId: 'store-mori',
  verificationLevel: 1,
};
const staff: Actor = {
  id: 'staff-aoi-account',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const admin: Actor = { id: 'care-admin', role: 'ADMIN', verificationLevel: 3 };
const reason = (code: string) => (error: unknown) =>
  error instanceof DomainError && error.code === code;
async function fixture(fn: (e: Engine, b: Booking, clock: { value: number }) => Promise<void>) {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  await seed(repo);
  const clock = { value: Date.UTC(2026, 9, 18, 0) };
  const e = new Engine(repo, () => clock.value);
  try {
    const q = await e.quote(customer, { ...quoteInput(e), startAt: e.now() + 60 * 60_000 });
    const h = await e.hold(customer, q.id);
    const p = await e.authorizeDemo(customer, h.id, true);
    const b = await e.createBooking(
      customer,
      {
        holdId: h.id,
        quoteId: q.id,
        paymentId: p.id,
        termsAccepted: true,
        policyVersion: q.cancellationPolicy.version,
        address: {
          name: 'Demo Care Guest',
          area: 'shinjuku',
          type: 'HOTEL',
          detail: 'Demo street 123',
          hotelName: 'Demo Hotel',
          room: '202',
          hotelPermission: true,
        },
      },
      crypto.randomUUID(),
    );
    await fn(e, b, clock);
  } finally {
    await repo.close();
  }
}
function quoteInput(e: Engine, otherStore = false) {
  return {
    listingId: otherStore ? 'listing-yuki' : 'listing-aoi',
    offeringId: otherStore ? 'store-mori-60' : 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: e.now() + 180 * 60_000,
    area: 'shinjuku',
    requiredLanguage: '',
  };
}
function input(b: Booking, extra: Record<string, unknown> = {}) {
  return {
    bookingId: b.id,
    category: 'SERVICE_QUALITY',
    subject: 'Service explanation issue',
    description: 'Please review the service explanation provided during this demo visit.',
    ...extra,
  };
}
const action = (ticket: SupportTicket, value: string, extra: Record<string, unknown> = {}) => ({
  version: ticket.version,
  action: value,
  text: 'Reviewed the facts and recorded the next action.',
  ...extra,
});

test('ordinary support is routed to the shop; sensitive reports go directly to platform', () =>
  fixture(async (e, b) => {
    const ordinary = await e.care.create(customer, input(b), 'ordinary-key');
    const sensitive = await e.care.create(
      customer,
      input(b, { category: 'SAFETY', description: 'Private report of a safety concern.' }),
      'sensitive-key',
    );
    assert.equal(ordinary.status, 'NEEDS_MERCHANT');
    assert.equal(ordinary.visibility, 'SHOP_AND_CUSTOMER');
    assert.equal(sensitive.status, 'PLATFORM_ESCALATED');
    assert.equal(sensitive.visibility, 'PLATFORM_ONLY');
    assert.equal(sensitive.priority, 'HIGH');
    assert.deepEqual(
      (await e.care.list(owner)).map((x) => x.id),
      [ordinary.id],
    );
    assert.equal((await e.care.list(admin)).length, 2);
    await assert.rejects(e.care.detail(owner, sensitive.id), reason('NOT_FOUND'));
  }));
test('case creation is idempotent under concurrent retries and rejects changed retry input', () =>
  fixture(async (e, b) => {
    const [first, second] = await Promise.all([
      e.care.create(customer, input(b), 'same-request-key'),
      e.care.create(customer, input(b), 'same-request-key'),
    ]);
    assert.equal(first.id, second.id);
    assert.equal((await e.care.list(customer)).length, 1);
    await assert.rejects(
      e.care.create(customer, input(b, { subject: 'Changed subject' }), 'same-request-key'),
      reason('IDEMPOTENCY_CONFLICT'),
    );
  }));
test('ticket creation requires own booking for service issues; independent safety reports are supported', () =>
  fixture(async (e, b) => {
    await assert.rejects(e.care.create(other, input(b), 'foreign-key'), reason('NOT_FOUND'));
    await assert.rejects(
      e.care.create(customer, { ...input(b), bookingId: undefined }, 'no-booking-key'),
      reason('BOOKING_REQUIRED'),
    );
    const independent = await e.care.create(
      customer,
      {
        category: 'PRIVACY',
        subject: 'Privacy concern',
        description: 'I would like the platform to investigate a privacy concern.',
      },
      'privacy-key',
    );
    assert.equal(independent.storeId, undefined);
    assert.equal(independent.visibility, 'PLATFORM_ONLY');
  }));
test('customers, shops and staff cannot enumerate unrelated support cases', () =>
  fixture(async (e, b) => {
    const item = await e.care.create(customer, input(b), 'case-isolation-key');
    for (const actor of [other, otherOwner, staff]) {
      assert.equal((await e.care.list(actor)).length, 0);
      await assert.rejects(e.care.detail(actor, item.id), reason('NOT_FOUND'));
      await assert.rejects(
        e.care.reply(actor, item.id, item.version, 'Attempted foreign reply'),
        reason('NOT_FOUND'),
      );
    }
  }));
test('reply versions prevent lost updates; shop/customer response status is tracked', () =>
  fixture(async (e, b) => {
    let item = await e.care.create(customer, input(b), 'reply-case-key');
    const stale = item.version;
    item = await e.care.reply(
      owner,
      item.id,
      item.version,
      'Please confirm the details of your visit.',
    );
    assert.equal(item.status, 'OPEN');
    await assert.rejects(
      e.care.reply(customer, item.id, stale, 'This is a stale reply.'),
      reason('VERSION_CONFLICT'),
    );
    item = await e.care.reply(
      customer,
      item.id,
      item.version,
      'The details require another shop response.',
    );
    assert.equal(item.status, 'NEEDS_MERCHANT');
    assert.equal((await e.care.detail(customer, item.id)).messages.length, 2);
  }));
test('escalated cases require platform resolution; reporter can close and reopen', () =>
  fixture(async (e, b) => {
    let item = await e.care.create(customer, input(b), 'escalation-key');
    await assert.rejects(
      e.care.action(customer, item.id, action(item, 'RESOLVE')),
      reason('FORBIDDEN'),
    );
    item = await e.care.action(customer, item.id, action(item, 'ESCALATE'));
    await assert.rejects(
      e.care.action(owner, item.id, action(item, 'RESOLVE')),
      reason('PLATFORM_REVIEW_REQUIRED'),
    );
    item = await e.care.action(admin, item.id, action(item, 'RESOLVE'));
    assert.equal(item.status, 'RESOLVED');
    item = await e.care.action(customer, item.id, action(item, 'CLOSE'));
    assert.equal(item.status, 'CLOSED');
    await assert.rejects(
      e.care.reply(owner, item.id, item.version, 'Cannot reply on a closed case.'),
      reason('INVALID_STATE'),
    );
    item = await e.care.action(customer, item.id, action(item, 'REOPEN'));
    assert.equal(item.status, 'PLATFORM_ESCALATED');
    assert.equal(item.resolution, undefined);
    assert.ok(
      (await e.care.detail(customer, item.id)).messages.some((x) => x.kind === 'RESOLUTION'),
    );
  }));
test('ordinary shop resolutions do not modify refunds or financial booking state', () =>
  fixture(async (e, b) => {
    let item = await e.care.create(customer, input(b), 'shop-resolution-key');
    item = await e.care.action(owner, item.id, action(item, 'RESOLVE'));
    assert.equal(item.status, 'RESOLVED');
    const booking = await e.booking(customer, b.id);
    assert.equal(booking.capturedAmount, 0);
    assert.equal(booking.paymentStatus, 'AUTHORIZED');
  }));
test('overdue shop replies automatically escalate once with an audit trail', () =>
  fixture(async (e, b, clock) => {
    const item = await e.care.create(customer, input(b), 'overdue-key');
    clock.value = item.dueAt + 1;
    const first = (await e.care.detail(customer, item.id)).ticket;
    assert.equal(first.status, 'PLATFORM_ESCALATED');
    assert.equal(first.version, 2);
    const second = (await e.care.detail(customer, item.id)).ticket;
    assert.equal(second.version, 2);
    const d = await e.dashboard(admin);
    assert.equal(d.audit.filter((x) => x.action === 'SUPPORT_REPLY_OVERDUE').length, 1);
  }));
test('support quota prevents unbounded open requests without breaking an idempotent replay', () =>
  fixture(async (e, b) => {
    for (let i = 0; i < 10; i++) await e.care.create(customer, input(b), `quota-key-${i}`);
    await assert.rejects(
      e.care.create(customer, input(b), 'quota-over-limit'),
      reason('SUPPORT_LIMIT'),
    );
    const replay = await e.care.create(customer, input(b), 'quota-key-0');
    assert.ok(replay.id);
  }));
test('shop customer blocks are private, scoped to the shop, and reversible', () =>
  fixture(async (e, b) => {
    let block = await e.care.setBlock(owner, customer.id, {
      active: true,
      reason: 'Private internal shop reason',
      version: 0,
    });
    await assert.rejects(e.quote(customer, quoteInput(e)), reason('CUSTOMER_RESTRICTED'));
    assert.ok(await e.quote(customer, quoteInput(e, true)));
    assert.equal((await e.care.blocks(otherOwner)).length, 0);
    await assert.rejects(e.care.blocks(customer), reason('FORBIDDEN'));
    await assert.rejects(e.care.blocks(admin), reason('FORBIDDEN'));
    await assert.rejects(
      e.care.setBlock(otherOwner, customer.id, {
        active: true,
        reason: 'Other shop reason',
        version: 0,
      }),
      reason('NOT_FOUND'),
    );
    block = await e.care.setBlock(owner, customer.id, {
      active: false,
      reason: 'Shop concern reviewed and released',
      version: block.version,
    });
    assert.equal(block.active, false);
    assert.ok(await e.quote(customer, quoteInput(e)));
  }));
test('block version checks prevent stale updates and cannot block arbitrary customer IDs', () =>
  fixture(async (e) => {
    await assert.rejects(
      e.care.setBlock(owner, 'unknown-customer', {
        active: true,
        reason: 'Unrelated identity',
        version: 0,
      }),
      reason('NOT_FOUND'),
    );
    await e.care.setBlock(owner, customer.id, {
      active: true,
      reason: 'Shop review required',
      version: 0,
    });
    await assert.rejects(
      e.care.setBlock(owner, customer.id, {
        active: false,
        reason: 'Stale release attempt',
        version: 0,
      }),
      reason('VERSION_CONFLICT'),
    );
  }));
test('staff safety feedback is confidential and holds new shop bookings until platform review', () =>
  fixture(async (e, b) => {
    const item = await e.care.feedback(
      staff,
      b.id,
      'Confidential staff safety concern for platform review.',
    );
    assert.equal((await e.care.list(customer)).length, 0);
    assert.equal((await e.care.list(owner)).length, 0);
    assert.equal((await e.care.list(staff)).length, 1);
    assert.ok(!('address' in item));
    await assert.rejects(e.care.detail(customer, item.id), reason('NOT_FOUND'));
    await assert.rejects(e.quote(customer, quoteInput(e)), reason('CUSTOMER_RESTRICTED'));
    const block = (await e.care.blocks(owner))[0];
    assert.equal(block.reviewRequired, true);
    assert.ok(!block.reason.includes('Confidential'));
    await assert.rejects(
      e.care.setBlock(owner, customer.id, {
        active: false,
        reason: 'Attempted safety bypass',
        version: block.version,
      }),
      reason('PLATFORM_REVIEW_REQUIRED'),
    );
    await e.care.action(admin, item.id, action(item, 'RESOLVE', { releaseShopBlock: true }));
    assert.ok(await e.quote(customer, quoteInput(e)));
    assert.equal((await e.care.blocks(owner))[0].active, false);
  }));
test('duplicate staff feedback is deduplicated and other staff cannot report this booking', () =>
  fixture(async (e, b) => {
    const a = await e.care.feedback(staff, b.id, 'A staff safety concern was observed for review.');
    const c = await e.care.feedback(staff, b.id, 'Another retry of the same staff concern.');
    assert.equal(a.id, c.id);
    await assert.rejects(
      e.care.feedback(
        { ...staff, id: 'ren-account', staffId: 'staff-ren' },
        b.id,
        'An unrelated person cannot submit this report.',
      ),
      reason('NOT_FOUND'),
    );
  }));
test('reopening a staff safety case restores the shop review hold', () =>
  fixture(async (e, b) => {
    let item = await e.care.feedback(
      staff,
      b.id,
      'Please review this private staff safety concern.',
    );
    item = await e.care.action(admin, item.id, action(item, 'RESOLVE', { releaseShopBlock: true }));
    item = await e.care.action(staff, item.id, action(item, 'REOPEN'));
    assert.equal(item.status, 'PLATFORM_ESCALATED');
    await assert.rejects(e.quote(customer, quoteInput(e)), reason('CUSTOMER_RESTRICTED'));
    assert.equal((await e.care.blocks(owner))[0].reviewRequired, true);
  }));
test('platform restrictions apply across shops, expose no investigation reason, and expire', () =>
  fixture(async (e, b, clock) => {
    await e.care.setRestriction(admin, {
      customerId: customer.id,
      active: true,
      reason: 'Private investigation rationale',
      expiresAt: e.now() + 60 * 60_000,
      version: 0,
    });
    await assert.rejects(e.quote(customer, quoteInput(e)), reason('CUSTOMER_RESTRICTED'));
    await assert.rejects(e.quote(customer, quoteInput(e, true)), reason('CUSTOMER_RESTRICTED'));
    const visible = await e.care.restrictions(customer);
    assert.equal(visible.length, 1);
    assert.ok(!JSON.stringify(visible).includes('Private'));
    assert.ok(!('reason' in visible[0]));
    await assert.rejects(e.care.restrictions(owner), reason('FORBIDDEN'));
    clock.value += 60 * 60_000 + 1;
    assert.equal((await e.care.restrictions(customer)).length, 0);
    assert.ok(await e.quote(customer, quoteInput(e)));
  }));
test('restrictions require a known account, bounded expiry and an administrator', () =>
  fixture(async (e) => {
    const data = {
      customerId: customer.id,
      active: true,
      reason: 'Safety investigation',
      expiresAt: e.now() + 60 * 60_000,
      version: 0,
    };
    await assert.rejects(e.care.setRestriction(owner, data), reason('FORBIDDEN'));
    await assert.rejects(
      e.care.setRestriction(admin, { ...data, customerId: 'unknown' }),
      reason('NOT_FOUND'),
    );
    await assert.rejects(
      e.care.setRestriction(admin, { ...data, expiresAt: e.now() - 1 }),
      reason('INVALID_EXPIRY'),
    );
    await assert.rejects(
      e.care.setRestriction(admin, { ...data, expiresAt: e.now() + 31 * 24 * 60 * 60_000 }),
      reason('INVALID_EXPIRY'),
    );
  }));
test('restricted customers can appeal and a platform decision can restore booking', () =>
  fixture(async (e) => {
    const restriction = await e.care.setRestriction(admin, {
      customerId: customer.id,
      active: true,
      reason: 'Private report pending review',
      expiresAt: e.now() + 60 * 60_000,
      version: 0,
    });
    let item = await e.care.appeal(
      customer,
      restriction.version,
      'Please review my account restriction with the available evidence.',
    );
    assert.equal(item.category, 'APPEAL');
    assert.equal(item.restrictionVersion, restriction.version);
    assert.equal(
      (await e.care.appeal(customer, restriction.version, 'Retrying the same appeal request.')).id,
      item.id,
    );
    await assert.rejects(e.care.detail(owner, item.id), reason('NOT_FOUND'));
    item = await e.care.action(
      admin,
      item.id,
      action(item, 'RESOLVE', { releaseRestriction: true }),
    );
    assert.equal(item.status, 'RESOLVED');
    assert.equal((await e.care.restrictions(customer)).length, 0);
    assert.ok(await e.quote(customer, quoteInput(e)));
  }));
test('a stale appeal cannot release a newer restriction; failed release does not resolve the case', () =>
  fixture(async (e) => {
    let r = await e.care.setRestriction(admin, {
      customerId: customer.id,
      active: true,
      reason: 'Initial safety review',
      expiresAt: e.now() + 60 * 60_000,
      version: 0,
    });
    const item = await e.care.appeal(
      customer,
      r.version,
      'Please reconsider the account restriction.',
    );
    r = await e.care.setRestriction(admin, {
      customerId: customer.id,
      active: true,
      reason: 'New evidence requires a new decision',
      expiresAt: e.now() + 2 * 60 * 60_000,
      version: r.version,
    });
    await assert.rejects(
      e.care.action(admin, item.id, action(item, 'RESOLVE', { releaseRestriction: true })),
      reason('RESTRICTION_CHANGED'),
    );
    assert.equal((await e.care.detail(customer, item.id)).ticket.status, 'PLATFORM_ESCALATED');
    assert.equal((await e.care.restrictions(customer))[0].version, r.version);
    assert.notEqual(
      (await e.care.appeal(customer, r.version, 'Please review this latest decision separately.'))
        .id,
      item.id,
    );
  }));
test('shop and customer cannot use case actions to bypass a platform restriction', () =>
  fixture(async (e, b) => {
    const item = await e.care.create(customer, input(b), 'no-bypass-key');
    await assert.rejects(
      e.care.action(customer, item.id, action(item, 'RESOLVE', { releaseRestriction: true })),
      reason('FORBIDDEN'),
    );
    await assert.rejects(
      e.care.action(owner, item.id, action(item, 'RESOLVE', { releaseShopBlock: true })),
      reason('FORBIDDEN'),
    );
    await assert.rejects(
      e.care.action(admin, item.id, action(item, 'RESOLVE', { releaseRestriction: true })),
      reason('INVALID_STATE'),
    );
  }));
test('safety event resolution is versioned, audited, and private to the platform', () =>
  fixture(async (e, b) => {
    const updated = await e.safety(staff, b.id, 'SOS', b.version);
    const event = (await e.care.safetyEvents(admin))[0];
    await assert.rejects(
      e.care.resolveSafety(owner, event.id, 1, 'Not allowed to resolve a platform event.'),
      reason('FORBIDDEN'),
    );
    const result = await e.care.resolveSafety(
      admin,
      event.id,
      1,
      'Contacted demo staff and verified the situation was safe.',
    );
    assert.equal(result.status, 'RESOLVED');
    assert.equal(result.version, 2);
    assert.equal((await e.booking(customer, b.id)).status, updated.status);
    assert.ok(!('resolution' in (await e.care.safetyEvents(owner))[0]));
    assert.ok(!('resolution' in (await e.dashboard(owner)).safety[0]));
    assert.ok(!('resolution' in (await e.care.safetyEvents(staff))[0]));
    assert.equal((await e.care.safetyEvents(otherOwner)).length, 0);
    await assert.rejects(
      e.care.resolveSafety(admin, event.id, 1, 'Duplicate stale event resolution.'),
      reason('VERSION_CONFLICT'),
    );
    assert.ok((await e.dashboard(admin)).audit.some((x) => x.action === 'SAFETY_EVENT_RESOLVED'));
  }));
test('private case narratives are not copied into audit or notification payloads', () =>
  fixture(async (e, b) => {
    const secret = 'Private narrative reference ABC-DO-NOT-SHARE';
    const item = await e.care.create(
      customer,
      input(b, { category: 'PRIVACY', description: secret }),
      'privacy-audit-key',
    );
    await e.care.reply(
      admin,
      item.id,
      item.version,
      'Private response details also remain in the case.',
    );
    const d = await e.dashboard(admin);
    assert.ok(!JSON.stringify(d.audit).includes(secret));
    await e.repo.transaction(async (tx) =>
      assert.ok(!JSON.stringify(await tx.list('outbox')).includes(secret)),
    );
  }));
