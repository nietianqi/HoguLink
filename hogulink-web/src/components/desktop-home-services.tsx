import type { Locale } from '@hogulink/contracts';
import type { Catalog } from '@/lib/api';
import type { ListingStatsMap, ShopStatsMap } from '@/lib/shop-stats';
import { HomeRecommendations } from './h5-consumer';

/** Desktop and H5 share recommendation rules, filters, amounts and booking links. */
export function DesktopHomeServices({
  locale: l,
  catalog,
  q,
  shopStats,
  listingStats,
}: {
  locale: Locale;
  catalog: Catalog;
  q: Record<string, string>;
  shopStats: ShopStatsMap;
  listingStats: ListingStatsMap;
}) {
  return (
    <section className="customer-home-services wrap" id="desktop-home-browse">
      <HomeRecommendations
        locale={l}
        catalog={catalog}
        q={q}
        shopStats={shopStats}
        listingStats={listingStats}
        desktop
      />
    </section>
  );
}
