import { DeviceHistory } from '@/components/consumer-journey';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale } from '@/lib/i18n';
export const metadata = { title: 'Recently viewed', robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return (
    <DeviceHistory
      locale={asLocale((await params).locale)}
      catalog={await serverApi<Catalog>('public/staff-listings')}
    />
  );
}
