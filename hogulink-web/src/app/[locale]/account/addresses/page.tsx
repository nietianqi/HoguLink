import { AddressBookPage } from '@/components/address-book';
import { asLocale } from '@/lib/i18n';
import { af } from '@/lib/customer-flow-i18n';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: af(asLocale((await params).locale), 'addresses'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return <AddressBookPage locale={asLocale((await params).locale)} />;
}
