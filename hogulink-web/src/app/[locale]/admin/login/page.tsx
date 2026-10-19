import { AdminAccessForm } from '@/components/admin-access-form';
import { asLocale } from '@/lib/i18n';
export const metadata = {
  title: 'Employee sign-in · HoguLink',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ activated?: string }>;
}) {
  const { locale } = await params;
  return (
    <AdminAccessForm locale={asLocale(locale)} activated={(await searchParams).activated === '1'} />
  );
}
