import { ServiceCatalog } from '@/components/consumer-journey';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale, areas } from '@/lib/i18n';
import { ut } from '@/lib/consumer-i18n';
import { seo } from '@/lib/seo';
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
  const q = Object.fromEntries(
    Object.entries(raw).filter(
      (p): p is [string, string] =>
        typeof p[1] === 'string' &&
        ['duration', 'area', 'language', 'mode', 'search', 'sort'].includes(p[0]),
    ),
  );
  if (!Object.hasOwn(areas, q.area ?? '')) delete q.area;
  if (!['ja', 'en', 'zh'].includes(q.language)) delete q.language;
  q.mode = q.mode === 'INSTANT' ? 'INSTANT' : 'SCHEDULED';
  q.search = q.search?.slice(0, 80) ?? '';
  const catalog = await serverApi<Catalog>(
    `public/staff-listings?${new URLSearchParams({ mode: q.mode, ...(q.area ? { area: q.area } : {}), ...(q.language ? { language: q.language } : {}) })}`,
  );
  return <ServiceCatalog key={JSON.stringify(q)} locale={l} catalog={catalog} q={q} />;
}
