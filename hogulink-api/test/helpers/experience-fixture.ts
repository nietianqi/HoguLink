import { randomUUID } from 'node:crypto';
import { registerClock, finishVisit } from './visit-fixture.js';
import type { Actor, Booking, Listing } from '@hogulink/contracts';
import { Repository } from '../../src/repository.js';
import { Engine } from '../../src/engine.js';
import { seed } from '../../src/seed.js';
export const customer: Actor = { id: 'quality-customer', role: 'CUSTOMER', verificationLevel: 1 };
export const shop: Actor = {
  id: 'quality-shop',
  role: 'MERCHANT',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
export const staff: Actor = {
  id: 'quality-staff',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
export const admin: Actor = { id: 'quality-admin', role: 'ADMIN', verificationLevel: 3 };
export const reviewScores = {
  punctuality: 4,
  communication: 5,
  explanation: 4,
  cleanliness: 5,
  overall: 4,
};
export const reviewText = 'The service started as explained and communication was clear.';
export const moderation = {
  decision: 'APPROVE',
  reason: 'Reviewed the genuine service feedback, privacy and publication conditions.',
  checks: { privacy: true, appearance: true, claims: true, relevance: true },
};
export async function fixture(fn: (e: Engine, clock: { now: number }) => Promise<void>) {
  const repo = new Repository('', ':memory:');
  await repo.init();
  await seed(repo);
  const clock = { now: Date.UTC(2026, 9, 18, 0) },
    e = new Engine(repo, () => clock.now);
  registerClock(e, (at) => {
    clock.now = at;
  });
  await repo.transaction(async (tx) => {
    for (const l of await tx.list<Listing>('listings'))
      await tx.put('listings', { ...l, dutyUpdatedAt: clock.now });
  });
  try {
    await fn(e, clock);
  } finally {
    await repo.close();
  }
}
export async function booking(
  e: Engine,
  options: {
    mode?: 'INSTANT' | 'SCHEDULED';
    actor?: Actor;
    listingId?: string;
    offeringId?: string;
    nominationType?: 'FREE' | 'NOMINATED';
    startAt?: number;
  } = {},
) {
  const actor = options.actor ?? customer,
    mode = options.mode ?? 'SCHEDULED',
    q = await e.quote(actor, {
      listingId: options.listingId ?? 'listing-aoi',
      offeringId: options.offeringId ?? 'store-nagi-60',
      bookingMode: mode,
      nominationType: options.nominationType ?? 'NOMINATED',
      startAt: options.startAt ?? e.now() + (mode === 'INSTANT' ? 60 : 180) * 60000,
      area: 'shinjuku',
      requiredLanguage: '',
    }),
    h = await e.hold(actor, q.id),
    p = await e.authorizeDemo(actor, h.id, true);
  return e.createBooking(
    actor,
    {
      quoteId: q.id,
      holdId: h.id,
      paymentId: p.id,
      termsAccepted: true,
      policyVersion: q.cancellationPolicy.version,
      address: {
        name: 'QA Guest',
        area: 'shinjuku',
        type: 'HOTEL',
        detail: 'Private QA address',
        hotelName: 'QA Hotel',
        room: '201',
        hotelPermission: true,
      },
    },
    randomUUID(),
  );
}
export async function start(e: Engine, clock: { now: number }, b?: Booking) {
  b = b ?? (await booking(e));
  b = await e.ack(staff, b.id, b.version, b.quote.bookingMode === 'INSTANT' ? 45 : undefined);
  clock.now = b.quote.startAt;
  for (const event of ['EN_ROUTE', 'ARRIVED', 'START'])
    b = await e.event(staff, b.id, b.version, event);
  return b;
}
export async function complete(e: Engine, clock: { now: number }, b?: Booking) {
  b = await start(e, clock, b);
  return finishVisit(e, b, staff, customer);
}
