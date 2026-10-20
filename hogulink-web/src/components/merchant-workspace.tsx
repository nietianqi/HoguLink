'use client';
import { rt } from '@/lib/runtime-i18n';
import { useDemoAccess } from '@/lib/use-runtime';
import { FinanceCenter } from './finance-center';
import { pt } from '@/lib/subscription-i18n';
import { AcceptanceSettings } from './acceptance-settings';
import { BookingRulesSettings } from './booking-rules-settings';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  LayoutDashboard,
  Leaf,
  LifeBuoy,
  ListChecks,
  LoaderCircle,
  Plus,
  ReceiptText,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Store as StoreIcon,
  UsersRound,
  X,
} from 'lucide-react';
import type {
  Actor,
  Booking,
  Listing,
  Locale,
  Offering,
  Store,
  SupportTicket,
  TimeOffRequest,
  AcceptanceRule,
  StoreBookingRules,
  BookingRulesHistory,
} from '@hogulink/contracts';
import { ft } from '@/lib/staff-i18n';
import { api, ClientError } from '@/lib/api';
import { areaName, dateTime, errorText, languageNames, money, statusText, t } from '@/lib/i18n';
import { acceptanceHelp, acceptanceLabel } from '@/lib/visit-i18n';
import { st, merchantTabs, type MerchantTab } from '@/lib/merchant-i18n';
import { xt } from '@/lib/exception-i18n';
import { csvCell, japanDay } from '@/lib/desktop-model';
import {
  japanInput,
  merchantNumbers,
  merchantTrend,
  parseJapanInput,
  type FeeEntry,
} from '@/lib/merchant-model';
import { useSession } from './booking-form';
import { MobileSheet } from './mobile-ui';
import { Operations } from './operations';
import { PartnerEntry } from './partner-portal';
import { QualityEntry, SafetyDeskPanel } from './quality-workspace';
import { merchantWorkday } from '@/lib/workday-model';
import { wt } from '@/lib/workday-i18n';
import { WorkdayTools } from './workday-tools';
import { MerchantPromotion } from './merchant-promotion';

type Block = {
  id: string;
  listingId: string;
  staffId: string;
  storeId: string;
  startAt: number;
  endAt: number;
  reason: 'BREAK' | 'TIME_OFF' | 'TRAINING';
  version: number;
  active: boolean;
};
type Workspace = {
  billingRates: Record<Store['plan'], number>;
  store: Omit<Store, 'pspAccount'>;
  listings: Listing[];
  offerings: Offering[];
  blocks: Block[];
  timeOffRequests: TimeOffRequest[];
  acceptanceHistory: AcceptanceRule[];
  bookingRules: StoreBookingRules;
  bookingRulesHistory: BookingRulesHistory[];
  feeEntries: FeeEntry[];
  totals: { captured: number; refunded: number; net: number; platform: number; afterFees: number };
};
const icons = {
  overview: LayoutDashboard,
  bookings: ListChecks,
  schedule: CalendarDays,
  team: UsersRound,
  services: SlidersHorizontal,
  finance: ReceiptText,
  settings: Settings2,
};
export function MerchantWorkspace({ locale: l }: { locale: Locale }) {
  const query = useSearchParams(),
    requested = query.get('tab') as MerchantTab;
  const tab = merchantTabs.includes(requested) ? requested : 'overview';
  const { actor, setActor, loading } = useSession();
  const demoAccess = useDemoAccess();
  const [demoShops, setDemoShops] = useState<Pick<Store, 'id' | 'name'>[]>([]),
    [data, setData] = useState<Workspace>(),
    [bookings, setBookings] = useState<Booking[]>([]),
    [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [shop, setShop] = useState('store-nagi'),
    [busy, setBusy] = useState(false),
    [fetching, setFetching] = useState(false),
    [error, setError] = useState(''),
    [readError, setReadError] = useState(''),
    [notice, setNotice] = useState('');
  const [day, setDay] = useState(japanDay(Date.now())),
    [member, setMember] = useState('');
  const [editor, setEditor] = useState<Offering | null>(null),
    [blockOpen, setBlockOpen] = useState(false);
  const [blockDraft, setBlockDraft] = useState({
    listingId: '',
    start: '',
    end: '',
    reason: 'BREAK',
  });
  const requestKey = useRef(''),
    generation = useRef(0);
  const hasRole = actor?.role === 'MERCHANT';
  const href = (view: MerchantTab, booking?: string) =>
    `/${l}/merchant?${new URLSearchParams({ tab: view, ...(booking ? { booking } : {}) })}`;
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    if (actor?.role !== 'MERCHANT') return;
    setFetching(true);
    try {
      const [workspace, orders, cases] = await Promise.all([
        api<Workspace>('merchant/workspace'),
        api<Booking[]>('bookings'),
        api<SupportTicket[]>('support-tickets'),
      ]);
      if (version !== generation.current) return;
      setData(workspace);
      setBookings(orders);
      setTickets(cases);
      setShop(workspace.store.id);
      setReadError('');
    } catch (e) {
      if (version === generation.current) {
        setReadError(errorText(l, e instanceof ClientError ? e.code : undefined));
        if (e instanceof ClientError && ['FORBIDDEN', 'UNAUTHENTICATED'].includes(e.code)) {
          setData(undefined);
          setBookings([]);
          setTickets([]);
        }
      }
    } finally {
      if (version === generation.current) setFetching(false);
    }
  }, [actor, l]);
  useEffect(() => {
    if (demoAccess)
      api<Pick<Store, 'id' | 'name'>[]>('auth/demo-shops')
        .then(setDemoShops)
        .catch(() => {});
  }, [l, demoAccess]);
  const requestedMember = query.get('member') ?? '';
  useEffect(() => {
    setData(undefined);
    setBookings([]);
    setTickets([]);
    setReadError('');
    setMember(requestedMember);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh, tab, requestedMember]);
  useEffect(() => {
    const changed = () => void refresh();
    window.addEventListener('hogulink-billing-changed', changed);
    return () => window.removeEventListener('hogulink-billing-changed', changed);
  }, [refresh]);
  async function login(storeId = shop) {
    generation.current++;
    setData(undefined);
    setBookings([]);
    setTickets([]);
    setBusy(true);
    setError('');
    setNotice('');
    setEditor(null);
    setBlockOpen(false);
    try {
      setActor(await api<Actor>('auth/demo', { role: 'MERCHANT', storeId }));
    } catch (e) {
      setError(errorText(l, e instanceof ClientError ? e.code : undefined));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await refresh();
      setNotice(st(l, 'saved'));
      return true;
    } catch (e) {
      setError(
        e instanceof ClientError && e.code === 'VERSION_CONFLICT'
          ? st(l, 'conflict')
          : errorText(l, e instanceof ClientError ? e.code : undefined),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const stats = { ...merchantNumbers(bookings, data?.feeEntries ?? []), ...data?.totals },
    trend = merchantTrend(bookings),
    peak = Math.max(1, ...trend.map((x) => x.count));
  const { attention, waitingStaff, waitingCustomer } = merchantWorkday(bookings);
  const upcoming = bookings
    .filter(
      (b) =>
        !['CANCELLED', 'EXPIRED', 'REJECTED', 'COMPLETED'].includes(b.status) &&
        b.quote.endAt > Date.now(),
    )
    .sort((a, b) => a.quote.startAt - b.quote.startAt);
  const openCases = tickets.filter((x) => !['RESOLVED', 'CLOSED'].includes(x.status)).length;
  const pendingLeaveCount = data?.timeOffRequests.filter((r) => r.status === 'PENDING').length ?? 0;
  const hasWork = attention.length + openCases + pendingLeaveCount > 0;
  const currentMember = data?.listings.some((x) => x.id === member) ? member : '';
  function openBlock(listingId = currentMember || data?.listings[0]?.id || '') {
    const start = Math.max(
      Date.parse(`${day}T09:00:00+09:00`),
      Math.ceil((Date.now() + 60_000) / 900_000) * 900_000,
    );
    setBlockDraft({
      listingId,
      start: japanInput(start),
      end: japanInput(start + 3600_000),
      reason: 'BREAK',
    });
    requestKey.current = crypto.randomUUID();
    setError('');
    setBlockOpen(true);
  }
  function exportFees() {
    const rows = [
      ['Reference', 'Type', 'Amount JPY', 'Date JST'],
      ...(data?.feeEntries ?? []).map((f) => [
        f.bookingId.slice(-8),
        f.type,
        f.amount,
        f.createdAt ? japanInput(f.createdAt).replace('T', ' ') : '',
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(['\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `HoguLink-fees-${japanDay(Date.now())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function orderRows(items: Booking[], limit = 4) {
    return items.length ? (
      <div className="merchant-upcoming">
        {items.slice(0, limit).map((b) => (
          <Link href={href('bookings', b.id)} key={b.id}>
            <time>
              <strong>
                {new Intl.DateTimeFormat(l, {
                  timeZone: 'Asia/Tokyo',
                  hour: '2-digit',
                  minute: '2-digit',
                  hourCycle: 'h23',
                }).format(b.quote.startAt)}
              </strong>
              <span>{japanDay(b.quote.startAt).slice(5)}</span>
            </time>
            <span>
              <strong>
                {data?.listings.find((x) => x.id === b.assignedListingId)?.name[l] ??
                  t(l, 'unassigned')}
              </strong>
              <small>
                {b.id.slice(-8).toUpperCase()} · {areaName(l, b.quote.area)}
              </small>
            </span>
            <span className={`status-badge status-${b.status.toLowerCase()}`}>
              {statusText(l, b.status)}
            </span>
            <ArrowUpRight size={17} />
          </Link>
        ))}
      </div>
    ) : (
      <div className="merchant-empty">
        <CalendarDays size={25} />
        <p>{st(l, 'empty')}</p>
      </div>
    );
  }
  return (
    <div className="merchant-layout workday-merchant" data-tab={tab}>
      <aside className="merchant-sidebar">
        <Link className="merchant-wordmark" href={href('overview')}>
          <span>
            <Leaf size={22} />
          </span>
          <strong>
            HoguLink<small>BUSINESS</small>
          </strong>
        </Link>
        <div className="merchant-shop-stamp">
          <StoreIcon size={18} />
          <span>
            {data?.store.name[l] ?? t(l, 'merchant')}
            <small>TOKYO / JAPAN</small>
          </span>
        </div>
        <nav aria-label={t(l, 'merchant')}>
          {merchantTabs.map((key) => {
            const Icon = icons[key];
            return (
              <Link key={key} href={href(key)} aria-current={key === tab ? 'page' : undefined}>
                <Icon size={18} />
                {st(l, key)}
                {key === 'bookings' && attention.length > 0 && <span>{attention.length}</span>}
              </Link>
            );
          })}
          <Link href={`/${l}/merchant/support`}>
            <LifeBuoy size={18} />
            {st(l, 'support')}
            {openCases > 0 && <span>{openCases}</span>}
          </Link>
        </nav>
        <div className="merchant-sidebar-note">
          <ShieldCheck size={20} />
          <p>{t(l, 'demo')}</p>
          <Link href={`/${l}`}>
            {t(l, 'explore')}
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </aside>
      <div className="merchant-content">
        {hasRole && (
          <SafetyDeskPanel
            key={`${actor.id}:${actor.storeId}`}
            locale={l}
            role="MERCHANT"
            urgentOnly
          />
        )}
        <header className="merchant-heading">
          <div>
            <span className="eyebrow small">HOGULINK BUSINESS / TOKYO</span>
            <h1>{st(l, tab)}</h1>
            <p>
              {tab === 'overview'
                ? st(l, 'intro')
                : tab === 'schedule'
                  ? st(l, 'calendarHelp')
                  : tab === 'services'
                    ? st(l, 'serviceHelp')
                    : tab === 'team'
                      ? st(l, 'teamHelp')
                      : tab === 'finance'
                        ? st(l, 'financeHelp')
                        : tab === 'settings'
                          ? st(l, 'rulesHelp')
                          : st(l, 'bookingsHelp')}
            </p>
          </div>
          <div className="merchant-heading-actions">
            {data && (
              <Link className="button secondary small" href={`/${l}/shops/${data.store.slug}`}>
                <ArrowUpRight size={15} />
                {st(l, 'preview')}
              </Link>
            )}
            <button
              className="merchant-icon-button"
              onClick={() => {
                setError('');
                void refresh();
              }}
              disabled={busy || fetching || !hasRole}
              aria-label={t(l, 'refresh')}
            >
              <RefreshCw size={18} className={fetching ? 'spin' : ''} />
            </button>
          </div>
        </header>
        <details className="workday-account-switch" open={!hasRole}>
          <summary>{data?.store.name[l] ?? wt(l, 'switchIdentity')}</summary>
          <div className="merchant-account">
            <span className="merchant-account-icon">
              <StoreIcon size={21} />
            </span>
            <div>
              <strong>
                {data?.store.name[l] ??
                  (hasRole
                    ? (data?.store.name[l] ??
                      demoShops.find((s) => s.id === actor?.storeId)?.name[l] ??
                      st(l, 'loading'))
                    : t(l, 'loginRequired'))}
              </strong>
              <small>
                {data
                  ? `${acceptanceLabel(l, data.store.acceptanceMode)} · ${data.store.areas.length} ${t(l, 'area')}`
                  : t(l, 'signInHelp')}
              </small>
            </div>
            <label hidden={!!actor?.partnerAccountId || !demoAccess}>
              <span className="sr-only">{st(l, 'selectShop')}</span>
              <select
                aria-label={st(l, 'selectShop')}
                value={shop}
                disabled={busy || fetching}
                onChange={(e) => {
                  setShop(e.target.value);
                  if (hasRole) void login(e.target.value);
                }}
              >
                {demoShops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name[l]}
                  </option>
                ))}
              </select>
            </label>
            {!hasRole && demoAccess && (
              <button
                className="button small"
                disabled={loading || busy || !demoShops.length}
                onClick={() => void login()}
              >
                {st(l, 'enter')}
                <ArrowRight size={15} />
              </button>
            )}
            {!hasRole && (
              <Link className="button secondary small" href={`/${l}/onboarding?role=MERCHANT`}>
                {rt(l, 'partnerLogin')}
              </Link>
            )}
          </div>
        </details>
        {(error || readError) && !editor && !blockOpen && (
          <p className="error-message" role="alert">
            {error || readError}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setError('');
                void refresh();
              }}
            >
              {t(l, 'refresh')}
            </button>
          </p>
        )}
        {notice && (
          <p className="merchant-saved" role="status">
            <Check size={16} />
            {notice}
          </p>
        )}
        {hasRole && !data && fetching && (
          <div className="merchant-loading" role="status">
            <LoaderCircle className="spin" size={24} />
            {st(l, 'loading')}
          </div>
        )}
        {data && hasRole && (
          <>
            {data.store.billingBlocked && tab !== 'finance' && (
              <div className="finance-billing-link restricted">
                <div>
                  <strong>{pt(l, 'restricted')}</strong>
                  <p>{pt(l, 'preservation')}</p>
                </div>
                <Link
                  className="button secondary small"
                  href={`/${l}/merchant?tab=finance&section=plans`}
                >
                  {pt(l, 'title')}
                </Link>
              </div>
            )}
            {tab === 'overview' && (
              <>
                <section className="workday-action-center" aria-label={wt(l, 'actions')}>
                  <div className="workday-focus-heading">
                    <span>{wt(l, 'overview')}</span>
                    <span>JST</span>
                  </div>
                  <h2>{hasWork ? wt(l, 'actions') : wt(l, 'allClear')}</h2>
                  <p>{wt(l, hasWork ? 'actionHelp' : 'noActionHelp')}</p>
                  <div className="workday-counts">
                    <Link href={href('bookings', attention[0]?.id)}>
                      <strong>{attention.length}</strong>
                      <span>{st(l, 'attention')}</span>
                    </Link>
                    <Link href={href('bookings', waitingStaff[0]?.id)}>
                      <strong>{waitingStaff.length}</strong>
                      <span>{wt(l, 'waitingStaff')}</span>
                    </Link>
                    <Link href={`/${l}/merchant/support`}>
                      <strong>{openCases}</strong>
                      <span>{st(l, 'support')}</span>
                    </Link>
                    <Link href={href('schedule')}>
                      <strong>
                        {data.timeOffRequests.filter((r) => r.status === 'PENDING').length}
                      </strong>
                      <span>{wt(l, 'waitingLeave')}</span>
                    </Link>
                  </div>
                  {attention.length > 0 && orderRows(attention, 2)}
                  {!attention.length && waitingStaff.length > 0 && orderRows(waitingStaff, 1)}
                  {waitingCustomer.length > 0 && (
                    <div className="workday-waiting">
                      <span>
                        {wt(l, 'waitingCustomer')} · {waitingCustomer.length}
                      </span>
                      {orderRows(waitingCustomer, 1)}
                    </div>
                  )}
                </section>
                <WorkdayTools
                  locale={l}
                  items={[
                    { href: href('bookings'), label: st(l, 'bookings'), icon: ListChecks },
                    { href: href('schedule'), label: st(l, 'schedule'), icon: CalendarDays },
                    { href: href('finance'), label: st(l, 'finance'), icon: ReceiptText },
                    {
                      href: `/${l}/merchant/support`,
                      label: st(l, 'support'),
                      icon: LifeBuoy,
                      count: openCases,
                    },
                  ]}
                />
                <div className="merchant-metrics">
                  {[
                    [CalendarDays, st(l, 'today'), stats.today, 'JST'],
                    [Clock3, st(l, 'attention'), attention.length, st(l, 'bookings')],
                    [
                      UsersRound,
                      st(l, 'teamReady'),
                      data.listings.filter(
                        (x) =>
                          x.publicationStatus === 'PUBLISHED_INDEXABLE' &&
                          x.membershipActive &&
                          x.identityVerified &&
                          x.portraitConsent,
                      ).length,
                      st(l, 'team'),
                    ],
                    [ReceiptText, st(l, 'net'), money(l, stats.net), st(l, 'allTime')],
                  ].map(([Icon, label, value, note], i) => {
                    const MetricIcon = Icon as typeof CalendarDays;
                    return (
                      <div key={i}>
                        <span>
                          {String(label)}
                          <MetricIcon size={17} />
                        </span>
                        <strong>{String(value)}</strong>
                        <small>{String(note)}</small>
                      </div>
                    );
                  })}
                </div>
                <div className="merchant-overview-grid">
                  <section className="merchant-panel">
                    <div className="merchant-panel-heading">
                      <h2>{st(l, 'activity')}</h2>
                      <span>
                        {trend.reduce((n, x) => n + x.count, 0)} {st(l, 'total')}
                      </span>
                    </div>
                    <div
                      className="merchant-chart"
                      role="img"
                      aria-label={trend.map((x) => `${x.day}: ${x.count}`).join('; ')}
                    >
                      {trend.map((x) => (
                        <div key={x.day}>
                          <strong>{x.count}</strong>
                          <div className="merchant-chart-track">
                            <span style={{ height: `${(x.count / peak) * 100}%` }} />
                          </div>
                          <time>{x.day.slice(5).replace('-', '/')}</time>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="merchant-panel">
                    <div className="merchant-panel-heading">
                      <h2>{st(l, 'attention')}</h2>
                      <Link href={href('bookings')}>
                        {st(l, 'manage')}
                        <ArrowUpRight size={16} />
                      </Link>
                    </div>
                    {orderRows(attention, 3)}
                    <Link className="merchant-support-link" href={`/${l}/merchant/support`}>
                      <LifeBuoy size={19} />
                      <span>
                        {st(l, 'support')}
                        <small>
                          {openCases}{' '}
                          {l === 'ja' ? '件の対応中' : l === 'en' ? 'open cases' : '个待处理工单'}
                        </small>
                      </span>
                      <ArrowUpRight size={16} />
                    </Link>
                  </section>
                  <section className="merchant-panel merchant-wide">
                    <div className="merchant-panel-heading">
                      <h2>{st(l, 'upcoming')}</h2>
                      <Link href={href('bookings')}>
                        {st(l, 'bookings')}
                        <ArrowUpRight size={16} />
                      </Link>
                    </div>
                    {orderRows(upcoming, 5)}
                  </section>
                </div>
              </>
            )}
            {tab === 'bookings' && (
              <Operations
                locale={l}
                role="MERCHANT"
                embedded
                initialSelected={query.get('booking') ?? undefined}
                key={`${actor?.id}:${actor?.storeId}:${query.get('booking') ?? ''}`}
              />
            )}
            {tab === 'schedule' && (
              <>
                {data.timeOffRequests.some((r) => r.status === 'PENDING') && (
                  <section className="merchant-panel" style={{ marginBottom: 24 }}>
                    <div className="merchant-panel-heading">
                      <h2>{ft(l, 'requests')}</h2>
                      <span>
                        {data.timeOffRequests.filter((r) => r.status === 'PENDING').length}
                      </span>
                    </div>
                    <p className="merchant-panel-copy">{ft(l, 'approvalHelp')}</p>
                    <div className="staff-merchant-requests">
                      {data.timeOffRequests
                        .filter(
                          (r) =>
                            r.status === 'PENDING' &&
                            (!currentMember || r.listingId === currentMember),
                        )
                        .map((r) => (
                          <article key={r.id}>
                            <div>
                              <strong>
                                {data.listings.find((x) => x.id === r.listingId)?.name[l]} ·{' '}
                                {ft(l, r.reason)}
                              </strong>
                              <p>
                                {dateTime(l, r.startAt)} — {dateTime(l, r.endAt)} JST
                              </p>
                            </div>
                            <div className="staff-action-row">
                              <button
                                className="button secondary small"
                                disabled={busy}
                                onClick={() =>
                                  mutate(() =>
                                    api(
                                      `merchant/time-off-requests/${r.id}`,
                                      { version: r.version, decision: 'REJECTED' },
                                      'PUT',
                                    ),
                                  )
                                }
                              >
                                {ft(l, 'reject')}
                              </button>
                              <button
                                className="button small"
                                disabled={busy || r.startAt <= Date.now()}
                                onClick={() =>
                                  mutate(() =>
                                    api(
                                      `merchant/time-off-requests/${r.id}`,
                                      { version: r.version, decision: 'APPROVED' },
                                      'PUT',
                                    ),
                                  )
                                }
                              >
                                {ft(l, 'approve')}
                              </button>
                            </div>
                          </article>
                        ))}
                    </div>
                  </section>
                )}
                <div className="merchant-calendar-toolbar">
                  <div className="merchant-date-switch">
                    <button
                      className="merchant-icon-button"
                      aria-label={l === 'ja' ? '前日' : l === 'en' ? 'Previous day' : '前一天'}
                      onClick={() =>
                        setDay(japanDay(Date.parse(day + 'T12:00:00+09:00') - 86400_000))
                      }
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <input
                      type="date"
                      aria-label={st(l, 'schedule')}
                      value={day}
                      onChange={(e) => {
                        if (e.target.value) setDay(e.target.value);
                      }}
                    />
                    <button
                      className="merchant-icon-button"
                      aria-label={l === 'ja' ? '翌日' : l === 'en' ? 'Next day' : '后一天'}
                      onClick={() =>
                        setDay(japanDay(Date.parse(day + 'T12:00:00+09:00') + 86400_000))
                      }
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                  <select
                    value={currentMember}
                    onChange={(e) => setMember(e.target.value)}
                    aria-label={st(l, 'member')}
                  >
                    <option value="">{t(l, 'all')}</option>
                    {data.listings.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name[l]}
                      </option>
                    ))}
                  </select>
                  <button className="button" onClick={() => openBlock()}>
                    <Plus size={17} />
                    {st(l, 'addBlock')}
                  </button>
                </div>
                <TeamCalendar
                  locale={l}
                  day={day}
                  listings={data.listings.filter((x) => !currentMember || x.id === currentMember)}
                  blocks={data.blocks}
                  bookings={bookings}
                  href={(id) => href('bookings', id)}
                />
                <section className="merchant-panel top-space">
                  <div className="merchant-panel-heading">
                    <h2>{st(l, 'blocks')}</h2>
                    <span>JST</span>
                  </div>
                  <p className="merchant-panel-copy">{st(l, 'blockHelp')}</p>
                  {data.blocks.length ? (
                    <div className="merchant-block-list">
                      {data.blocks.map((b) => (
                        <div key={b.id}>
                          <span className="merchant-block-symbol">
                            <Clock3 size={18} />
                          </span>
                          <div>
                            <strong>
                              {data.listings.find((x) => x.id === b.listingId)?.name[l]} ·{' '}
                              {st(l, b.reason)}
                            </strong>
                            <p>
                              {dateTime(l, b.startAt)} — {dateTime(l, b.endAt)} JST
                            </p>
                          </div>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void mutate(() =>
                                api(
                                  `merchant/time-blocks/${b.id}`,
                                  { version: b.version },
                                  'DELETE',
                                ),
                              )
                            }
                          >
                            {st(l, 'release')}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="merchant-empty-text">{st(l, 'noBlocks')}</p>
                  )}
                </section>
              </>
            )}
            {tab === 'team' && (
              <div className="merchant-team-grid">
                {data.listings.map((x) => {
                  const eligible =
                    x.membershipActive &&
                    x.identityVerified &&
                    x.portraitConsent &&
                    x.publicationStatus === 'PUBLISHED_INDEXABLE';
                  return (
                    <article className="merchant-team-card" key={x.id}>
                      <div className="merchant-team-title">
                        <img src={x.photo} alt="" width={64} height={72} />
                        <div>
                          <h2>{x.name[l]}</h2>
                          <p>{x.languages.map((v) => languageNames[v]).join(' · ')}</p>
                          <span className="merchant-pill">
                            {st(
                              l,
                              x.onDuty && Date.now() - x.dutyUpdatedAt < 4 * 3600_000
                                ? 'standby'
                                : 'scheduled',
                            )}
                          </span>
                        </div>
                      </div>
                      <p className={eligible ? 'merchant-eligible' : 'merchant-warning'}>
                        <ShieldCheck size={16} />
                        {st(l, eligible ? 'eligible' : 'notEligible')}
                      </p>
                      <div className="merchant-checks">
                        {[
                          [st(l, 'identity'), x.identityVerified],
                          [st(l, 'consent'), x.portraitConsent],
                          [st(l, 'membership'), x.membershipActive],
                        ].map(([label, ok]) => (
                          <span key={String(label)}>
                            {ok ? <Check size={14} /> : <X size={14} />} {String(label)}
                          </span>
                        ))}
                      </div>
                      <p className="merchant-team-services">
                        {data.offerings
                          .filter((o) => x.offeringIds.includes(o.id))
                          .map((o) => `${o.durationMinutes} ${t(l, 'minutes')}`)
                          .join(' / ')}
                      </p>
                      <Link
                        className="button secondary full"
                        href={`${href('schedule')}&member=${encodeURIComponent(x.id)}`}
                      >
                        {st(l, 'schedule')}
                        <ArrowUpRight size={15} />
                      </Link>
                    </article>
                  );
                })}
              </div>
            )}
            {tab === 'services' && (
              <section className="merchant-panel">
                <div className="merchant-panel-heading">
                  <h2>{st(l, 'services')}</h2>
                  <span>
                    {data.offerings.length} {st(l, 'total')}
                  </span>
                </div>
                <div className="merchant-service-list">
                  {data.offerings.map((o) => (
                    <article key={o.id}>
                      <span className="merchant-duration">
                        {o.durationMinutes}
                        <small>{t(l, 'minutes')}</small>
                      </span>
                      <div>
                        <h2>{o.name[l]}</h2>
                        <p>
                          {st(l, 'travel')} {money(l, o.transportFee)} · v{o.version}
                        </p>
                        <span className={`merchant-pill ${o.active === false ? 'muted' : ''}`}>
                          {st(l, o.active === false ? 'paused' : 'live')}
                        </span>
                        <MerchantPromotion
                          locale={l}
                          offering={o}
                          disabled={busy}
                          onChanged={() => mutate(async () => {})}
                        />
                      </div>
                      <strong>{money(l, o.price)}</strong>
                      <button
                        className="button secondary small"
                        disabled={busy || !o.approved || o.regulatoryCategory !== 'RELAXATION'}
                        onClick={() => {
                          setError('');
                          setEditor(o);
                        }}
                      >
                        {st(l, 'edit')}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {tab === 'finance' && (
              <>
                {actor && (
                  <FinanceCenter
                    key={`${actor.id}:${actor.storeId}`}
                    locale={l}
                    actor={actor}
                    initialBookingId={query.get('booking') ?? ''}
                    initialMonth={query.get('month') ?? undefined}
                    initialSection={query.get('section') ?? undefined}
                    initialInvoiceSource={query.get('invoiceSource') ?? undefined}
                  />
                )}
              </>
            )}
            {tab === 'settings' && (
              <div className="merchant-settings-grid">
                <div className="merchant-settings-stack">
                  <BookingRulesSettings
                    key={`${data.store.id}:prices:${data.bookingRules.version}`}
                    rules={data.bookingRules}
                    history={data.bookingRulesHistory ?? []}
                    locale={l}
                    busy={busy}
                    onSave={(input) => mutate(() => api('merchant/booking-rules', input, 'PUT'))}
                  />
                  <section className="merchant-panel">
                    <div className="merchant-panel-heading">
                      <h2>{st(l, 'shopInfo')}</h2>
                      <ShieldCheck size={19} />
                    </div>
                    <dl className="merchant-business-info">
                      <div>
                        <dt>{t(l, 'shop')}</dt>
                        <dd>{data.store.name[l]}</dd>
                      </div>
                      <div>
                        <dt>{t(l, 'legal')}</dt>
                        <dd>{data.store.legalName}</dd>
                      </div>
                      <div>
                        <dt>{t(l, 'address')}</dt>
                        <dd>{data.store.legalAddress}</dd>
                      </div>
                      <div>
                        <dt>{t(l, 'coverage')}</dt>
                        <dd>{data.store.areas.map((a) => areaName(l, a)).join(' · ')}</dd>
                      </div>
                    </dl>
                  </section>
                </div>
                <AcceptanceSettings
                  key={`${data.store.id}:${data.store.ruleVersion}`}
                  store={data.store}
                  offerings={data.offerings}
                  listings={data.listings}
                  history={data.acceptanceHistory ?? []}
                  locale={l}
                  busy={busy}
                  onSave={(input) => mutate(() => api('merchant/settings', input, 'PUT'))}
                />
              </div>
            )}
          </>
        )}
        <details className="workday-resources">
          <summary>{wt(l, 'resources')}</summary>
          <PartnerEntry locale={l} role="MERCHANT" />
          <QualityEntry locale={l} role="MERCHANT" />
        </details>
      </div>
      <MobileSheet
        className="merchant-dialog"
        open={!!editor}
        onClose={() => {
          if (!busy) setEditor(null);
        }}
        locale={l}
        title={st(l, 'services')}
      >
        {editor && (
          <form
            key={`${editor.id}:${editor.version}`}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await mutate(() =>
                  api(
                    `merchant/services/${editor.id}`,
                    {
                      version: editor.version,
                      price: Number(f.get('price')),
                      transportFee: Number(f.get('travel')),
                      active: f.has('active'),
                    },
                    'PUT',
                  ),
                )
              )
                setEditor(null);
            }}
          >
            <fieldset disabled={busy}>
              <h3>
                {editor.name[l]} · {editor.durationMinutes} {t(l, 'minutes')}
              </h3>
              <p>{st(l, 'serviceHelp')}</p>
              <label className="field">
                {st(l, 'price')}
                <input
                  name="price"
                  type="number"
                  inputMode="numeric"
                  min={1000}
                  max={200000}
                  step={1}
                  defaultValue={editor.price}
                  required
                />
              </label>
              <label className="field">
                {st(l, 'travel')}
                <input
                  name="travel"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20000}
                  step={1}
                  defaultValue={editor.transportFee}
                  required
                />
              </label>
              <label className="checkbox">
                <input type="checkbox" name="active" defaultChecked={editor.active !== false} />
                <span>{st(l, 'bookable')}</span>
              </label>
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              <div className="merchant-dialog-actions">
                <button type="button" className="button secondary" onClick={() => setEditor(null)}>
                  {st(l, 'cancel')}
                </button>
                <button className="button">
                  {busy ? <LoaderCircle size={17} className="spin" /> : st(l, 'save')}
                </button>
              </div>
            </fieldset>
          </form>
        )}
      </MobileSheet>
      <MobileSheet
        className="merchant-dialog"
        open={blockOpen}
        onClose={() => {
          if (!busy) setBlockOpen(false);
        }}
        locale={l}
        title={st(l, 'addBlock')}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const startAt = parseJapanInput(blockDraft.start),
              endAt = parseJapanInput(blockDraft.end);
            if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
              setError(t(l, 'INVALID_TIME'));
              return;
            }
            if (
              await mutate(() =>
                api(
                  'merchant/time-blocks',
                  { listingId: blockDraft.listingId, startAt, endAt, reason: blockDraft.reason },
                  'POST',
                  requestKey.current,
                ),
              )
            )
              setBlockOpen(false);
          }}
        >
          <fieldset disabled={busy}>
            <p>{st(l, 'blockHelp')}</p>
            <label className="field">
              {st(l, 'member')}
              <select
                value={blockDraft.listingId}
                onChange={(e) => {
                  setBlockDraft({ ...blockDraft, listingId: e.target.value });
                  requestKey.current = crypto.randomUUID();
                }}
              >
                {data?.listings
                  .filter((x) => x.membershipActive)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name[l]}
                    </option>
                  ))}
              </select>
            </label>
            {(['start', 'end'] as const).map((key) => (
              <label className="field" key={key}>
                {st(l, key)}
                <input
                  type="datetime-local"
                  required
                  value={blockDraft[key]}
                  onChange={(e) => {
                    setBlockDraft({ ...blockDraft, [key]: e.target.value });
                    requestKey.current = crypto.randomUUID();
                  }}
                />
              </label>
            ))}
            <label className="field">
              {st(l, 'reason')}
              <select
                value={blockDraft.reason}
                onChange={(e) => {
                  setBlockDraft({ ...blockDraft, reason: e.target.value });
                  requestKey.current = crypto.randomUUID();
                }}
              >
                {(['BREAK', 'TIME_OFF', 'TRAINING'] as const).map((r) => (
                  <option key={r} value={r}>
                    {st(l, r)}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <div className="merchant-dialog-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setBlockOpen(false)}
              >
                {st(l, 'cancel')}
              </button>
              <button className="button">
                {busy ? <LoaderCircle size={17} className="spin" /> : st(l, 'save')}
              </button>
            </div>
          </fieldset>
        </form>
      </MobileSheet>
    </div>
  );
}

function TeamCalendar({
  locale: l,
  day,
  listings,
  blocks,
  bookings,
  href,
}: {
  locale: Locale;
  day: string;
  listings: Listing[];
  blocks: Block[];
  bookings: Booking[];
  href: (id: string) => string;
}) {
  const midnight = Date.parse(day + 'T00:00:00+09:00'),
    end = midnight + 86400_000;
  const events = [
    ...bookings
      .filter((b) => !['CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status))
      .map((b) => ({
        id: b.id,
        listingId: b.assignedListingId ?? b.selectedStaffListingId,
        start: b.quote.startAt,
        end: b.quote.endAt,
        label: statusText(l, b.status),
        detail: `${(b.quote.endAt - b.quote.startAt) / 60000} ${t(l, 'minutes')} · ${b.id.slice(-6).toUpperCase()}`,
        booking: true,
      })),
    ...blocks.map((b) => ({
      id: b.id,
      listingId: b.listingId,
      start: b.startAt,
      end: b.endAt,
      label: st(l, b.reason),
      detail: st(l, 'paused'),
      booking: false,
    })),
  ].filter((e) => e.start < end && e.end > midnight && listings.some((x) => x.id === e.listingId));
  const from = Math.min(
      9,
      ...events.map((e) => Math.floor(Math.max(0, e.start - midnight) / 3600_000)),
    ),
    to = Math.max(
      22,
      ...events.map((e) => Math.ceil(Math.min(86400_000, e.end - midnight) / 3600_000)),
    ),
    height = (to - from) * 64;
  return (
    <section className="merchant-calendar">
      <div className="merchant-calendar-scroll">
        <div
          className="merchant-calendar-inner"
          style={{
            gridTemplateColumns: `56px repeat(${listings.length},minmax(180px,1fr))`,
            minWidth: 56 + listings.length * 180,
          }}
        >
          <div className="calendar-corner">JST</div>
          {listings.map((x) => (
            <div key={x.id} className="calendar-member">
              <img src={x.photo} alt="" width={32} height={36} />
              <strong>{x.name[l]}</strong>
            </div>
          ))}
          <div className="calendar-hours" style={{ height }}>
            {Array.from({ length: to - from + 1 }, (_, i) => (
              <time key={i} style={{ top: i * 64 }}>
                {String(from + i).padStart(2, '0')}:00
              </time>
            ))}
          </div>
          {listings.map((x) => (
            <div className="calendar-lane" key={x.id} style={{ height }}>
              {events
                .filter((e) => e.listingId === x.id)
                .map((e) => {
                  const style = {
                    top:
                      ((Math.max(e.start, midnight) - midnight - from * 3600_000) / 3600_000) * 64,
                    height: Math.max(
                      32,
                      ((Math.min(e.end, end) - Math.max(e.start, midnight)) / 3600_000) * 64 - 3,
                    ),
                  };
                  const content = (
                    <>
                      <strong>{e.label}</strong>
                      <span>{dateTime(l, e.start)}</span>
                      <small>{e.detail}</small>
                    </>
                  );
                  return e.booking ? (
                    <Link href={href(e.id)} className="calendar-event" style={style} key={e.id}>
                      {content}
                    </Link>
                  ) : (
                    <div className="calendar-event blocked" style={style} key={e.id}>
                      {content}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
