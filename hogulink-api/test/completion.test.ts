import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Booking } from '@hogulink/contracts';
import {
  fixture,
  booking,
  start,
  customer,
  shop,
  staff,
  admin,
} from './helpers/experience-fixture.js';
import { completionWindowMs } from '../src/completion.js';
const code = (value: string) => (e: unknown) => (e as { code?: string }).code === value;
const key = () => randomUUID();
const current = (e: any, id: string) => e.booking(customer, id) as Promise<Booking>;
const confirm = (e: any, b: Booking, k = key()) =>
  e.completionAction(
    customer,
    b.id,
    { version: b.version, action: 'CONFIRM', expectedAmount: b.quote.total },
    k,
  );
async function request(e: any, clock: { now: number }, b?: Booking) {
  b = await start(e, clock, b);
  clock.now = b.startedAt! + b.quote.endAt - b.quote.startAt;
  return e.event(staff, b.id, b.version, 'COMPLETE') as Promise<Booking>;
}
test('service cannot start one millisecond before booked time; server timestamp is authoritative', async () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    clock.now = b.quote.startAt - 30 * 60000;
    for (const event of ['EN_ROUTE', 'ARRIVED']) b = await e.event(staff, b.id, b.version, event);
    clock.now = b.quote.startAt - 1;
    await assert.rejects(e.event(staff, b.id, b.version, 'START'), code('SERVICE_TOO_EARLY'));
    assert.equal((await current(e, b.id)).startedAt, undefined);
    clock.now++;
    b = await e.event(staff, b.id, b.version, 'START');
    assert.equal(b.startedAt, clock.now);
  }));
test('completion is blocked at duration minus one millisecond and does not capture or release the task', async () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    clock.now = b.startedAt! + b.quote.endAt - b.quote.startAt - 1;
    await assert.rejects(e.event(staff, b.id, b.version, 'COMPLETE'), code('SERVICE_TOO_SHORT'));
    const after = await current(e, b.id);
    assert.equal(after.status, 'IN_SERVICE');
    assert.equal(after.capturedAmount, 0);
    assert.equal(after.version, b.version);
    await e.repo.transaction(async (tx) => {
      assert.equal((await tx.get<any>('holds', b.holdId))!.active, true);
      assert.equal(
        (await tx.list<any>('feeEntries')).filter((x) => x.bookingId === b.id).length,
        0,
      );
    });
  }));
test('late start requires the entire purchased duration, not just the scheduled end', async () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    clock.now = b.quote.startAt + 20 * 60000;
    for (const event of ['EN_ROUTE', 'ARRIVED', 'START'])
      b = await e.event(staff, b.id, b.version, event);
    clock.now = b.quote.endAt;
    await assert.rejects(e.event(staff, b.id, b.version, 'COMPLETE'), code('SERVICE_TOO_SHORT'));
    clock.now += 20 * 60000;
    b = await e.event(staff, b.id, b.version, 'COMPLETE');
    assert.equal(b.status, 'AWAITING_COMPLETION');
    assert.equal(b.capturedAmount, 0);
  }));
test('therapist end releases capacity and private address, customer alone captures once', async () =>
  fixture(async (e, clock) => {
    let b = await request(e, clock);
    assert.equal(b.status, 'AWAITING_COMPLETION');
    assert.equal(b.completedAt, undefined);
    assert.equal(b.capturedAmount, 0);
    assert.equal((await e.booking(staff, b.id)).address, undefined);
    await e.repo.transaction(async (tx) =>
      assert.equal((await tx.get<any>('holds', b.holdId))!.active, false),
    );
    for (const actor of [shop, staff, admin])
      await assert.rejects(
        e.completionAction(
          actor,
          b.id,
          { version: b.version, action: 'CONFIRM', expectedAmount: b.quote.total },
          key(),
        ),
        code('FORBIDDEN'),
      );
    await assert.rejects(
      e.completionAction(
        customer,
        b.id,
        { version: b.version, action: 'CONFIRM', expectedAmount: b.quote.total - 1 },
        key(),
      ),
      code('COMPLETION_AMOUNT_CHANGED'),
    );
    const k = key(),
      payload = { version: b.version, action: 'CONFIRM', expectedAmount: b.quote.total };
    const results = await Promise.all([
      e.completionAction(customer, b.id, payload, k),
      e.completionAction(customer, b.id, payload, k),
    ]);
    assert(results.every((x) => x.status === 'COMPLETED'));
    b = await current(e, b.id);
    assert.equal(b.capturedAmount, b.quote.total);
    assert.equal(b.completedAt, clock.now);
    assert.equal(b.completion!.confirmedAt, clock.now);
    await assert.rejects(confirm(e, b), code('INVALID_STATE'));
    await e.repo.transaction(async (tx) =>
      assert.equal(
        (await tx.list<any>('feeEntries')).filter(
          (x) => x.bookingId === b.id && x.type === 'CAPTURE',
        ).length,
        1,
      ),
    );
  }));
test('customer cannot confirm in progress; unrelated users and unrelated staff cannot inspect or mutate', async () =>
  fixture(async (e, clock) => {
    let b = await start(e, clock);
    await assert.rejects(confirm(e, b), code('INVALID_STATE'));
    b = await current(e, b.id);
    const other = { ...customer, id: 'other' },
      foreign = { ...staff, staffId: 'staff-mio' };
    for (const actor of [other, foreign]) {
      await assert.rejects(e.completionView(actor, b.id), code('NOT_FOUND'));
      await assert.rejects(
        e.completionAction(
          actor,
          b.id,
          {
            version: b.version,
            action: actor.role === 'CUSTOMER' ? 'DISPUTE' : 'EXCEPTION',
            note: 'This is a factual report for review.',
          },
          key(),
        ),
        code('NOT_FOUND'),
      );
    }
  }));
test('short visit exception is frozen, cannot become billable by waiting, shop can close without fee', async () =>
  fixture(async (e, clock) => {
    let b = await start(e, clock);
    clock.now += 10 * 60000;
    b = await e.completionAction(
      staff,
      b.id,
      {
        version: b.version,
        action: 'EXCEPTION',
        note: 'Customer felt unwell and the service ended early.',
      },
      key(),
    );
    assert.equal(b.completion!.status, 'DISPUTED');
    assert(b.completion!.ticketId);
    const ended = b.completion!.endedAt;
    clock.now = b.quote.endAt + 60000;
    await assert.rejects(
      e.completionAction(
        shop,
        b.id,
        {
          version: b.version,
          action: 'REVIEW',
          note: 'Checked the elapsed time; attempting to reopen.',
        },
        key(),
      ),
      code('SERVICE_TOO_SHORT'),
    );
    await assert.rejects(confirm(e, b), code('SERVICE_TOO_SHORT'));
    for (const actor of [customer, shop])
      await assert.rejects(e.cancel(actor, b.id, b.version), code('SERVICE_IN_PROGRESS'));
    b = await e.completionAction(
      shop,
      b.id,
      {
        version: b.version,
        action: 'VOID',
        note: 'Service ended early; waive the entire service amount.',
      },
      key(),
    );
    assert.equal(b.status, 'CANCELLED');
    assert.equal(b.paymentStatus, 'VOIDED');
    assert.equal(b.capturedAmount, 0);
    assert.equal(b.completion!.endedAt, ended);
    assert.equal(b.completion!.status, 'VOIDED');
    await assert.rejects(confirm(e, b), code('INVALID_STATE'));
  }));
test('customer disputes a full visit; shop review still needs fresh customer confirmation', async () =>
  fixture(async (e, clock) => {
    let b = await request(e, clock);
    b = await e.completionAction(
      customer,
      b.id,
      {
        version: b.version,
        action: 'DISPUTE',
        note: 'Please review service quality before any capture.',
      },
      key(),
    );
    await assert.rejects(confirm(e, b), code('COMPLETION_REVIEW_REQUIRED'));
    const monitor = await e.governance.monitor(admin);
    assert(monitor.alerts.some((x) => x.bookingId === b.id && x.kind === 'COMPLETION_REVIEW'));
    b = await e.completionAction(
      shop,
      b.id,
      {
        version: b.version,
        action: 'REVIEW',
        note: 'Discussed the recorded service with the customer; please verify.',
      },
      key(),
    );
    assert.equal(b.capturedAmount, 0);
    assert.equal(b.completion!.status, 'PENDING');
    b = await confirm(e, b);
    assert.equal(b.status, 'COMPLETED');
    assert(b.completion!.history.some((x) => x.action === 'DISPUTE'));
    assert(b.completion!.ticketId);
  }));
test('silence for the disclosed window confirms an undisputed visit and captures exactly once', async () =>
  fixture(async (e, clock) => {
    let b = await request(e, clock);
    clock.now += completionWindowMs - 1;
    b = await current(e, b.id);
    assert.equal(b.completion!.status, 'PENDING');
    assert.equal(b.capturedAmount, 0);
    clock.now++;
    b = await current(e, b.id);
    assert.equal(b.status, 'COMPLETED');
    assert.equal(b.completion!.status, 'CONFIRMED');
    assert.equal(b.completion!.autoConfirmed, true);
    assert.equal(b.capturedAmount, b.quote.total);
    await assert.rejects(confirm(e, b), code('INVALID_STATE'));
    clock.now += completionWindowMs;
    await current(e, b.id);
    await e.repo.transaction(async (tx) =>
      assert.equal(
        (await tx.list<any>('feeEntries')).filter(
          (x) => x.bookingId === b.id && x.type === 'CAPTURE',
        ).length,
        1,
      ),
    );
  }));
test('a reviewed dispute is never accepted by silence; timeout opens one case for the shop', async () =>
  fixture(async (e, clock) => {
    let b = await request(e, clock);
    b = await e.completionAction(
      customer,
      b.id,
      { version: b.version, action: 'DISPUTE', note: 'The visit felt shorter than booked.' },
      key(),
    );
    b = await e.completionAction(
      shop,
      b.id,
      {
        version: b.version,
        action: 'REVIEW',
        note: 'Shared the recorded times with the customer; please verify.',
      },
      key(),
    );
    clock.now += completionWindowMs;
    b = await current(e, b.id);
    assert.equal(b.completion!.status, 'TIMED_OUT');
    assert.equal(b.capturedAmount, 0);
    const caseId = b.completion!.ticketId;
    await current(e, b.id);
    assert.equal((await current(e, b.id)).completion!.ticketId, caseId);
    await assert.rejects(confirm(e, b), code('COMPLETION_REVIEW_REQUIRED'));
    b = await e.completionAction(
      shop,
      b.id,
      {
        version: b.version,
        action: 'REVIEW',
        note: 'Reached the customer; request explicit confirmation again.',
      },
      key(),
    );
    b = await confirm(e, b);
    assert.equal(b.status, 'COMPLETED');
  }));
test('expired authorization goes to payment review without fees, capture or settlement', async () =>
  fixture(async (e, clock) => {
    let b = await request(e, clock);
    await e.repo.transaction(async (tx) => {
      const p = await tx.get<any>('payments', b.paymentId);
      p.expiresAt = clock.now;
      await tx.put('payments', p);
    });
    b = await current(e, b.id);
    assert.equal(b.completion!.status, 'PAYMENT_REVIEW');
    assert.equal(b.capturedAmount, 0);
    await assert.rejects(confirm(e, b), code('COMPLETION_REVIEW_REQUIRED'));
    await e.repo.transaction(async (tx) =>
      assert.equal(
        (await tx.list<any>('feeEntries')).filter((x) => x.bookingId === b.id).length,
        0,
      ),
    );
    b = await e.completionAction(
      shop,
      b.id,
      {
        version: b.version,
        action: 'VOID',
        note: 'Authorization expired; release it and close without charge.',
      },
      key(),
    );
    assert.equal(b.paymentStatus, 'VOIDED');
  }));
test('version, retry-key and transaction guards prevent racing disputes and confirmations', async () =>
  fixture(async (e, clock) => {
    let b = await request(e, clock);
    await assert.rejects(confirm(e, { ...b, version: b.version - 1 }), code('VERSION_CONFLICT'));
    await assert.rejects(
      e.completionAction(
        customer,
        b.id,
        { version: b.version, action: 'CONFIRM', expectedAmount: b.quote.total },
        '',
      ),
      code('IDEMPOTENCY_REQUIRED'),
    );
    const outcomes = await Promise.allSettled([
      e.completionAction(
        customer,
        b.id,
        {
          version: b.version,
          action: 'DISPUTE',
          note: 'Service quality must be reviewed before payment.',
        },
        key(),
      ),
      confirm(e, b),
    ]);
    assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
    b = await current(e, b.id);
    assert.equal(b.completion!.status, 'DISPUTED');
    assert.equal(b.capturedAmount, 0);
  }));
test('renewing an expired demo authorization does not capture or erase an existing dispute', async () =>
  fixture(async (e, clock) => {
    let b = await request(e, clock);
    b = await e.completionAction(
      customer,
      b.id,
      {
        version: b.version,
        action: 'DISPUTE',
        note: 'PRIVATE_CUSTOMER_NOTE service duration is disputed.',
      },
      key(),
    );
    await e.repo.transaction(async (tx) => {
      const p = await tx.get<any>('payments', b.paymentId);
      p.expiresAt = clock.now;
      await tx.put('payments', p);
    });
    b = await current(e, b.id);
    assert.equal(b.completion!.status, 'PAYMENT_REVIEW');
    assert(!JSON.stringify(await e.booking(staff, b.id)).includes('PRIVATE_CUSTOMER_NOTE'));
    assert(!JSON.stringify(await e.completionView(staff, b.id)).includes('PRIVATE_CUSTOMER_NOTE'));
    assert(!JSON.stringify(await e.completionView(admin, b.id)).includes('PRIVATE_CUSTOMER_NOTE'));
    assert(
      !JSON.stringify((await e.admin.snapshot(admin)).bookings).includes('PRIVATE_CUSTOMER_NOTE'),
    );
    b = await e.completionAction(
      customer,
      b.id,
      { version: b.version, action: 'REAUTHORIZE', expectedAmount: b.quote.total },
      key(),
    );
    assert.equal(b.completion!.status, 'DISPUTED');
    assert.equal(b.paymentStatus, 'AUTHORIZED');
    assert.equal(b.capturedAmount, 0);
    await assert.rejects(confirm(e, b), code('COMPLETION_REVIEW_REQUIRED'));
  }));
test('distant-date saved payment is authorized 48 hours before the visit, so completion needs no renewal', async () =>
  fixture(async (e, clock) => {
    let b = await booking(e, { startAt: clock.now + 10 * 86400000 });
    assert.equal(b.paymentStatus, 'METHOD_SAVED');
    b = await e.ack(staff, b.id, b.version);
    clock.now = b.quote.startAt - 48 * 3600000 - 1;
    assert.equal((await current(e, b.id)).paymentStatus, 'METHOD_SAVED');
    clock.now++;
    b = await current(e, b.id);
    assert.equal(b.paymentStatus, 'AUTHORIZED');
    clock.now = b.quote.startAt;
    for (const event of ['EN_ROUTE', 'ARRIVED', 'START'])
      b = await e.event(staff, b.id, b.version, event);
    clock.now = b.quote.endAt;
    b = await e.event(staff, b.id, b.version, 'COMPLETE');
    assert.equal(b.completion!.status, 'PENDING');
    b = await confirm(e, b);
    assert.equal(b.capturedAmount, b.quote.total);
  }));
test('a visit that reaches completion without an authorization needs customer renewal and then confirmation', async () =>
  fixture(async (e, clock) => {
    let b = await start(e, clock);
    // A record that skipped the pre-visit authorization (for example, created before it existed).
    await e.repo.transaction(async (tx) => {
      const p = await tx.get<any>('payments', b.paymentId);
      await tx.put('payments', { ...p, status: 'METHOD_SAVED' });
      const stored = await tx.get<any>('bookings', b.id);
      await tx.put('bookings', { ...stored, paymentStatus: 'METHOD_SAVED' });
    });
    clock.now = b.startedAt! + b.quote.endAt - b.quote.startAt;
    b = await e.event(staff, b.id, b.version, 'COMPLETE');
    b = await current(e, b.id);
    assert.equal(b.completion!.status, 'PAYMENT_REVIEW');
    assert.equal(b.capturedAmount, 0);
    await assert.rejects(
      e.completionAction(
        shop,
        b.id,
        { version: b.version, action: 'REAUTHORIZE', expectedAmount: b.quote.total },
        key(),
      ),
      code('FORBIDDEN'),
    );
    b = await e.completionAction(
      customer,
      b.id,
      { version: b.version, action: 'REAUTHORIZE', expectedAmount: b.quote.total },
      key(),
    );
    assert.equal(b.completion!.status, 'PENDING');
    assert.equal(b.capturedAmount, 0);
    b = await confirm(e, b);
    assert.equal(b.status, 'COMPLETED');
    assert.equal(b.capturedAmount, b.quote.total);
  }));
test('late starts do not trigger safety check-in before the purchased service and grace period elapse', async () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    clock.now = b.quote.startAt + 30 * 60000;
    for (const event of ['EN_ROUTE', 'ARRIVED', 'START'])
      b = await e.event(staff, b.id, b.version, event);
    clock.now = b.quote.endAt + 15 * 60000;
    assert.equal((await e.fulfillment.desk(staff)).checks.length, 0);
    clock.now = b.startedAt! + b.quote.endAt - b.quote.startAt + 15 * 60000;
    assert.equal((await e.fulfillment.desk(staff)).checks.length, 1);
  }));
test('legacy missing-start records can be investigated and closed, but never completed or captured', async () =>
  fixture(async (e, clock) => {
    let b = await start(e, clock);
    await e.repo.transaction((tx) => tx.put('bookings', { ...b, startedAt: undefined }));
    await assert.rejects(e.event(staff, b.id, b.version, 'COMPLETE'), code('SERVICE_TOO_SHORT'));
    b = await e.completionAction(
      shop,
      b.id,
      {
        version: b.version,
        action: 'EXCEPTION',
        note: 'Legacy service has no trustworthy start timestamp; investigate.',
      },
      key(),
    );
    assert.equal(b.completion!.timingInvalid, true);
    await assert.rejects(
      e.completionAction(
        shop,
        b.id,
        {
          version: b.version,
          action: 'REVIEW',
          note: 'Attempt to restore a legacy record without verified service time.',
        },
        key(),
      ),
      code('SERVICE_TOO_SHORT'),
    );
    b = await e.completionAction(
      shop,
      b.id,
      {
        version: b.version,
        action: 'VOID',
        note: 'Cannot verify start time; close without any customer charge.',
      },
      key(),
    );
    assert.equal(b.capturedAmount, 0);
    assert.equal(b.status, 'CANCELLED');
  }));
test('payment renewal after a long absence preserves the requirement for shop timeout review', async () =>
  fixture(async (e, clock) => {
    let b = await request(e, clock);
    clock.now += 8 * 86400000;
    b = await current(e, b.id);
    assert.equal(b.completion!.status, 'PAYMENT_REVIEW');
    b = await e.completionAction(
      customer,
      b.id,
      { version: b.version, action: 'REAUTHORIZE', expectedAmount: b.quote.total },
      key(),
    );
    assert.equal(b.completion!.status, 'TIMED_OUT');
    assert.equal(b.capturedAmount, 0);
    await assert.rejects(confirm(e, b), code('COMPLETION_REVIEW_REQUIRED'));
  }));
