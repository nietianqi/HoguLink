import { redirect } from 'next/navigation';
import { asLocale } from '@/lib/i18n';
import { browseHref } from '@/lib/booking-browse-model';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const l = asLocale((await params).locale);
  redirect(browseHref(l, { ...(await searchParams), view: 'services' }));
}
