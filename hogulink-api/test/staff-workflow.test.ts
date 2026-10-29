import test from 'node:test';
import assert from 'node:assert/strict';
import { type SafetyEvent } from '@hogulink/contracts';
import { fixture, booking, staff, customer, shop } from './helpers/experience-fixture.js';
const code = (value: string) => (error: unknown) => (error as { code?: string }).code === value;
test('safety notification progress distinguishes queued, failed, partial and accepted delivery', () =>
  fixture(async (e) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    b = await e.safety(staff, b.id, 'SOS', b.version);
    const previousProvider = process.env.EMAIL_PROVIDER,
      previousScope = process.env.NOTIFICATION_EMAIL_SCOPE;
    // The engine was created with notifications disabled. Only inspect stored delivery state;
    // this never constructs a sender or sends an external message.
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.NOTIFICATION_EMAIL_SCOPE = 'all';
    try {
      const current = async () =>
        (await e.care.safetyEvents(staff)).find((event) => event.bookingId === b.id)!;
      assert.equal((await current()).notificationStatus, 'PENDING');
      const change = async (status: string, receipts = {}) =>
        e.repo.transaction(async (tx) => {
          const jobs = await tx.find<any>('outbox', { bookingId: b.id, type: 'SOS' });
          assert.equal(jobs.length, 1);
          await tx.put('outbox', { ...jobs[0], status, receipts });
        });
      await change('BLOCKED');
      assert.equal((await current()).notificationStatus, 'FAILED');
      await change('RETRY', { 'recipient-hash': 'accepted-message' });
      assert.equal((await current()).notificationStatus, 'PARTIAL');
      await change('SENT', { 'recipient-hash': 'accepted-message' });
      const sent = await current();
      assert.equal(sent.notificationStatus, 'SENT');
      assert.ok(!JSON.stringify(sent).includes('recipient-hash'));
      process.env.NOTIFICATION_EMAIL_SCOPE = 'customer-auth';
      assert.equal((await current()).notificationStatus, 'NOT_CONFIGURED');
    } finally {
      if (previousProvider === undefined) delete process.env.EMAIL_PROVIDER;
      else process.env.EMAIL_PROVIDER = previousProvider;
      if (previousScope === undefined) delete process.env.NOTIFICATION_EMAIL_SCOPE;
      else process.env.NOTIFICATION_EMAIL_SCOPE = previousScope;
    }
  }));
test('scheduled departure and arrival cannot be recorded before their travel window', () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    const opens = b.quote.startAt - 90 * 60000;
    await assert.rejects(e.event(staff, b.id, b.version, 'EN_ROUTE'), code('TRAVEL_TOO_EARLY'));
    assert.equal((await e.booking(customer, b.id)).status, 'CONFIRMED');
    clock.now = opens - 1;
    await assert.rejects(e.event(staff, b.id, b.version, 'EN_ROUTE'), code('TRAVEL_TOO_EARLY'));
    clock.now = opens;
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    // A malformed clock cannot create an earlier arrival record either.
    clock.now = opens - 1;
    await assert.rejects(e.event(staff, b.id, b.version, 'ARRIVED'), code('TRAVEL_TOO_EARLY'));
    clock.now = opens;
    b = await e.event(staff, b.id, b.version, 'ARRIVED');
    assert.equal(b.arrivedAt, opens);
    await assert.rejects(e.event(staff, b.id, b.version, 'START'), code('SERVICE_TOO_EARLY'));
  }));
test('a safety event exposes delivery and follow-up progress without internal notes or recipients', () =>
  fixture(async (e) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    b = await e.safety(staff, b.id, 'SOS', b.version);
    const events = await e.care.safetyEvents(staff);
    const event = events.find((item) => item.bookingId === b.id)!;
    assert.ok(event);
    assert.equal(event.notificationStatus, 'NOT_CONFIGURED');
    await e.repo.transaction(async (tx) => {
      const stored = (await tx.get<SafetyEvent>('safety', event.id))!;
      stored.merchantContact = {
        at: e.now(),
        note: 'Internal incident details must remain private.',
      };
      stored.handling = {
        ownerId: 'safety-person',
        ownerName: 'Internal person',
        acknowledgedAt: e.now(),
        followUpAt: e.now() + 60000,
        history: [],
      };
      await tx.put('safety', stored);
    });
    const updated = (await e.care.safetyEvents(staff)).find((item) => item.id === event.id)!;
    assert.equal(updated.followUp, 'PLATFORM_HANDLING');
    assert.equal(updated.handling, undefined);
    assert.equal(updated.merchantContact, undefined);
    assert.ok(!JSON.stringify(updated).includes('Internal'));
    assert.equal((await e.care.safetyEvents({ ...staff, storeId: 'store-mori' })).length, 0);
    assert.equal((await e.care.safetyEvents(shop))[0].notificationStatus, undefined);
  }));
