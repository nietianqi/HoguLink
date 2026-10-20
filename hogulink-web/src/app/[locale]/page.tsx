import { CustomerHome } from '@/components/customer-home';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale, t } from '@/lib/i18n';
import { directoryQuery } from '@/lib/therapist-directory-model';
import { seo } from '@/lib/seo';
import type { MobileTherapists } from '@hogulink/contracts';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return seo(l, '', t(l, 'explore'), t(l, 'heroText'));
}
export default async function Home({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const l = asLocale((await params).locale),
    q = directoryQuery(await searchParams);
  const [catalog, recommendations] = await Promise.all([
    serverApi<Catalog>(
      `public/staff-listings?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([k]) => ['area', 'language', 'mode'].includes(k))))}`,
    ),
    serverApi<MobileTherapists>(
      `public/h5/therapists?${new URLSearchParams({ ...q, limit: '6' })}`,
    ).catch(() => null),
  ]);
  return <CustomerHome locale={l} catalog={catalog} recommendations={recommendations} q={q} />;
}
