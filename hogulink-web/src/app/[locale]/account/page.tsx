import { CustomerHub } from '@/components/consumer-journey';
import { asLocale } from '@/lib/i18n';
import { ut } from '@/lib/consumer-i18n';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: ut(asLocale((await params).locale), 'mine'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return <CustomerHub locale={asLocale((await params).locale)} />;
}
