import { performance } from 'node:perf_hooks';
import { Repository } from '../hogulink-api/src/repository.js';
import { Engine } from '../hogulink-api/src/engine.js';
import { seed } from '../hogulink-api/src/seed.js';
import type { Actor, Booking } from '@hogulink/contracts';
const repo = new Repository('', ':memory:');
await repo.init();
await seed(repo);
const now = Date.UTC(2026, 9, 19, 0),
  engine = new Engine(repo, () => now),
  customer: Actor = { id: 'benchmark-customer', role: 'CUSTOMER', verificationLevel: 1 };
try {
  const q = await engine.quote(customer, {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: now + 3 * 3600000,
    area: 'shinjuku',
    requiredLanguage: '',
  });
  const h = await engine.hold(customer, q.id),
    p = await engine.authorizeDemo(customer, h.id, true);
  const template = await engine.createBooking(
    customer,
    {
      quoteId: q.id,
      holdId: h.id,
      paymentId: p.id,
      termsAccepted: true,
      policyVersion: q.cancellationPolicy.version,
      address: {
        name: 'Benchmark',
        type: 'HOTEL',
        area: 'shinjuku',
        detail: 'Test hotel only',
        hotelName: 'Test Hotel',
        room: '101',
        hotelPermission: true,
      },
    },
    'benchmark-booking',
  );
  await repo.transaction(async (tx) => {
    await tx.remove('bookings', template.id);
    await tx.remove('holds', h.id);
    await tx.remove('payments', p.id);
    await tx.releaseInterval(h.id);
  });
  const average = async (fn: () => Promise<unknown>) => {
    const start = performance.now();
    for (let i = 0; i < 5; i++) await fn();
    return (performance.now() - start) / 5;
  };
  const rows: Record<string, number>[] = [];
  let inserted = 0;
  for (const size of [0, 2000, 10000, 30000]) {
    await repo.transaction(async (tx) => {
      for (let i = inserted; i < size; i++) {
        const old = now - 200 * 86400000 + (i % 30) * 86400000;
        await tx.put<Booking>('bookings', {
          ...template,
          id: `archive-${i}`,
          customerId: `old-customer-${i % 200}`,
          status: 'COMPLETED',
          createdAt: old,
          completedAt: old + 3600000,
          quote: { ...template.quote, startAt: old, endAt: old + 3600000 },
        });
      }
    });
    inserted = size;
    await engine.run(async () => {});
    await engine.publicCatalog();
    await engine.availability('listing-aoi', 'store-nagi-60');
    const catalogMs = await average(() => engine.publicCatalog()),
      instantMs = await average(() => engine.publicCatalog({ mode: 'INSTANT' })),
      availabilityMs = await average(() => engine.availability('listing-aoi', 'store-nagi-60'));
    const start = performance.now();
    await Promise.all(Array.from({ length: 20 }, () => engine.publicCatalog()));
    rows.push({
      archivedBookings: size,
      catalogMs,
      instantMs,
      availabilityMs,
      concurrent20Ms: performance.now() - start,
    });
  }
  console.log(JSON.stringify({ driver: 'SQLite memory', node: process.version, rows }, null, 2));
} finally {
  await repo.close();
}
