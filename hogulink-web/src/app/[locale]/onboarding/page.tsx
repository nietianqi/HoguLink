import { PartnerPortal } from '@/components/partner-portal';
import { asLocale } from '@/lib/i18n';
export const metadata = { title: 'Partner onboarding', robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <main id="main" className="wrap page-section onboarding-page">
      <PartnerPortal locale={asLocale(locale)} />
    </main>
  );
}
