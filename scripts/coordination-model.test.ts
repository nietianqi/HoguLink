import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking } from '@hogulink/contracts';
import { nextWork, workOrderStage } from '../hogulink-web/src/lib/coordination-model';
test('an accepted unassigned order asks for initial assignment rather than a replacement', () =>
  assert.equal(
    nextWork({
      status: 'ACCEPTED',
      staffTaskStatus: 'NOT_SENT',
      replacementConsent: 'NOT_REQUIRED',
    } as Booking),
    'assign',
  ));
const b = (fields: Partial<Booking>) =>
  ({
    status: 'CONFIRMED',
    staffTaskStatus: 'ACKNOWLEDGED',
    replacementConsent: 'NOT_REQUIRED',
    ...fields,
  }) as Booking;
test('order progress returns to therapist confirmation during replacement consent', () => {
  assert.equal(workOrderStage(b({})), 2);
  assert.equal(
    workOrderStage(b({ replacementConsent: 'PENDING', proposedListingId: 'listing-mio' })),
    1,
  );
  assert.equal(workOrderStage(b({ status: 'ACCEPTED', staffTaskStatus: 'OFFERED' })), 1);
  assert.equal(workOrderStage(b({ status: 'REQUESTED', staffTaskStatus: 'NOT_SENT' })), 0);
});
test('a completion dispute stays at customer approval and terminal cancellation does not imply fulfillment', () => {
  for (const status of ['PENDING', 'DISPUTED', 'TIMED_OUT', 'PAYMENT_REVIEW'] as const)
    assert.equal(
      workOrderStage(
        b({ status: 'AWAITING_COMPLETION', completion: { status } as Booking['completion'] }),
      ),
      3,
    );
  assert.equal(workOrderStage(b({ status: 'COMPLETED' })), 4);
  for (const status of ['CANCELLED', 'REJECTED', 'EXPIRED'] as const)
    assert.equal(workOrderStage(b({ status })), null);
});
test('pending customer confirmation and exception review are distinct next actions', () => {
  assert.equal(
    nextWork(
      b({
        status: 'AWAITING_COMPLETION',
        completion: { status: 'PENDING' } as Booking['completion'],
      }),
    ),
    'completionPending',
  );
  for (const status of ['DISPUTED', 'TIMED_OUT', 'PAYMENT_REVIEW'] as const)
    assert.equal(
      nextWork(
        b({ status: 'AWAITING_COMPLETION', completion: { status } as Booking['completion'] }),
      ),
      'completionReview',
    );
});
test('shop acceptance, therapist confirmation and visit are separate next actions', () => {
  assert.equal(nextWork(b({ status: 'REQUESTED' })), 'accept');
  assert.equal(nextWork(b({ status: 'ACCEPTED', staffTaskStatus: 'OFFERED' })), 'confirm');
  assert.equal(nextWork(b({})), 'visit');
});
test('replacement waiting without a candidate belongs to shop; pending proposal belongs to customer', () => {
  assert.equal(
    nextWork(b({ replacementConsent: 'PENDING', staffTaskStatus: 'WITHDRAWN' })),
    'arrange',
  );
  assert.equal(
    nextWork(b({ replacementConsent: 'PENDING', proposedListingId: 'listing-mio' })),
    'consent',
  );
});
test('cancelled and completed tasks keep aftercare rather than another fulfillment action', () => {
  for (const status of ['COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED'] as const)
    assert.equal(nextWork(b({ status, staffTaskStatus: 'OFFERED' })), 'closed');
});
