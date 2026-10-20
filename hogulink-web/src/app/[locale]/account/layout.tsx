import { asLocale } from '@/lib/i18n';
import { CustomerAccountNav } from '@/components/customer-account-nav';

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
      <CustomerAccountNav locale={l} />
      <div className="customer-account-content">{children}</div>
    </div>
  );
}
