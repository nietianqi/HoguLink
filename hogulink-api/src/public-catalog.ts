import type { Store, Listing, PublicStore, Offering } from '@hogulink/contracts';
import { effectiveBookingRules } from './booking-rules.js';
export function toPublicStore(
  store: Store,
): PublicStore & { bookingRules: NonNullable<PublicStore['bookingRules']> } {
  const rules = effectiveBookingRules(store);
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
    areas: store.areas,
    bookingRules: {
      version: rules.version,
      nominationFee: rules.nominationFee,
      templateId: rules.templateId,
      cancellationPolicy: rules.cancellationPolicy,
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
  };
}
/** Public view of a service: the live promotion is kept, internal price history is not. */
export function toPublicOffering(x: Offering, now: number): Offering {
  const { promotionHistory: _history, priceSince: _since, promotion, ...rest } = x;
  return promotion && promotion.endsAt > now && promotion.regularPrice === x.price
    ? { ...rest, promotion }
    : rest;
}
