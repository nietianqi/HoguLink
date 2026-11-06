import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, complete, staff, customer, shop } from './helpers/experience-fixture.js';
import { staffBookingView, staffResponse } from '../src/staff-response.js';

test('staff transport omits financial facts, payment identifiers and private complaint links', () =>
  fixture(async (e, clock) => {
    let b = await complete(e, clock);
    b = await e.refund(shop, b.id, b.version, 500);
    const domain = await e.booking(staff, b.id);
    const wire = staffBookingView({
      ...domain,
      completion: {
        ...domain.completion!,
        ticketId: 'private-customer-case',
        history: [
          { action: 'DISPUTE', role: 'CUSTOMER', at: clock.now, note: 'Private complaint' },
        ],
      },
    });
    for (const field of [
      'capturedAmount',
      'refundedAmount',
      'platformFee',
      'captureFeeRateBps',
      'customerId',
      'merchantId',
      'paymentId',
      'holdId',
      'checkInCode',
      'acceptanceDecision',
    ])
      assert.equal(field in wire, false, field);
    assert.equal('customerId' in wire.quote, false);
    assert.equal('ticketId' in wire.completion!, false);
    assert.equal('note' in wire.completion!.history[0], false);
    assert.equal(wire.id, b.id);
    assert.equal(wire.quote.total, 8700);
    assert.equal(wire.status, 'COMPLETED');
    assert.equal(wire.address, undefined);
    // Transport filtering must never delete the stored accounting facts or other roles' views.
    assert.equal((await e.booking(customer, b.id)).refundedAmount, 500);
    assert.equal((await e.booking(shop, b.id)).platformFee, 770);
    assert.equal(domain.refundedAmount, 500);
  }));

test('staff transport projects booking lists, mutation results and nested envelopes', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    const payload = {
      booking: { ...b, futureFinancialField: 123 },
      rows: [b],
      serverNow: clock.now,
    };
    const wire = JSON.stringify(staffResponse(payload));
    for (const field of [
      'capturedAmount',
      'refundedAmount',
      'platformFee',
      'paymentId',
      'futureFinancialField',
    ])
      assert.equal(wire.includes(`"${field}"`), false, field);
    assert.equal(JSON.parse(wire).serverNow, clock.now);
    assert.equal(JSON.parse(wire).rows[0].id, b.id);
    assert.deepEqual(staffResponse({ error: { code: 'INVALID_STATE' } }), {
      error: { code: 'INVALID_STATE' },
    });
  }));
