import { H5Benefits } from '@/components/h5-consumer';
import { serverApi } from '@/lib/api';
import { asLocale } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import type { MobileBootstrap } from '@hogulink/contracts';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: ht(asLocale((await params).locale), 'card'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return (
    <H5Benefits
      locale={asLocale((await params).locale)}
      bootstrap={await serverApi<MobileBootstrap>('public/h5/bootstrap')}
    />
  );
}
