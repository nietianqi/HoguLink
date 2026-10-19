import { Suspense } from 'react';
import { CustomerAuthForm } from '@/components/customer-auth-form';
import { asLocale } from '@/lib/i18n';
export const metadata = { title: 'Account access', robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  return (
    <Suspense>
      <CustomerAuthForm locale={locale} />
    </Suspense>
  );
}
