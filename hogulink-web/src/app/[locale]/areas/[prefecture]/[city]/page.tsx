import { notFound } from 'next/navigation';
import { TherapistCard } from '@/components/catalog';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale, t, areas, areaName } from '@/lib/i18n';
import { seo } from '@/lib/seo';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; prefecture: string; city: string }>;
}) {
  const p = await params;
  const l = asLocale(p.locale);
  return seo(
    l,
    `/areas/${p.prefecture}/${p.city}`,
    `${areaName(l, p.city)} · ${t(l, 'explore')}`,
    t(l, 'heroText'),
  );
}
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; prefecture: string; city: string }>;
}) {
  const p = await params;
  if (p.prefecture !== 'tokyo' || !Object.hasOwn(areas, p.city)) notFound();
  const l = asLocale(p.locale);
  const catalog = await serverApi<Catalog>(`public/staff-listings?area=${p.city}`);
  if (!catalog.listings.length) notFound();
  return (
    <main id="main" className="wrap page-section">
      <div className="page-title">
        <span className="eyebrow small">TOKYO / {p.city.toUpperCase()}</span>
        <h1>
          {areaName(l, p.city)} · {t(l, 'explore')}
        </h1>
        <p>{t(l, 'subtitle')}</p>
      </div>
      <div className="therapist-grid">
        {catalog.listings.map((listing) => (
          <TherapistCard
            key={listing.id}
            listing={listing}
            store={catalog.stores.find((x) => x.id === listing.storeId)!}
            offerings={catalog.offerings}
            locale={l}
          />
        ))}
      </div>
    </main>
  );
}
