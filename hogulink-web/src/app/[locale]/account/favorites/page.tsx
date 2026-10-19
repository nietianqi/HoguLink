import { FavoritesPage } from '@/components/experience-ui';
import { StoreFavoritesPage } from '@/components/engagement-ui';
import { asLocale } from '@/lib/i18n';
export const metadata = { title: 'My favorites', robots: { index: false, follow: false } };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const l = asLocale((await params).locale);
  return (await searchParams).type === 'shops' ? (
    <StoreFavoritesPage locale={l} />
  ) : (
    <FavoritesPage locale={l} />
  );
}
