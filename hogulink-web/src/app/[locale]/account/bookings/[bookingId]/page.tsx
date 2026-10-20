import { Operations } from '@/components/operations';
import { asLocale } from '@/lib/i18n';
import { vt } from '@/lib/visit-i18n';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: vt(asLocale((await params).locale), 'orderDetails'),
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
