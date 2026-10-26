import {
  fulfillmentMode,
  listingSupports,
  venueAvailable,
  type FulfillmentMode,
} from '@hogulink/contracts';
import type { Catalog } from './api';
import type { PublicStore } from './api';

export function storeForMode(s: PublicStore, mode: FulfillmentMode): PublicStore {
  return mode === 'IN_STORE' && s.venue
    ? {
        ...s,
        areas: [s.venue.area],
        bookingRules: s.bookingRules
          ? {
              ...s.bookingRules,
              nominationFee: s.venue.nominationFee,
              cancellationPolicy: s.venue.cancellationPolicy ?? s.bookingRules.cancellationPolicy,
              areaTransportFees: undefined,
              timeSurcharges: s.venue.timeSurcharges,
              businessHours: s.venue.businessHours,
            }
          : undefined,
      }
    : s;
}

/** Browsing a mode is not consent to book it. Only an affirmative planner selection carries this marker. */
export function chosenServiceMode(raw: Record<string, unknown>): FulfillmentMode | null {
  return raw.modeConfirmed === '1' &&
    (raw.fulfillmentMode === 'HOME_VISIT' || raw.fulfillmentMode === 'IN_STORE')
    ? raw.fulfillmentMode
    : null;
}

/** One selected mode for every list, price and provider link. Checkout uses its frozen quote. */
export function catalogForMode(catalog: Catalog, mode: FulfillmentMode): Catalog {
  const stores = catalog.stores
    .filter((s) => (mode === 'IN_STORE' ? venueAvailable(s) : s.homeVisitsEnabled !== false))
    .map((s) =>
      mode === 'IN_STORE' && s.venue
        ? {
            ...s,
            areas: [s.venue.area],
            bookingRules: s.bookingRules
              ? {
                  ...s.bookingRules,
                  nominationFee: s.venue.nominationFee,
                  cancellationPolicy:
                    s.venue.cancellationPolicy ?? s.bookingRules.cancellationPolicy,
                  areaTransportFees: undefined,
                  timeSurcharges: s.venue.timeSurcharges,
                  businessHours: s.venue.businessHours,
                }
              : undefined,
          }
        : s,
    );
  const offerings = catalog.offerings.filter(
    (o) =>
      fulfillmentMode(o) === mode && o.active !== false && stores.some((s) => s.id === o.storeId),
  );
  return {
    ...catalog,
    stores,
    offerings,
    listings: catalog.listings.filter(
      (l) =>
        listingSupports(l, mode) &&
        offerings.some((o) => o.storeId === l.storeId && l.offeringIds.includes(o.id)),
    ),
  };
}
