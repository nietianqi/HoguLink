'use client';
import { h5ServiceImage } from '@/lib/h5-media';
import { sv } from '@/lib/service-mode-i18n';
import { ModePrices } from './service-mode';
import { choiceModePrices } from '@/lib/consumer-model';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  Heart,
  History,
  Store,
  RefreshCw,
  Leaf,
  MapPin,
  TicketPercent,
} from 'lucide-react';
import { ht } from '@/lib/h5-i18n';
import type { Locale } from '@hogulink/contracts';
import { api, type Catalog } from '@/lib/api';
import { areaName, areas, dateTime, languageNames, money, t } from '@/lib/i18n';
import { ut } from '@/lib/consumer-i18n';
import { xt } from '@/lib/discovery-i18n';

import { qt, qualityError } from '@/lib/quality-i18n';
import {
  historyKey,
  readVisitHistory,
  rememberVisit,
  browseServiceChoices as serviceChoices,
  type VisitHistory,
} from '@/lib/consumer-model';
import { useSession } from './booking-form';
import { H5Badges, H5Price } from './h5-business';
import { MobileSheet } from './mobile-ui';
import { PriceLines } from './catalog';

import { instantServiceMembers } from '@/lib/service-availability';

const durationWords = { 60: 'short', 90: 'medium', 120: 'long' } as const;
const safeCarry = (q: Record<string, string>) =>
  Object.fromEntries(
    ['area', 'language', 'mode', 'fulfillmentMode'].flatMap((k) => (q[k] ? [[k, q[k]]] : [])),
  );
export function MobileConsumerEntries({
  locale: l,
  catalog,
  q,
}: {
  locale: Locale;
  catalog: Catalog;
  q: Record<string, string>;
}) {
  const items = serviceChoices(catalog, {
      area: q.area,
      language: q.language,
      mode: q.mode,
      fulfillmentMode: q.fulfillmentMode,
    }),
    carry = safeCarry(q);
  return (
    <section className="consumer-mobile-home wrap" aria-label={ut(l, 'serviceFirst')}>
      <div className="consumer-shortcuts">
        {(
          [
            [CalendarDays, 'bookings', 'account/bookings'],
            [Heart, 'favorites', 'account/favorites'],
            [History, 'history', 'account/history'],
            [Store, 'partner', 'onboarding?role=MERCHANT'],
          ] as const
        ).map(([Icon, label, path]) => (
          <Link key={label} href={`/${l}/${path}`}>
            <span>
              <Icon size={21} />
            </span>
            <strong>{ut(l, label)}</strong>
          </Link>
        ))}
      </div>
      <div className="consumer-section-head">
        <div>
          <h2>{ut(l, 'serviceFirst')}</h2>
          <small>{ut(l, 'serviceFirstHelp')}</small>
        </div>
        <Link href={`/${l}/services?${new URLSearchParams(carry)}`}>
          {ut(l, 'allServices')}
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="consumer-duration-cards">
        {([60, 90, 120] as const).map((n) => {
          const price = items
            .filter((x) => x.offering.durationMinutes === n)
            .sort((a, b) => a.total - b.total)[0]?.total;
          return (
            <Link
              key={n}
              href={`/${l}/services?${new URLSearchParams({ ...carry, duration: String(n) })}`}
            >
              <span className="consumer-minute">
                {n}
                <small>{t(l, 'minutes')}</small>
              </span>
              <strong>{ut(l, durationWords[n])}</strong>
              <small>
                {price === undefined
                  ? '—'
                  : `${sv(l, items.find((x) => x.offering.durationMinutes === n && x.total === price)?.offering.fulfillmentMode ?? 'HOME_VISIT')} ${money(l, price)} ${ut(l, 'from')}`}
              </small>
            </Link>
          );
        })}
      </div>
      <small className="consumer-price-note">{ut(l, 'allIn')}</small>
    </section>
  );
}
type Choice = ReturnType<typeof serviceChoices>[number];
export function ServiceCatalog({
  locale: l,
  catalog,
  q,
}: {
  locale: Locale;
  catalog: Catalog;
  q: Record<string, string>;
}) {
  const duration = [60, 90, 120].includes(Number(q.duration)) ? Number(q.duration) : 0,
    mode = q.mode === 'INSTANT' ? 'INSTANT' : 'SCHEDULED';
  const [selected, setSelected] = useState<Choice>(),
    [members, setMembers] = useState<Choice['members']>([]),
    [open, setOpen] = useState(false),
    [filterOpen, setFilterOpen] = useState(false),
    [search, setSearch] = useState(q.search ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const choiceRequest = useRef(0);
  const choices = serviceChoices(catalog, {
    duration,
    area: q.area,
    language: q.language,
    mode,
    fulfillmentMode: q.fulfillmentMode,
    search: q.search,
    locale: l,
    sort: q.sort,
    promotions: q.promo === '1',
  });
  const href = (changes: Record<string, string>) =>
    `/${l}/services?${new URLSearchParams(
      Object.entries({ ...q, ...changes }).filter(([, v]) => v !== ''),
    )}`;
  async function choose(item: Choice) {
    const request = ++choiceRequest.current;
    setOpen(true);
    setBusy(true);
    setSelected(item);
    setMembers([]);
    setError('');
    try {
      const fresh = await api<Catalog>(
        `public/staff-listings?${new URLSearchParams({ ...safeCarry(q), mode, fulfillmentMode: q.fulfillmentMode || 'ALL' })}`,
      );
      const current = serviceChoices(fresh, {
        area: q.area,
        language: q.language,
        mode,
        fulfillmentMode: q.fulfillmentMode,
      }).find((x) => x.offering.id === item.offering.id);
      if (!current) throw Error('unavailable');
      let candidates = current.members;
      if (mode === 'INSTANT') {
        candidates = await instantServiceMembers(candidates, item.offering.id, {
          area: q.area,
          language: q.language,
        });
      }
      if (request !== choiceRequest.current) return;
      setSelected(current);
      setMembers(candidates);
      if (!candidates.length) setError(ut(l, 'noServices'));
    } catch (e) {
      if (request !== choiceRequest.current) return;
      setError(
        e instanceof Error && e.message === 'unavailable'
          ? qt(l, 'unavailable')
          : qualityError(l, e),
      );
    } finally {
      if (request === choiceRequest.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!q.offering) return;
    const item = choices.find((choice) =>
      choice.variants.some((v) => v.offering.id === q.offering),
    );
    if (item) void choose(item);
    return () => {
      choiceRequest.current++;
    };
    // This selection belongs to the URL; subsequent state updates must not reopen the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.offering]);
  const advancedFields = (
    <>
      <label>
        <span>{sv(l, 'mode')}</span>
        <select name="fulfillmentMode" defaultValue={q.fulfillmentMode ?? ''}>
          <option value="">{t(l, 'all')}</option>
          <option value="HOME_VISIT">{sv(l, 'HOME_VISIT')}</option>
          <option value="IN_STORE">{sv(l, 'IN_STORE')}</option>
        </select>
      </label>
      <label>
        <span>{t(l, 'area')}</span>
        <select aria-label={t(l, 'area')} name="area" defaultValue={q.area ?? ''}>
          <option value="">{t(l, 'all')}</option>
          {Object.keys(areas).map((a) => (
            <option key={a} value={a}>
              {areaName(l, a)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t(l, 'language')}</span>
        <select aria-label={t(l, 'language')} name="language" defaultValue={q.language ?? ''}>
          <option value="">{t(l, 'allLanguages')}</option>
          <option value="ja">日本語</option>
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
      </label>
      <label>
        <span>{t(l, 'mode')}</span>
        <select aria-label={t(l, 'mode')} name="mode" defaultValue={mode}>
          <option value="SCHEDULED">{t(l, 'scheduled')}</option>
          <option value="INSTANT">{t(l, 'instant')}</option>
        </select>
      </label>
      <label>
        <span>{ut(l, 'sort')}</span>
        <select
          aria-label={ut(l, 'sort')}
          name="sort"
          defaultValue={q.sort === 'price' ? 'price' : ''}
        >
          <option value="">{ut(l, 'recommended')}</option>
          <option value="price">{ut(l, 'lowPrice')}</option>
        </select>
      </label>
    </>
  );
  const booking = (member: Choice['members'][number], free = false) =>
    `/${l}/book/${member.slug}?${new URLSearchParams({ ...safeCarry(q), mode, offering: selected!.offering.id, nomination: free ? 'FREE' : 'NOMINATED' })}`;
  return (
    <main id="main" className="wrap consumer-page">
      {q.offering &&
        !choices.some((item) => item.variants.some((v) => v.offering.id === q.offering)) && (
          <p className="quality-error" role="alert">
            {qt(l, 'unavailable')}
          </p>
        )}
      <div className="consumer-intro">
        <h1>{ut(l, 'serviceTitle')}</h1>
        <p>{ut(l, 'serviceIntro')}</p>
      </div>
      <form className="consumer-service-filter" action={`/${l}/services`}>
        <label>
          <span>{ut(l, 'search')}</span>
          <input
            name="search"
            aria-label={ut(l, 'search')}
            maxLength={80}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {advancedFields}
        <input type="hidden" name="duration" value={duration || ''} />
        <button className="quality-primary">{ut(l, 'filterServices')}</button>
        <button
          className="quality-button consumer-filter-toggle"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen(true)}
        >
          {ut(l, 'filters')}
        </button>
      </form>
      <nav className="consumer-service-tabs" aria-label={ut(l, 'services')}>
        <Link href={href({ duration: '' })} aria-current={!duration ? 'page' : undefined}>
          {t(l, 'all')}
        </Link>
        {[60, 90, 120].map((n) => (
          <Link
            key={n}
            href={href({ duration: String(n) })}
            aria-current={duration === n ? 'page' : undefined}
          >
            {n} {t(l, 'minutes')}
          </Link>
        ))}
        <Link
          className="consumer-promo-tab"
          href={href({ promo: q.promo === '1' ? '' : '1' })}
          aria-current={q.promo === '1' ? 'page' : undefined}
        >
          <TicketPercent size={14} aria-hidden="true" />
          {ht(l, 'promotions')}
        </Link>
      </nav>
      <div className="consumer-section-head">
        <h2>
          {ut(l, 'services')} <small>{choices.length}</small>
        </h2>
        <span className="consumer-price-note">{ut(l, 'allIn')}</span>
      </div>
      <div className="consumer-service-grid">
        {choices.map((item) => (
          <article className="consumer-service-card" key={item.offering.id}>
            <img
              className="consumer-service-photo"
              src={h5ServiceImage(item.offering, catalog.demo)}
              alt={ht(l, 'serviceIllustration')}
              loading="lazy"
              width={160}
              height={130}
            />
            <div className={`consumer-service-art duration-${item.offering.durationMinutes}`}>
              <Leaf size={34} strokeWidth={1} />
              <span>
                {item.offering.durationMinutes}
                <small>{t(l, 'minutes')}</small>
              </span>
            </div>
            <div className="consumer-service-info">
              <span className="quality-eyebrow">{item.store.name[l]}</span>
              <h3>{item.offering.name[l]}</h3>
              <p>
                {item.offering.durationMinutes} {t(l, 'minutes')} ·{' '}
                {t(l, mode === 'INSTANT' ? 'instant' : 'scheduled')}
              </p>
              <H5Badges
                locale={l}
                promotion={!!item.promotionEndsAt}
                freeTravel={item.transportFee === 0}
              />
              <div className="consumer-service-bottom">
                <div>
                  <ModePrices locale={l} prices={item.modePrices} />
                  <small>{ut(l, 'total')}</small>
                </div>
                <button className="quality-primary" onClick={() => void choose(item)}>
                  {ut(l, 'chooseTherapist')}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!choices.length && (
        <div className="quality-empty">
          <p>{ut(l, 'noServices')}</p>
          <Link className="quality-button" href={`/${l}/services`}>
            {t(l, 'all')}
          </Link>
        </div>
      )}
      <p className="consumer-price-note">{ut(l, 'refreshed')}</p>
      <MobileSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title={ut(l, 'filters')}
        locale={l}
        className="quality-dialog"
      >
        <form className="consumer-advanced-form" action={`/${l}/services`}>
          {advancedFields}
          <input type="hidden" name="duration" value={duration || ''} />
          <input type="hidden" name="search" value={search} />
          <button className="quality-primary">{ut(l, 'filterServices')}</button>
        </form>
      </MobileSheet>
      <MobileSheet
        open={open}
        onClose={() => {
          choiceRequest.current++;
          setOpen(false);
          setBusy(false);
        }}
        title={ut(l, 'chooseTherapist')}
        locale={l}
        className="quality-dialog consumer-choice-dialog"
      >
        {selected && (
          <>
            <h3>
              {selected.offering.name[l]} · {selected.offering.durationMinutes} {t(l, 'minutes')}
            </h3>
            <p>{selected.store.name[l]}</p>
            <ModePrices locale={l} prices={selected.modePrices} />
            {busy ? (
              <p role="status">{ut(l, 'checking')}</p>
            ) : (
              <>
                <div className="consumer-member-list">
                  {members.map((m) => (
                    <Link key={m.id} href={booking(m)}>
                      <img src={m.photo} alt="" width={52} height={62} />
                      <span>
                        <strong>{m.name[l]}</strong>
                        <small>{m.languages.map((x) => languageNames[x]).join(' · ')}</small>
                      </span>
                      <ArrowRight size={18} />
                    </Link>
                  ))}
                </div>
                {members[0] && (
                  <Link className="consumer-assign" href={booking(members[0], true)}>
                    <Store size={19} />
                    <span>
                      <strong>{ut(l, 'shopAssign')}</strong>
                      <ModePrices
                        locale={l}
                        prices={choiceModePrices(selected.variants, undefined, true)}
                      />
                      <small>{ut(l, 'noNomination')}</small>
                    </span>
                    <ArrowUpRight size={17} />
                  </Link>
                )}
              </>
            )}
            {error && (
              <p className="quality-error" role="alert">
                {error}
              </p>
            )}
            <small className="consumer-price-note">{ut(l, 'refreshed')}</small>
          </>
        )}
      </MobileSheet>
    </main>
  );
}
export function RememberProfile({ id }: { id: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(
        historyKey,
        JSON.stringify(rememberVisit(localStorage.getItem(historyKey), id)),
      );
      window.dispatchEvent(new Event('hogulink-history-updated'));
    } catch {}
  }, [id]);
  return null;
}
export function DeviceHistory({ locale: l, catalog }: { locale: Locale; catalog: Catalog }) {
  const [history, setHistory] = useState<VisitHistory[]>([]),
    [ready, setReady] = useState(false),
    [storageError, setStorageError] = useState(false),
    [open, setOpen] = useState(false);
  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem(historyKey),
        current = readVisitHistory(raw),
        clean = JSON.stringify(current);
      setHistory(current);
      if (raw !== null && raw !== clean) localStorage.setItem(historyKey, clean);
    } catch {
      setStorageError(true);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('storage', load);
    window.addEventListener('pageshow', load);
    window.addEventListener('hogulink-history-updated', load);
    return () => {
      window.removeEventListener('storage', load);
      window.removeEventListener('pageshow', load);
      window.removeEventListener('hogulink-history-updated', load);
    };
  }, [load]);
  const rows = history.flatMap((h) => {
    const listing = catalog.listings.find((l) => l.id === h.id);
    const store = listing && catalog.stores.find((s) => s.id === listing.storeId);
    return listing && store ? [{ listing, store, at: h.at }] : [];
  });
  return (
    <main id="main" className="wrap consumer-page">
      <div className="consumer-intro">
        <span className="quality-eyebrow">YOUR RECENT VISITS</span>
        <h1>{ut(l, 'history')}</h1>
        <p>{ut(l, 'historyHelp')}</p>
      </div>
      <div className="consumer-section-head">
        <Link className="quality-button" href={`/${l}/account`}>
          {ut(l, 'mine')}
        </Link>
        <button className="quality-link" disabled={!history.length} onClick={() => setOpen(true)}>
          {ut(l, 'clear')}
        </button>
      </div>
      {storageError && <p className="quality-note">{ut(l, 'storageUnavailable')}</p>}
      {ready && !rows.length && (
        <div className="quality-empty">
          <History size={30} />
          <p>{ut(l, 'emptyHistory')}</p>
          <Link className="quality-primary" href={`/${l}`}>
            {ut(l, 'browse')}
          </Link>
        </div>
      )}
      <div className="consumer-history-grid">
        {rows.map(({ listing: m, store, at }) => (
          <article key={m.id} className="consumer-history-card">
            <img src={m.photo} alt="" width={88} height={104} />
            <div>
              <h2>{m.name[l]}</h2>
              <p>{store.name[l]}</p>
              <time>{dateTime(l, at)}</time>
              <Link href={`/${l}/therapists/${m.slug}`}>
                {t(l, 'details')}
                <ArrowUpRight size={16} />
              </Link>
            </div>
          </article>
        ))}
      </div>
      <MobileSheet
        open={open}
        onClose={() => setOpen(false)}
        title={ut(l, 'clearTitle')}
        locale={l}
        className="quality-dialog"
      >
        <p>{ut(l, 'clearHelp')}</p>
        <button
          className="quality-primary"
          onClick={() => {
            try {
              localStorage.removeItem(historyKey);
              setHistory([]);
              window.dispatchEvent(new Event('hogulink-history-updated'));
            } catch {
              setStorageError(true);
            }
            setOpen(false);
          }}
        >
          {ut(l, 'clear')}
        </button>
      </MobileSheet>
    </main>
  );
}
export { CustomerHub } from './customer-account-hub';
