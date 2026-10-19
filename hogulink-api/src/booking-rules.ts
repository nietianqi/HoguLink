import type { Store, StoreBookingRules } from '@hogulink/contracts';
import { config } from './config.js';

// Legacy shops keep the existing demo terms until their owner explicitly saves a version.
export function effectiveBookingRules(store: Pick<Store, 'bookingRules'>): StoreBookingRules {
  return structuredClone(
    store.bookingRules ?? {
      version: 0,
      nominationFee: config.nominationFee,
      templateId: 'LEGACY',
      cancellationPolicy: config.cancellation,
    },
  );
}
