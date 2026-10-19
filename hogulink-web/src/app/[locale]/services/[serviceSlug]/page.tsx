import { notFound } from 'next/navigation';
import { TherapistCard } from '@/components/catalog';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale, t } from '@/lib/i18n';
import { seo } from '@/lib/seo';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; serviceSlug: string }>;
}) {
  const p = await params;
  const l = asLocale(p.locale);
  return seo(
    l,
    `/services/${p.serviceSlug}`,
    l === 'ja' ? 'リラクゼーション' : l === 'en' ? 'Relaxation' : '舒缓放松',
    t(l, 'nonMedical'),
  );
}
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; serviceSlug: string }>;
}) {
  const p = await params;
  if (p.serviceSlug !== 'relaxation') notFound();
  const l = asLocale(p.locale);
  const catalog = await serverApi<Catalog>('public/staff-listings');
  return (
    <main id="main" className="wrap page-section">
      <div className="page-title">
        <span className="eyebrow small">RELAXATION / TOKYO</span>
        <h1>{l === 'ja' ? 'リラクゼーション' : l === 'en' ? 'Relaxation sessions' : '舒缓放松'}</h1>
        <p>{t(l, 'nonMedical')}</p>
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
