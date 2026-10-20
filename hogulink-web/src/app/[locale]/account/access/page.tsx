import { Suspense } from 'react';
import { CustomerAuthForm } from '@/components/customer-auth-form';
import { asLocale } from '@/lib/i18n';
import { ca } from '@/lib/customer-auth-i18n';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: ca(asLocale((await params).locale), 'title'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  return (
    <Suspense>
      <CustomerAuthForm locale={locale} />
    </Suspense>
  );
}
