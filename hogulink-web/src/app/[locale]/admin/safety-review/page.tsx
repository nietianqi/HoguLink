import { ContentReview } from '@/components/content-review';
import { asLocale } from '@/lib/i18n';
export const metadata = { title: 'Message safety review', robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return <ContentReview locale={asLocale((await params).locale)} />;
}
