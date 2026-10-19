import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { locales, localeMap } from '@/lib/i18n';
import { Header, Footer } from '@/components/shell';
import { MobileNavigation } from '@/components/mobile-ui';
import type { Locale } from '@hogulink/contracts';
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) notFound();
  const l = locale as Locale;
  return (
    <>
      <a className="skip-link" href="#main">
        {l === 'ja' ? '本文へ' : l === 'en' ? 'Skip to content' : '跳至正文'}
      </a>
      <Suspense>
        <Header locale={l} />
      </Suspense>
      {children}
      <Footer locale={l} />
      <Suspense>
        <MobileNavigation locale={l} />
      </Suspense>
    </>
  );
}
