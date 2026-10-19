import { notFound } from 'next/navigation';
import { QualityWorkspace } from '@/components/quality-workspace';
import { asLocale } from '@/lib/i18n';
export const metadata = { title: 'Experience & safety', robots: { index: false, follow: false } };
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; workspace: string }>;
}) {
  const p = await params;
  if (!['merchant', 'staff', 'admin'].includes(p.workspace)) notFound();
  return (
    <QualityWorkspace
      locale={asLocale(p.locale)}
      role={p.workspace === 'merchant' ? 'MERCHANT' : p.workspace === 'staff' ? 'STAFF' : 'ADMIN'}
    />
  );
}
