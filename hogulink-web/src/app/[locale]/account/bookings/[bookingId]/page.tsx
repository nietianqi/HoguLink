import { Operations } from '@/components/operations';
import { asLocale, t } from '@/lib/i18n';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: t(asLocale((await params).locale), 'orders'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; bookingId: string }>;
}) {
  const p = await params;
  return (
    <main id="main" className="wrap page-section">
      <Operations locale={asLocale(p.locale)} role="CUSTOMER" bookingId={p.bookingId} />
    </main>
  );
}
