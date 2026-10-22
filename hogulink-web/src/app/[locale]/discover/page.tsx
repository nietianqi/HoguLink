import { DiscoveryHub } from '@/components/discovery-hub';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale } from '@/lib/i18n';
import { xt } from '@/lib/discovery-i18n';
import { seo } from '@/lib/seo';
import type { DiscoveryFeed } from '@hogulink/contracts';
import { loadShopStats, type ShopStatsMap } from '@/lib/shop-stats';
import { shopCards, shopPage } from '@/lib/shop-model';
import { discoveryParams, discoveryQuery } from '@/lib/discovery-feed-model';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return seo(l, '/discover', xt(l, 'discover'), xt(l, 'intro'));
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const l = asLocale((await params).locale),
    raw = await searchParams;
  const q = Object.fromEntries(
    ['tab', 'search', 'area', 'language', 'mode', 'shopPage'].flatMap((k) =>
      typeof raw[k] === 'string' ? [[k, raw[k].slice(0, 100)]] : [],
    ),
  );
  const [catalog, feed] = await Promise.all([
    serverApi<Catalog>(
      `public/staff-listings?${new URLSearchParams({
        ...(q.area ? { area: q.area } : {}),
        ...(q.language ? { language: q.language } : {}),
        ...(q.mode === 'INSTANT' ? { mode: 'INSTANT' } : {}),
      })}`,
    ),
    serverApi<DiscoveryFeed>(`public/discovery?${discoveryParams(discoveryQuery(q))}`).catch(
      () => null,
    ),
  ]);
  const shopStats =
    q.tab === 'shops'
      ? await loadShopStats(
          shopPage(shopCards(catalog, { ...q, locale: l }), q.shopPage).items.map(
            (card) => card.store.id,
          ),
          (path) => serverApi<ShopStatsMap>(path),
        )
      : {};
  return <DiscoveryHub locale={l} catalog={catalog} q={q} feed={feed} shopStats={shopStats} />;
}
