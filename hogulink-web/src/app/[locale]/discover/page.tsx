import { DiscoveryHub } from '@/components/discovery-hub';
import { serverApi } from '@/lib/api';
import { asLocale } from '@/lib/i18n';
import { xt } from '@/lib/discovery-i18n';
import { seo } from '@/lib/seo';
import type { DiscoveryFeed } from '@hogulink/contracts';
import { redirect } from 'next/navigation';
import { browseHref } from '@/lib/booking-browse-model';
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
    ['tab', 'search', 'area', 'language', 'shopPage'].flatMap((k) =>
      typeof raw[k] === 'string' ? [[k, raw[k].slice(0, 100)]] : [],
    ),
  );
  if (q.tab === 'shops') redirect(browseHref(l, { ...q, view: 'shops' }));
  const feed = await serverApi<DiscoveryFeed>(`public/discovery?${discoveryParams(discoveryQuery(q))}`).catch(() => null);
  return <DiscoveryHub locale={l} q={q} feed={feed} />;
}
