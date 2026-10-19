import { Operations } from '@/components/operations';
import { asLocale } from '@/lib/i18n';
import type { BookingFilter } from '@/lib/desktop-model';
export const metadata = { title: 'My bookings', robots: { index: false, follow: false } };
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
  return (
    <main id="main" className="wrap page-section">
      <Operations
        key={filter}
        locale={asLocale((await params).locale)}
        role="CUSTOMER"
        initialFilter={filter}
      />
    </main>
  );
}
