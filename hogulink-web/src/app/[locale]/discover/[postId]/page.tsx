import { notFound } from 'next/navigation';
import type { DiscoveryDetail } from '@hogulink/contracts';
import { asLocale } from '@/lib/i18n';
import { serverApi, ServerApiError } from '@/lib/api';
import { discoveryApiParams, discoveryQuery } from '@/lib/discovery-feed-model';
import { pt } from '@/lib/discovery-post-i18n';
import { DiscoveryPostPage, DiscoveryUnavailable } from '@/components/discovery-post';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return { title: pt(l, 'detail'), robots: { index: false, follow: true } };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; postId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await params,
    l = asLocale(p.locale),
    q = discoveryQuery(await searchParams);
  let detail: DiscoveryDetail;
  try {
    detail = await serverApi<DiscoveryDetail>(
      `public/discovery/${encodeURIComponent(p.postId)}?${discoveryApiParams(q, 'detail')}`,
    );
  } catch (e) {
    if (e instanceof ServerApiError && e.status === 404) notFound();
    return <DiscoveryUnavailable locale={l} />;
  }
  return <DiscoveryPostPage locale={l} detail={detail} q={q} />;
}
