'use client';
import { CustomerSignIn } from './customer-signin';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  History,
  Store,
  Clock3,
  ReceiptText,
  Star,
  LogOut,
  Leaf,
  XCircle,
} from 'lucide-react';
import {
  H5AccountProfile,
  H5AccountFeatures,
  H5AccountUtilities,
  H5OrderPrompt,
} from './h5-consumer';
import { ht } from '@/lib/h5-i18n';
import type { CustomerOverview, Locale } from '@hogulink/contracts';
import { api, type Catalog } from '@/lib/api';
import { dateTime, languageNames, money, statusText, t } from '@/lib/i18n';
import { ut } from '@/lib/consumer-i18n';

import { qt, qualityError } from '@/lib/quality-i18n';
import {
  historyKey,
  readVisitHistory,
  rememberVisit,
  serviceChoices,
  type VisitHistory,
} from '@/lib/consumer-model';
import { useSession } from './booking-form';

import { MobileSheet } from './mobile-ui';
import { PriceLines } from './catalog';

import { wt } from '@/lib/workday-i18n';
import { instantServiceMembers } from '@/lib/service-availability';
import { groupedServices } from '@/lib/booking-browse-model';
import { cui } from '@/lib/customer-ui-i18n';
import { Button, Card, Dialog, EmptyState, Price } from './ui';

const safeCarry = (q: Record<string, string>) =>
  Object.fromEntries(['area', 'language', 'mode'].flatMap((k) => (q[k] ? [[k, q[k]]] : [])));
type Choice = ReturnType<typeof serviceChoices>[number];
export function ServiceCatalog({
  locale: l,
  catalog,
  q,
  embedded = false,
}: {
  locale: Locale;
  catalog: Catalog;
  q: Record<string, string>;
  embedded?: boolean;
}) {
  const duration = [60, 90, 120].includes(Number(q.duration)) ? Number(q.duration) : 0,
    mode = q.mode === 'INSTANT' ? 'INSTANT' : 'SCHEDULED';
  const [selected, setSelected] = useState<Choice>(),
    [members, setMembers] = useState<Choice['members']>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const choiceRequest = useRef(0);
  const [group, setGroup] = useState<ReturnType<typeof groupedServices>[number]>();
  const choices = serviceChoices(catalog, {
    duration,
    area: q.area,
    language: q.language,
    mode,
    search: q.search,
    locale: l,
    sort: q.sort,
    promotions: q.promo === '1',
  }).filter((item) => q.travel !== 'free' || item.offering.transportFee === 0);
  const groups = groupedServices(choices, q.sort);
  async function choose(item: Choice) {
    const request = ++choiceRequest.current;
    setOpen(true);
    setBusy(true);
    setSelected(item);
    setMembers([]);
    setError('');
    try {
      const fresh = await api<Catalog>(
        `public/staff-listings?${new URLSearchParams({ ...safeCarry(q), mode })}`,
      );
      const current = serviceChoices(fresh, { area: q.area, language: q.language, mode }).find(
        (x) => x.offering.id === item.offering.id,
      );
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
    const item = choices.find((choice) => choice.offering.id === q.offering);
    if (item) void choose(item);
    return () => {
      choiceRequest.current++;
    };
    // Selection belongs to the URL; state updates must not reopen the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.offering]);
  useEffect(
    () => () => {
      choiceRequest.current++;
    },
    [],
  );
  const booking = (member: Choice['members'][number], free = false) =>
    `/${l}/book/${member.slug}?${new URLSearchParams({ ...safeCarry(q), mode, offering: selected!.offering.id, nomination: free ? 'FREE' : 'NOMINATED' })}`;
  const Container = embedded ? 'section' : 'main';
  return (
    <Container
      id={embedded ? undefined : 'main'}
      className="ui-service-catalog"
      aria-label={cui(l, 'services')}
    >
      {q.offering && !choices.some((item) => item.offering.id === q.offering) && (
        <p className="quality-error" role="alert">
          {qt(l, 'unavailable')}
        </p>
      )}
      <p className="ui-note">{cui(l, 'freeFees')}</p>
      <div className="ui-service-grid">
        {groups.map((group) => (
          <Card className="ui-service-card" key={group.key}>
            <h2>{group.from.offering.name[l]}</h2>
            <p>
              {group.durations.join(' / ')} {t(l, 'minutes')} ·{' '}
              {cui(l, 'groupShops').replace('{n}', String(group.shops))}
            </p>
            <Price
              locale={l}
              total={group.from.freeTotal}
              compareTotal={
                group.from.compareTotal === undefined
                  ? undefined
                  : group.from.compareTotal - (group.from.total - group.from.freeTotal)
              }
              promotionEndsAt={group.from.promotionEndsAt}
            />
            <p>
              {cui(l, 'serviceFrom').replace('{n}', String(group.from.offering.durationMinutes))}
            </p>
            <Button onClick={() => setGroup(group)}>{cui(l, 'chooseShop')}</Button>
          </Card>
        ))}
      </div>
      {!choices.length && (
        <EmptyState href={`/${l}/therapists?view=services`} action={cui(l, 'clear')}>
          {cui(l, 'noMatch')}
        </EmptyState>
      )}
      <p className="ui-note">{ut(l, 'refreshed')}</p>
      <Dialog
        open={!!group}
        onClose={() => setGroup(undefined)}
        title={cui(l, 'chooseShop')}
        locale={l}
        className="quality-dialog"
      >
        <p className="ui-note">{cui(l, 'freeFees')}</p>
        <div className="ui-service-options">
          {group?.items.map((item) => (
            <button
              className="ui-card ui-service-option"
              key={item.offering.id}
              onClick={() => {
                setGroup(undefined);
                void choose(item);
              }}
            >
              <span>
                <strong>{item.store.name[l]}</strong>
                <small>
                  {item.offering.durationMinutes} {t(l, 'minutes')}
                </small>
              </span>
              <span>
                <Price
                  locale={l}
                  total={item.freeTotal}
                  compareTotal={
                    item.compareTotal === undefined
                      ? undefined
                      : item.compareTotal - (item.total - item.freeTotal)
                  }
                  promotionEndsAt={item.promotionEndsAt}
                />
                <small>{ut(l, 'chooseTherapist')} →</small>
              </span>
            </button>
          ))}
        </div>
      </Dialog>
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
            <PriceLines
              locale={l}
              quote={{
                serviceFee: selected.freeTotal - selected.offering.transportFee,
                nominationFee: selected.total - selected.freeTotal,
                transportFee: selected.offering.transportFee,
                total: selected.total,
              }}
            />
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
                      <small>
                        {money(l, selected.freeTotal)} · {ut(l, 'noNomination')}
                      </small>
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
    </Container>
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
export function CustomerHub({ locale: l }: { locale: Locale }) {
  const { actor, setActor, loading } = useSession(),
    [overview, setOverview] = useState<CustomerOverview>(),
    [demo, setDemo] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    generation = useRef(0);
  const load = useCallback(async () => {
    const id = ++generation.current;
    if (actor?.role !== 'CUSTOMER') {
      setOverview(undefined);
      return;
    }
    try {
      const data = await api<CustomerOverview>('customer/overview');
      if (id === generation.current) {
        setOverview(data);
        setError('');
      }
    } catch (e) {
      if (id === generation.current) setError(qualityError(l, e));
    }
  }, [actor, l]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    if (actor?.role !== 'CUSTOMER') return;
    const visible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [actor, load]);
  useEffect(() => {
    if (!overview?.resumeCheckout) return;
    const timer = setTimeout(
      () => void load(),
      Math.max(1, overview.resumeCheckout.expiresAt - overview.now + 100),
    );
    return () => clearTimeout(timer);
  }, [overview, load]);
  useEffect(() => {
    api<Catalog>('public/staff-listings')
      .then((c) => setDemo(c.demo))
      .catch(() => {});
  }, []);
  const signed = actor?.role === 'CUSTOMER';
  const links = {
    checkout: overview?.resumeCheckout
      ? `/${l}/checkout/${overview.resumeCheckout.holdId}`
      : `/${l}/services`,
    active: `/${l}/account/bookings?status=active`,
    review: overview?.reviewBookingId
      ? `/${l}/account/bookings/${overview.reviewBookingId}`
      : `/${l}/account/bookings?status=completed`,
    support: `/${l}/account/support`,
    closed: `/${l}/account/bookings?status=closed`,
  };
  return (
    <main
      id="main"
      className="wrap consumer-page consumer-account workday-customer h5-surface"
      aria-busy={loading || (signed && !overview && !error)}
    >
      <H5AccountProfile locale={l} actor={actor} loading={loading} />
      {signed && overview?.focus && (
        <section className="workday-customer-focus" aria-label={wt(l, 'currentVisit')}>
          <div className="workday-focus-heading">
            <span>{wt(l, 'currentVisit')}</span>
            <span className={`status-badge status-${overview.focus.status.toLowerCase()}`}>
              {overview.focus.requiresConsent
                ? wt(l, 'consentPending')
                : statusText(l, overview.focus.status)}
            </span>
          </div>
          <h2>{overview.focus.serviceName[l]}</h2>
          <p>
            {dateTime(l, overview.focus.startAt)} · JST{' '}
            <strong>{money(l, overview.focus.total)}</strong>
          </p>
          {overview.focus.requiresConsent && <p>{wt(l, 'consentHelp')}</p>}
          <Link className="button" href={`/${l}/account/bookings/${overview.focus.id}`}>
            {wt(
              l,
              overview.focus.requiresConsent
                ? 'consent'
                : overview.focus.status === 'AWAITING_COMPLETION'
                  ? 'completionPending'
                  : 'track',
            )}
            <ArrowRight size={18} />
          </Link>
        </section>
      )}
      {!loading && !signed && (
        <section className="consumer-signin quality-card">
          <h2>{ut(l, 'pendingLogin')}</h2>
          {actor && <p>{ut(l, 'otherRole')}</p>}
          <CustomerSignIn locale={l} className="quality-primary" />
          {actor && (
            <Link className="quality-link" href={`/${l}/${actor.role.toLowerCase()}`}>
              {qt(l, 'back')}
            </Link>
          )}
        </section>
      )}
      {error && (
        <p className="quality-error" role="alert">
          {error}
        </p>
      )}
      <section className="consumer-orders">
        <div className="consumer-section-head">
          <h2>{ut(l, 'orderSection')}</h2>
          <Link href={`/${l}/account/bookings`}>
            {ut(l, 'allOrders')}
            <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="consumer-order-shortcuts">
          {(
            [
              [ReceiptText, 'checkout'],
              [CalendarDays, 'active'],
              [Star, 'review'],
              [XCircle, 'closed'],
            ] as const
          ).map(([Icon, key]) => (
            <Link
              key={key}
              href={links[key]}
              title={key === 'closed' ? ht(l, 'closedHelp') : undefined}
            >
              <span>
                <Icon size={24} strokeWidth={1.6} />
                {signed && overview && overview.counts[key] > 0 && (
                  <b>{overview.counts[key] > 99 ? '99+' : overview.counts[key]}</b>
                )}
              </span>
              <strong>{key === 'closed' ? ht(l, 'closed') : ut(l, key)}</strong>
            </Link>
          ))}
        </div>
        {overview?.resumeCheckout && (
          <Link className="consumer-resume" href={links.checkout}>
            <Clock3 size={21} />
            <span>
              <strong>
                {ut(l, 'resume')} · {money(l, overview.resumeCheckout.total)}
              </strong>
              <small>
                {ut(l, 'expires')} {dateTime(l, overview.resumeCheckout.expiresAt)}
              </small>
              <small>{ut(l, 'holdHelp')}</small>
            </span>
            <ArrowRight size={18} />
          </Link>
        )}
        {signed && overview && !overview.recent.length && (
          <Link className="consumer-start h5-desktop-start" href={`/${l}/services`}>
            <Leaf size={22} />
            <span>{ut(l, 'start')}</span>
            <ArrowRight size={18} />
          </Link>
        )}
        {!overview?.resumeCheckout &&
          !overview?.focus &&
          ((!loading && !signed) || overview?.counts.active === 0) && (
            <H5OrderPrompt locale={l} signed={signed} />
          )}
      </section>
      <H5AccountUtilities locale={l} />
      <H5AccountFeatures locale={l} />
      {signed && (
        <div className="consumer-logout">
          <small>{ut(l, 'logoutHelp')}</small>
          <button
            className="quality-link"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api('auth/logout', {});
                try {
                  localStorage.removeItem(historyKey);
                } catch {}
                generation.current++;
                setActor(null);
                setOverview(undefined);
                window.dispatchEvent(new Event('hogulink-history-updated'));
                window.dispatchEvent(new Event('hogulink-session-invalid'));
              } catch (e) {
                setError(qualityError(l, e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <LogOut size={15} />
            {ut(l, 'logout')}
          </button>
        </div>
      )}
    </main>
  );
}
