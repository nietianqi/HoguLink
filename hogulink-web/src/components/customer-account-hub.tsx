'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Heart,
  History,
  LifeBuoy,
  BookOpen,
  MapPin,
  MessageCircle,
  Settings,
  Star,
  UserRound,
  XCircle,
} from 'lucide-react';
import type { CustomerOverview, Locale } from '@hogulink/contracts';
import { api } from '@/lib/api';
import { areaName, dateTime, money, statusText, t } from '@/lib/i18n';
import { ut } from '@/lib/consumer-i18n';
import { ht } from '@/lib/h5-i18n';
import { xt } from '@/lib/discovery-i18n';
import { af } from '@/lib/customer-flow-i18n';
import { qt, qualityError } from '@/lib/quality-i18n';
import { sv } from '@/lib/service-mode-i18n';
import { at } from '@/lib/account-i18n';
import {
  accountBookingAction,
  accountCountdown,
  accountRecent,
  accountStartTime,
  rebookingHref,
  type AccountBooking,
  type Rebooking,
} from '@/lib/account-model';
import { useSession } from './booking-form';
import { CustomerSignIn } from './customer-signin';
import { InboxUnreadBadge } from './inbox-badge';
import { H5PortraitThumbnail } from './h5-overlays';

function BookingIdentity({ locale: l, booking: b }: { locale: Locale; booking: AccountBooking }) {
  return (
    <div className="account-booking-identity">
      <div className="account-therapist-photo">
        {b.therapistPhoto ? (
          <H5PortraitThumbnail photo={b.therapistPhoto} size={64} />
        ) : (
          <UserRound size={28} aria-hidden="true" />
        )}
      </div>
      <div>
        <strong>{b.therapistName[l]}</strong>
        <span>{b.storeName[l]}</span>
        <span>
          {b.serviceName[l]} · {Math.round((b.endAt - b.startAt) / 60000)} {at(l, 'duration')}
        </span>
      </div>
    </div>
  );
}

function RecentBooking({
  locale: l,
  booking: b,
  now,
}: {
  locale: Locale;
  booking: AccountBooking;
  now: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <article className="account-history-card">
      <div className="account-card-heading">
        <span className={`status-badge status-${b.status.toLowerCase()}`}>
          {statusText(l, b.status)}
        </span>
        <span className="account-service-mode">{sv(l, b.fulfillmentMode)}</span>
      </div>
      <Link className="account-history-summary" href={`/${l}/account/bookings/${b.id}`}>
        <BookingIdentity locale={l} booking={b} />
        <time dateTime={new Date(b.startAt).toISOString()}>
          {accountStartTime(l, b.startAt, now)}
        </time>
      </Link>
      <div className="account-card-actions">
        <strong>{money(l, b.total)}</strong>
        {b.status === 'COMPLETED' ? (
          <button
            className="quality-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                router.push(
                  rebookingHref(l, await api<Rebooking>(`customer/bookings/${b.id}/rebook`)),
                );
              } catch (e) {
                setError(qualityError(l, e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? ht(l, 'loading') : at(l, 'again')}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        ) : (
          <Link className="quality-link" href={`/${l}/account/bookings/${b.id}`}>
            {at(l, 'details')}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        )}
      </div>
      {error && (
        <p className="quality-error" role="alert">
          {error}
          <Link href={`/${l}/services`}>{at(l, 'browse')}</Link>
        </p>
      )}
    </article>
  );
}

export function CustomerHub({ locale: l }: { locale: Locale }) {
  const { actor, loading } = useSession();
  const signed = actor?.role === 'CUSTOMER';
  const [snapshot, setSnapshot] = useState<{ owner: string; value: CustomerOverview }>();
  const overview = signed && snapshot?.owner === actor.id ? snapshot.value : undefined;
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(0);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    if (actor?.role !== 'CUSTOMER') {
      setSnapshot(undefined);
      setError('');
      return;
    }
    setBusy(true);
    try {
      const next = await api<CustomerOverview>('customer/overview');
      if (version === generation.current) {
        setSnapshot({ owner: actor.id, value: next });
        setError('');
        setNow(next.now);
      }
    } catch (e) {
      if (version === generation.current) setError(qualityError(l, e));
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }, [actor, l]);
  useEffect(() => {
    setSnapshot(undefined);
    setError('');
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!signed) return;
    const visible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [signed, load]);
  useEffect(() => {
    if (!overview) return;
    const anchor = performance.now();
    const timer = setInterval(() => setNow(overview.now + performance.now() - anchor), 30000);
    return () => clearInterval(timer);
  }, [overview]);
  useEffect(() => {
    if (!overview?.resumeCheckout) return;
    const timer = setTimeout(
      () => void load(),
      Math.max(1, overview.resumeCheckout.expiresAt - overview.now + 100),
    );
    return () => clearTimeout(timer);
  }, [overview, load]);
  const focus = overview?.focus;
  const action = focus && accountBookingAction(focus);
  const recent = overview ? accountRecent(overview) : [];
  const resume = overview?.resumeCheckout;
  const shortcuts = [
    { key: 'active', label: ut(l, 'active'), Icon: CalendarDays },
    { key: 'review', label: at(l, 'review'), Icon: Star },
    { key: 'completed', label: at(l, 'completed'), Icon: CheckCircle2 },
    { key: 'closed', label: at(l, 'closed'), Icon: XCircle },
  ] as const;
  return (
    <main id="main" className="wrap consumer-page consumer-account account-dashboard h5-surface">
      <header className="account-dashboard-header">
        <span className="account-user-avatar">
          <UserRound size={28} aria-hidden="true" />
        </span>
        <div>
          <h1>
            {loading
              ? ht(l, 'loading')
              : signed
                ? actor.displayName?.trim() || ht(l, 'member')
                : ut(l, 'guest')}
          </h1>
          <p>{signed ? ut(l, 'accountHelp') : at(l, 'guestHelp')}</p>
          {!loading && !signed && <CustomerSignIn locale={l} className="button account-login" />}
        </div>
        <Link className="account-settings-link" href={`/${l}/account/settings`}>
          <Settings size={21} aria-hidden="true" />
          <span>{ht(l, 'settings')}</span>
        </Link>
      </header>
      {!loading && actor && !signed && (
        <p className="notice">
          {ut(l, 'otherRole')}{' '}
          <Link className="quality-link" href={`/${l}/${actor.role.toLowerCase()}`}>
            {qt(l, 'back')}
          </Link>
        </p>
      )}
      {signed && busy && !overview && (
        <p className="account-loading" role="status">
          {ht(l, 'loading')}
        </p>
      )}
      {error && (
        <div className="account-load-error" role="alert">
          <p>{at(l, 'loadUnavailable')}</p>
          <button className="quality-button" disabled={busy} onClick={() => void load()}>
            {at(l, 'retry')}
          </button>
        </div>
      )}
      {signed && focus && action && (
        <section
          className="account-current-card"
          aria-label={at(
            l,
            focus.requiresConsent || focus.status === 'AWAITING_COMPLETION' ? 'tasks' : 'current',
          )}
        >
          <div className="account-card-heading">
            <h2>
              {at(
                l,
                focus.requiresConsent || focus.status === 'AWAITING_COMPLETION'
                  ? 'tasks'
                  : 'current',
              )}
            </h2>
            <span className={`status-badge status-${focus.status.toLowerCase()}`}>
              {focus.requiresConsent ? at(l, 'consent') : statusText(l, focus.status)}
            </span>
          </div>
          <BookingIdentity locale={l} booking={focus} />
          <div className="account-visit-place">
            <span className="account-service-mode">{sv(l, focus.fulfillmentMode)}</span>
            <span>
              <MapPin size={15} aria-hidden="true" />
              {at(l, 'place')} · {areaName(l, focus.area)}
            </span>
          </div>
          <time className="account-current-time" dateTime={new Date(focus.startAt).toISOString()}>
            {accountStartTime(l, focus.startAt, now)}
          </time>
          {!['ARRIVED', 'IN_SERVICE', 'AWAITING_COMPLETION'].includes(focus.status) &&
            !focus.requiresConsent && (
              <p className="account-countdown">{accountCountdown(l, focus.startAt, now)}</p>
            )}
          <p className="account-next-step">{at(l, action.help)}</p>
          <div className="account-card-actions">
            <strong>{money(l, focus.total)}</strong>
            <Link className="button" href={`/${l}/account/bookings/${focus.id}`}>
              {at(l, action.label)}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}
      {signed && resume && resume.expiresAt > now && (
        <section className="account-resume" aria-label={ut(l, 'resume')}>
          <Clock3 size={23} aria-hidden="true" />
          <div>
            <h2>{ut(l, 'resume')}</h2>
            <p>
              {money(l, resume.total)} · {ut(l, 'expires')} {dateTime(l, resume.expiresAt)} · JST
            </p>
            <small>{ut(l, 'holdHelp')}</small>
          </div>
          <Link className="quality-button" href={`/${l}/checkout/${resume.holdId}`}>
            {ut(l, 'resume')}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>
      )}
      <section className="account-orders-card">
        <div className="account-card-heading">
          <h2>{ut(l, 'orderSection')}</h2>
          <Link href={`/${l}/account/bookings`}>
            {ut(l, 'allOrders')}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
        <nav className="account-status-shortcuts" aria-label={ut(l, 'orderSection')}>
          {shortcuts.map(({ key, label, Icon }) => (
            <Link key={key} href={`/${l}/account/bookings?status=${key}`}>
              <span>
                <Icon size={25} aria-hidden="true" />
                {signed && overview && overview.counts[key] > 0 && (
                  <b>{overview.counts[key] > 99 ? '99+' : overview.counts[key]}</b>
                )}
              </span>
              <strong>{label}</strong>
            </Link>
          ))}
        </nav>
        {!signed && !loading && <p className="account-empty-note">{at(l, 'guestOrders')}</p>}
        {signed && overview && overview.counts.active === 0 && !resume && (
          <div className="account-empty-orders">
            <div>
              <strong>{at(l, 'empty')}</strong>
              <p>{at(l, 'emptyHelp')}</p>
            </div>
            <Link className="quality-button" href={`/${l}/services`}>
              {at(l, 'browse')}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        )}
      </section>
      <section className="account-mobile-tools">
        <h2>{ut(l, 'utilities')}</h2>
        <nav aria-label={ut(l, 'utilities')}>
          {[
            { path: 'account/addresses', label: af(l, 'addresses'), Icon: MapPin },
            { path: 'account/favorites', label: ut(l, 'favorites'), Icon: Heart },
            { path: 'account/history', label: ut(l, 'history'), Icon: History },
            { path: 'account/messages', label: xt(l, 'inbox'), Icon: MessageCircle },
            { path: 'account/support', label: at(l, 'help'), Icon: LifeBuoy },
            { path: 'guides/booking-and-safety', label: at(l, 'guide'), Icon: BookOpen },
          ].map(({ path, label, Icon }) => (
            <Link href={`/${l}/${path}`} key={path}>
              <span>
                <Icon size={22} aria-hidden="true" />
                {signed && path === 'account/messages' && <InboxUnreadBadge />}
              </span>
              <strong>{label}</strong>
            </Link>
          ))}
        </nav>
      </section>
      {signed && recent.length > 0 && (
        <section className="account-recent-section">
          <div className="account-card-heading">
            <h2>{at(l, 'recent')}</h2>
            <Link href={`/${l}/account/bookings`}>
              {ut(l, 'allOrders')}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className="account-history-grid">
            {recent.map((b) => (
              <RecentBooking key={b.id} locale={l} booking={b} now={now} />
            ))}
          </div>
          <p className="account-rebook-note">{at(l, 'againHelp')}</p>
        </section>
      )}
      <nav className="account-help-links" aria-label={ut(l, 'terms')}>
        <Link className="account-desktop-guide" href={`/${l}/guides/booking-and-safety`}>
          {ut(l, 'safety')}
        </Link>
        <Link href={`/${l}/guides/terms`}>{ut(l, 'terms')}</Link>
        <Link href={`/${l}/onboarding?role=MERCHANT`}>{ut(l, 'partner')}</Link>
      </nav>
    </main>
  );
}
