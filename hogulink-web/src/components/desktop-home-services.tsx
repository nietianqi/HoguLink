import Link from 'next/link';
import { ArrowUpRight, CalendarDays, Heart, History, ShieldCheck } from 'lucide-react';
import type { Locale } from '@hogulink/contracts';
import type { Catalog } from '@/lib/api';
import type { ListingStatsMap, ShopStatsMap } from '@/lib/shop-stats';
import { ut } from '@/lib/consumer-i18n';
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
      <nav className="customer-shortcuts" aria-label={ut(l, 'utilities')}>
        {(
          [
            [CalendarDays, 'bookings', 'account/bookings'],
            [Heart, 'favorites', 'account/favorites'],
            [History, 'history', 'account/history'],
            [ShieldCheck, 'support', 'account/support'],
          ] as const
        ).map(([Icon, label, path]) => (
          <Link href={`/${l}/${path}`} key={path}>
            <Icon size={22} />
            <span>{ut(l, label)}</span>
            <ArrowUpRight size={16} />
          </Link>
        ))}
      </nav>
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
