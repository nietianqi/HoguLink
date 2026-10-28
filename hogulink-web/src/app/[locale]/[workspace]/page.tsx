import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { MerchantWorkspace } from '@/components/merchant-workspace';
import { StaffWorkspace } from '@/components/staff-workspace';
import { AdminWorkspace } from '@/components/admin-workspace';
import { at, adminTabs, type AdminTab } from '@/lib/admin-i18n';
import { t } from '@/lib/i18n';
import { asLocale } from '@/lib/i18n';
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspace: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const p = await params,
    q = await searchParams,
    l = asLocale(p.locale);
  return {
    title:
      p.workspace === 'admin'
        ? at(l, adminTabs.includes(q.tab as AdminTab) ? (q.tab as AdminTab) : 'title')
        : t(l, p.workspace === 'staff' ? 'staff' : 'merchant'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; workspace: string }>;
}) {
  const p = await params;
  if (!['merchant', 'staff', 'admin'].includes(p.workspace)) notFound();
  return (
    <main
      id="main"
      className={`wrap page-section ${p.workspace === 'merchant' ? 'merchant-page' : p.workspace === 'staff' ? 'staff-page' : 'admin-page'}`}
    >
      {p.workspace === 'merchant' ? (
        <Suspense>
          <MerchantWorkspace locale={asLocale(p.locale)} />
        </Suspense>
      ) : p.workspace === 'staff' ? (
        <Suspense>
          <StaffWorkspace locale={asLocale(p.locale)} />
        </Suspense>
      ) : (
        <Suspense>
          <AdminWorkspace locale={asLocale(p.locale)} />
        </Suspense>
      )}
    </main>
  );
}
