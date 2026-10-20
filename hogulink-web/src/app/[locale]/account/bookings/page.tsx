import { Operations } from '@/components/operations';
import { asLocale } from '@/lib/i18n';
import type { BookingFilter } from '@/lib/desktop-model';
import { H5PageHeading } from '@/components/h5-overlays';
import { ht } from '@/lib/h5-i18n';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: ht(asLocale((await params).locale), 'orders'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const q = await searchParams;
  const filter: BookingFilter = ['all', 'active', 'completed', 'attention', 'closed'].includes(
    q.status ?? '',
  )
    ? (q.status as BookingFilter)
    : 'all';
  const l = asLocale((await params).locale);
  return (
    <main id="main" className="wrap page-section h5-order-list-page h5-surface">
      <div className="h5-order-list-heading">
        <H5PageHeading locale={l} title={ht(l, 'orders')} />
      </div>
      <Operations key={filter} locale={l} role="CUSTOMER" initialFilter={filter} />
    </main>
  );
}
