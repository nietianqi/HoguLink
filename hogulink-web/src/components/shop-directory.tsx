'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, SlidersHorizontal, Store } from 'lucide-react';
import type { Locale } from '@hogulink/contracts';
import { areas, areaName, t } from '@/lib/i18n';
import { bf } from '@/lib/booking-browse-i18n';
import { browseListHref } from '@/lib/booking-browse-model';
import { shopCardHref, type ShopCard } from '@/lib/shop-model';
import { sv } from '@/lib/service-mode-i18n';
import { BookingBrowseHeader, BrowseFilterChips } from './booking-browse';
import { H5ShopList } from './h5-shops';
import { MobileSheet } from './mobile-ui';
export function ShopDirectory({
  locale: l,
  q,
  cards,
  page,
  pages,
  total,
  demo,
}: {
  locale: Locale;
  q: Record<string, string>;
  cards: ShopCard[];
  page: number;
  pages: number;
  total: number;
  demo: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(q.search ?? '');
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(q);
  const href = (changes: Record<string, string>) =>
    browseListHref(l, 'shops', { ...q, ...changes });
  const navigate = (next: Record<string, string>) => {
    setOpen(false);
    startTransition(() => router.push(browseListHref(l, 'shops', { ...next, shopPage: '1' })));
  };
  return (
    <main
      id="main"
      className="wrap h5-surface booking-directory booking-shop-directory"
      aria-busy={pending}
    >
      <BookingBrowseHeader locale={l} kind="shops" q={q} />
      <section className="booking-directory-controls" aria-label={bf(l, 'filters')}>
        <form
          className="booking-directory-search"
          action={`/${l}/shops`}
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ ...q, search });
          }}
        >
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            name="search"
            aria-label={bf(l, 'searchShops')}
            placeholder={bf(l, 'searchShops')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={80}
          />
          <button disabled={pending}>{bf(l, 'searchAction')}</button>
        </form>
        <div className="booking-directory-toolbar">
          <label>
            <span className="sr-only">
              {bf(l, q.fulfillmentMode === 'IN_STORE' ? 'venueArea' : 'area')}
            </span>
            <select
              aria-label={bf(l, q.fulfillmentMode === 'IN_STORE' ? 'venueArea' : 'area')}
              value={q.area ?? ''}
              disabled={pending}
              onChange={(event) => navigate({ ...q, area: event.target.value })}
            >
              <option value="">
                {bf(l, 'area')} · {t(l, 'all')}
              </option>
              {Object.keys(areas).map((area) => (
                <option key={area} value={area}>
                  {areaName(l, area)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">{bf(l, 'sort')}</span>
            <select
              aria-label={bf(l, 'sort')}
              value={q.sort}
              disabled={pending}
              onChange={(event) => navigate({ ...q, sort: event.target.value })}
            >
              <option value="price">{bf(l, 'price')}</option>
              <option value="name">{bf(l, 'name')}</option>
            </select>
          </label>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={pending}
            onClick={() => {
              setDraft(q);
              setOpen(true);
            }}
          >
            <SlidersHorizontal size={16} />
            {bf(l, 'filters')}
          </button>
        </div>
        <BrowseFilterChips locale={l} kind="shops" q={q} />
      </section>
      <div className="booking-directory-result-heading">
        <h2>{bf(l, 'allShops')}</h2>
        <span role="status">{bf(l, 'shopsCount').replace('{n}', String(total))}</span>
      </div>
      {q.fulfillmentMode === 'IN_STORE' && (
        <p className="consumer-price-note">{bf(l, 'storeScheduled')}</p>
      )}
      <H5ShopList
        feedHeading={false}
        priceNote={bf(l, 'shopPriceNote')}
        locale={l}
        cards={cards}
        demo={demo}
        href={(_, card) => `${shopCardHref(l, card, q)}&from=shops`}
        pagination={{
          page,
          pages,
          previous: href({ shopPage: String(page - 1) }),
          next: href({ shopPage: String(page + 1) }),
        }}
      />
      {!cards.length && (
        <div className="h5-empty">
          <Store size={32} />
          <h2>{bf(l, 'noShops')}</h2>
          <Link className="h5-primary" href={`/${l}/shops`}>
            {bf(l, 'clear')}
          </Link>
        </div>
      )}
      <MobileSheet
        locale={l}
        title={bf(l, 'filters')}
        open={open}
        onClose={() => setOpen(false)}
        className="booking-directory-sheet"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            navigate(draft);
          }}
        >
          <label className="field">
            {sv(l, 'mode')}
            <select
              value={draft.fulfillmentMode ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  fulfillmentMode: event.target.value,
                  ...(event.target.value === 'IN_STORE' ? { mode: 'SCHEDULED' } : {}),
                })
              }
            >
              <option value="">{t(l, 'all')}</option>
              <option value="HOME_VISIT">{sv(l, 'HOME_VISIT')}</option>
              <option value="IN_STORE">{sv(l, 'IN_STORE')}</option>
            </select>
          </label>
          <label className="field">
            {t(l, 'language')}
            <select
              value={draft.language ?? ''}
              onChange={(event) => setDraft({ ...draft, language: event.target.value })}
            >
              <option value="">{t(l, 'allLanguages')}</option>
              <option value="ja">日本語</option>
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </label>
          <label className="field">
            {t(l, 'mode')}
            <select
              value={draft.mode ?? 'SCHEDULED'}
              onChange={(event) => setDraft({ ...draft, mode: event.target.value })}
            >
              <option value="SCHEDULED">{t(l, 'scheduled')}</option>
              <option value="INSTANT" disabled={draft.fulfillmentMode === 'IN_STORE'}>
                {t(l, 'instant')}
              </option>
            </select>
          </label>
          <button className="button full">{bf(l, 'apply')}</button>
        </form>
      </MobileSheet>
    </main>
  );
}
