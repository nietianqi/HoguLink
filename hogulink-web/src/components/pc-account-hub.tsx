'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Heart,
  History,
  LifeBuoy,
  MapPin,
  Star,
  UserRound,
} from 'lucide-react';
import type { Actor, CustomerOverview, Locale } from '@hogulink/contracts';
import { api } from '@/lib/api';
import { at } from '@/lib/account-i18n';
import { pa } from '@/lib/pc-account-i18n';
import { areaName, dateTime, money, statusText } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { ut } from '@/lib/consumer-i18n';
import { af } from '@/lib/customer-flow-i18n';
import { qualityError, qt } from '@/lib/quality-i18n';
import { sv } from '@/lib/service-mode-i18n';
import {
  accountStartTime,
  rebookingHref,
  type Rebooking,
  type AccountBooking,
} from '@/lib/account-model';
import { visitTimeRange } from '@/lib/booking-presentation';
import { CustomerSignIn } from './customer-signin';
import { H5PortraitThumbnail } from './h5-overlays';

export function AccountRebook({ locale: l, bookingId }: { locale: Locale; bookingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <div className="pc-rebook">
      <button
        className="quality-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            router.push(
              rebookingHref(l, await api<Rebooking>(`customer/bookings/${bookingId}/rebook`)),
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
      {error && (
        <p className="quality-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Identity({ locale: l, booking: b }: { locale: Locale; booking: AccountBooking }) {
  return (
    <div className="pc-account-identity">
      <span className="pc-account-portrait">
        {b.therapistPhoto ? (
          <H5PortraitThumbnail photo={b.therapistPhoto} size={56} />
        ) : (
          <UserRound size={26} aria-hidden="true" />
        )}
      </span>
      <div>
        <strong>
          {b.serviceName[l]} · {Math.round((b.endAt - b.startAt) / 60000)} {at(l, 'duration')}
        </strong>
        <span>
          {b.therapistName[l]} · {b.storeName[l]}
        </span>
      </div>
    </div>
  );
}

export function PcAccountHub({
  locale: l,
  actor,
  loading,
  overview,
  busy,
  error,
  onRetry,
}: {
  locale: Locale;
  actor: Actor | null;
  loading: boolean;
  overview?: CustomerOverview;
  busy: boolean;
  error: string;
  onRetry: () => void;
}) {
  const signed = actor?.role === 'CUSTOMER';
  const data = !error ? overview : undefined;
  const desktop = data?.desktop,
    upcoming = desktop?.upcoming ?? data?.focus;
  const hour = data
    ? Number(
        new Intl.DateTimeFormat('en', {
          hour: 'numeric',
          hourCycle: 'h23',
          timeZone: 'Asia/Tokyo',
        }).format(data.now),
      )
    : undefined;
  const greeting =
    hour === undefined ? 'welcome' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const actions = desktop?.actions ?? [];
  const orderHref = (id: string) => `/${l}/account/bookings/${encodeURIComponent(id)}`;
  return (
    <main id="main" className="pc-account-dashboard h5-surface" aria-busy={busy || loading}>
      <header className="pc-account-welcome">
        <div>
          <p className="pc-account-eyebrow">{pa(l, 'overview')}</p>
          <h1>
            {loading
              ? ht(l, 'loading')
              : signed
                ? `${pa(l, greeting)}${l === 'en' ? ', ' : l === 'ja' ? '、' : '，'}${actor.displayName?.trim() || ht(l, 'member')}`
                : pa(l, 'center')}
          </h1>
          <p>{signed ? pa(l, 'subtitle') : at(l, 'guestHelp')}</p>
        </div>
        {signed && data && (
          <nav className="pc-account-counts" aria-label={ht(l, 'orders')}>
            {(['active', 'review', 'completed'] as const).map((key) => (
              <Link key={key} href={`/${l}/account/bookings?status=${key}`}>
                <strong>{data.counts[key]}</strong>
                <span>{key === 'active' ? pa(l, 'active') : at(l, key)}</span>
              </Link>
            ))}
          </nav>
        )}
      </header>
      {loading ? (
        <p className="pc-account-loading" role="status">
          {ht(l, 'loading')}
        </p>
      ) : !signed ? (
        <section className="pc-account-card pc-account-guest">
          <UserRound size={38} aria-hidden="true" />
          <h2>{at(l, 'guestHelp')}</h2>
          <p>{pa(l, 'subtitle')}</p>
          {actor && (
            <p className="notice">
              {ut(l, 'otherRole')}{' '}
              <Link href={`/${l}/${actor.role.toLowerCase()}`}>{qt(l, 'back')}</Link>
            </p>
          )}
          <div className="pc-account-actions">
            <CustomerSignIn locale={l} />
            <Link className="quality-link" href={`/${l}/services`}>
              {pa(l, 'browseGuest')}
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      ) : (
        <>
          {error && (
            <div className="pc-account-card quality-error" role="alert">
              <p>{at(l, 'loadUnavailable')}</p>
              <button className="quality-button" disabled={busy} onClick={onRetry}>
                {at(l, 'retry')}
              </button>
            </div>
          )}
          {!data && !error && <p role="status">{ht(l, 'loading')}</p>}
          {desktop && data && (
            <>
              <section
                className="pc-account-card pc-account-tasks"
                aria-labelledby="pc-account-tasks-title"
              >
                <div className="pc-account-section-title">
                  <h2 id="pc-account-tasks-title">
                    {pa(l, 'tasks')}
                    {actions.length > 0 && <span>{actions.length}</span>}
                  </h2>
                  <Link href={`/${l}/account/bookings?status=attention`}>
                    {at(l, 'details')}
                    <ArrowRight size={15} />
                  </Link>
                </div>
                {actions.length ? (
                  <ul>
                    {actions.map((b) => (
                      <li key={b.id}>
                        <span className={`pc-task-icon kind-${b.kind}`}>
                          {b.kind === 'review' ? (
                            <Star size={20} />
                          ) : b.kind === 'completion' ? (
                            <CheckCircle2 size={20} />
                          ) : (
                            <Clock3 size={20} />
                          )}
                        </span>
                        <div>
                          <strong>{pa(l, b.kind)}</strong>
                          <p>
                            {b.serviceName[l]} · {b.storeName[l]} ·{' '}
                            {accountStartTime(l, b.startAt, data.now)}
                          </p>
                          {b.deadline && (
                            <small>
                              {pa(l, 'deadline')} · {dateTime(l, b.deadline)} JST
                            </small>
                          )}
                        </div>
                        <Link
                          className="quality-button"
                          href={`${orderHref(b.id)}#${b.kind === 'review' ? 'customer-review' : b.kind === 'consent' ? 'customer-replacement' : b.kind === 'payment' && b.status !== 'AWAITING_COMPLETION' ? 'customer-guarantee' : 'customer-completion'}-${b.id}`}
                        >
                          {b.kind === 'review'
                            ? pa(l, 'goReview')
                            : b.kind === 'payment'
                              ? pa(l, 'goPayment')
                              : at(l, b.kind)}
                          <ArrowRight size={15} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="pc-account-caught-up">
                    <CheckCircle2 size={24} />
                    <div>
                      <strong>{pa(l, 'noTasks')}</strong>
                      <p>{pa(l, 'noTasksHelp')}</p>
                    </div>
                  </div>
                )}
              </section>
              {data.resumeCheckout && (
                <section className="pc-account-card pc-account-resume">
                  <Clock3 size={22} />
                  <div>
                    <h2>{ut(l, 'resume')}</h2>
                    <p>
                      {money(l, data.resumeCheckout.total)} · {ut(l, 'expires')}{' '}
                      {dateTime(l, data.resumeCheckout.expiresAt)} JST
                    </p>
                    <small>{ut(l, 'holdHelp')}</small>
                  </div>
                  <Link
                    className="quality-button"
                    href={`/${l}/checkout/${data.resumeCheckout.holdId}`}
                  >
                    {ut(l, 'resume')}
                    <ArrowRight size={15} />
                  </Link>
                </section>
              )}
              <div className="pc-account-main-grid">
                <section
                  className="pc-account-card pc-account-next"
                  aria-labelledby="pc-account-next-title"
                >
                  <div className="pc-account-section-title">
                    <h2 id="pc-account-next-title">
                      {upcoming && upcoming.startAt <= data.now
                        ? pa(l, 'current')
                        : pa(l, 'upcoming')}
                    </h2>
                    {upcoming && (
                      <span className={`status-badge status-${upcoming.status.toLowerCase()}`}>
                        {statusText(l, upcoming.status)}
                      </span>
                    )}
                  </div>
                  {upcoming ? (
                    <>
                      <div className="pc-account-next-body">
                        <div className="pc-account-date">
                          <CalendarDays size={22} />
                          <strong>
                            {new Intl.DateTimeFormat(l, {
                              month: 'short',
                              day: 'numeric',
                              timeZone: 'Asia/Tokyo',
                            }).format(upcoming.startAt)}
                          </strong>
                          <span>
                            {new Intl.DateTimeFormat(l, {
                              weekday: 'long',
                              timeZone: 'Asia/Tokyo',
                            }).format(upcoming.startAt)}
                          </span>
                        </div>
                        <div>
                          <Identity locale={l} booking={upcoming} />
                          <time>{visitTimeRange(l, upcoming.startAt, upcoming.endAt)}</time>
                          <p className="pc-account-area">
                            <MapPin size={15} />
                            {sv(l, upcoming.fulfillmentMode)} · {areaName(l, upcoming.area)}
                          </p>
                        </div>
                      </div>
                      <div className="pc-account-next-footer">
                        <strong>{money(l, upcoming.total)}</strong>
                        <Link className="button" href={orderHref(upcoming.id)}>
                          {at(l, 'details')}
                          <ArrowRight size={16} />
                        </Link>
                      </div>
                      <nav className="pc-account-secondary">
                        <Link href={`${orderHref(upcoming.id)}#order-messages-${upcoming.id}`}>
                          {pa(l, 'contact')}
                        </Link>
                        <Link href={`${orderHref(upcoming.id)}#order-policy-${upcoming.id}`}>
                          {pa(l, 'policy')}
                        </Link>
                      </nav>
                    </>
                  ) : (
                    <div className="pc-account-empty">
                      <CalendarDays size={32} />
                      <h3>{pa(l, 'noCurrent')}</h3>
                      <p>{at(l, 'emptyHelp')}</p>
                      <Link className="button" href={`/${l}/services`}>
                        {at(l, 'browse')}
                        <ArrowRight size={16} />
                      </Link>
                    </div>
                  )}
                </section>
                <aside className="pc-account-card pc-account-utilities">
                  <h2>{pa(l, 'utilities')}</h2>
                  <nav>
                    {[
                      {
                        path: 'addresses',
                        label: af(l, 'addresses'),
                        help:
                          desktop.savedPlaces === 0
                            ? pa(l, 'addAddress')
                            : pa(l, 'addressCount', desktop.savedPlaces),
                        Icon: MapPin,
                      },
                      {
                        path: 'favorites',
                        label: pa(l, 'savedItems'),
                        help: pa(l, 'favoriteCount', data.counts.favorites),
                        Icon: Heart,
                      },
                      { path: 'history', label: pa(l, 'history'), Icon: History },
                      { path: 'support', label: at(l, 'help'), Icon: LifeBuoy },
                    ].map(({ path, label, help, Icon }) => (
                      <Link
                        key={path}
                        href={`/${l}/account/${path}${path === 'addresses' && desktop.savedPlaces === 0 ? '?action=add' : ''}`}
                      >
                        <Icon size={20} />
                        <span>
                          <strong>{label}</strong>
                          {help && <small>{help}</small>}
                        </span>
                        <ArrowRight size={15} />
                      </Link>
                    ))}
                  </nav>
                </aside>
              </div>
              <section className="pc-account-card">
                <div className="pc-account-section-title">
                  <h2>{pa(l, 'completed')}</h2>
                  <Link href={`/${l}/account/bookings?status=completed`}>
                    {ut(l, 'allOrders')}
                    <ArrowRight size={15} />
                  </Link>
                </div>
                {desktop.recentCompleted.length ? (
                  <>
                    <div className="pc-account-completed">
                      {desktop.recentCompleted.map((b) => (
                        <article key={b.id}>
                          <Link href={orderHref(b.id)}>
                            <Identity locale={l} booking={b} />
                            <time>{visitTimeRange(l, b.startAt, b.endAt)}</time>
                          </Link>
                          <strong>{money(l, b.total)}</strong>
                          <div className="pc-account-actions">
                            {data.reviewBookingIds.includes(b.id) && (
                              <Link
                                className="quality-link"
                                href={`${orderHref(b.id)}#customer-review-${b.id}`}
                              >
                                {pa(l, 'goReview')}
                              </Link>
                            )}
                            <AccountRebook locale={l} bookingId={b.id} />
                          </div>
                        </article>
                      ))}
                    </div>
                    <p className="pc-account-footnote">{at(l, 'againHelp')}</p>
                  </>
                ) : (
                  <p className="pc-account-footnote">{pa(l, 'noneCompleted')}</p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
