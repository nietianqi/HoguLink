import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking, Locale } from '@hogulink/contracts';
import {
  customerNextStep,
  customerShowAmounts,
} from '../hogulink-web/src/lib/customer-order-model';
import { selectedHomeArea, restoreVisitAddress } from '../hogulink-web/src/lib/visit-model';
import { chosenServiceMode } from '../hogulink-web/src/lib/service-mode-model';
import { pc } from '../hogulink-web/src/lib/pc-consumer-i18n';

function booking(overrides: Partial<Booking> = {}) {
  return {
    id: 'test-order',
    status: 'CONFIRMED',
    staffTaskStatus: 'ACKNOWLEDGED',
    replacementConsent: 'NOT_REQUIRED',
    paymentStatus: 'AUTHORIZED',
    deadline: 12345,
    quote: { fulfillmentMode: 'HOME_VISIT' },
    ...overrides,
  } as Booking;
}

test('customer acceptance distinguishes shop response, therapist response and re-arrangement', () => {
  assert.equal(
    customerNextStep(booking({ status: 'REQUESTED', staffTaskStatus: 'NOT_SENT' })).key,
    'waitingShop',
  );
  assert.equal(
    customerNextStep(booking({ status: 'ACCEPTED', staffTaskStatus: 'OFFERED' })).key,
    'waitingTherapist',
  );
  for (const state of ['DECLINED', 'WITHDRAWN', 'EXPIRED', 'NOT_SENT'] as const)
    assert.equal(customerNextStep(booking({ staffTaskStatus: state })).key, 'arranging');
  assert.equal(customerNextStep(booking()).key, 'homeReady');
});

test('in-store readiness and check-in never use departure instructions', () => {
  const b = booking({ quote: { fulfillmentMode: 'IN_STORE' } as Booking['quote'] });
  assert.equal(customerNextStep(b).key, 'storeReady');
  assert.equal(customerNextStep(b).target, '#customer-venue-test-order');
  assert.equal(
    customerNextStep({ ...b, checkIn: { at: 123 } as Booking['checkIn'] }).key,
    'checkedIn',
  );
  assert.equal(customerNextStep(booking({ status: 'EN_ROUTE' })).key, 'onWay');
  assert.equal(customerNextStep(booking({ status: 'ARRIVED' })).key, 'arrived');
  assert.equal(customerNextStep({ ...b, status: 'IN_SERVICE' }).key, 'serving');
});

test('replacement, payment and completion retain their own decisions and deadlines', () => {
  const next = customerNextStep(
    booking({
      replacementConsent: 'PENDING',
      proposedListingId: 'new-person',
      replacementDeadline: 56789,
    }),
  );
  assert.equal(next.key, 'replacement');
  assert.equal(next.deadline, 56789);
  assert.equal(customerNextStep(booking({ replacementConsent: 'PENDING' })).key, 'arranging');
  assert.equal(
    customerNextStep(booking({ paymentStatus: 'FAILED', paymentActionBy: 67890 })).key,
    'paymentAction',
  );
  assert.equal(
    customerNextStep(
      booking({
        status: 'AWAITING_COMPLETION',
        completion: { status: 'PENDING' } as Booking['completion'],
      }),
    ).key,
    'completion',
  );
  assert.equal(
    customerNextStep(booking({ status: 'AWAITING_COMPLETION' })).key,
    'completionReview',
  );
  for (const status of ['CANCELLED', 'REJECTED', 'EXPIRED'] as const)
    assert.equal(
      customerNextStep(
        booking({
          status,
          paymentStatus: 'FAILED',
          paymentActionBy: 67890,
          replacementConsent: 'PENDING',
        }),
      ).key,
      'closed',
    );
  assert.equal(customerNextStep(booking({ status: 'COMPLETED' })).key, 'completed');
});

test('missing or incompatible customer areas are not replaced with a charged default', () => {
  for (const value of [undefined, null, '', 'minato'])
    assert.equal(selectedHomeArea(['shinjuku', 'chuo'], value), '');
  assert.equal(selectedHomeArea(['shinjuku', 'chuo'], 'chuo'), 'chuo');
  // Simplification does not undo the earlier explicit service-mode agreement.
  assert.equal(chosenServiceMode({ fulfillmentMode: 'HOME_VISIT' }), null);
  assert.equal(chosenServiceMode({ fulfillmentMode: 'IN_STORE', modeConfirmed: '1' }), 'IN_STORE');
});

test('unbilled orders omit empty financial tiles without hiding existing refund history', () => {
  assert.equal(customerShowAmounts({ captured: 0, refunded: 0, requests: [] }), false);
  assert.equal(customerShowAmounts({ captured: 100, refunded: 0, requests: [] }), true);
  assert.equal(customerShowAmounts({ captured: 0, refunded: 100, requests: [] }), true);
  assert.equal(
    customerShowAmounts({ captured: 0, refunded: 0, requests: [{ status: 'REJECTED' }] }),
    true,
  );
});

test('home-address convenience never bypasses a hotel-only restriction or reuses hotel consent', () => {
  assert.equal(restoreVisitAddress({ type: 'HOME' }, 'shinjuku', false).type, 'HOME');
  const address = restoreVisitAddress({ type: 'HOME', hotelPermission: true }, 'shinjuku', true);
  assert.equal(address.type, 'HOTEL');
  assert.equal(address.hotelPermission, false);
});

test('customer next steps have Japanese, English and Chinese copy', () => {
  const states = [
    booking(),
    booking({ status: 'REQUESTED' }),
    booking({ status: 'IN_SERVICE' }),
    booking({ quote: { fulfillmentMode: 'IN_STORE' } as Booking['quote'] }),
    booking({ replacementConsent: 'PENDING', proposedListingId: 'other' }),
  ];
  for (const locale of ['ja', 'en', 'zh-cn'] as Locale[])
    for (const b of states) {
      const next = customerNextStep(b);
      assert.ok(pc(locale, next.key).length > 5);
      assert.ok(pc(locale, next.action).length > 0);
    }
});
