import { effectiveServicePrice, travelFeeFor, type Locale } from '@hogulink/contracts';
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
    const transportFee = travelFeeFor(offering, store.bookingRules, filters.area);
    const priced = effectiveServicePrice(offering, now);
    const nomination = nominationFeeFor(store, catalog.bookingRules);
    return [
      {
        offering,
        store,
        members,
        transportFee,
        total: priced.price + transportFee + nomination,
        freeTotal: priced.price + transportFee,
        compareTotal:
          priced.comparePrice === undefined
            ? undefined
            : priced.comparePrice + transportFee + nomination,
        promotionEndsAt: priced.promotion?.endsAt,
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

/** Keep several visit lengths, then add distinct menus instead of repeating shops' copies. */
export function featuredServices(choices: ReturnType<typeof serviceChoices>) {
  const result: typeof choices = [];
  const seen = new Set<string>();
  const add = (choice: (typeof choices)[number]) => {
    const key = JSON.stringify([
      choice.offering.durationMinutes,
      choice.offering.name.ja,
      choice.offering.name.en,
      choice.offering.name['zh-cn'],
    ]);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(choice);
  };
  for (const duration of [60, 90, 120]) {
    const choice = choices.find((item) => item.offering.durationMinutes === duration);
    if (choice) add(choice);
  }
  for (const choice of choices) {
    if (result.length >= 9) break;
    add(choice);
  }
  return result;
}

/** One eligible menu per person, with different shops represented before filling six places. */
export function featuredTherapists(choices: ReturnType<typeof serviceChoices>) {
  const people = new Map<
    string,
    { listing: Catalog['listings'][number]; choice: (typeof choices)[number] }
  >();
  for (const choice of choices)
    for (const listing of choice.members)
      if (!people.has(listing.id)) people.set(listing.id, { listing, choice });
  const candidates = [...people.values()];
  const result: typeof candidates = [];
  const shops = new Set<string>();
  for (const candidate of candidates) {
    if (shops.has(candidate.choice.store.id)) continue;
    result.push(candidate);
    shops.add(candidate.choice.store.id);
    if (result.length === 6) return result;
  }
  for (const candidate of candidates) {
    if (result.length === 6) break;
    if (!result.some((item) => item.listing.id === candidate.listing.id)) result.push(candidate);
  }
  return result;
}
