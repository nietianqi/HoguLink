import { CareCenter } from '@/components/care-center';
import { asLocale, t } from '@/lib/i18n';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: t(asLocale((await params).locale), 'support'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ booking?: string; ticket?: string; category?: string }>;
}) {
  const q = await searchParams;
  return (
    <main id="main" className="wrap page-section">
      <CareCenter
        locale={asLocale((await params).locale)}
        role="CUSTOMER"
        initialBookingId={q.booking}
        initialTicketId={typeof q.ticket === 'string' ? q.ticket : undefined}
        initialCategory={typeof q.category === 'string' ? q.category : undefined}
      />
    </main>
  );
}
