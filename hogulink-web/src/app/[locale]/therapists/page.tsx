import { H5TherapistDirectory } from '@/components/h5-therapist-directory';
import { Suspense } from 'react';
import { serverApi } from '@/lib/api';
import { asLocale, t } from '@/lib/i18n';
import { directoryQuery, directoryHref } from '@/lib/therapist-directory-model';
import { ht } from '@/lib/h5-i18n';
import { seo } from '@/lib/seo';
import type { MobileBootstrap, MobileTherapists } from '@hogulink/contracts';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return seo(l, '/therapists', t(l, 'explore'), ht(l, 'welcomeSub'));
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const l = asLocale((await params).locale),
    raw = await searchParams;
  const q = directoryQuery(raw);
  try {
    const [initial, bootstrap] = await Promise.all([
      serverApi<MobileTherapists>(
        `public/h5/therapists?${new URLSearchParams({ ...q, fulfillmentMode: q.fulfillmentMode || 'ALL' })}`,
      ),
      serverApi<MobileBootstrap>('public/h5/bootstrap'),
    ]);
    return (
      <>
        <H5TherapistDirectory
          key={JSON.stringify(q)}
          locale={l}
          q={q}
          initial={initial}
          bootstrap={bootstrap}
        />
      </>
    );
  } catch {
    return (
      <main id="main" className="wrap h5-surface h5-empty">
        <h1>{t(l, 'explore')}</h1>
        <p role="alert">{ht(l, 'retry')}</p>
        <a className="h5-primary" href={directoryHref(l, q)}>
          {ht(l, 'retryAction')}
        </a>
      </main>
    );
  }
}
