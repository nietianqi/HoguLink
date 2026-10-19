import { CustomerInboxPage } from '@/components/engagement-ui';
import type { InboxFilter } from '@hogulink/contracts';
import { asLocale } from '@/lib/i18n';
import { xt } from '@/lib/discovery-i18n';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return { title: xt(l, 'inbox'), robots: { index: false, follow: false } };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const l = asLocale((await params).locale),
    q = await searchParams,
    filter = (
      ['all', 'unread', 'bookings', 'support'].includes(q.filter ?? '') ? q.filter : 'all'
    ) as InboxFilter;
  return <CustomerInboxPage locale={l} filter={filter} key={filter} />;
}
