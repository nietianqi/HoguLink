'use client';
import { useDemoAccess } from '@/lib/use-runtime';
import { goCustomerAccess } from './customer-signin';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  RefreshCw,
  ShieldAlert,
  Check,
  CalendarDays,
  MessagesSquare,
  LoaderCircle,
  Store as StoreIcon,
  UserRound,
  ShieldCheck,
} from 'lucide-react';
import type { Actor, Booking, Listing, Locale, Message, Role } from '@hogulink/contracts';
import { api, ClientError, type Catalog } from '@/lib/api';
import { t, errorText, dateTime, money, statusText, areaName, type TextKey } from '@/lib/i18n';
import { useSession } from './booking-form';
import { PriceLines } from './catalog';
import { WorkspaceNav } from './workspace-nav';
import { ct } from '@/lib/care-i18n';
import { xt } from '@/lib/exception-i18n';
import { NoShowPanel } from './no-show-panel';
import { BookingQueue } from './booking-queue';
import { dt } from '@/lib/desktop-i18n';
import { filterBookings, needsAttention, type BookingFilter } from '@/lib/desktop-model';
import { st } from '@/lib/merchant-i18n';
import { MobileSheet } from './mobile-ui';
import { qt } from '@/lib/quality-i18n';
import { CustomerExperiencePanel } from './experience-ui';
import { ArrivalPanel, CancellationAction } from './quality-workspace';
import { OrderCarePanel } from './order-care';
import { CompletionPanel } from './completion-panel';
import { af } from '@/lib/customer-flow-i18n';
import { OrderCoordination } from './order-coordination';
import { ot } from '@/lib/coordination-i18n';
import { nextWork } from '@/lib/coordination-model';
import { wt } from '@/lib/workday-i18n';
import { xt as discoveryText } from '@/lib/discovery-i18n';
import { WorkdayTools } from './workday-tools';
import { PartnerOrderFlow, OrderQueueDisclosure } from './partner-order-flow';
import { pf } from '@/lib/partner-flow-i18n';
import { br } from '@/lib/booking-rules-i18n';
import { policyText, vt } from '@/lib/visit-i18n';
import { visitTimeRange } from '@/lib/booking-presentation';
import { CustomerOrderProgress } from './customer-order-progress';
import { MapPin, MessageCircle, LifeBuoy } from 'lucide-react';
import { ca } from '@/lib/customer-auth-i18n';
import { loadCustomerBookings } from '@/lib/customer-booking-data';
import {
  loadPartnerBookings,
  type PartnerDashboard as Dashboard,
} from '@/lib/partner-booking-data';
const roles: Record<Role, TextKey> = {
  CUSTOMER: 'customer',
  MERCHANT: 'merchant',
  STAFF: 'staff',
  ADMIN: 'admin',
};
export function Operations({
  locale: l,
  role,
  bookingId,
  embedded = false,
  initialSelected,
  initialFilter = 'all',
}: {
  locale: Locale;
  role: Role;
  bookingId?: string;
  embedded?: boolean;
  initialSelected?: string;
  initialFilter?: BookingFilter;
}) {
  const { actor, setActor, loading } = useSession();
  const demoAccess = useDemoAccess();
  const [queueSearch, setQueueSearch] = useState('');
  const [queueStatus, setQueueStatus] = useState<BookingFilter>(initialFilter);
  const [queuePeriod, setQueuePeriod] = useState('all');
  const [selectedBooking, setSelectedBooking] = useState(initialSelected ?? '');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>();
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [account, setAccount] = useState(role === 'STAFF' ? 'staff-aoi' : 'store-nagi');
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [messageStates, setMessageStates] = useState<Record<string, 'loading' | 'ready' | 'error'>>(
    {},
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [candidateState, setCandidateState] = useState<{ key: string; items: Listing[] }>({
    key: '',
    items: [],
  });
  const [confirmAction, setConfirmAction] = useState<{
    booking: Booking;
    operation: 'refunds' | 'cancel' | 'reject';
  } | null>(null);
  const loadVersion = useRef(0);
  const messageVersion = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++loadVersion.current;
    if (role === 'CUSTOMER' && actor?.role === 'CUSTOMER') {
      const next = await loadCustomerBookings(bookingId);
      if (generation !== loadVersion.current) return;
      void next.catalog.then((value) => {
        if (generation === loadVersion.current) setCatalog(value);
      });
      setBookings(next.bookings);
      setOrdersLoaded(true);
      return;
    }
    if (actor?.role === role) {
      const next = await loadPartnerBookings(role, bookingId);
      if (generation !== loadVersion.current) return;
      setBookings(next.bookings);
      setOrdersLoaded(true);
      void next.catalog.then((value) => {
        if (generation === loadVersion.current) setCatalog(value);
      });
      void next.dashboard.then((value) => {
        if (generation === loadVersion.current) setDashboard(value);
      });
    } else {
      const c = await api<Catalog>('public/staff-listings');
      if (generation === loadVersion.current) setCatalog(c);
    }
  }, [actor, role, bookingId]);
  useEffect(() => {
    let current = true;
    messageVersion.current++;
    setOrdersLoaded(false);
    setBookings([]);
    setCatalog(undefined);
    setDashboard(undefined);
    setMessages({});
    setMessageStates({});
    setDrafts({});
    setConfirmAction(null);
    setError('');
    if (!loading)
      void refresh().catch((e) => {
        if (current) setError(errorText(l, e instanceof ClientError ? e.code : undefined));
      });
    return () => {
      current = false;
      loadVersion.current++;
      messageVersion.current++;
    };
  }, [refresh, l, loading]);
  async function task(fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await refresh();
      if (success) setNotice(success);
      return true;
    } catch (e) {
      setError(errorText(l, e instanceof ClientError ? e.code : undefined));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    if (role === 'CUSTOMER') {
      goCustomerAccess(l);
      return;
    }
    if (!demoAccess) {
      window.location.assign(
        role === 'ADMIN' ? `/${l}/admin/login` : `/${l}/onboarding?role=${role}`,
      );
      return;
    }
    loadVersion.current++;
    setBookings([]);
    setDashboard(undefined);
    setMessages({});
    setDrafts({});
    setAssignments({});
    setSelectedBooking('');
    setQueueSearch('');
    setQueueStatus('all');
    setQueuePeriod('all');
    setBusy(true);
    setError('');
    try {
      setActor(
        await api<Actor>('auth/demo', {
          role,
          ...(role === 'MERCHANT' ? { storeId: account } : {}),
          ...(role === 'STAFF' ? { staffId: account } : {}),
        }),
      );
    } catch (e) {
      setError(errorText(l, e instanceof ClientError ? e.code : undefined));
    } finally {
      setBusy(false);
    }
  }
  function action(b: Booking, operation: string, extra: Record<string, unknown> = {}) {
    const group =
      role === 'CUSTOMER'
        ? 'customer/bookings'
        : role === 'MERCHANT'
          ? 'merchant/bookings'
          : 'staff/tasks';
    return () => api(`${group}/${b.id}/${operation}`, { version: b.version, ...extra });
  }
  const stores = dashboard?.stores ?? catalog?.stores ?? [];
  const listings = dashboard?.listings ?? catalog?.listings ?? [];
  function listingName(id: string | null) {
    return (
      listings.find((x) => x.id === id)?.name[l] ??
      (id
        ? role === 'CUSTOMER'
          ? vt(l, 'therapistUnavailable')
          : id.replace('listing-', '')
        : t(l, 'unassigned'))
    );
  }
  async function loadMessages(id: string) {
    const generation = messageVersion.current;
    const group =
      role === 'CUSTOMER'
        ? 'customer/bookings'
        : role === 'MERCHANT'
          ? 'merchant/bookings'
          : 'staff/tasks';
    setMessageStates((previous) => ({ ...previous, [id]: 'loading' }));
    try {
      const next = await api<Message[]>(`${group}/${id}/messages`);
      if (generation !== messageVersion.current) return;
      setMessages((previous) => ({ ...previous, [id]: next }));
      setMessageStates((previous) => ({ ...previous, [id]: 'ready' }));
    } catch {
      if (generation === messageVersion.current)
        setMessageStates((previous) => ({ ...previous, [id]: 'error' }));
    }
  }
  const hasRole = actor?.role === role;
  const visibleBookings = filterBookings(bookings, {
    role,
    status: queueStatus,
    search: queueSearch,
    period: queuePeriod,
    describe: (b) =>
      `${stores.find((s) => s.id === b.storeId)?.name[l] ?? b.legalNameSnapshot} ${listingName(b.assignedListingId)} ${listingName(b.selectedStaffListingId)}`,
  });
  const missingInitial =
    ordersLoaded &&
    !!initialSelected &&
    selectedBooking === initialSelected &&
    !bookings.some((b) => b.id === initialSelected);
  const selectedId = missingInitial
    ? undefined
    : visibleBookings.some((b) => b.id === selectedBooking)
      ? selectedBooking
      : visibleBookings[0]?.id;
  const selectedVersion = bookings.find((b) => b.id === selectedId)?.version;
  const candidateKey = `${actor?.storeId}:${selectedId}:${selectedVersion}`;
  useEffect(() => {
    let cancelled = false;
    if (role === 'MERCHANT' && hasRole && selectedId)
      api<Listing[]>(`merchant/bookings/${selectedId}/assignment-candidates`)
        .then((items) => {
          if (!cancelled) setCandidateState({ key: candidateKey, items });
        })
        .catch((e) => {
          if (!cancelled) {
            setCandidateState({ key: candidateKey, items: [] });
            setError(errorText(l, e instanceof ClientError ? e.code : undefined));
          }
        });
    return () => {
      cancelled = true;
    };
  }, [role, hasRole, selectedId, candidateKey, l, bookings]);

  const customerDecision =
    role === 'CUSTOMER' &&
    !!bookingId &&
    bookings.some(
      (b) => b.id === bookingId && b.replacementConsent === 'PENDING' && !!b.proposedListingId,
    );
  const customerTools = (
    <WorkdayTools
      locale={l}
      items={[
        { href: `/${l}/account/bookings`, label: t(l, 'orders'), icon: CalendarDays },
        { href: `/${l}/account/addresses`, label: af(l, 'addresses'), icon: MapPin },
        {
          href: `/${l}/account/messages`,
          label: discoveryText(l, 'inbox'),
          icon: MessageCircle,
        },
        {
          href: bookingId ? `#aftercare-${bookingId}` : `/${l}/account/support`,
          label: af(l, 'aftercare'),
          icon: LifeBuoy,
        },
      ]}
    />
  );
  const roleIcon =
    role === 'MERCHANT' ? (
      <StoreIcon size={25} />
    ) : role === 'ADMIN' ? (
      <ShieldCheck size={25} />
    ) : (
      <UserRound size={25} />
    );
  return (
    <div
      className={`workspace-layout ${embedded ? 'merchant-embedded' : ''} ${role === 'CUSTOMER' ? 'workday-orders' : ''}`}
      data-focused={!!initialSelected}
      data-consent={customerDecision}
    >
      <WorkspaceNav locale={l} role={role} active="bookings" />
      <div className="workspace-content">
        <div className="workspace-title">
          <div>
            {role === 'CUSTOMER' && bookingId && (
              <Link className="back-link" href={`/${l}/account/bookings`}>
                {vt(l, 'backBookings')}
              </Link>
            )}
            {role !== 'CUSTOMER' && <span className="eyebrow small">HOGULINK / {role}</span>}
            <h1>
              {roleIcon}{' '}
              {role === 'CUSTOMER'
                ? bookingId
                  ? vt(l, 'orderDetails')
                  : t(l, 'orders')
                : t(l, roles[role])}
            </h1>
            <p>
              {role === 'CUSTOMER'
                ? wt(l, 'customerHelp')
                : role === 'STAFF'
                  ? t(l, 'taskPrivacy')
                  : t(l, 'roleHelp')}
            </p>
          </div>
          {hasRole && (
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => task(refresh)}
            >
              <RefreshCw size={15} />
              {t(l, 'refresh')}
            </button>
          )}
        </div>
        {role === 'CUSTOMER' && hasRole && !bookingId && !customerDecision && customerTools}
        {(role !== 'CUSTOMER' || !hasRole) && (
          <div className="account-panel">
            {role === 'CUSTOMER' && (
              <Link className="quality-button" href={`/${l}/account/favorites`}>
                {qt(l, 'favorites')}
              </Link>
            )}
            <span className="account-avatar">{roleIcon}</span>
            <div>
              <strong>
                {hasRole
                  ? (stores.find((s) => s.id === actor.storeId)?.name[l] ??
                    listings.find((x) => x.staffId === actor.staffId)?.name[l] ??
                    t(l, roles[role]))
                  : t(l, 'loginRequired')}
              </strong>
              <p>{role === 'CUSTOMER' ? t(l, 'signInHelp') : t(l, 'roleHelp')}</p>
            </div>
            {role === 'MERCHANT' && (
              <select
                aria-label={t(l, 'shop')}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name[l]}
                  </option>
                ))}
              </select>
            )}
            {role === 'STAFF' && (
              <select
                aria-label={t(l, 'chooseStaff')}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                {listings.map((s) => (
                  <option key={s.staffId} value={s.staffId}>
                    {s.name[l]}
                  </option>
                ))}
              </select>
            )}
            <button className="button small" disabled={busy || loading} onClick={login}>
              {role === 'CUSTOMER' ? ca(l, 'login') : t(l, 'enter')}
              <ArrowRight size={14} />
            </button>
          </div>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="success notice" role="status">
            <Check size={17} />
            {notice}
          </p>
        )}
        {hasRole && (
          <>
            {ordersLoaded && (role !== 'CUSTOMER' || !bookingId) && (
              <div className="workspace-stats">
                <div>
                  <span>{t(l, 'orders')}</span>
                  <strong>{bookings.length}</strong>
                </div>
                <div>
                  <span>{dt(l, 'attention')}</span>
                  <strong>
                    {bookings.filter((b) => needsAttention(b, role)).length}
                    <small>{dt(l, 'matches')}</small>
                  </strong>
                </div>
                <div>
                  <span>{role === 'ADMIN' ? t(l, 'safetyQueue') : dt(l, 'netCaptured')}</span>
                  <strong>
                    {role === 'ADMIN'
                      ? (dashboard?.safety.filter((event) => event.status !== 'RESOLVED').length ??
                        0)
                      : money(
                          l,
                          bookings.reduce((sum, b) => sum + b.capturedAmount - b.refundedAmount, 0),
                        )}
                  </strong>
                </div>
                {role !== 'ADMIN' && (
                  <div>
                    <span>{dt(l, 'active')}</span>
                    <strong>
                      {
                        bookings.filter(
                          (b) =>
                            !['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status),
                        ).length
                      }
                    </strong>
                  </div>
                )}
                {role === 'ADMIN' && (
                  <div>
                    <span>{t(l, 'notifications')}</span>
                    <strong>{dashboard?.outboxPending ?? 0}</strong>
                  </div>
                )}
              </div>
            )}
            {role === 'STAFF' && (
              <div className="notice">
                <ShieldCheck size={20} />
                <span>{t(l, 'taskPrivacy')}</span>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() =>
                    task(() => api('staff/duty-status', { onDuty: true }, 'PUT'), t(l, 'saved'))
                  }
                >
                  {t(l, 'standby')}
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    task(() => api('staff/duty-status', { onDuty: false }, 'PUT'), t(l, 'saved'))
                  }
                >
                  {t(l, 'offDuty')}
                </button>
              </div>
            )}
            {!bookingId && ordersLoaded && (
              <>
                {embedded && role === 'MERCHANT' && initialSelected && (
                  <Link className="workday-task-back" href={`/${l}/merchant?tab=bookings`}>
                    {st(l, 'bookings')}
                    <ArrowRight size={15} />
                  </Link>
                )}
                <OrderQueueDisclosure locale={l} focused={role === 'MERCHANT' && !!initialSelected}>
                  <BookingQueue
                    locale={l}
                    role={role}
                    bookings={visibleBookings}
                    allBookings={bookings}
                    catalog={{ stores, listings }}
                    selectedId={role === 'CUSTOMER' ? undefined : selectedId}
                    onSelect={setSelectedBooking}
                    search={queueSearch}
                    onSearch={setQueueSearch}
                    status={queueStatus}
                    onStatus={setQueueStatus}
                    period={queuePeriod}
                    onPeriod={setQueuePeriod}
                  />
                </OrderQueueDisclosure>
              </>
            )}
            <div className="booking-list" id="booking-detail" aria-busy={!ordersLoaded && !error}>
              {!ordersLoaded && !error && (
                <p className="flow-muted" role="status">
                  {pf(l, 'loadingOrder')}
                </p>
              )}
              {missingInitial && (
                <p className="notice" role="alert">
                  {ot(l, 'missingOrder')}
                </p>
              )}
              {!visibleBookings.length && bookings.length > 0 && (
                <div className="empty-state">
                  <CalendarDays size={30} />
                  <h3>{dt(l, 'noMatches')}</h3>
                </div>
              )}
              {ordersLoaded && !bookings.length && (role !== 'CUSTOMER' || !!bookingId) && (
                <div className="empty-state">
                  <CalendarDays size={35} />
                  <h3>{t(l, 'empty')}</h3>
                  {role === 'CUSTOMER' && (
                    <Link className="button" href={`/${l}`}>
                      {t(l, 'explore')}
                    </Link>
                  )}
                </div>
              )}
              {(missingInitial || (role === 'CUSTOMER' && !bookingId) ? [] : visibleBookings).map(
                (b) => {
                  const active = !['COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(
                    b.status,
                  );
                  const candidates =
                    role === 'MERCHANT'
                      ? candidateState.key === candidateKey
                        ? candidateState.items
                        : []
                      : (dashboard?.listings ?? catalog?.listings ?? []).filter(
                          (x) =>
                            x.storeId === b.storeId &&
                            x.staffId !== b.assignedStaffId &&
                            x.publicationStatus === 'PUBLISHED_INDEXABLE',
                        );
                  const assignmentId = candidates.some((x) => x.id === assignments[b.id])
                    ? assignments[b.id]
                    : candidates[0]?.id;
                  return (
                    <article
                      className={`booking-card ${role === 'CUSTOMER' && bookingId ? 'customer-order-detail' : role === 'MERCHANT' ? 'merchant-order-detail' : ''}`}
                      key={b.id}
                      data-selected={bookingId || b.id === selectedId ? 'true' : 'false'}
                    >
                      <div className="booking-card-heading">
                        <div>
                          <span className={`status-badge status-${b.status.toLowerCase()}`}>
                            {(role === 'CUSTOMER' || role === 'MERCHANT') &&
                            b.replacementConsent === 'PENDING' &&
                            b.proposedListingId
                              ? wt(l, 'consentPending')
                              : statusText(l, b.status)}
                          </span>
                          <span className="booking-ref">
                            {b.id.slice(-8).toUpperCase()}
                            {role !== 'CUSTOMER' && ` · v${b.version}`}
                          </span>
                        </div>
                        <strong>
                          {role === 'CUSTOMER' ? (
                            visitTimeRange(l, b.quote.startAt, b.quote.endAt)
                          ) : (
                            <>
                              {dateTime(l, b.quote.startAt)} <small>JST</small>
                            </>
                          )}
                        </strong>
                      </div>
                      {role === 'CUSTOMER' && bookingId && (
                        <>
                          <CustomerOrderProgress locale={l} booking={b} />
                          <nav className="order-detail-nav" aria-label={vt(l, 'orderDetails')}>
                            <a href={`#order-overview-${b.id}`}>{af(l, 'orderOverview')}</a>
                            <a href={`#order-price-${b.id}`}>{vt(l, 'included')}</a>
                            <a
                              href={`#order-policy-${b.id}`}
                              onClick={() => {
                                const panel = document.getElementById(`order-policy-${b.id}`);
                                if (panel instanceof HTMLDetailsElement) panel.open = true;
                              }}
                            >
                              {t(l, 'policy')}
                            </a>
                            <a
                              href={`#order-messages-${b.id}`}
                              onClick={() => {
                                const panel = document.getElementById(`order-messages-${b.id}`);
                                if (panel instanceof HTMLDetailsElement) panel.open = true;
                              }}
                            >
                              {t(l, 'messages')}
                            </a>
                            <a href={`#aftercare-${b.id}`}>{af(l, 'aftercare')}</a>
                          </nav>
                        </>
                      )}
                      {role === 'CUSTOMER' &&
                        bookingId &&
                        !(b.replacementConsent === 'PENDING' && b.proposedListingId) && (
                          <div className="workday-order-next">
                            <span>{wt(l, 'currentVisit')}</span>
                            <strong>{ot(l, nextWork(b))}</strong>
                            {active &&
                              ![
                                'visit',
                                'closed',
                                'completionPending',
                                'completionReview',
                              ].includes(nextWork(b)) && (
                                <small>
                                  {wt(l, 'responseBy')} ·{' '}
                                  {dateTime(
                                    l,
                                    b.replacementConsent === 'PENDING'
                                      ? (b.replacementDeadline ?? b.deadline)
                                      : b.deadline,
                                  )}{' '}
                                  JST
                                </small>
                              )}
                            {b.refundedAmount > 0 && (
                              <small>
                                {t(l, 'refunded')} {money(l, b.refundedAmount)} ·{' '}
                                {dt(l, 'netCaptured')}{' '}
                                {money(l, b.capturedAmount - b.refundedAmount)}
                              </small>
                            )}
                          </div>
                        )}
                      {role === 'CUSTOMER' && b.replacementConsent === 'PENDING' && (
                        <div className="replacement-panel">
                          <h3>{t(l, 'replacement')}</h3>
                          <p>
                            {b.proposedListingId ? (
                              <>
                                {t(l, 'replacementText')} ·{' '}
                                <strong>{listingName(b.proposedListingId)}</strong>
                              </>
                            ) : (
                              xt(l, 'waitingShop')
                            )}
                          </p>
                          <small className="workday-response">
                            {wt(l, 'responseBy')} ·{' '}
                            {dateTime(l, b.replacementDeadline ?? b.deadline)} JST
                          </small>
                          <div className="button-row">
                            {b.proposedListingId && (
                              <button
                                className="button small"
                                disabled={busy}
                                onClick={() =>
                                  task(action(b, 'replacement-consent', { approved: true }))
                                }
                              >
                                {t(l, 'approve')}
                              </button>
                            )}
                            <button
                              className="button secondary small"
                              disabled={busy}
                              onClick={() =>
                                task(action(b, 'replacement-consent', { approved: false }))
                              }
                            >
                              {b.proposedListingId ? t(l, 'decline') : xt(l, 'freeCancel')}
                            </button>
                          </div>
                        </div>
                      )}
                      {role === 'MERCHANT' && (
                        <PartnerOrderFlow locale={l} booking={b} role="MERCHANT" />
                      )}
                      {role === 'MERCHANT' && (
                        <section
                          className="merchant-dispatch-panel"
                          id={`dispatch-${b.id}`}
                          aria-label={pf(l, 'dispatch')}
                        >
                          <div className="partner-section-heading">
                            <span>01</span>
                            <h3>{pf(l, 'dispatch')}</h3>
                          </div>
                          <p className="flow-muted">
                            {b.status === 'REQUESTED'
                              ? ot(l, 'accept')
                              : pf(
                                  l,
                                  b.replacementConsent === 'PENDING' && b.proposedListingId
                                    ? 'pending'
                                    : ['ACCEPTED', 'CONFIRMED', 'REQUESTED'].includes(b.status)
                                      ? b.quote.nominationType === 'FREE'
                                        ? 'freeHelp'
                                        : 'nominatedHelp'
                                      : 'noDispatch',
                                )}
                          </p>
                          <div className="merchant-dispatch-controls">
                            {b.status === 'REQUESTED' && (
                              <>
                                <button
                                  className="button small"
                                  disabled={busy}
                                  onClick={() => task(action(b, 'accept'))}
                                >
                                  {t(l, 'accept')}
                                </button>
                                <button
                                  className="text-button danger"
                                  disabled={busy}
                                  onClick={() => {
                                    setError('');
                                    setConfirmAction({ booking: b, operation: 'reject' });
                                  }}
                                >
                                  {t(l, 'reject')}
                                </button>
                              </>
                            )}
                            {['ACCEPTED', 'CONFIRMED'].includes(b.status) &&
                              (b.replacementConsent !== 'PENDING' || !b.proposedListingId) &&
                              candidates.length > 0 && (
                                <>
                                  <label className="merchant-candidate-field">
                                    <span>{pf(l, 'candidate')}</span>
                                    <select
                                      aria-label={`${t(l, 'chooseStaff')} ${b.id.slice(-8)}`}
                                      value={assignmentId ?? ''}
                                      onChange={(e) =>
                                        setAssignments((previous) => ({
                                          ...previous,
                                          [b.id]: e.target.value,
                                        }))
                                      }
                                    >
                                      {candidates.map((x) => (
                                        <option key={x.id} value={x.id}>
                                          {x.name[l]}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <button
                                    className="button secondary small"
                                    disabled={busy}
                                    onClick={() =>
                                      task(
                                        action(
                                          b,
                                          b.quote.nominationType === 'FREE'
                                            ? 'assignments'
                                            : 'replacement-proposals',
                                          { listingId: assignmentId },
                                        ),
                                      )
                                    }
                                  >
                                    {t(l, b.quote.nominationType === 'FREE' ? 'assign' : 'propose')}
                                  </button>
                                </>
                              )}
                            {['ACCEPTED', 'CONFIRMED'].includes(b.status) &&
                              (b.replacementConsent !== 'PENDING' || !b.proposedListingId) &&
                              candidates.length === 0 && (
                                <p className="merchant-candidate-note">
                                  {st(
                                    l,
                                    candidateState.key === candidateKey
                                      ? 'noCandidates'
                                      : 'assignments',
                                  )}
                                </p>
                              )}
                          </div>
                        </section>
                      )}
                      {customerDecision && !bookingId && customerTools}
                      <CompletionPanel
                        locale={l}
                        booking={b}
                        role={role}
                        onUpdated={() => void task(refresh)}
                      />
                      <div className="booking-card-main" id={`order-overview-${b.id}`}>
                        <div className="booking-facts">
                          <h3>
                            {stores.find((s) => s.id === b.storeId)?.name[l] ?? b.legalNameSnapshot}
                          </h3>
                          <p className="muted legal-name">{b.legalNameSnapshot}</p>
                          <dl>
                            <div>
                              <dt>{af(l, 'serviceItem')}</dt>
                              <dd>
                                {b.quote.serviceName?.[l] ?? t(l, 'services')} ·{' '}
                                {(b.quote.endAt - b.quote.startAt) / 60000} {t(l, 'minutes')}
                              </dd>
                            </div>
                            <div>
                              <dt>{t(l, 'original')}</dt>
                              <dd>
                                {b.selectedStaffListingId
                                  ? listingName(b.selectedStaffListingId)
                                  : t(l, 'free')}
                              </dd>
                            </div>
                            <div>
                              <dt>{t(l, 'assigned')}</dt>
                              <dd>
                                {listingName(b.assignedListingId)} ·{' '}
                                {statusText(l, b.staffTaskStatus)}
                              </dd>
                            </div>
                            <div>
                              <dt>{t(l, 'area')}</dt>
                              <dd>{areaName(l, b.quote.area)}</dd>
                            </div>
                            <div>
                              <dt>{t(l, 'paymentStatus')}</dt>
                              <dd>{statusText(l, b.paymentStatus)}</dd>
                            </div>
                            {b.capturedAmount > 0 && (
                              <div>
                                <dt>{t(l, 'captured')}</dt>
                                <dd>
                                  {money(l, b.capturedAmount)} · {t(l, 'refunded')}{' '}
                                  {money(l, b.refundedAmount)}
                                </dd>
                              </div>
                            )}
                          </dl>
                          {b.address ? (
                            <p className="address-display">
                              {b.address.name} · {b.address.detail}
                              {b.address.type === 'HOTEL' &&
                                ` · ${b.address.hotelName} / ${b.address.room}`}
                            </p>
                          ) : (
                            role === 'STAFF' && <p className="muted">{t(l, 'noAddress')}</p>
                          )}
                          <p className="muted">
                            {active &&
                              ![
                                'visit',
                                'closed',
                                'completionPending',
                                'completionReview',
                              ].includes(nextWork(b)) &&
                              `${dateTime(l, b.replacementConsent === 'PENDING' ? (b.replacementDeadline ?? b.deadline) : b.deadline)} · `}
                            {active
                              ? ot(l, nextWork(b))
                              : b.cancelReason === 'CUSTOMER_NO_SHOW'
                                ? xt(l, 'closed')
                                : b.cancelReason === 'MERCHANT_UNABLE' ||
                                    b.cancelReason === 'PROVIDER_ARRIVAL_DELAY' ||
                                    b.cancelReason === 'CUSTOMER_REQUEST' ||
                                    b.cancelReason === 'SAFETY_TERMINATION'
                                  ? qt(l, b.cancelReason)
                                  : b.cancelReason
                                    ? statusText(l, b.status)
                                    : null}
                          </p>
                        </div>
                        <div className="booking-price" id={`order-price-${b.id}`}>
                          <PriceLines locale={l} quote={b.quote} />
                        </div>
                      </div>
                      {role === 'CUSTOMER' && (
                        <>
                          <details className="order-policy-snapshot" id={`order-policy-${b.id}`}>
                            <summary>{br(l, 'frozen')}</summary>
                            <p>{policyText(l, b.quote.cancellationPolicy, b.quote.bookingMode)}</p>
                            <small>{b.quote.cancellationPolicy.version}</small>
                          </details>
                          <ArrivalPanel
                            locale={l}
                            booking={b}
                            onUpdated={() => void task(refresh)}
                          />
                          <CustomerExperiencePanel locale={l} booking={b} />
                          {bookingId && (
                            <OrderCarePanel
                              locale={l}
                              booking={b}
                              showProgress={false}
                              onUpdated={() => void task(refresh)}
                            />
                          )}
                        </>
                      )}
                      <NoShowPanel
                        locale={l}
                        booking={b}
                        role={role}
                        onUpdated={() => task(refresh)}
                      />
                      <div className="booking-actions">
                        {role === 'CUSTOMER' && !bookingId && (
                          <Link className="text-button" href={`/${l}/account/bookings/${b.id}`}>
                            {af(l, 'aftercare')} ↗
                          </Link>
                        )}
                        {(role === 'CUSTOMER' || role === 'STAFF') && (
                          <Link
                            className="text-button"
                            href={`/${l}/${role === 'CUSTOMER' ? 'account' : 'staff'}/support?booking=${b.id}`}
                          >
                            {ct(l, role === 'STAFF' ? 'privateFeedback' : 'create')}
                          </Link>
                        )}
                        {role === 'CUSTOMER' && active && (
                          <CancellationAction
                            locale={l}
                            booking={b}
                            onUpdated={() => void task(refresh)}
                          />
                        )}
                        {role === 'STAFF' && active && (
                          <>
                            {b.staffTaskStatus === 'OFFERED' && (
                              <button
                                className="button small"
                                disabled={busy}
                                onClick={() => task(action(b, 'ack', { arrivalMinutes: 45 }))}
                              >
                                {t(l, 'ack')} {b.quote.bookingMode === 'INSTANT' ? '· 45 min' : ''}
                              </button>
                            )}
                            {['OFFERED', 'ACKNOWLEDGED'].includes(b.staffTaskStatus) &&
                              ['ACCEPTED', 'CONFIRMED'].includes(b.status) && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() =>
                                    task(
                                      action(b, 'decline', {
                                        reason: 'Unable to serve / デモ / 演示',
                                      }),
                                    )
                                  }
                                >
                                  {t(l, 'unavailable')}
                                </button>
                              )}
                            {b.staffTaskStatus === 'ACKNOWLEDGED' &&
                              b.replacementConsent !== 'PENDING' &&
                              (['CONFIRMED', 'EN_ROUTE'] as const).includes(
                                b.status as 'CONFIRMED',
                              ) && (
                                <button
                                  className="button small"
                                  disabled={busy}
                                  onClick={() =>
                                    task(
                                      action(b, 'events', {
                                        event: (
                                          {
                                            CONFIRMED: 'EN_ROUTE',
                                            EN_ROUTE: 'ARRIVED',
                                            ARRIVED: 'START',
                                            IN_SERVICE: 'COMPLETE',
                                          } as Record<string, string>
                                        )[b.status],
                                      }),
                                    )
                                  }
                                >
                                  {t(
                                    l,
                                    (
                                      {
                                        CONFIRMED: 'enRoute',
                                        EN_ROUTE: 'arrived',
                                        ARRIVED: 'startService',
                                        IN_SERVICE: 'complete',
                                      } as Record<string, TextKey>
                                    )[b.status],
                                  )}
                                </button>
                              )}
                            <button
                              className="button danger-button small"
                              disabled={busy}
                              onClick={() =>
                                task(
                                  () =>
                                    api('staff/safety-alerts', {
                                      bookingId: b.id,
                                      version: b.version,
                                      type: 'SOS',
                                    }),
                                  t(l, 'sosNote'),
                                )
                              }
                            >
                              <ShieldAlert size={15} />
                              {t(l, 'sos')}
                            </button>
                            <button
                              className="text-button danger"
                              disabled={busy}
                              onClick={() =>
                                task(
                                  () =>
                                    api('staff/safety-alerts', {
                                      bookingId: b.id,
                                      version: b.version,
                                      type: 'SAFETY_TERMINATION',
                                    }),
                                  t(l, 'sosNote'),
                                )
                              }
                            >
                              {t(l, 'terminate')}
                            </button>
                          </>
                        )}
                        {role === 'CUSTOMER' && !bookingId && (
                          <Link href={`/${l}/account/bookings/${b.id}`} className="text-button">
                            {t(l, 'details')} <ArrowRight size={14} />
                          </Link>
                        )}
                      </div>
                      {role === 'MERCHANT' &&
                        ((active && !['IN_SERVICE', 'AWAITING_COMPLETION'].includes(b.status)) ||
                          b.capturedAmount > b.refundedAmount) && (
                          <details className="partner-exceptions">
                            <summary>{pf(l, 'exceptions')}</summary>
                            <p>{pf(l, 'exceptionHelp')}</p>
                            <div className="booking-actions">
                              {active &&
                                !['IN_SERVICE', 'AWAITING_COMPLETION'].includes(b.status) && (
                                  <button
                                    className="text-button danger"
                                    disabled={busy}
                                    onClick={() => {
                                      setError('');
                                      setConfirmAction({ booking: b, operation: 'cancel' });
                                    }}
                                  >
                                    {t(l, 'cancel')}
                                  </button>
                                )}
                              {b.capturedAmount > b.refundedAmount && (
                                <button
                                  className="button secondary small"
                                  disabled={busy}
                                  onClick={() => {
                                    setError('');
                                    setConfirmAction({ booking: b, operation: 'refunds' });
                                  }}
                                >
                                  {st(l, 'refund')}
                                </button>
                              )}
                            </div>
                          </details>
                        )}
                      {actor &&
                        ((role === 'CUSTOMER' && bookingId) ||
                          (role === 'MERCHANT' && b.id === selectedId)) && (
                          <OrderCoordination
                            key={`${actor.id}:${b.id}`}
                            locale={l}
                            booking={b}
                            actor={actor}
                            showNext={false}
                            onUpdated={() => void task(refresh)}
                          />
                        )}
                      {((role === 'CUSTOMER' && (bookingId || active)) ||
                        role === 'MERCHANT' ||
                        (role === 'STAFF' &&
                          b.staffTaskStatus === 'ACKNOWLEDGED' &&
                          b.replacementConsent !== 'PENDING' &&
                          active)) && (
                        <details
                          className="message-panel"
                          id={`order-messages-${b.id}`}
                          onToggle={(e) => {
                            if (
                              e.currentTarget.open &&
                              !messages[b.id] &&
                              messageStates[b.id] !== 'loading'
                            )
                              void loadMessages(b.id);
                          }}
                        >
                          <summary>
                            <MessagesSquare size={16} />
                            {role === 'MERCHANT' ? ot(l, 'customerMessages') : t(l, 'messages')}
                          </summary>
                          <p className="muted">{t(l, 'contactHidden')}</p>
                          {messageStates[b.id] === 'loading' && (
                            <p role="status">{t(l, 'waiting')}</p>
                          )}
                          {messageStates[b.id] === 'error' && (
                            <div role="alert">
                              <p className="error-message">{t(l, 'error')}</p>
                              <button
                                type="button"
                                className="button secondary small"
                                onClick={() => void loadMessages(b.id)}
                              >
                                {t(l, 'refresh')}
                              </button>
                            </div>
                          )}
                          {messageStates[b.id] === 'ready' && !messages[b.id]?.length && (
                            <p className="muted">{vt(l, 'noOrderMessages')}</p>
                          )}
                          <div className="message-list">
                            {(messages[b.id] ?? []).map((m) => (
                              <div key={m.id}>
                                <small>
                                  {t(l, roles[m.role])} · {dateTime(l, m.createdAt)}
                                </small>
                                <p>{m.text}</p>
                              </div>
                            ))}
                          </div>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (busy || messageStates[b.id] !== 'ready') return;
                              const group =
                                role === 'CUSTOMER'
                                  ? 'customer/bookings'
                                  : role === 'MERCHANT'
                                    ? 'merchant/bookings'
                                    : 'staff/tasks';
                              void task(async () => {
                                const x = await api<Message[]>(`${group}/${b.id}/messages`, {
                                  text: drafts[b.id] ?? '',
                                });
                                setMessages((previous) => ({ ...previous, [b.id]: x }));
                                setMessageStates((previous) => ({ ...previous, [b.id]: 'ready' }));
                                setDrafts((previous) => ({ ...previous, [b.id]: '' }));
                              });
                            }}
                          >
                            <label className="sr-only" htmlFor={`message-${b.id}`}>
                              {t(l, 'messages')}
                            </label>
                            <input
                              id={`message-${b.id}`}
                              required
                              maxLength={1000}
                              value={drafts[b.id] ?? ''}
                              onChange={(e) =>
                                setDrafts((previous) => ({ ...previous, [b.id]: e.target.value }))
                              }
                              placeholder={t(l, 'messagePlaceholder')}
                            />
                            <button
                              className="button small"
                              disabled={busy || messageStates[b.id] !== 'ready'}
                            >
                              {t(l, 'send')}
                            </button>
                          </form>
                        </details>
                      )}
                    </article>
                  );
                },
              )}
            </div>
            {role === 'MERCHANT' && dashboard && (
              <section className="form-card top-space" id="billing">
                <h2>{t(l, 'billing')}</h2>
                <p>{t(l, 'feeHelp')}</p>
                <div className="button-row">
                  <label className="field">
                    {t(l, 'plan')}
                    <select
                      value={dashboard.stores[0]?.plan ?? 'STANDARD'}
                      disabled={busy}
                      onChange={(e) =>
                        task(
                          () => api('merchant/billing/plan-changes', { plan: e.target.value }),
                          t(l, 'saved'),
                        )
                      }
                    >
                      <option value="TRIAL">TRIAL · 0%</option>
                      <option value="STANDARD">STANDARD · 10%</option>
                      <option value="ANNUAL">ANNUAL · 5% · ¥100,000 / year (demo)</option>
                    </select>
                  </label>
                  <strong className="large-amount">
                    {money(
                      l,
                      dashboard.feeEntries.reduce((sum, x) => sum + x.amount, 0),
                    )}
                  </strong>
                </div>
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{t(l, 'orders')}</th>
                        <th>{t(l, 'billing')}</th>
                        <th>JPY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.feeEntries.map((x) => (
                        <tr key={x.id}>
                          <td>{x.bookingId.slice(-8)}</td>
                          <td>{x.type}</td>
                          <td>{money(l, x.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {role === 'ADMIN' && dashboard && (
              <>
                <section className="form-card top-space" id="moderation">
                  <h2>{t(l, 'moderation')}</h2>
                  <div className="moderation-list">
                    {dashboard.listings.map((x) => (
                      <div key={x.id}>
                        <span>
                          <strong>{x.name[l]}</strong>
                          <small>{x.publicationStatus}</small>
                        </span>
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() =>
                            task(
                              () =>
                                api('admin/enforcement-actions', {
                                  listingId: x.id,
                                  suspend: x.publicationStatus !== 'SUSPENDED',
                                  reason:
                                    x.publicationStatus === 'SUSPENDED'
                                      ? 'Demo manual review completed'
                                      : 'Demo content safety review',
                                }),
                              t(l, 'saved'),
                            )
                          }
                        >
                          {t(l, x.publicationStatus === 'SUSPENDED' ? 'restore' : 'suspend')}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="form-card top-space">
                  <h2>{t(l, 'safetyQueue')}</h2>
                  <p className="notice">{t(l, 'supportText')}</p>
                  {dashboard.safety.map((x) => (
                    <div className="audit-row" key={x.id}>
                      <ShieldAlert size={17} />
                      <strong>{x.type}</strong>
                      <span>
                        {x.bookingId.slice(-8)} · {dateTime(l, x.createdAt)}
                      </span>
                    </div>
                  ))}
                </section>
                <section className="form-card top-space" id="audit">
                  <h2>{t(l, 'audit')}</h2>
                  <div className="audit-list">
                    {dashboard.audit.map((x) => (
                      <div className="audit-row" key={x.id}>
                        <span>{dateTime(l, x.at)}</span>
                        <strong>{x.action}</strong>
                        <span>
                          {x.actorId} {x.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
            <p className="notice top-space">
              <ShieldCheck size={18} />
              {t(l, 'supportText')}
            </p>
          </>
        )}
      </div>
      <MobileSheet
        className="merchant-dialog"
        open={!!confirmAction}
        onClose={() => {
          if (!busy) setConfirmAction(null);
        }}
        title={confirmAction?.operation === 'refunds' ? st(l, 'refund') : t(l, 'cancel')}
        locale={l}
      >
        {confirmAction && (
          <form
            key={`${confirmAction.booking.id}:${confirmAction.operation}`}
            onSubmit={async (e) => {
              e.preventDefault();
              const amount = Number(new FormData(e.currentTarget).get('amount'));
              const ok = await task(
                action(
                  confirmAction.booking,
                  confirmAction.operation,
                  confirmAction.operation === 'refunds' ? { amount } : {},
                ),
                st(l, 'saved'),
              );
              if (ok) setConfirmAction(null);
            }}
          >
            <fieldset disabled={busy}>
              <h3>
                {confirmAction.booking.id.slice(-8).toUpperCase()} ·{' '}
                {money(l, confirmAction.booking.quote.total)}
              </h3>
              <p>{st(l, confirmAction.operation === 'refunds' ? 'refundHelp' : 'cancelHelp')}</p>
              {confirmAction.operation === 'refunds' && (
                <label className="field">
                  {st(l, 'refundAmount')}
                  <input
                    type="number"
                    name="amount"
                    inputMode="numeric"
                    required
                    min={1}
                    max={
                      confirmAction.booking.capturedAmount - confirmAction.booking.refundedAmount
                    }
                    step={1}
                    defaultValue={
                      confirmAction.booking.capturedAmount - confirmAction.booking.refundedAmount
                    }
                  />
                </label>
              )}
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              <div className="merchant-dialog-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setConfirmAction(null)}
                >
                  {st(l, 'cancel')}
                </button>
                <button className="button">
                  {busy ? <LoaderCircle className="spin" size={17} /> : st(l, 'confirm')}
                </button>
              </div>
            </fieldset>
          </form>
        )}
      </MobileSheet>
    </div>
  );
}
