import { DiscoveryHub } from '@/components/discovery-hub';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale } from '@/lib/i18n';
import { xt } from '@/lib/discovery-i18n';
import { seo } from '@/lib/seo';
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
    ['tab', 'search', 'area', 'language'].flatMap((k) =>
      typeof raw[k] === 'string' ? [[k, raw[k].slice(0, 100)]] : [],
    ),
  );
  return (
    <DiscoveryHub locale={l} catalog={await serverApi<Catalog>('public/staff-listings')} q={q} />
  );
}
