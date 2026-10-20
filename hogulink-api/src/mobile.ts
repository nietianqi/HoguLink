import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  areaDistanceKm,
  effectiveServicePrice,
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
  const catalog = await engine.publicCatalog();
  const visibleStores = new Set(catalog.listings.map((listing) => listing.storeId));
  return {
    version: 1,
    currency: 'JPY',
    demo: (process.env.APP_MODE ?? 'demo') === 'demo',
    serviceAreas: [
      ...new Set(catalog.stores.filter((s) => visibleStores.has(s.id)).flatMap((s) => s.areas)),
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
    const priced = catalog.offerings
      .filter(
        (o) =>
          o.storeId === store.id &&
          listing.offeringIds.includes(o.id) &&
          o.regulatoryCategory === 'RELAXATION' &&
          (d.travel !== 'free' || o.transportFee === 0) &&
          o.durationMinutes === Number(d.duration),
      )
      .map((o) => ({ o, p: effectiveServicePrice(o, now) }))
      .sort(
        (a, b) =>
          a.p.price + a.o.transportFee - b.p.price - b.o.transportFee ||
          a.o.id.localeCompare(b.o.id),
      )[0];
    if (!priced) return [];
    const { o: offering, p } = priced;
    return [
      {
        listing,
        store,
        offering,
        nominationFee,
        total: p.price + offering.transportFee + nominationFee,
        ...(p.comparePrice !== undefined
          ? { compareTotal: p.comparePrice + offering.transportFee + nominationFee }
          : {}),
        ...(p.promotion ? { promotionEndsAt: p.promotion.endsAt } : {}),
        earliestAt: null,
        badges: { freeTravel: offering.transportFee === 0, instantNow: false },
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
  // Default and price pages check at most the requested page's 20 candidates.
  // The explicit soonest sort needs all matching times before it can rank them.
  const pageCandidates =
    d.sort === 'earliest' ? candidates : candidates.slice(offset, offset + d.limit);
  const items: MobileTherapist[] = await Promise.all(
    pageCandidates.map(async (item) => {
      const availability = await engine.availability(
        item.listing.id,
        item.offering.id,
        false,
        d.language ?? '',
        d.mode,
        d.area ?? '',
      );
      const instant =
        d.mode === 'INSTANT'
          ? availability
          : item.listing.onDuty && item.store.acceptanceMode !== 'MANUAL'
            ? await engine.availability(
                item.listing.id,
                item.offering.id,
                false,
                d.language ?? '',
                'INSTANT',
                d.area ?? '',
              )
            : undefined;
      return {
        ...item,
        earliestAt: availability.slots[0] ?? null,
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
  const pageItems = d.sort === 'earliest' ? items.slice(offset, offset + d.limit) : items;
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
