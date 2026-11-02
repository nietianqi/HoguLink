import { Suspense } from 'react';
import { asLocale } from '@/lib/i18n';
import { cm } from '@/lib/community-i18n';
import { CommunityMine } from '@/components/community-compose';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return { title: cm(l, 'mine'), robots: { index: false, follow: false } };
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return (
    <Suspense>
      <CommunityMine locale={asLocale((await params).locale)} />
    </Suspense>
  );
}
