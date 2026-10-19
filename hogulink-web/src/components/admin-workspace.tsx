'use client';
import { useDemoAccess } from '@/lib/use-runtime';
import { SystemDelivery } from './system-delivery';
import { rt } from '@/lib/runtime-i18n';
import { FinanceCenter } from './finance-center';
import { QualityEntry } from './quality-workspace';
import { qt } from '@/lib/quality-i18n';
import { OnboardingReview } from './partner-portal';
import { NoShowPanel } from './no-show-panel';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Download,
  FileCheck2,
  History,
  LayoutDashboard,
  Leaf,
  ListChecks,
  LockKeyhole,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Store as StoreIcon,
  Wallet,
  X,
  UsersRound,
} from 'lucide-react';
import type { Actor, AdminBooking, AdminReview, Locale, SafetyEvent } from '@hogulink/contracts';
import { bookingStatuses, canAdmin } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { areaName, dateTime, errorText, money, statusText, t } from '@/lib/i18n';
import { acceptanceLabel } from '@/lib/visit-i18n';
import { categoryLabel, caseStatus } from '@/lib/care-i18n';
import {
  at,
  adminTabs,
  adminTabAllowed,
  auditLabel,
  type AdminKey,
  type AdminTab,
} from '@/lib/admin-i18n';
import { et } from '@/lib/member-i18n';
import {
  activeCase,
  adminTrend,
  filterAdminOrders,
  financeTotals,
  liveListing,
  orderNeedsAttention,
  type AdminWorkspace as Workspace,
} from '@/lib/admin-model';
import { csvCell, japanDay } from '@/lib/desktop-model';
import { useSession } from './booking-form';
import { MobileSheet } from './mobile-ui';
import { AdminCaseQueue } from './admin-case-queue';
import { AdminMembers } from './admin-members';
import { OrderMonitor } from './order-monitor';

type ReviewTarget = {
  type: AdminReview['targetType'];
  id: string;
  storeId: string;
  name: string;
  subtitle: string;
  version: number;
  visible: boolean;
  reviewed: boolean;
  checks: { label: AdminKey; ok: boolean }[];
};
type ReviewDraft = { target: ReviewTarget; decision: AdminReview['decision'] };
const icons = {
  overview: LayoutDashboard,
  orders: ListChecks,
  review: FileCheck2,
  safety: ShieldCheck,
  finance: Wallet,
  audit: History,
  system: Server,
  members: UsersRound,
};

export function AdminWorkspace({ locale: l }: { locale: Locale }) {
  const query = useSearchParams(),
    router = useRouter(),
    requested = query.get('tab') as AdminTab;
  const { actor, setActor, loading } = useSession();
  const demoAccess = useDemoAccess();
  const visibleTabs = adminTabs.filter(
    (view) => !actor || actor.role !== 'ADMIN' || adminTabAllowed(actor, view),
  );
  const tab = visibleTabs.includes(requested) ? requested : 'overview';
  const [data, setData] = useState<Workspace>(),
    [busy, setBusy] = useState(false),
    [fetching, setFetching] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''),
    [shop, setShop] = useState(''),
    [status, setStatus] = useState('all'),
    [period, setPeriod] = useState('all'),
    [targetType, setTargetType] = useState('all'),
    [reviewFilter, setReviewFilter] = useState('all'),
    [safetyFilter, setSafetyFilter] = useState('open'),
    [page, setPage] = useState(1);
  const [review, setReview] = useState<ReviewDraft | null>(null),
    [resolution, setResolution] = useState<SafetyEvent | null>(null),
    [reason, setReason] = useState(''),
    [ack, setAck] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(10);
  const requestedStatus = query.get('status'),
    requestedQueue = query.get('queue');
  const generation = useRef(0),
    hasRole = actor?.role === 'ADMIN';
  const href = (view: AdminTab, booking?: string) =>
    `/${l}/admin?${new URLSearchParams({ tab: view, ...(booking ? { booking } : {}) })}`;
  const fail = useCallback(
    (e: unknown) => {
      const code = e instanceof ClientError ? e.code : undefined;
      setError(
        code === 'REVIEW_INCOMPLETE' ||
          code === 'REGULATORY_REVIEW_REQUIRED' ||
          code === 'VERSION_CONFLICT'
          ? at(l, code)
          : errorText(l, code),
      );
    },
    [l],
  );
  const refresh = useCallback(async () => {
    if (actor?.role !== 'ADMIN') return;
    const version = ++generation.current;
    setFetching(true);
    try {
      const value = await api<Workspace>('admin/workspace');
      if (version === generation.current) setData(value);
    } catch (e) {
      if (version === generation.current) {
        fail(e);
        if (e instanceof ClientError && ['FORBIDDEN', 'UNAUTHENTICATED'].includes(e.code))
          setData(undefined);
      }
    } finally {
      if (version === generation.current) setFetching(false);
    }
  }, [actor, fail]);
  useEffect(() => {
    setData(undefined);
    setReview(null);
    setResolution(null);
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 45000);
    return () => {
      generation.current++;
      window.clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    setSearch('');
    setPage(1);
  }, [tab]);
  useEffect(() => {
    setStatus(
      requestedStatus &&
        (requestedStatus === 'attention' ||
          bookingStatuses.some((value) => value === requestedStatus))
        ? requestedStatus
        : 'all',
    );
  }, [tab, requestedStatus]);
  useEffect(() => {
    setReviewFilter(requestedQueue === 'pending' ? 'pending' : 'all');
  }, [tab, requestedQueue]);
  useEffect(() => {
    setPage(1);
  }, [search, shop, status, period, targetType, reviewFilter, safetyFilter]);
  const requestedBooking = query.get('booking');
  useEffect(() => {
    if (requestedBooking) {
      setSearch('');
      setStatus('all');
      setPeriod('all');
      setShop('');
    }
  }, [requestedBooking]);
  async function login(finance = false) {
    generation.current++;
    setData(undefined);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setActor(
        await api<Actor>('auth/demo', {
          role: 'ADMIN',
          ...(finance ? { adminPersona: 'FINANCE' } : {}),
        }),
      );
    } catch (e) {
      fail(e);
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
      setNotice(at(l, 'saved'));
      return true;
    } catch (e) {
      fail(e);
      if (e instanceof ClientError && ['VERSION_CONFLICT', 'INVALID_STATE'].includes(e.code)) {
        setReview(null);
        setResolution(null);
        await refresh();
      }
      return false;
    } finally {
      setBusy(false);
    }
  }
  const shopName = (id: string) => data?.stores.find((s) => s.id === id)?.name[l] ?? id;
  const staffName = (id: string | null) =>
    data?.listings.find((s) => s.id === id)?.name[l] ?? at(l, 'none');
  const serviceName = (b: AdminBooking) =>
    data?.offerings.find((o) => o.id === b.quote.offeringId)?.name[l] ?? at(l, 'service');
  const targets: ReviewTarget[] = data
    ? [
        ...data.stores.map((s) => ({
          type: 'STORE' as const,
          id: s.id,
          storeId: s.id,
          name: s.name[l],
          subtitle: s.legalName,
          version: s.moderationVersion ?? 1,
          visible: s.active && s.approved,
          reviewed: s.approved,
          checks: [
            { label: 'legal' as const, ok: !!s.legalName && !!s.legalAddress && !!s.contact },
            { label: 'routing' as const, ok: s.pspReady },
          ],
        })),
        ...data.listings.map((s) => ({
          type: 'LISTING' as const,
          id: s.id,
          storeId: s.storeId,
          name: s.name[l],
          subtitle: shopName(s.storeId),
          version: s.moderationVersion ?? 1,
          visible: liveListing(s, data.stores),
          reviewed: s.publicationStatus === 'PUBLISHED_INDEXABLE',
          checks: [
            { label: 'member' as const, ok: s.membershipActive },
            { label: 'verified' as const, ok: s.identityVerified },
            { label: 'consent' as const, ok: s.portraitConsent },
          ],
        })),
        ...data.offerings.map((s) => ({
          type: 'OFFERING' as const,
          id: s.id,
          storeId: s.storeId,
          name: s.name[l],
          subtitle: `${shopName(s.storeId)} · ${s.durationMinutes} ${at(l, 'minutes')}`,
          version: s.version,
          visible:
            s.approved &&
            s.active !== false &&
            !!data.stores.find((x) => x.id === s.storeId && x.active && x.approved),
          reviewed: s.approved,
          checks: [{ label: 'relaxation' as const, ok: s.regulatoryCategory === 'RELAXATION' }],
        })),
      ]
    : [];
  const needReview = targets.filter((x) => !x.reviewed || x.checks.some((c) => !c.ok));
  const reviewRows = targets.filter(
    (x) =>
      (targetType === 'all' || x.type === targetType) &&
      (!shop || x.storeId === shop) &&
      (reviewFilter === 'all' ||
        (reviewFilter === 'pending'
          ? !x.reviewed || x.checks.some((c) => !c.ok)
          : reviewFilter === 'live'
            ? x.visible
            : !x.visible)) &&
      `${x.name} ${x.subtitle}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const orders = data
    ? filterAdminOrders(data.bookings, {
        search,
        storeId: shop,
        status,
        period,
        describe: (b) =>
          `${shopName(b.storeId)} ${staffName(b.assignedListingId)} ${serviceName(b)}`,
      })
    : [];
  const selectedOrder = requestedBooking
    ? data?.bookings.find((b) => b.id === requestedBooking)
    : orders[0];
  const openCases = data?.cases.filter(activeCase) ?? [],
    openSafety = data?.safety.filter((s) => s.status === 'OPEN') ?? [];
  const finance = financeTotals(data?.bookings ?? [], data?.feeEntries ?? []),
    trend = adminTrend(data?.bookings ?? []),
    peak = Math.max(1, ...trend.map((d) => d.count));
  const safetyCases = (data?.cases ?? []).filter(
    (c) =>
      (!shop || c.storeId === shop) &&
      (!requestedBooking || c.bookingId === requestedBooking) &&
      (safetyFilter === 'all' || (safetyFilter === 'open' ? activeCase(c) : !activeCase(c))) &&
      `${c.subject} ${c.id} ${c.bookingId ?? ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const safetyEvents = (data?.safety ?? []).filter(
    (s) =>
      (!shop || s.storeId === shop) &&
      (!requestedBooking || s.bookingId === requestedBooking) &&
      (safetyFilter === 'all' || s.status === (safetyFilter === 'open' ? 'OPEN' : 'RESOLVED')) &&
      `${s.type} ${s.bookingId}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const auditRows = (data?.audit ?? []).filter((a) =>
    `${a.action} ${a.bookingId ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const feeRows = (data?.feeEntries ?? []).filter((f) => !shop || f.storeId === shop);
  const operator = (id: string): AdminKey =>
    id === 'system'
      ? 'automation'
      : id.includes('admin')
        ? 'platform'
        : id.includes('owner')
          ? 'merchant'
          : id.includes('staff')
            ? 'staff'
            : 'customer';
  function openReview(target: ReviewTarget, decision: AdminReview['decision']) {
    setReview({ target, decision });
    setReason('');
    setAck(false);
    setError('');
  }
  function exportCsv(name: string, rows: (string | number)[][]) {
    const url = URL.createObjectURL(
      new Blob(['\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `HoguLink-${name}-${japanDay(Date.now())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportCurrent() {
    if (tab === 'finance')
      exportCsv('platform-fees', [
        [at(l, 'reference'), at(l, 'shop'), at(l, 'type'), 'JPY', at(l, 'time')],
        ...feeRows.map((f) => [
          f.bookingId.slice(-8),
          shopName(f.storeId),
          f.type,
          f.amount,
          f.createdAt ? dateTime(l, f.createdAt) : '',
        ]),
      ]);
    else if (tab === 'audit')
      exportCsv('audit', [
        [at(l, 'time'), at(l, 'action'), at(l, 'reference')],
        ...auditRows.map((a) => [dateTime(l, a.at), a.action, a.bookingId?.slice(-8) ?? '']),
      ]);
    else
      exportCsv('orders', [
        [at(l, 'reference'), at(l, 'shop'), at(l, 'status'), at(l, 'visit'), 'JPY'],
        ...orders.map((b) => [
          b.id.slice(-8),
          shopName(b.storeId),
          statusText(l, b.status),
          dateTime(l, b.quote.startAt),
          b.quote.total,
        ]),
      ]);
  }
  function pager(total: number, size = 10) {
    const pages = Math.max(1, Math.ceil(total / size)),
      current = Math.min(page, pages);
    return (
      <div className="admin-pagination">
        <span>
          {total} {at(l, 'records')}
        </span>
        <div>
          <button
            disabled={current === 1}
            onClick={() => setPage(current - 1)}
            aria-label={at(l, 'prev')}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {current} / {pages}
          </span>
          <button
            disabled={current === pages}
            onClick={() => setPage(current + 1)}
            aria-label={at(l, 'nextPage')}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    );
  }
  function slice<T>(rows: T[], size = 10) {
    const p = Math.min(page, Math.max(1, Math.ceil(rows.length / size)));
    return rows.slice((p - 1) * size, p * size);
  }
  function shopSelect() {
    return (
      <label>
        <span className="sr-only">{at(l, 'shop')}</span>
        <select
          value={shop}
          onChange={(e) => {
            setShop(e.target.value);
            if (requestedBooking) router.replace(href(tab), { scroll: false });
          }}
          aria-label={at(l, 'shop')}
        >
          <option value="">{at(l, 'allShops')}</option>
          {data?.stores.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name[l]}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function searchInput(audit = false) {
    return (
      <label className="admin-search">
        <Search size={17} />
        <span className="sr-only">{at(l, audit ? 'auditSearch' : 'search')}</span>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (requestedBooking) router.replace(href(tab), { scroll: false });
          }}
          placeholder={at(l, audit ? 'auditSearch' : 'search')}
          aria-label={at(l, audit ? 'auditSearch' : 'search')}
        />
      </label>
    );
  }
  function orderTable(rows: AdminBooking[], compact = false) {
    return rows.length ? (
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{at(l, 'reference')}</th>
              <th>{at(l, 'service')}</th>
              <th>{at(l, 'visit')}</th>
              <th>{at(l, 'status')}</th>
              {!compact && <th>{at(l, 'amount')}</th>}
              <th>
                <span className="sr-only">{at(l, 'view')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr
                key={b.id}
                className={selectedOrder?.id === b.id && tab === 'orders' ? 'selected' : ''}
              >
                <td>
                  <Link className="admin-order-reference" href={href('orders', b.id)}>
                    {b.id.slice(-8).toUpperCase()}
                  </Link>
                  <small>{shopName(b.storeId)}</small>
                </td>
                <td>
                  <strong>{serviceName(b)}</strong>
                  <small>
                    {staffName(b.assignedListingId)} ·{' '}
                    {Math.round((b.quote.endAt - b.quote.startAt) / 60000)} {at(l, 'minutes')}
                  </small>
                </td>
                <td>
                  {dateTime(l, b.quote.startAt)}
                  <small>JST</small>
                </td>
                <td>
                  <span className={`admin-pill ${orderNeedsAttention(b) ? 'warning' : ''}`}>
                    {statusText(l, b.status)}
                  </span>
                  <small>{statusText(l, b.paymentStatus)}</small>
                </td>
                {!compact && <td className="admin-numeric">{money(l, b.quote.total)}</td>}
                <td>
                  <Link
                    className="admin-icon"
                    href={href('orders', b.id)}
                    aria-label={`${at(l, 'view')} ${b.id.slice(-8)}`}
                  >
                    <ArrowUpRight size={17} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="admin-empty">
        <ListChecks size={30} />
        <p>{at(l, 'empty')}</p>
      </div>
    );
  }
  function reviewDetail() {
    if (!review) return null;
    const target = review.target;
    const store = data?.stores.find((s) => s.id === target.storeId),
      listing =
        target.type === 'LISTING' ? data?.listings.find((s) => s.id === target.id) : undefined,
      offering =
        target.type === 'OFFERING' ? data?.offerings.find((s) => s.id === target.id) : undefined;
    return (
      <>
        <div className="admin-review-summary">
          <span>{at(l, target.type)}</span>
          <h3>{target.name}</h3>
          <p>{target.subtitle}</p>
        </div>
        <dl className="admin-review-facts">
          {target.type === 'STORE' && store && (
            <>
              <div>
                <dt>{at(l, 'contract')}</dt>
                <dd>{store.legalName}</dd>
              </div>
              <div>
                <dt>{at(l, 'legal')}</dt>
                <dd>
                  {store.legalAddress}
                  <br />
                  {store.contact}
                </dd>
              </div>
            </>
          )}
          {listing && (
            <div>
              <dt>{at(l, 'checks')}</dt>
              <dd>{listing.description[l]}</dd>
            </div>
          )}
          {offering && (
            <>
              <div>
                <dt>{at(l, 'qualification')}</dt>
                <dd>
                  {at(l, offering.regulatoryCategory === 'RELAXATION' ? 'relaxation' : 'licensed')}
                </dd>
              </div>
              <div>
                <dt>{at(l, 'amount')}</dt>
                <dd>
                  {money(l, offering.price)} · {offering.durationMinutes} {at(l, 'minutes')}
                </dd>
              </div>
            </>
          )}
          {target.checks.map((c) => (
            <div key={c.label}>
              <dt>{at(l, c.label)}</dt>
              <dd>
                {c.ok ? <Check size={15} /> : <X size={15} />}{' '}
                {at(l, c.ok ? 'complete' : 'missing')}
              </dd>
            </div>
          ))}
        </dl>
      </>
    );
  }
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <Link className="admin-wordmark" href={href('overview')}>
          <span>
            <Leaf size={24} />
          </span>
          <strong>
            HoguLink<small>PLATFORM CONSOLE</small>
          </strong>
        </Link>
        <div className="admin-space-label">
          <ShieldCheck size={16} />
          {at(l, 'portal')}
          <span>DEMO</span>
        </div>
        <nav aria-label={at(l, 'portal')}>
          {visibleTabs.map((view) => {
            const Icon = icons[view],
              count =
                view === 'safety' ? openSafety.length : view === 'review' ? needReview.length : 0;
            return (
              <Link key={view} href={href(view)} aria-current={view === tab ? 'page' : undefined}>
                <Icon size={18} />
                {at(l, view)}
                {count > 0 && <b>{count}</b>}
              </Link>
            );
          })}
        </nav>
        <div className="admin-sidebar-bottom">
          {canAdmin(actor, 'cases.read') && (
            <Link href={`/${l}/admin/support`}>
              <CircleHelp size={18} />
              {at(l, 'support')}
              <ArrowUpRight size={15} />
            </Link>
          )}
          <p>
            <LockKeyhole size={14} />
            {at(l, 'demo')}
          </p>
          <Link href={`/${l}`}>
            {t(l, 'explore')}
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </aside>
      <div className="admin-content">
        {(canAdmin(actor!, 'supply.write') || canAdmin(actor!, 'safety.write')) && (
          <QualityEntry locale={l} role="ADMIN" />
        )}
        <header className="admin-heading">
          <div>
            <span className="eyebrow">HOGULINK / OPERATIONS</span>
            <h1>{at(l, tab === 'overview' ? 'title' : tab)}</h1>
            <p>
              {tab === 'members'
                ? et(l, 'intro')
                : at(
                    l,
                    tab === 'overview'
                      ? 'intro'
                      : tab === 'review'
                        ? 'supplyHelp'
                        : tab === 'safety'
                          ? 'safetyHelp'
                          : tab === 'finance'
                            ? 'financeHelp'
                            : tab === 'audit'
                              ? 'auditHelp'
                              : tab === 'system'
                                ? 'systemHelp'
                                : 'refundBoundary',
                  )}
            </p>
          </div>
          <div className="admin-heading-tools">
            <span>
              <i />
              {at(l, 'demoMode')}
            </span>
            <button
              className="admin-icon"
              aria-label={at(l, 'refresh')}
              disabled={busy || fetching || !hasRole}
              onClick={() => {
                setError('');
                void refresh();
              }}
            >
              <RefreshCw size={18} className={fetching ? 'admin-spinning' : ''} />
            </button>
            <Link className="admin-icon" aria-label={at(l, 'support')} href={`/${l}/admin/support`}>
              <CircleHelp size={19} />
            </Link>
          </div>
        </header>
        <div className="admin-mobile-tabs" role="navigation" aria-label={at(l, 'portal')}>
          {visibleTabs.map((view) => (
            <Link key={view} href={href(view)} aria-current={view === tab ? 'page' : undefined}>
              {at(l, view)}
            </Link>
          ))}
        </div>
        <details className="admin-account" open={!hasRole}>
          <summary>
            <ShieldCheck size={14} />
            {at(l, 'identity')} ·{' '}
            {hasRole ? (actor?.displayName ?? at(l, 'platform')) : at(l, 'login')}
          </summary>
          <div>
            <p>{hasRole && actor?.adminRole ? et(l, actor.adminRole) : at(l, 'loginHelp')}</p>
            <Link className="button secondary" href={`/${l}/admin/login`}>
              {et(l, 'login')}
            </Link>
            {demoAccess &&
              (!hasRole || actor?.id === 'demo-admin' || actor?.id === 'demo-finance') && (
                <>
                  <button
                    className="button secondary"
                    onClick={() => void login()}
                    disabled={busy || loading}
                  >
                    {at(l, 'login')}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => void login(true)}
                    disabled={busy || loading}
                  >
                    {l === 'ja'
                      ? 'デモ経理担当として入る'
                      : l === 'en'
                        ? 'Enter as demo finance'
                        : '进入演示财务经办工作台'}
                  </button>
                </>
              )}
            {hasRole && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  await api('auth/logout', {});
                  setActor(null);
                  setData(undefined);
                }}
              >
                {et(l, 'logout')}
              </button>
            )}
          </div>
        </details>
        {hasRole && adminTabs.includes(requested) && !visibleTabs.includes(requested) && (
          <p className="notice" role="status">
            {et(l, 'denied')}
          </p>
        )}
        {error && !review && !resolution && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {hasRole && !data && (
          <section className="admin-panel admin-empty" aria-busy={fetching}>
            {error ? (
              <button className="button secondary" onClick={() => refresh()}>
                {at(l, 'refresh')}
              </button>
            ) : (
              at(l, 'loading')
            )}
          </section>
        )}
        {hasRole && data && (
          <>
            {tab === 'overview' && (
              <>
                <div className="admin-stat-grid">
                  <div>
                    <span>{at(l, 'allOrders')}</span>
                    <strong>{data.bookings.length}</strong>
                    <small>{at(l, 'allTime')}</small>
                    <ListChecks size={20} />
                  </div>
                  {canAdmin(actor, 'cases.read') && (
                    <div>
                      <span>{at(l, 'openCases')}</span>
                      <strong>{openCases.length}</strong>
                      <small>{at(l, 'open')}</small>
                      <BookOpen size={20} />
                    </div>
                  )}
                  <div>
                    <span>{at(l, 'published')}</span>
                    <strong>
                      {data.listings.filter((x) => liveListing(x, data.stores)).length}
                      <small> / {data.listings.length}</small>
                    </strong>
                    <small>{at(l, 'approved')}</small>
                    <ShieldCheck size={20} />
                  </div>
                  {canAdmin(actor, 'finance.read') && (
                    <div>
                      <span>{at(l, 'platformNet')}</span>
                      <strong className="money">{money(l, finance.platform)}</strong>
                      <small>{at(l, 'afterReversal')}</small>
                      <Wallet size={20} />
                    </div>
                  )}
                </div>
                <div className="admin-overview-grid">
                  <section className="admin-control">
                    <div className="admin-control-top">
                      <span>
                        <i />
                        {at(l, 'portal')}
                      </span>
                      <ShieldCheck size={25} />
                    </div>
                    <h2>{at(l, 'control')}</h2>
                    <p>{at(l, 'controlHelp')}</p>
                    <div className="admin-control-metrics">
                      {canAdmin(actor, 'safety.write') && (
                        <Link href={href('safety')}>
                          <strong>{openSafety.length}</strong>
                          <span>
                            {at(l, 'openSafety')}
                            <ArrowUpRight size={14} />
                          </span>
                        </Link>
                      )}
                      {canAdmin(actor, 'supply.read') && (
                        <Link href={`${href('review')}&queue=pending`}>
                          <strong>{needReview.length}</strong>
                          <span>
                            {at(l, 'reviewCount')}
                            <ArrowUpRight size={14} />
                          </span>
                        </Link>
                      )}
                      <Link href={`${href('orders')}&status=attention`}>
                        <strong>{data.bookings.filter(orderNeedsAttention).length}</strong>
                        <span>
                          {at(l, 'attention')}
                          <ArrowUpRight size={14} />
                        </span>
                      </Link>
                    </div>
                  </section>
                  <section className="admin-panel admin-trend">
                    <div className="admin-panel-heading">
                      <div>
                        <h2>{at(l, 'trend')}</h2>
                        <p>{at(l, 'trendHelp')}</p>
                      </div>
                      <span>JST</span>
                    </div>
                    <div
                      className="admin-chart"
                      role="img"
                      aria-label={trend.map((d) => `${d.day}: ${d.count}`).join(', ')}
                    >
                      {trend.map((d) => (
                        <div key={d.day}>
                          <strong>{d.count}</strong>
                          <div>
                            <span style={{ height: `${(d.count / peak) * 100}%` }} />
                          </div>
                          <small>{d.day.slice(5).replace('-', '/')}</small>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
                {canAdmin(actor, 'cases.read') && (
                  <section className="admin-panel admin-priority">
                    <div className="admin-panel-heading">
                      <h2>{at(l, 'next')}</h2>
                      <Link href={href('safety')}>
                        {at(l, 'all')}
                        <ArrowUpRight size={15} />
                      </Link>
                    </div>
                    <div>
                      {openSafety.slice(0, 2).map((s) => (
                        <Link href={href('safety', s.bookingId)} key={s.id}>
                          <span className="admin-priority-icon warning">
                            <ShieldAlert size={19} />
                          </span>
                          <div>
                            <strong>
                              {s.type === 'MISSED_CHECK_IN'
                                ? qt(l, 'MISSED_CHECK_IN')
                                : s.type === 'SOS'
                                  ? 'SOS'
                                  : at(l, 'safetyEvent')}{' '}
                              · {shopName(s.storeId)}
                            </strong>
                            <p>
                              {dateTime(l, s.createdAt)} · {s.bookingId.slice(-8)}
                            </p>
                          </div>
                          <span className="admin-pill warning">{at(l, 'open')}</span>
                          <ChevronRight size={17} />
                        </Link>
                      ))}
                      {openCases
                        .filter(
                          (c) =>
                            c.priority === 'HIGH' ||
                            c.status === 'PLATFORM_ESCALATED' ||
                            c.dueAt < Date.now(),
                        )
                        .slice(0, 3)
                        .map((c) => (
                          <Link href={`/${l}/admin/support?case=${c.id}`} key={c.id}>
                            <span className="admin-priority-icon">
                              <BookOpen size={18} />
                            </span>
                            <div>
                              <strong>{c.subject}</strong>
                              <p>
                                {categoryLabel(l, c.category)} · {dateTime(l, c.dueAt)}
                              </p>
                            </div>
                            <span className="admin-pill">{caseStatus(l, c.status)}</span>
                            <ChevronRight size={17} />
                          </Link>
                        ))}
                      {!openSafety.length &&
                        !openCases.some(
                          (c) =>
                            c.priority === 'HIGH' ||
                            c.status === 'PLATFORM_ESCALATED' ||
                            c.dueAt < Date.now(),
                        ) && (
                          <div className="admin-empty">
                            <Check size={27} />
                            <p>{at(l, 'noUrgent')}</p>
                          </div>
                        )}
                    </div>
                  </section>
                )}
                <section className="admin-panel">
                  <div className="admin-panel-heading">
                    <h2>{at(l, 'orders')}</h2>
                    <Link href={href('orders')}>
                      {at(l, 'all')}
                      <ArrowUpRight size={15} />
                    </Link>
                  </div>
                  {orderTable(data.bookings.slice(0, 5), true)}
                </section>
              </>
            )}
            {tab === 'orders' && (
              <>
                {actor && (
                  <OrderMonitor
                    key={`${actor.id}:${actor.adminRole}:${actor.adminSessionVersion}`}
                    locale={l}
                    actor={actor}
                    storeName={shopName}
                  />
                )}
                <div className="admin-toolbar">
                  {searchInput()}
                  {shopSelect()}
                  <select
                    value={status}
                    aria-label={at(l, 'status')}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      if (requestedBooking) router.replace(href('orders'), { scroll: false });
                    }}
                  >
                    <option value="all">{at(l, 'allStatuses')}</option>
                    <option value="attention">{at(l, 'attention')}</option>
                    {bookingStatuses.map((s) => (
                      <option key={s} value={s}>
                        {statusText(l, s)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={period}
                    aria-label={at(l, 'period')}
                    onChange={(e) => {
                      setPeriod(e.target.value);
                      if (requestedBooking) router.replace(href('orders'), { scroll: false });
                    }}
                  >
                    {(['all', 'today', 'upcoming'] as const).map((v) => (
                      <option value={v} key={v}>
                        {at(l, v === 'all' ? 'allDates' : v)}
                      </option>
                    ))}
                  </select>
                  <button className="button secondary" onClick={exportCurrent}>
                    <Download size={16} />
                    {at(l, 'export')}
                  </button>
                </div>
                <section className="admin-panel admin-orders-panel">
                  {orderTable(slice(orders))}
                  {pager(orders.length)}
                </section>
                {selectedOrder && (
                  <section className="admin-panel admin-order-detail" id="admin-order-detail">
                    <div className="admin-panel-heading">
                      <div>
                        <span className="eyebrow">
                          ORDER / {selectedOrder.id.slice(-8).toUpperCase()}
                        </span>
                        <h2>{at(l, 'details')}</h2>
                      </div>
                      <span className="admin-pill">{statusText(l, selectedOrder.status)}</span>
                    </div>
                    <div className="admin-order-columns">
                      <div>
                        <h3>{serviceName(selectedOrder)}</h3>
                        <p>
                          {dateTime(l, selectedOrder.quote.startAt)} ·{' '}
                          {areaName(l, selectedOrder.quote.area)}
                        </p>
                        <dl>
                          <div>
                            <dt>{at(l, 'contract')}</dt>
                            <dd>{selectedOrder.legalNameSnapshot}</dd>
                          </div>
                          <div>
                            <dt>{at(l, 'original')}</dt>
                            <dd>
                              {selectedOrder.quote.nominationType === 'FREE'
                                ? t(l, 'free')
                                : staffName(selectedOrder.selectedStaffListingId)}
                            </dd>
                          </div>
                          <div>
                            <dt>{at(l, 'assigned')}</dt>
                            <dd>{staffName(selectedOrder.assignedListingId)}</dd>
                          </div>
                          <div>
                            <dt>{at(l, 'frozen')}</dt>
                            <dd>{acceptanceLabel(l, selectedOrder.acceptanceMode)}</dd>
                          </div>
                        </dl>
                      </div>
                      <div className="admin-order-money">
                        {(
                          [
                            ['amount', selectedOrder.quote.total],
                            ['captured', selectedOrder.capturedAmount],
                            ['refunded', selectedOrder.refundedAmount],
                          ] as const
                        ).map(([key, value]) => (
                          <div key={key}>
                            <span>{at(l, key)}</span>
                            <strong>{money(l, value)}</strong>
                          </div>
                        ))}
                        <p>
                          {at(l, 'payment')} · {statusText(l, selectedOrder.paymentStatus)}
                        </p>
                        <NoShowPanel
                          locale={l}
                          booking={selectedOrder}
                          role="ADMIN"
                          onUpdated={refresh}
                        />
                        <Link
                          className="button secondary full"
                          href={href('safety', selectedOrder.id)}
                        >
                          {at(l, 'related')}
                          <ArrowUpRight size={16} />
                        </Link>
                        {canAdmin(actor, 'finance.read') && (
                          <Link
                            className="button secondary full"
                            href={`${href('finance', selectedOrder.id)}&month=${new Date(selectedOrder.updatedAt + 9 * 3600000).toISOString().slice(0, 7)}`}
                          >
                            {at(l, 'finance')}
                            <ArrowUpRight size={16} />
                          </Link>
                        )}
                      </div>
                    </div>
                    <p className="admin-privacy">
                      <LockKeyhole size={15} />
                      {at(l, 'privacy')}
                    </p>
                    <details className="admin-order-history">
                      <summary>{at(l, 'timeline')}</summary>
                      {data.audit
                        .filter((a) => a.bookingId === selectedOrder.id)
                        .slice(0, 10)
                        .map((a) => (
                          <p key={a.id}>
                            <time>{dateTime(l, a.at)}</time>
                            {auditLabel(l, a.action)}
                          </p>
                        ))}
                    </details>
                  </section>
                )}
                <p className="admin-footnote">{at(l, 'exportHelp')}</p>
              </>
            )}
            {tab === 'review' && (
              <>
                {canAdmin(actor, 'supply.write') && (
                  <OnboardingReview locale={l} onChanged={() => void refresh()} />
                )}
                <div className="admin-toolbar">
                  {searchInput()}
                  {shopSelect()}
                  <select
                    value={targetType}
                    onChange={(e) => setTargetType(e.target.value)}
                    aria-label={at(l, 'type')}
                  >
                    <option value="all">{at(l, 'all')}</option>
                    {(['STORE', 'LISTING', 'OFFERING'] as const).map((v) => (
                      <option value={v} key={v}>
                        {at(l, v)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={reviewFilter}
                    onChange={(e) => setReviewFilter(e.target.value)}
                    aria-label={at(l, 'status')}
                  >
                    {(['all', 'pending', 'live', 'paused'] as const).map((v) => (
                      <option value={v} key={v}>
                        {at(l, v)}
                      </option>
                    ))}
                  </select>
                </div>
                <section className="admin-panel admin-supply-panel">
                  <div className="admin-supply-list">
                    {slice(reviewRows).map((target) => (
                      <article key={`${target.type}-${target.id}`}>
                        <span className={`admin-supply-symbol ${target.type.toLowerCase()}`}>
                          {target.type === 'STORE' ? (
                            <StoreIcon size={21} />
                          ) : target.type === 'LISTING' ? (
                            <ShieldCheck size={21} />
                          ) : (
                            <Leaf size={21} />
                          )}
                        </span>
                        <div className="admin-supply-name">
                          <small>{at(l, target.type)}</small>
                          <h3>{target.name}</h3>
                          <p>{target.subtitle}</p>
                          <div className="admin-checks">
                            {target.checks.map((c) => (
                              <span key={c.label}>
                                {c.ok ? <Check size={13} /> : <X size={13} />} {at(l, c.label)}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="admin-supply-status">
                          <span
                            className={`admin-pill ${!target.reviewed ? 'warning' : !target.visible ? 'neutral' : ''}`}
                          >
                            {at(
                              l,
                              !target.reviewed ? 'pending' : target.visible ? 'live' : 'paused',
                            )}
                          </span>
                          <small>{at(l, target.reviewed ? 'approved' : 'notApproved')}</small>
                        </div>
                        <div className="admin-supply-actions">
                          {canAdmin(actor, 'supply.write') && (
                            <button
                              className="button secondary small"
                              disabled={busy}
                              onClick={() =>
                                openReview(target, target.visible ? 'SUSPEND' : 'APPROVE')
                              }
                            >
                              {at(l, target.visible ? 'suspend' : 'approve')}
                            </button>
                          )}
                          {canAdmin(actor, 'supply.write') && (
                            <button
                              className="admin-icon"
                              disabled={busy}
                              onClick={() => openReview(target, 'REJECT')}
                              aria-label={`${at(l, 'reviewTitle')} · ${target.name}`}
                            >
                              <ClipboardCheck size={17} />
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  {!reviewRows.length && (
                    <div className="admin-empty">
                      <FileCheck2 size={30} />
                      <p>{at(l, 'empty')}</p>
                    </div>
                  )}
                  {pager(reviewRows.length)}
                </section>
                <section className="admin-panel admin-review-history">
                  <div className="admin-panel-heading">
                    <h2>{at(l, 'history')}</h2>
                    <span>{data.reviews.length}</span>
                  </div>
                  {data.reviews.length ? (
                    data.reviews.slice(0, historyLimit).map((r) => (
                      <details key={r.id}>
                        <summary>
                          <span className="admin-pill">
                            {at(
                              l,
                              r.decision === 'APPROVE'
                                ? 'approve'
                                : r.decision === 'SUSPEND'
                                  ? 'suspend'
                                  : 'reject',
                            )}
                          </span>
                          <strong>
                            {targets.find((x) => x.id === r.targetId && x.type === r.targetType)
                              ?.name ?? r.targetId}
                          </strong>
                          <time>{dateTime(l, r.at)}</time>
                        </summary>
                        <p>{r.reason}</p>
                      </details>
                    ))
                  ) : (
                    <p className="admin-empty-copy">{at(l, 'empty')}</p>
                  )}
                  {data.reviews.length > historyLimit && (
                    <button
                      className="button secondary full"
                      onClick={() => setHistoryLimit(data.reviews.length)}
                    >
                      {at(l, 'all')} · {data.reviews.length}
                    </button>
                  )}
                </section>
              </>
            )}
            {tab === 'safety' && (
              <>
                <div className="admin-toolbar">
                  {searchInput()}
                  {shopSelect()}
                  <select
                    aria-label={at(l, 'status')}
                    value={safetyFilter}
                    onChange={(e) => setSafetyFilter(e.target.value)}
                  >
                    {(['open', 'resolved', 'all'] as const).map((v) => (
                      <option key={v} value={v}>
                        {at(l, v)}
                      </option>
                    ))}
                  </select>
                  {canAdmin(actor, 'safety.write') && (
                    <Link className="button secondary" href={`/${l}/admin/support`}>
                      {at(l, 'restrictions')}
                      <ArrowUpRight size={16} />
                    </Link>
                  )}
                </div>
                {requestedBooking && (
                  <p className="admin-context-filter">
                    {at(l, 'reference')} {requestedBooking.slice(-8)}
                    <Link href={href('safety')}>
                      {at(l, 'clear')}
                      <X size={14} />
                    </Link>
                  </p>
                )}
                <p className="admin-local-safety">
                  <ShieldAlert size={17} />
                  {at(l, 'localSafety')}
                </p>
                <div className="admin-safety-grid">
                  <section className="admin-panel">
                    <div className="admin-panel-heading">
                      <h2>{at(l, 'safetyEvent')}</h2>
                      <span>{safetyEvents.length}</span>
                    </div>
                    {slice(safetyEvents).map((s) => (
                      <article className="admin-safety-item" key={s.id}>
                        <div>
                          <span
                            className={`admin-priority-icon ${s.status === 'OPEN' ? 'warning' : ''}`}
                          >
                            <ShieldAlert size={19} />
                          </span>
                          <strong>
                            {s.type === 'MISSED_CHECK_IN'
                              ? qt(l, 'MISSED_CHECK_IN')
                              : s.type === 'SOS'
                                ? 'SOS'
                                : at(l, 'safetyEvent')}
                          </strong>
                          <span className={`admin-pill ${s.status === 'OPEN' ? 'warning' : ''}`}>
                            {at(l, s.status === 'OPEN' ? 'open' : 'resolved')}
                          </span>
                        </div>
                        <p>
                          {shopName(s.storeId)} ·{' '}
                          {staffName(
                            data.listings.find((x) => x.staffId === s.staffId)?.id ?? null,
                          )}
                        </p>
                        <small>{dateTime(l, s.createdAt)}</small>
                        <Link href={href('orders', s.bookingId)}>
                          {at(l, 'reference')} {s.bookingId.slice(-8)}
                          <ArrowUpRight size={14} />
                        </Link>
                        {s.resolution && <p className="admin-resolution">{s.resolution}</p>}
                        {s.status === 'OPEN' && (
                          <button
                            className="button secondary full"
                            disabled={busy}
                            onClick={() => {
                              setResolution(s);
                              setReason('');
                              setError('');
                            }}
                          >
                            {at(l, 'resolve')}
                          </button>
                        )}
                      </article>
                    ))}
                    {!safetyEvents.length && (
                      <div className="admin-empty">
                        <ShieldCheck size={28} />
                        <p>{at(l, 'empty')}</p>
                      </div>
                    )}
                    {safetyEvents.length > 10 && pager(safetyEvents.length)}
                  </section>
                  <AdminCaseQueue
                    locale={l}
                    cases={safetyCases}
                    handling={data.caseHandling}
                    actorId={actor!.id}
                    assignees={data.assignees}
                    shopName={shopName}
                  />
                </div>
              </>
            )}
            {tab === 'finance' && actor && (
              <FinanceCenter
                key={`${actor.id}:${actor.adminRole}:${actor.adminSessionVersion}`}
                locale={l}
                actor={actor}
                initialStoreId={
                  requestedBooking
                    ? selectedOrder?.storeId
                    : (query.get('storeId') ?? query.get('store') ?? undefined)
                }
                initialBookingId={requestedBooking ?? ''}
                initialMonth={query.get('month') ?? undefined}
                initialSection={query.get('section') ?? undefined}
                initialInvoiceSource={query.get('invoiceSource') ?? undefined}
              />
            )}
            {tab === 'audit' && (
              <>
                <div className="admin-toolbar">
                  {searchInput(true)}
                  <button className="button secondary" onClick={exportCurrent}>
                    <Download size={16} />
                    {at(l, 'export')}
                  </button>
                </div>
                <section className="admin-panel admin-audit-panel">
                  <div className="admin-table-scroll">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>{at(l, 'time')}</th>
                          <th>{at(l, 'action')}</th>
                          <th>{at(l, 'actor')}</th>
                          <th>{at(l, 'record')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slice(auditRows, 20).map((a) => (
                          <tr key={a.id}>
                            <td>{dateTime(l, a.at)}</td>
                            <td>
                              <strong>{auditLabel(l, a.action)}</strong>
                              <small>{a.action}</small>
                            </td>
                            <td>{at(l, operator(a.actorId))}</td>
                            <td>
                              {a.bookingId ? (
                                <Link
                                  className="admin-order-reference"
                                  href={href('orders', a.bookingId)}
                                >
                                  {a.bookingId.slice(-8).toUpperCase()}
                                  <ArrowUpRight size={13} />
                                </Link>
                              ) : (
                                <span>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!auditRows.length && (
                    <div className="admin-empty">
                      <History size={29} />
                      <p>{at(l, 'empty')}</p>
                    </div>
                  )}
                  {pager(auditRows.length, 20)}
                </section>
                <p className="admin-footnote">{at(l, 'exportHelp')}</p>
              </>
            )}
            {tab === 'system' && (
              <>
                <div className="admin-system-grid">
                  <section className="admin-panel">
                    <div className="admin-panel-heading">
                      <h2>{at(l, 'runtime')}</h2>
                      <Server size={21} />
                    </div>
                    <dl className="admin-system-facts">
                      <div>
                        <dt>{at(l, 'runtime')}</dt>
                        <dd>
                          <i />
                          {at(l, 'demoMode')}
                        </dd>
                      </div>
                      <div>
                        <dt>{at(l, 'payment')}</dt>
                        <dd>{at(l, 'simulated')}</dd>
                      </div>
                      <div>
                        <dt>{at(l, 'notifications')}</dt>
                        <dd>
                          {data.system.notifications === 'DEMO_LOCAL_ONLY'
                            ? rt(l, 'disabled')
                            : rt(l, 'configured')}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  <section className="admin-panel">
                    <div className="admin-panel-heading">
                      <h2>{at(l, 'rules')}</h2>
                      <ClipboardCheck size={21} />
                    </div>
                    <dl className="admin-system-facts">
                      <div>
                        <dt>{at(l, 'buffer')}</dt>
                        <dd>
                          {data.system.bufferMinutes} {at(l, 'minutes')}
                        </dd>
                      </div>
                      <div>
                        <dt>{at(l, 'hold')}</dt>
                        <dd>
                          {data.system.holdTtlSeconds} {at(l, 'seconds')}
                        </dd>
                      </div>
                      <div>
                        <dt>{at(l, 'rates')}</dt>
                        <dd>
                          {data.system.standardFeeBps / 100}% / {data.system.annualFeeBps / 100}%
                        </dd>
                      </div>
                    </dl>
                  </section>
                </div>
                {actor && <SystemDelivery locale={l} actor={actor} />}
              </>
            )}
            {tab === 'members' && actor && <AdminMembers locale={l} actor={actor} />}
            <p className="admin-sync">
              {at(l, 'updated')} {dateTime(l, data.generatedAt)} JST · {at(l, 'demo')}
            </p>
          </>
        )}
      </div>
      <MobileSheet
        open={!!review || !!resolution}
        onClose={() => {
          if (!busy) {
            setReview(null);
            setResolution(null);
          }
        }}
        title={at(l, review ? 'reviewTitle' : 'resolve')}
        locale={l}
        className="merchant-dialog admin-dialog"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (review) {
              if (!ack) return;
              const ok = await mutate(() =>
                api('admin/reviews', {
                  targetType: review.target.type,
                  targetId: review.target.id,
                  version: review.target.version,
                  decision: review.decision,
                  reason: reason.trim(),
                }),
              );
              if (ok) setReview(null);
            } else if (resolution) {
              if (
                await mutate(() =>
                  api(`admin/safety-events/${resolution.id}/resolve`, {
                    version: resolution.version ?? 1,
                    text: reason.trim(),
                  }),
                )
              )
                setResolution(null);
            }
          }}
        >
          {review ? (
            <>
              {reviewDetail()}
              <p>{at(l, 'reviewHelp')}</p>
              <label>
                {at(l, 'decision')}
                <select
                  value={review.decision}
                  onChange={(e) => {
                    setReview({ ...review, decision: e.target.value as AdminReview['decision'] });
                    setAck(false);
                  }}
                >
                  <option value="APPROVE">{at(l, 'approve')}</option>
                  <option value="SUSPEND">{at(l, 'suspend')}</option>
                  <option value="REJECT">{at(l, 'reject')}</option>
                </select>
              </label>
              <div className="admin-impact">
                <ShieldAlert size={18} />
                <p>{at(l, 'impact')}</p>
              </div>
            </>
          ) : (
            <>
              <div className="admin-review-summary">
                <h3>
                  {resolution?.type === 'MISSED_CHECK_IN'
                    ? qt(l, 'MISSED_CHECK_IN')
                    : resolution?.type === 'SOS'
                      ? 'SOS'
                      : at(l, 'safetyEvent')}
                </h3>
                <p>
                  {resolution && shopName(resolution.storeId)} · {resolution?.bookingId.slice(-8)}
                </p>
              </div>
              <p>{at(l, 'resolveHelp')}</p>
            </>
          )}
          <label>
            {at(l, 'reason')}
            <textarea
              required
              minLength={10}
              maxLength={500}
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {review && (
            <label className="admin-ack">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                required
              />
              <span>{at(l, 'ack')}</span>
            </label>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <div className="admin-dialog-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setResolution(null);
              }}
            >
              {at(l, 'cancel')}
            </button>
            <button
              className="button"
              disabled={busy || reason.trim().length < 10 || (!!review && !ack)}
            >
              {at(l, review ? 'confirm' : 'resolve')}
            </button>
          </div>
        </form>
      </MobileSheet>
    </div>
  );
}
