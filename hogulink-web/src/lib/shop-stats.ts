import type { ListingStats } from '@hogulink/contracts';

/** A missing key means unknown, never an empty history. */
export type ListingStatsMap = Partial<Record<string, ListingStats>>;
export type ShopStatsMap = ListingStatsMap;

/** Respect the public endpoint's 50-ID limit and keep partial successes on failure. */
async function loadPublicStats(
  kind: 'store' | 'listing',
  ids: string[],
  read: (path: string) => Promise<ListingStatsMap>,
): Promise<ListingStatsMap> {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += 50) batches.push(unique.slice(i, i + 50));
  const result: ShopStatsMap = {};
  // Avoid starting one request per batch simultaneously for large directories.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, batches.length) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        try {
          const data = await read(
            `public/${kind}-stats?ids=${encodeURIComponent(batch.join(','))}`,
          );
          for (const id of batch) if (data[id]) result[id] = data[id];
        } catch {
          // Other batches remain usable. The UI exposes an explicit retry for unknown facts.
        }
      }
    }),
  );
  return result;
}

export function loadShopStats(ids: string[], read: (path: string) => Promise<ShopStatsMap>) {
  return loadPublicStats('store', ids, read);
}

export function loadListingStats(ids: string[], read: (path: string) => Promise<ListingStatsMap>) {
  return loadPublicStats('listing', ids, read);
}
