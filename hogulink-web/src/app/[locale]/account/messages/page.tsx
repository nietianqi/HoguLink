import { CustomerInboxPage } from '@/components/engagement-ui';
import type { InboxFilter } from '@hogulink/contracts';
import { asLocale } from '@/lib/i18n';
import { xt } from '@/lib/discovery-i18n';
import { H5MessageNotice } from '@/components/h5-consumer';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return { title: xt(l, 'inbox'), robots: { index: false, follow: false } };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ filter?: string; channel?: string }>;
}) {
  const l = asLocale((await params).locale),
    q = await searchParams,
    filter = (
      ['all', 'unread', 'bookings', 'support'].includes(q.filter ?? '') ? q.filter : 'all'
    ) as InboxFilter;
  if (q.channel === 'activity' || q.channel === 'system')
    return <H5MessageNotice locale={l} channel={q.channel} />;
  const channel = q.channel === 'orders' || q.filter !== undefined ? 'orders' : undefined;
  return (
    <CustomerInboxPage
      locale={l}
      filter={filter}
      channel={channel}
      key={`${filter}:${channel ?? 'home'}`}
    />
  );
}
