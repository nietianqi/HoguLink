import { effectiveServicePrice, type Locale } from '@hogulink/contracts';
import { nominationFeeFor, type Catalog } from './api';
export const historyKey = 'hogulink-device-history-v1';
export type VisitHistory = { id: string; at: number };
const lifetime = 30 * 86400000;
export function readVisitHistory(raw: string | null, now = Date.now()): VisitHistory[] {
  try {
    const value: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(value)) return [];
    const valid = value.filter(
      (r): r is VisitHistory =>
        !!r &&
        typeof r.id === 'string' &&
        /^[a-zA-Z0-9_-]{1,120}$/.test(r.id) &&
        Number.isSafeInteger(r.at) &&
        r.at > now - lifetime &&
        r.at <= now,
    );
    const seen = new Set<string>();
    return valid
      .sort((a, b) => b.at - a.at)
      .filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      })
      .slice(0, 12)
      .map(({ id, at }) => ({ id, at }));
  } catch {
    return [];
  }
}
export function rememberVisit(raw: string | null, id: string, now = Date.now()) {
  return readVisitHistory(
    JSON.stringify([{ id, at: now }, ...readVisitHistory(raw, now).filter((r) => r.id !== id)]),
    now,
  );
}
export function serviceChoices(
  catalog: Catalog,
  filters: {
    duration?: number;
    area?: string;
    language?: string;
    mode?: string;
    search?: string;
    locale?: Locale;
    sort?: string;
    promotions?: boolean;
  } = {},
  now = Date.now(),
) {
  const query = (filters.search ?? '').trim().toLocaleLowerCase();
  const result = catalog.offerings.flatMap((offering) => {
    const store = catalog.stores.find((s) => s.id === offering.storeId);
    if (
      !store?.active ||
      !store.approved ||
      !offering.approved ||
      offering.active === false ||
      offering.regulatoryCategory !== 'RELAXATION' ||
      (filters.duration && offering.durationMinutes !== filters.duration) ||
      (filters.area && !store.areas.includes(filters.area)) ||
      (filters.mode === 'INSTANT' && store.acceptanceMode === 'MANUAL') ||
      (filters.promotions && !effectiveServicePrice(offering, now).promotion)
    )
      return [];
    const members = catalog.listings.filter(
      (l) =>
        l.storeId === store.id &&
        l.membershipActive &&
        l.identityVerified &&
        l.portraitConsent &&
        l.publicationStatus === 'PUBLISHED_INDEXABLE' &&
        l.offeringIds.includes(offering.id) &&
        (!filters.language || l.languages.includes(filters.language)) &&
        (filters.mode !== 'INSTANT' || l.onDuty),
    );
    if (
      !members.length ||
      (query &&
        !`${Object.values(offering.name).join(' ')} ${Object.values(store.name).join(' ')}`
          .toLocaleLowerCase()
          .includes(query))
    )
      return [];
    return [
      {
        offering,
        store,
        members,
        total:
          effectiveServicePrice(offering, now).price +
          offering.transportFee +
          nominationFeeFor(store, catalog.bookingRules),
        freeTotal: effectiveServicePrice(offering, now).price + offering.transportFee,
        compareTotal:
          effectiveServicePrice(offering, now).comparePrice === undefined
            ? undefined
            : effectiveServicePrice(offering, now).comparePrice! +
              offering.transportFee +
              nominationFeeFor(store, catalog.bookingRules),
        promotionEndsAt: effectiveServicePrice(offering, now).promotion?.endsAt,
      },
    ];
  });
  return result.sort((a, b) =>
    filters.sort === 'price'
      ? a.total - b.total || a.offering.id.localeCompare(b.offering.id)
      : a.offering.durationMinutes - b.offering.durationMinutes ||
        a.total - b.total ||
        a.offering.id.localeCompare(b.offering.id),
  );
}
