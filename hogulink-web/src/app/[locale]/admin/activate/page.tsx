import { AdminAccessForm } from '@/components/admin-access-form';
import { asLocale } from '@/lib/i18n';
export const metadata = {
  title: 'Employee invitation · HoguLink',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ locale }, { token }] = await Promise.all([params, searchParams]);
  return <AdminAccessForm locale={asLocale(locale)} token={token} invitation />;
}
