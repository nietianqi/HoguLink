import { at } from '@/lib/admin-i18n';
import { AdminFrame } from '@/components/admin-navigation';
import { Suspense } from 'react';
import { ContentReview } from '@/components/content-review';
import { asLocale } from '@/lib/i18n';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: at(asLocale((await params).locale), 'contentNav'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return (
    <Suspense>
      <AdminFrame locale={l} active="content">
        <ContentReview locale={l} />
      </AdminFrame>
    </Suspense>
  );
}
