import { FavoritesPage } from '@/components/experience-ui';
import { StoreFavoritesPage } from '@/components/engagement-ui';
import { asLocale } from '@/lib/i18n';
import { DiscoverySavedPage } from '@/components/discovery-post';
import { pt } from '@/lib/discovery-post-i18n';
import { qt } from '@/lib/quality-i18n';
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const l = asLocale((await params).locale);
  return {
    title: (await searchParams).type === 'content' ? pt(l, 'saved') : qt(l, 'favorites'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const l = asLocale((await params).locale);
  if ((await searchParams).type === 'content') return <DiscoverySavedPage locale={l} />;
  return (await searchParams).type === 'shops' ? (
    <StoreFavoritesPage locale={l} />
  ) : (
    <FavoritesPage locale={l} />
  );
}
