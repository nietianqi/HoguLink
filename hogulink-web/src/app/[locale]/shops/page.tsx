import { serverApi, type Catalog } from '@/lib/api';
import { asLocale } from '@/lib/i18n';
import { seo } from '@/lib/seo';
import { bf } from '@/lib/booking-browse-i18n';
import { shopDirectoryQuery, browsePreferences } from '@/lib/booking-browse-model';
import { shopCards, shopPage } from '@/lib/shop-model';
import { loadShopStats, type ShopStatsMap } from '@/lib/shop-stats';
import { ShopDirectory } from '@/components/shop-directory';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return seo(l, '/shops', bf(l, 'allShops'), bf(l, 'shopPriceNote'));
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const l = asLocale((await params).locale),
    q = shopDirectoryQuery(await searchParams);
  const catalog = await serverApi<Catalog>(
    `public/staff-listings?${new URLSearchParams({ ...browsePreferences(q), fulfillmentMode: q.fulfillmentMode || 'ALL' })}`,
  );
  const all = shopCards(catalog, { ...q, locale: l });
  if (q.sort === 'name')
    all.sort(
      (a, b) =>
        a.store.name[l].localeCompare(b.store.name[l], l) || a.store.id.localeCompare(b.store.id),
    );
  const page = shopPage(all, q.shopPage);
  const stats = await loadShopStats(
    page.items.map((c) => c.store.id),
    (path) => serverApi<ShopStatsMap>(path),
  );
  return (
    <ShopDirectory
      key={JSON.stringify(q)}
      locale={l}
      q={q}
      cards={page.items.map((c) => ({ ...c, stats: stats[c.store.id] }))}
      page={page.page}
      pages={page.pages}
      total={page.total}
      demo={catalog.demo}
    />
  );
}
