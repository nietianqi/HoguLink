import { Suspense } from 'react';
import { at } from '@/lib/admin-i18n';
import { AdminFrame } from '@/components/admin-navigation';
import { MerchantNavigation } from '@/components/merchant-navigation';
import { StaffNavigation, StaffLanguage } from '@/components/staff-navigation';
import { notFound } from 'next/navigation';
import { QualityWorkspace } from '@/components/quality-workspace';
import { asLocale } from '@/lib/i18n';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; workspace: string }>;
}) {
  const p = await params;
  return {
    title: at(asLocale(p.locale), 'experienceNav'),
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
  const content = (
    <QualityWorkspace
      locale={asLocale(p.locale)}
      role={p.workspace === 'merchant' ? 'MERCHANT' : p.workspace === 'staff' ? 'STAFF' : 'ADMIN'}
    />
  );
  return p.workspace === 'admin' ? (
    <Suspense>
      <AdminFrame locale={asLocale(p.locale)} active="quality">
        {content}
      </AdminFrame>
    </Suspense>
  ) : p.workspace === 'merchant' ? (
    <Suspense>
      <div className="wrap merchant-page">
        <div className="merchant-layout workday-merchant">
          <MerchantNavigation locale={asLocale(p.locale)} />
          <div className="merchant-content">{content}</div>
        </div>
      </div>
    </Suspense>
  ) : (
    <Suspense>
      <div className="wrap staff-page">
        <div className="staff-layout workday-staff">
          <StaffNavigation locale={asLocale(p.locale)} />
          <div className="staff-content">
            <StaffLanguage locale={asLocale(p.locale)} />
            {content}
          </div>
        </div>
      </div>
    </Suspense>
  );
}
