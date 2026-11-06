import { asLocale } from '@/lib/i18n';
import { CustomerAccountNav, CustomerSavedTabs } from '@/components/customer-account-nav';
import { Suspense } from 'react';

export default async function AccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const l = asLocale((await params).locale);
  return (
    <div className="customer-account-layout wrap">
      <Suspense>
        <CustomerAccountNav locale={l} />
      </Suspense>
      <div className="customer-account-content">
        <Suspense>
          <CustomerSavedTabs locale={l} />
        </Suspense>
        {children}
      </div>
    </div>
  );
}
