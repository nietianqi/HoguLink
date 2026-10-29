import Link from 'next/link';
import { Clock3, Search, LayoutGrid, List } from 'lucide-react';
import { type Locale } from '@hogulink/contracts';
import { serverApi, type Catalog } from '@/lib/api';
import { serviceChoices } from '@/lib/consumer-model';
import { japanDay } from '@/lib/desktop-model';
import { t } from '@/lib/i18n';
import { dt } from '@/lib/desktop-i18n';
import { TherapistCard } from './catalog';
import { DiscoveryFilters } from './discovery-filters';
export async function AdvancedTherapistResults({
  locale: l,
  q,
}: {
  locale: Locale;
  q: Record<string, string>;
}) {
  const duration = [60, 90, 120].includes(Number(q.duration)) ? Number(q.duration) : 60;
  const maxTotal = [10000, 15000, 20000].includes(Number(q.maxTotal)) ? Number(q.maxTotal) : 0;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date ?? '') ? q.date : '';
  const mode =
    q.fulfillmentMode === 'IN_STORE' ? 'SCHEDULED' : q.mode === 'INSTANT' ? 'INSTANT' : 'SCHEDULED';
  const serviceMode =
    q.fulfillmentMode === 'IN_STORE'
      ? 'IN_STORE'
      : q.fulfillmentMode === 'HOME_VISIT'
        ? 'HOME_VISIT'
        : 'ALL';
  const href = (changes: Record<string, string>) =>
    `/${l}/therapists?${new URLSearchParams({ ...q, ...changes, filters: 'advanced' })}`;
  const catalog = await serverApi<Catalog>(
    `public/staff-listings?${new URLSearchParams({ area: q.area ?? '', language: q.language ?? '', mode, fulfillmentMode: serviceMode })}`,
  );
  const shopFilters = { area: q.area, language: q.language, mode, fulfillmentMode: serviceMode };
  const matchingChoices = serviceChoices(catalog, { ...shopFilters, duration }).filter(
    (choice) => !maxTotal || choice.total <= maxTotal,
  );
  const candidates = catalog.listings.flatMap((listing) => {
    const choices = matchingChoices.filter((c) => c.members.some((m) => m.id === listing.id));
    const chosen = choices.find((c) => c.offering.fulfillmentMode !== 'IN_STORE') ?? choices[0];
    if (!chosen) return [];
    const { store, offering } = chosen;
    if (q.acceptance === 'manual' && store.acceptanceMode !== 'MANUAL') return [];
    if (q.acceptance === 'auto' && store.acceptanceMode === 'MANUAL') return [];
    return [
      { listing, offering, store, total: chosen.total, offerings: choices.map((c) => c.offering) },
    ];
  });
  const availablePromise = Promise.all(
    candidates.map(async (item) => {
      let slots: number[] | undefined;
      if (mode === 'SCHEDULED') {
        try {
          slots = (
            await serverApi<{ slots: number[] }>(
              `public/staff-listings/${item.listing.id}/availability?${new URLSearchParams({ offeringId: item.offering.id, fulfillmentMode: item.offering.fulfillmentMode ?? 'HOME_VISIT', area: q.area ?? '', language: q.language ?? '' })}`,
            )
          ).slots;
        } catch {
          slots = undefined;
        }
      }
      return {
        ...item,
        slots: date && slots ? slots.filter((slot) => japanDay(slot) === date) : slots,
      };
    }),
  );
  const available = await availablePromise;
  const cards = available.filter(
    (item) => mode === 'INSTANT' || !date || (item.slots?.length ?? 0) > 0,
  );
  if (q.sort === 'price') cards.sort((a, b) => a.total - b.total);
  if (q.sort === 'earliest')
    cards.sort((a, b) => (a.slots?.[0] ?? Infinity) - (b.slots?.[0] ?? Infinity));
  return (
    <main id="main" className="wrap advanced-therapist-results">
      {' '}
      <section>
        <div className="section-heading">
          <div>
            <h1>{t(l, 'explore')}</h1>
            <p>{t(l, 'subtitle')}</p>
          </div>
          <span className="result-count">
            {cards.length}
            <span>{t(l, 'results')}</span>
          </span>
        </div>
        <div className="discovery-layout">
          <DiscoveryFilters
            key={JSON.stringify(q)}
            locale={l}
            q={q}
            mode={mode}
            duration={duration}
            standalone
          />
          <div className="discovery-results">
            {mode === 'SCHEDULED' && available.some((item) => item.slots === undefined) && (
              <p className="notice" role="status">
                {dt(l, 'unavailable')}
              </p>
            )}
            <div className="filter-row">
              <div className="filter-pills">
                <Link className={!q.language ? 'selected' : ''} href={href({ language: '' })}>
                  {t(l, 'all')}
                </Link>
                {[
                  ['ja', '日本語'],
                  ['en', 'English'],
                  ['zh', '中文'],
                ].map(([value, label]) => (
                  <Link
                    key={value}
                    className={q.language === value ? 'selected' : ''}
                    href={href({ language: value })}
                  >
                    {label}
                  </Link>
                ))}
              </div>
              <div className="view-toggle">
                <Link
                  href={href({ view: 'grid' })}
                  aria-label={dt(l, 'grid')}
                  aria-current={q.view !== 'list' ? 'true' : undefined}
                >
                  <LayoutGrid size={18} />
                </Link>
                <Link
                  href={href({ view: 'list' })}
                  aria-label={dt(l, 'list')}
                  aria-current={q.view === 'list' ? 'true' : undefined}
                >
                  <List size={19} />
                </Link>
              </div>
            </div>
            <div className={`therapist-grid ${q.view === 'list' ? 'therapist-list' : ''}`}>
              {cards.map(({ listing, store, offering, offerings, slots }) => (
                <TherapistCard
                  key={listing.id}
                  demo={catalog.demo}
                  listing={listing}
                  store={store}
                  offering={offering}
                  slots={slots}
                  area={q.area}
                  language={q.language}
                  offerings={offerings}
                  locale={l}
                  nominationFee={catalog.bookingRules?.nominationFee}
                  mode={mode}
                />
              ))}
            </div>
            {!cards.length && (
              <div className="empty-state">
                <Search size={30} />
                <p>{t(l, 'noResults')}</p>
                <Link className="button secondary" href={`/${l}/therapists`}>
                  {t(l, 'all')}
                </Link>
              </div>
            )}
            <p className="availability-footnote">
              <Clock3 size={14} />
              {dt(l, 'availabilityNote')}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
