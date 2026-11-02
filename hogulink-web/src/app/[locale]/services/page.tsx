import { ServiceCatalog } from '@/components/consumer-journey';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale } from '@/lib/i18n';
import { ut } from '@/lib/consumer-i18n';
import { seo } from '@/lib/seo';
import { browsePreferences, serviceDirectoryQuery } from '@/lib/booking-browse-model';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return seo(l, '/services', ut(l, 'services'), ut(l, 'serviceIntro'));
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
  const q = serviceDirectoryQuery(raw);
  const catalog = await serverApi<Catalog>(
    `public/staff-listings?${new URLSearchParams({ ...browsePreferences(q), fulfillmentMode: q.fulfillmentMode || 'ALL' })}`,
  );
  return (
    <>
      <ServiceCatalog key={JSON.stringify(q)} locale={l} catalog={catalog} q={q} />
    </>
  );
}
