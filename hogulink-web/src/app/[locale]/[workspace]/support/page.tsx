import { notFound } from 'next/navigation';
import { CareCenter } from '@/components/care-center';
import { asLocale } from '@/lib/i18n';
export const metadata = {
  title: 'Support & safety workspace',
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspace: string }>;
  searchParams: Promise<{ booking?: string; case?: string }>;
}) {
  const p = await params;
  const q = await searchParams;
  if (!['merchant', 'staff', 'admin'].includes(p.workspace)) notFound();
  return (
    <main id="main" className="wrap page-section">
      <CareCenter
        key={`${p.workspace}:${q.case ?? ''}:${q.booking ?? ''}`}
        locale={asLocale(p.locale)}
        role={p.workspace === 'merchant' ? 'MERCHANT' : p.workspace === 'staff' ? 'STAFF' : 'ADMIN'}
        initialBookingId={q.booking}
        initialTicketId={q.case}
      />
    </main>
  );
}
