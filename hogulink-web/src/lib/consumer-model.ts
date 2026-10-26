import {
  effectiveServicePrice,
  travelFeeFor,
  fulfillmentMode,
  listingSupports,
  venueAvailable,
  type Locale,
} from '@hogulink/contracts';
import { nominationFeeFor, type Catalog } from './api';
import { storeForMode } from './service-mode-model';
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
    fulfillmentMode?: string;
    search?: string;
    locale?: Locale;
    sort?: string;
    promotions?: boolean;
  } = {},
  now = Date.now(),
) {
  const query = (filters.search ?? '').trim().toLocaleLowerCase();
  const result = catalog.offerings.flatMap((offering) => {
    const original = catalog.stores.find((s) => s.id === offering.storeId);
    const mode = fulfillmentMode(offering);
    const store = original && storeForMode(original, mode);
    if (
      !store?.active ||
      !store.approved ||
      !offering.approved ||
      (filters.fulfillmentMode !== 'ALL' &&
        mode !== (filters.fulfillmentMode === 'IN_STORE' ? 'IN_STORE' : 'HOME_VISIT')) ||
      (mode === 'IN_STORE' ? !venueAvailable(store) : store.homeVisitsEnabled === false) ||
      offering.active === false ||
      offering.regulatoryCategory !== 'RELAXATION' ||
      (filters.duration && offering.durationMinutes !== filters.duration) ||
      (filters.area && !store.areas.includes(filters.area)) ||
      (filters.mode === 'INSTANT' && (mode === 'IN_STORE' || store.acceptanceMode === 'MANUAL')) ||
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
        listingSupports(l, fulfillmentMode(offering)) &&
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

type Choice = ReturnType<typeof serviceChoices>[number];
export type ModePrice = { mode: 'HOME_VISIT' | 'IN_STORE'; total: number; durationMinutes: number };
export function providerModePrices(
  store: Catalog['stores'][number],
  offerings: Catalog['offerings'],
  listings: Catalog['listings'],
  area?: string,
  free = false,
  now = Date.now(),
): ModePrice[] {
  return (['HOME_VISIT', 'IN_STORE'] as const).flatMap((mode) => {
    if (mode === 'IN_STORE' ? !venueAvailable(store) : store.homeVisitsEnabled === false) return [];
    const s = storeForMode(store, mode);
    const rows = offerings
      .filter(
        (o) =>
          o.storeId === store.id &&
          o.approved &&
          o.active !== false &&
          o.regulatoryCategory === 'RELAXATION' &&
          fulfillmentMode(o) === mode &&
          listings.some((l) => listingSupports(l, mode) && l.offeringIds.includes(o.id)),
      )
      .map((o) => ({
        mode,
        total:
          effectiveServicePrice(o, now).price +
          travelFeeFor(o, s.bookingRules, area) +
          (free ? 0 : (s.bookingRules?.nominationFee ?? 500)),
        durationMinutes: o.durationMinutes,
      }))
      .sort((a, b) => a.total - b.total);
    return rows[0] ? [rows[0]] : [];
  });
}
export function choiceModePrices(choices: Choice[], listingId?: string, free = false): ModePrice[] {
  return (['HOME_VISIT', 'IN_STORE'] as const).flatMap((mode) => {
    const rows = choices.filter(
      (c) =>
        fulfillmentMode(c.offering) === mode &&
        (!listingId || c.members.some((m) => m.id === listingId)),
    );
    const row = rows.sort(
      (a, b) =>
        (free ? a.freeTotal - b.freeTotal : a.total - b.total) ||
        a.offering.id.localeCompare(b.offering.id),
    )[0];
    return row
      ? [
          {
            mode,
            total: free ? row.freeTotal : row.total,
            durationMinutes: row.offering.durationMinutes,
          },
        ]
      : [];
  });
}
/** Only the exact generated child ID links the two menus; equal names never imply the same service. */
export function browseServiceChoices(
  catalog: Catalog,
  filters: Parameters<typeof serviceChoices>[1] = {},
  now = Date.now(),
) {
  const choices = serviceChoices(
    catalog,
    {
      ...filters,
      fulfillmentMode:
        filters.fulfillmentMode === 'HOME_VISIT' || filters.fulfillmentMode === 'IN_STORE'
          ? filters.fulfillmentMode
          : 'ALL',
    },
    now,
  );
  const groups = new Map<string, Choice[]>();
  for (const choice of choices) {
    const o = choice.offering;
    const parent =
      fulfillmentMode(o) === 'IN_STORE' && o.id.endsWith('-in-store')
        ? choices.find(
            (c) =>
              c.offering.id === o.id.slice(0, -9) &&
              c.store.id === o.storeId &&
              c.offering.durationMinutes === o.durationMinutes,
          )
        : undefined;
    const key = `${o.storeId}:${parent?.offering.id ?? o.id}`;
    groups.set(key, [...(groups.get(key) ?? []), choice]);
  }
  return [...groups.values()].map((variants) => {
    const first = variants.find((c) => fulfillmentMode(c.offering) === 'HOME_VISIT') ?? variants[0];
    return {
      ...first,
      variants,
      members: [...new Map(variants.flatMap((c) => c.members).map((m) => [m.id, m])).values()],
      modePrices: choiceModePrices(variants),
    };
  });
}

/** Keep several visit lengths, then add distinct menus instead of repeating shops' copies. */
export function featuredServices<T extends Choice>(choices: T[]) {
  const result: T[] = [];
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
export function featuredTherapists<T extends Choice>(choices: T[]) {
  const people = new Map<string, { listing: Catalog['listings'][number]; choice: T }>();
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
