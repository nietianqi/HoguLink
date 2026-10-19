import { CustomerHub } from '@/components/consumer-journey';
import { asLocale } from '@/lib/i18n';
export const metadata = { title: 'My HoguLink', robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return <CustomerHub locale={asLocale((await params).locale)} />;
}
