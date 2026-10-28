import { Suspense } from 'react';
import { at } from '@/lib/admin-i18n';
import { AdminFrame } from '@/components/admin-navigation';
import { notFound } from 'next/navigation';
import { CareCenter } from '@/components/care-center';
import { asLocale } from '@/lib/i18n';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; workspace: string }>;
}) {
  const p = await params;
  return { title: at(asLocale(p.locale), 'support'), robots: { index: false, follow: false } };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspace: string }>;
  searchParams: Promise<{ booking?: string; case?: string; queue?: string }>;
}) {
  const p = await params;
  const q = await searchParams;
  if (!['merchant', 'staff', 'admin'].includes(p.workspace)) notFound();
  const content = (
    <main id="main" className="wrap page-section">
      <CareCenter
        key={`${p.workspace}:${q.case ?? ''}:${q.booking ?? ''}:${q.queue ?? ''}`}
        locale={asLocale(p.locale)}
        role={p.workspace === 'merchant' ? 'MERCHANT' : p.workspace === 'staff' ? 'STAFF' : 'ADMIN'}
        initialBookingId={q.booking}
        initialTicketId={q.case}
        initialQueue={q.queue}
      />
    </main>
  );
  return p.workspace === 'admin' ? (
    <Suspense>
      <AdminFrame locale={asLocale(p.locale)} active="support">
        {content}
      </AdminFrame>
    </Suspense>
  ) : (
    content
  );
}
