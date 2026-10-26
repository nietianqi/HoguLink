import type { Store } from '@hogulink/contracts';
import type { Engine } from '../../src/engine.js';
import { effectiveBookingRules } from '../../src/booking-rules.js';

/**
 * Scheduled visits follow each shop's business hours (default 09:00-22:00 JST). Tests that
 * book outside those hours first open the shop all day, as a 24-hour shop would.
 */
export async function openAllDay(e: Engine, storeIds = ['store-nagi', 'store-sora', 'store-mori']) {
  await e.repo.transaction(async (tx) => {
    for (const id of storeIds) {
      const store = await tx.get<Store>('stores', id);
      if (!store) continue;
      // Keeps the shop's rule version, so existing quotes and policies are unaffected.
      await tx.put('stores', {
        ...store,
        bookingRules: {
          ...effectiveBookingRules(store),
          businessHours: { startMinute: 0, endMinute: 1440 },
        },
      });
    }
  });
}
