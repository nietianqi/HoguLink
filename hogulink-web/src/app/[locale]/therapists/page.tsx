import { H5TherapistDirectory } from '@/components/h5-therapist-directory';
import { BrowseNavigation } from '@/components/booking-browse';
import { H5ShopCard } from '@/components/h5-shops';
import { ServiceCatalog } from '@/components/consumer-journey';
import { EmptyState } from '@/components/ui';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale } from '@/lib/i18n';
import { directoryQuery } from '@/lib/therapist-directory-model';
import { browseHref, browseQuery } from '@/lib/booking-browse-model';
import { cui } from '@/lib/customer-ui-i18n';
import { ht } from '@/lib/h5-i18n';
import { shopCards, shopCardHref, shopPage } from '@/lib/shop-model';
import { seo } from '@/lib/seo';
import type { MobileBootstrap, MobileTherapists } from '@hogulink/contracts';
import Link from 'next/link';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const l = asLocale((await params).locale);
  return seo(l, '/therapists', cui(l, 'browse'), cui(l, 'intro'));
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const l = asLocale((await params).locale),
    raw = await searchParams,
    q = browseQuery(raw);
  let content;
  try {
    if (q.view === 'therapists') {
      const query = directoryQuery(q);
      const [initial, bootstrap] = await Promise.all([
        serverApi<MobileTherapists>(`public/h5/therapists?${new URLSearchParams(query)}`),
        serverApi<MobileBootstrap>('public/h5/bootstrap'),
      ]);
      content = (
        <H5TherapistDirectory
          key={JSON.stringify(query)}
          locale={l}
          q={query}
          initial={initial}
          bootstrap={bootstrap}
        />
      );
    } else {
      const catalog = await serverApi<Catalog>(
        `public/staff-listings?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([k]) => ['area', 'language', 'mode'].includes(k))))}`,
      );
      if (q.view === 'services')
        content = (
          <ServiceCatalog
            key={`services:${JSON.stringify(q)}`}
            locale={l}
            catalog={catalog}
            q={q}
            embedded
          />
        );
      else {
        const filtered = {
          ...catalog,
          offerings: catalog.offerings.filter(
            (o) =>
              (!q.duration || String(o.durationMinutes) === q.duration) &&
              (q.travel !== 'free' || o.transportFee === 0),
          ),
        };
        const page = shopPage(
          shopCards(filtered, { ...q, locale: l }),
          typeof raw.page === 'string' ? raw.page : undefined,
        );
        content = (
          <section aria-label={cui(l, 'shops')}>
            <p className="ui-note">{cui(l, 'freeFees')}</p>
            <div className="ui-home-shops">
              {page.items.map((card) => (
                <H5ShopCard
                  key={card.store.id}
                  locale={l}
                  card={card}
                  href={shopCardHref(l, card, { area: q.area, language: q.language, mode: q.mode })}
                />
              ))}
            </div>
            {!page.items.length && (
              <EmptyState href={`/${l}/therapists?view=shops`} action={cui(l, 'clear')}>
                {cui(l, 'noMatch')}
              </EmptyState>
            )}
            {page.pages > 1 && (
              <nav className="ui-pagination" aria-label="Pagination">
                {page.page > 1 && (
                  <Link href={`${browseHref(l, q)}&page=${page.page - 1}`}>← {page.page - 1}</Link>
                )}
                <span>
                  {page.page} / {page.pages}
                </span>
                {page.page < page.pages && (
                  <Link href={`${browseHref(l, q)}&page=${page.page + 1}`}>{page.page + 1} →</Link>
                )}
              </nav>
            )}
          </section>
        );
      }
    }
  } catch {
    content = (
      <EmptyState href={browseHref(l, q)} action={ht(l, 'retryAction')}>
        {cui(l, 'checkLater')}
      </EmptyState>
    );
  }
  return (
    <main id="main" className="wrap ui-browse">
      <BrowseNavigation key={`filters:${JSON.stringify(q)}`} locale={l} q={q} />
      {content}
    </main>
  );
}
