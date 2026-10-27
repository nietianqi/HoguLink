import { venueAvailable } from '@hogulink/contracts';
import type { Store, Listing, PublicStore, Offering } from '@hogulink/contracts';
import { effectiveBookingRules } from './booking-rules.js';
export function toPublicStore(
  store: Store,
  mode: 'HOME_VISIT' | 'IN_STORE' = 'HOME_VISIT',
): PublicStore & { bookingRules: NonNullable<PublicStore['bookingRules']> } {
  const base = effectiveBookingRules(store);
  const rules =
    mode === 'IN_STORE' && store.venue
      ? {
          ...base,
          nominationFee: store.venue.nominationFee,
          cancellationPolicy: store.venue.cancellationPolicy ?? base.cancellationPolicy,
          areaTransportFees: undefined,
          timeSurcharges: store.venue.timeSurcharges,
          businessHours: store.venue.businessHours,
        }
      : base;
  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    ...(store.description ? { description: store.description } : {}),
    legalName: store.legalName,
    legalAddress: store.legalAddress,
    contact: store.contact,
    acceptanceMode: store.acceptanceMode,
    active: store.active,
    approved: store.approved,
    areas: mode === 'IN_STORE' && store.venue ? [store.venue.area] : store.areas,
    homeVisitsEnabled: store.homeVisitsEnabled,
    // Only a venue that can take bookings is shown; paused or disabled venues stay private.
    ...(venueAvailable(store)
      ? {
          venue: (() => {
            const {
              resources,
              reviewedBy: _by,
              reviewNote: _note,
              suspension: _paused,
              ...publicVenue
            } = store.venue!;
            return { ...publicVenue, capacity: resources.filter((r) => r.active).length };
          })(),
        }
      : {}),
    bookingRules: {
      version: rules.version,
      nominationFee: rules.nominationFee,
      templateId: rules.templateId,
      cancellationPolicy: rules.cancellationPolicy,
      ...(rules.timeSurcharges?.length ? { timeSurcharges: rules.timeSurcharges } : {}),
      ...(rules.areaTransportFees && Object.keys(rules.areaTransportFees).length
        ? { areaTransportFees: rules.areaTransportFees }
        : {}),
      ...(rules.businessHours ? { businessHours: rules.businessHours } : {}),
    },
  };
}
export function toPublicListing(x: Listing, onDuty = x.onDuty): Listing {
  return {
    id: x.id,
    slug: x.slug,
    storeId: x.storeId,
    staffId: x.staffId,
    name: x.name,
    description: x.description,
    languages: x.languages,
    initials: x.initials,
    color: x.color,
    publicationStatus: x.publicationStatus,
    membershipActive: x.membershipActive,
    portraitConsent: x.portraitConsent,
    identityVerified: x.identityVerified,
    onDuty,
    dutyUpdatedAt: x.dutyUpdatedAt,
    offeringIds: x.offeringIds,
    hotelOnly: x.hotelOnly,
    photo: x.photo,
    fulfillmentModes: x.fulfillmentModes,
  };
}
/** Public view of a service: the live promotion is kept, internal price history is not. */
export function toPublicOffering(x: Offering, now: number): Offering {
  const { promotionHistory: _history, priceSince: _since, promotion, ...rest } = x;
  return promotion && promotion.endsAt > now && promotion.regularPrice === x.price
    ? { ...rest, promotion }
    : rest;
}
