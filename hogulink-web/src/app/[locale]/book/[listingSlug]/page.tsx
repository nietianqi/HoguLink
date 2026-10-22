import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BookingForm, VisitBackLink } from '@/components/booking-form';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale, t } from '@/lib/i18n';
import { vt } from '@/lib/visit-i18n';
import { VisitSteps } from '@/components/visit-shared';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: t(asLocale((await params).locale), 'booking'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; listingSlug: string }>;
}) {
  const p = await params;
  const l = asLocale(p.locale);
  const catalog = await serverApi<Catalog>('public/staff-listings');
  const listing = catalog.listings.find((x) => x.slug === p.listingSlug);
  if (!listing) notFound();
  const store = catalog.stores.find((x) => x.id === listing.storeId)!;
  return (
    <main id="main" className="wrap page-section visit-page">
      <Suspense
        fallback={
          <Link className="back-link" href={`/${l}/therapists/${listing.slug}`}>
            <ArrowLeft size={15} />
            {listing.name[l]}
          </Link>
        }
      >
        <VisitBackLink locale={l} listing={listing} />
      </Suspense>
      <VisitSteps locale={l} step={1} />
      <div className="visit-page-heading">
        <span className="eyebrow small">{vt(l, 'step1')}</span>
        <h1>{vt(l, 'bookingTitle')}</h1>
        <p>{vt(l, 'bookingText')}</p>
      </div>
      <Suspense fallback={<p>{t(l, 'waiting')}</p>}>
        <BookingForm
          locale={l}
          listing={listing}
          store={store}
          offerings={catalog.offerings.filter((x) => x.storeId === store.id)}
          team={catalog.listings.filter((x) => x.storeId === store.id)}
          rules={catalog.bookingRules}
        />
      </Suspense>
    </main>
  );
}
