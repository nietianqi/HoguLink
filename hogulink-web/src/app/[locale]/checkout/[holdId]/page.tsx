import { Checkout } from '@/components/checkout';
import { asLocale, t } from '@/lib/i18n';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: t(asLocale((await params).locale), 'checkout'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; holdId: string }>;
}) {
  const p = await params;
  return (
    <main id="main" className="wrap page-section visit-page">
      <Checkout locale={asLocale(p.locale)} holdId={p.holdId} />
    </main>
  );
}
