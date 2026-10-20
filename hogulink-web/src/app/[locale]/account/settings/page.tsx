import Link from 'next/link';
import { Suspense } from 'react';
import { H5Language } from '@/components/h5-consumer';
import { asLocale } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { H5AccountSession, H5PageHeading } from '@/components/h5-overlays';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return {
    title: ht(asLocale((await params).locale), 'settings'),
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return (
    <main id="main" className="wrap h5-settings h5-surface">
      <H5PageHeading locale={l} title={ht(l, 'settings')} />
      <section className="quality-card">
        <h2>{ht(l, 'language')}</h2>
        <Suspense>
          <H5Language locale={l} />
        </Suspense>
      </section>
      <nav className="quality-card">
        {(
          [
            ['addresses', 'account/addresses'],
            ['card', 'account/benefits'],
            ['privacy', 'legal/privacy'],
            ['terms', 'legal/terms'],
            ['support', 'account/support'],
          ] as const
        ).map(([key, href]) => (
          <Link key={key} href={`/${l}/${href}`}>
            {ht(l, key)}
          </Link>
        ))}
        <Link href={`/${l}/account/access`}>{ht(l, 'accountAccess')}</Link>
      </nav>
      <H5AccountSession locale={l} />
      <p className="h5-footnote">{ht(l, 'nativeHelp')}</p>
      <Link href={`/${l}/account`}>{utFallback(l)}</Link>
    </main>
  );
}
function utFallback(l: 'ja' | 'en' | 'zh-cn') {
  return l === 'ja' ? 'マイページ' : l === 'en' ? 'My account' : '返回我的';
}
