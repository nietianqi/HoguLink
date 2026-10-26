import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  areaDistanceKm,
  effectiveServicePrice,
  timeSurchargeAt,
  travelFeeFor,
  fulfillmentMode,
  listingSupports,
  venueAvailable,
  type ListingStats,
  type MobileBootstrap,
  type MobileTherapist,
  type MobileTherapists,
} from '@hogulink/contracts';
import type { Engine } from './engine.js';
import { ensure } from './errors.js';

const areaKeys = ['shinjuku', 'shibuya', 'minato', 'chuo', 'taito'] as const;
const input = z
  .object({
    fulfillmentMode: z.enum(['HOME_VISIT', 'IN_STORE', 'ALL']).default('HOME_VISIT'),
    area: z.enum(areaKeys).optional(),
    language: z.enum(['ja', 'en', 'zh']).optional(),
    mode: z.enum(['SCHEDULED', 'INSTANT']).default('SCHEDULED'),
    duration: z.enum(['60', '90', '120']).default('60'),
    search: z.string().trim().max(80).default(''),
    sort: z.enum(['recommended', 'price', 'earliest', 'rating', 'distance']).default('recommended'),
    travel: z.enum(['any', 'free']).default('any'),
    /** Nearest served area, computed on the device; precise coordinates are never sent. */
    near: z.enum(areaKeys).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(20),
    cursor: z.string().max(400).optional(),
  })
  .strict();

export async function mobileBootstrap(engine: Engine): Promise<MobileBootstrap> {
  const catalog = await engine.publicCatalog({ fulfillmentMode: 'ALL' });
  const visibleStores = new Set(catalog.listings.map((listing) => listing.storeId));
  return {
    version: 1,
    currency: 'JPY',
    demo: (process.env.APP_MODE ?? 'demo') === 'demo',
    serviceAreas: [
      ...new Set(
        catalog.stores
          .filter((s) => visibleStores.has(s.id))
          .flatMap((s) => [...s.areas, ...(s.venue?.enabled ? [s.venue.area] : [])]),
      ),
    ].sort(),
    features: {
      coupons: false,
      storedValue: false,
      nativeApp: false,
      gpsDistance: true,
      promotions: true,
    },
  };
}

const emptyStats = (): ListingStats => ({
  rating: null,
  reviewCount: 0,
  completed90d: 0,
  favorites: 0,
});

/** Aggregated public facts per listing: approved reviews, recent completions, favorites. */
export async function listingStats(
  engine: Engine,
  listingIds: string[],
): Promise<Record<string, ListingStats>> {
  return engine.repo.read((tx) => tx.listingStats(listingIds, engine.now() - 90 * 86_400_000));
}

/** The same facts per shop, so shop cards never invent a rating or a visit count. */
export async function storeStats(
  engine: Engine,
  storeIds: string[],
): Promise<Record<string, ListingStats>> {
  return engine.repo.read((tx) => tx.storeStats(storeIds, engine.now() - 90 * 86_400_000));
}

export async function mobileTherapists(engine: Engine, query: unknown): Promise<MobileTherapists> {
  const d = input.parse(query);
  ensure(
    d.sort !== 'distance' || !!d.near,
    'LOCATION_REQUIRED',
    'Allow location or choose an area to sort by distance.',
    400,
  );
  const signature = createHash('sha256')
    .update(JSON.stringify({ ...d, cursor: undefined, limit: undefined }))
    .digest('hex')
    .slice(0, 20);
  let offset = 0;
  if (d.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(d.cursor, 'base64url').toString('utf8'));
      ensure(
        cursor.key === signature &&
          Number.isSafeInteger(cursor.offset) &&
          cursor.offset >= 0 &&
          cursor.offset <= 100000,
        'INVALID_CURSOR',
        'Refresh the therapist list.',
        400,
      );
      offset = cursor.offset;
    } catch {
      ensure(false, 'INVALID_CURSOR', 'Refresh the therapist list.', 400);
    }
  }
  const catalog = await engine.publicCatalog(d);
  const now = engine.now();
  const term = d.search.normalize('NFKC').toLocaleLowerCase();
  const matched = catalog.listings.flatMap((listing) => {
    const store = catalog.stores.find((s) => s.id === listing.storeId);
    if (
      !store ||
      (term &&
        ![...Object.values(listing.name), ...Object.values(store.name)]
          .join(' ')
          .normalize('NFKC')
          .toLocaleLowerCase()
          .includes(term))
    )
      return [];
    const nominationFee = store.bookingRules?.nominationFee ?? catalog.bookingRules.nominationFee;
    // Without a chosen area the menu's own travel fee is shown; a chosen area uses the shop table.
    const rulesFor = (o: (typeof catalog.offerings)[number]) =>
      fulfillmentMode(o) === 'IN_STORE' && store.venue && store.bookingRules
        ? {
            ...store.bookingRules,
            nominationFee: store.venue.nominationFee,
            areaTransportFees: undefined,
            timeSurcharges: store.venue.timeSurcharges,
          }
        : store.bookingRules;
    const travel = (o: (typeof catalog.offerings)[number]) =>
      fulfillmentMode(o) === 'IN_STORE' ? 0 : travelFeeFor(o, store.bookingRules, d.area);
    const variants = catalog.offerings
      .filter(
        (o) =>
          o.storeId === store.id &&
          listing.offeringIds.includes(o.id) &&
          listingSupports(listing, fulfillmentMode(o)) &&
          (fulfillmentMode(o) === 'IN_STORE'
            ? venueAvailable(store) && d.mode !== 'INSTANT'
            : store.homeVisitsEnabled !== false) &&
          o.regulatoryCategory === 'RELAXATION' &&
          (d.travel !== 'free' || travel(o) === 0) &&
          o.durationMinutes === Number(d.duration),
      )
      .map((o) => ({
        o,
        p: effectiveServicePrice(o, now),
        fee: travel(o),
        nomination: rulesFor(o)?.nominationFee ?? nominationFee,
      }))
      .sort(
        (a, b) =>
          (fulfillmentMode(a.o) === 'HOME_VISIT' ? 0 : 1) -
            (fulfillmentMode(b.o) === 'HOME_VISIT' ? 0 : 1) ||
          a.p.price + a.fee + a.nomination - b.p.price - b.fee - b.nomination ||
          a.o.id.localeCompare(b.o.id),
      );
    const priced = variants[0];
    if (!priced) return [];
    const { o: offering, p, fee: transportFee } = priced;
    return [
      {
        listing,
        store: {
          ...store,
          areas:
            fulfillmentMode(offering) === 'IN_STORE' && store.venue
              ? [store.venue.area]
              : store.areas,
          bookingRules: rulesFor(offering),
        },
        offering,
        nominationFee: priced.nomination,
        transportFee,
        total: p.price + transportFee + priced.nomination,
        modePrices: (['HOME_VISIT', 'IN_STORE'] as const).flatMap((mode) => {
          const candidate = variants
            .filter((v) => fulfillmentMode(v.o) === mode)
            .sort((a, b) => a.p.price + a.fee + a.nomination - b.p.price - b.fee - b.nomination)[0];
          return candidate
            ? [
                {
                  mode,
                  total: candidate.p.price + candidate.fee + candidate.nomination,
                  durationMinutes: candidate.o.durationMinutes,
                },
              ]
            : [];
        }),
        ...(p.comparePrice !== undefined
          ? { compareTotal: p.comparePrice + transportFee + priced.nomination }
          : {}),
        ...(p.promotion ? { promotionEndsAt: p.promotion.endsAt } : {}),
        earliestAt: null,
        badges: { freeTravel: transportFee === 0, instantNow: false },
      },
    ];
  });
  const stats =
    d.sort === 'rating'
      ? await listingStats(
          engine,
          matched.map((x) => x.listing.id),
        )
      : {};
  const candidates: MobileTherapist[] = matched.map((x) => ({
    ...x,
    stats: stats[x.listing.id] ?? emptyStats(),
  }));
  const rank = (a: MobileTherapist, b: MobileTherapist) =>
    (d.sort === 'price'
      ? a.total - b.total
      : d.sort === 'rating'
        ? (b.stats.rating ?? -1) - (a.stats.rating ?? -1) ||
          b.stats.reviewCount - a.stats.reviewCount
        : d.sort === 'distance'
          ? areaDistanceKm(d.near!, a.store.areas) - areaDistanceKm(d.near!, b.store.areas)
          : 0) || a.listing.id.localeCompare(b.listing.id);
  candidates.sort(rank);
  // Default pages check at most the requested page's 20 candidates. "Soonest" needs every
  // matching time, and "lowest total" needs every shown price (a time-band surcharge depends
  // on the shown slot), so both rank all candidates before paging.
  const rankAll = d.sort === 'earliest' || d.sort === 'price';
  const pageCandidates = rankAll ? candidates : candidates.slice(offset, offset + d.limit);
  const items: MobileTherapist[] = await Promise.all(
    pageCandidates.map(async (item) => {
      const availability = await engine.availability(
        item.listing.id,
        item.offering.id,
        false,
        d.language ?? '',
        d.mode,
        d.area ?? '',
        fulfillmentMode(item.offering),
      );
      const instant =
        d.mode === 'INSTANT'
          ? availability
          : fulfillmentMode(item.offering) !== 'IN_STORE' &&
              item.listing.onDuty &&
              item.store.acceptanceMode !== 'MANUAL'
            ? await engine.availability(
                item.listing.id,
                item.offering.id,
                false,
                d.language ?? '',
                'INSTANT',
                d.area ?? '',
              )
            : undefined;
      const earliestAt = availability.slots[0] ?? null;
      // The shown price is the price at the shown time, including any shop time-band surcharge.
      const surcharge = earliestAt ? timeSurchargeAt(item.store.bookingRules, earliestAt) : 0;
      return {
        ...item,
        earliestAt,
        ...(surcharge
          ? {
              timeSurcharge: surcharge,
              total: item.total + surcharge,
              ...(item.compareTotal !== undefined
                ? { compareTotal: item.compareTotal + surcharge }
                : {}),
            }
          : {}),
        badges: { ...item.badges, instantNow: !!instant?.slots.length },
      };
    }),
  );
  items.sort((a, b) =>
    d.sort === 'earliest'
      ? (a.earliestAt ?? Infinity) - (b.earliestAt ?? Infinity) ||
        a.listing.id.localeCompare(b.listing.id)
      : rank(a, b),
  );
  const pageItems = rankAll ? items.slice(offset, offset + d.limit) : items;
  if (d.sort !== 'rating') {
    const pageStats = await listingStats(
      engine,
      pageItems.map((x) => x.listing.id),
    );
    for (const item of pageItems) item.stats = pageStats[item.listing.id];
  }
  return {
    items: pageItems,
    total: candidates.length,
    nextCursor:
      offset + d.limit < candidates.length
        ? Buffer.from(JSON.stringify({ key: signature, offset: offset + d.limit })).toString(
            'base64url',
          )
        : null,
    checkedAt: now,
  };
}
