'use client';
import { VenueReviews } from './venue-settings';
import { ServiceProposalReviews } from './merchant-services';
import { mo } from '@/lib/merchant-operations-i18n';
import { MediaReview } from './media-review';
import { StorefrontReviews } from './storefront-reviews';
import { useDemoAccess } from '@/lib/use-runtime';
import { SystemDelivery } from './system-delivery';
import { rt } from '@/lib/runtime-i18n';
import { FinanceCenter } from './finance-center';
import { qt } from '@/lib/quality-i18n';
import { OnboardingReview } from './partner-portal';
import { NoShowPanel } from './no-show-panel';
import { EmergencyLookup, SharedLocation } from './safety-help';
import { ShopQuality, SuspensionImpactPanel } from './shop-quality';
import { AdminTodoBoard } from './admin-todo';
import { AdminNavigation } from './admin-navigation';
import { AdminCustomers } from './admin-customers';
import { AdminMetrics } from './admin-metrics';
import { SafetyHandlingPanel } from './safety-handling-panel';
import { sv as serviceModeLabel } from '@/lib/service-mode-i18n';
import { ot } from '@/lib/admin-operations-i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Download,
  FileCheck2,
  History,
  Leaf,
  ListChecks,
  LockKeyhole,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Store as StoreIcon,
  X,
} from 'lucide-react';
import type {
  Actor,
  AdminBooking,
  AdminReview,
  Audit,
  Locale,
  SafetyEvent,
} from '@hogulink/contracts';
import { bookingStatuses, canAdmin, type AdminTodo } from '@hogulink/contracts';
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
    [readError, setReadError] = useState(''),
    [notice, setNotice] = useState('');
  const [todo, setTodo] = useState<AdminTodo>();
  const [searches, setSearches] = useState<Record<string, string>>({
    orders: query.get('search') ?? '',
  });
  const search = searches[tab] ?? '';
  const setSearch = (value: string) => setSearches((old) => ({ ...old, [tab]: value }));
  const [shop, setShop] = useState(query.get('store') ?? ''),
    [status, setStatus] = useState('all'),
    [period, setPeriod] = useState(query.get('period') ?? 'all'),
    [targetType, setTargetType] = useState('all'),
    [reviewFilter, setReviewFilter] = useState('all'),
    [safetyFilter, setSafetyFilter] = useState('open'),
    [page, setPage] = useState(1);
  const [review, setReview] = useState<ReviewDraft | null>(null),
    [resolution, setResolution] = useState<SafetyEvent | null>(null),
    [reason, setReason] = useState(''),
    [ack, setAck] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [fulfillmentMode, setFulfillmentMode] = useState(query.get('fulfillmentMode') ?? '');
  const [dateFrom, setDateFrom] = useState(query.get('from') ?? '');
  const [dateTo, setDateTo] = useState(query.get('to') ?? '');
  const [orderSort, setOrderSort] = useState(query.get('sort') ?? 'newest');
  const requestedStatus = query.get('status'),
    requestedQueue = query.get('queue');
  const generation = useRef(0),
    hasRole = actor?.role === 'ADMIN';
  const href = (view: AdminTab, booking?: string) =>
    `/${l}/admin?${new URLSearchParams({
      tab: view,
      ...(view === 'orders'
        ? {
            search: searches.orders ?? '',
            store: shop,
            status,
            period,
            fulfillmentMode,
            from: dateFrom,
            to: dateTo,
            sort: orderSort,
          }
        : {}),
      ...(booking ? { booking } : {}),
    })}`;
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
      const [value, pending] = await Promise.all([
        api<Workspace>('admin/workspace'),
        api<AdminTodo>('admin/todo').catch(() => undefined),
      ]);
      if (version === generation.current) {
        setData(value);
        setTodo(pending);
        setReadError('');
      }
    } catch (e) {
      if (version === generation.current) {
        setReadError(errorText(l, e instanceof ClientError ? e.code : undefined));
        if (e instanceof ClientError && ['FORBIDDEN', 'UNAUTHENTICATED'].includes(e.code))
          setData(undefined);
      }
    } finally {
      if (version === generation.current) setFetching(false);
    }
  }, [actor, l]);
  useEffect(() => {
    setData(undefined);
    setReview(null);
    setResolution(null);
    setReadError('');
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15000);
    const onFocus = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      generation.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);
  useEffect(() => {
    setPage(1);
  }, [tab]);
  useEffect(() => {
    if (tab !== 'orders') return;
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
  }, [
    search,
    shop,
    status,
    period,
    targetType,
    reviewFilter,
    safetyFilter,
    fulfillmentMode,
    dateFrom,
    dateTo,
    orderSort,
  ]);
  const requestedBooking = query.get('booking');
  const orderFilterQuery = query.toString();
  useEffect(() => {
    if (tab !== 'orders') return;
    const values = new URLSearchParams(orderFilterQuery);
    setShop(values.get('store') ?? '');
    setPeriod(values.get('period') ?? 'all');
    setFulfillmentMode(values.get('fulfillmentMode') ?? '');
    setDateFrom(values.get('from') ?? '');
    setDateTo(values.get('to') ?? '');
    setOrderSort(values.get('sort') ?? 'newest');
    const value = values.get('search') ?? '';
    setSearches((old) => (old.orders === value ? old : { ...old, orders: value }));
  }, [tab, orderFilterQuery]);
  const orderTrigger = useRef<HTMLAnchorElement | null>(null);
  const focusOrder = query.get('focus');
  const focusedOrder = useRef('');
  useEffect(() => {
    if (requestedBooking) {
      focusedOrder.current = '';
      return;
    }
    if (tab !== 'orders' || !data || !focusOrder || focusedOrder.current === focusOrder) return;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLAnchorElement>(
        `.admin-orders-panel a[data-order-id="${CSS.escape(focusOrder)}"]`,
      );
      (target ?? document.querySelector<HTMLElement>('.admin-heading h1'))?.focus();
      focusedOrder.current = focusOrder;
    });
    return () => cancelAnimationFrame(frame);
  }, [requestedBooking, focusOrder, tab, data]);
  const orderWasOpen = useRef(false);
  useEffect(() => {
    if (orderWasOpen.current && !requestedBooking && tab === 'orders')
      orderTrigger.current?.focus();
    orderWasOpen.current = !!requestedBooking && tab === 'orders';
  }, [requestedBooking, tab]);
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
  const profileTarget = targets.find(
    (target) => target.id === query.get('entity') && target.type === query.get('entityType'),
  );
  const orders = data
    ? filterAdminOrders(data.bookings, {
        search,
        storeId: shop,
        status,
        period,
        fulfillmentMode,
        from: period === 'custom' ? dateFrom : '',
        to: period === 'custom' ? dateTo : '',
        sort: orderSort,
        describe: (b) =>
          `${shopName(b.storeId)} ${staffName(b.assignedListingId)} ${serviceName(b)}`,
      })
    : [];
  const selectedOrder = requestedBooking
    ? data?.bookings.find((b) => b.id === requestedBooking)
    : undefined;
  /** Tab badges use the to-do counts, so the board and the navigation always agree. */
  const tabCount = (view: AdminTab) =>
    view === 'orders'
      ? (todo?.orderAlerts?.open ?? 0)
      : view === 'safety'
        ? (todo?.safetyEvents ?? 0) + (todo?.cases?.attention ?? 0)
        : view === 'review'
          ? (todo?.media ?? 0) +
            (todo?.storefronts ?? 0) +
            (todo?.services ?? 0) +
            (todo?.onboarding ?? 0) +
            (todo?.venues ?? 0) +
            (todo?.aftercare ?? 0) +
            needReview.length
          : view === 'finance'
            ? (todo?.finance?.unmatched ?? 0) + (todo?.finance?.invoices ?? 0)
            : 0;
  const openCases = data?.cases.filter(activeCase) ?? [],
    openSafety = data?.safety.filter((s) => s.status === 'OPEN') ?? [];
  const urgentCount =
    openSafety.length +
    openCases.filter(
      (c) => c.priority === 'HIGH' || c.status === 'PLATFORM_ESCALATED' || c.dueAt < Date.now(),
    ).length;
  const trend = adminTrend(data?.bookings ?? []),
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
    `${a.action} ${auditLabel(l, a.action)} ${a.bookingId ?? ''}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const feeRows = (data?.feeEntries ?? []).filter((f) => !shop || f.storeId === shop);
  const operator = (entry: Audit) => {
    const role = entry.actorRole;
    return role === 'SYSTEM'
      ? at(l, 'automation')
      : role === 'ADMIN'
        ? at(l, 'platform')
        : role === 'MERCHANT'
          ? at(l, 'merchant')
          : role === 'STAFF'
            ? at(l, 'staff')
            : role === 'CUSTOMER'
              ? at(l, 'customer')
              : ot(l, 'unknownActor');
  };
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
        ...auditRows.map((a) => [
          dateTime(l, a.at),
          auditLabel(l, a.action),
          a.bookingId?.slice(-8) ?? '',
        ]),
      ]);
    else
      exportCsv('orders', [
        [
          at(l, 'reference'),
          at(l, 'shop'),
          at(l, 'status'),
          at(l, 'visit'),
          ot(l, 'created'),
          ot(l, 'allModes'),
          'JPY',
        ],
        ...orders.map((b) => [
          b.id.slice(-8),
          shopName(b.storeId),
          statusText(l, b.status),
          dateTime(l, b.quote.startAt),
          dateTime(l, b.createdAt),
          serviceModeLabel(l, b.quote.fulfillmentMode ?? 'HOME_VISIT'),
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
              {!compact && <th>{ot(l, 'created')}</th>}
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
                  <Link
                    className="admin-order-reference"
                    data-order-id={b.id}
                    href={href('orders', b.id)}
                    onClick={(e) => {
                      orderTrigger.current = e.currentTarget;
                    }}
                    scroll={false}
                  >
                    {b.id.slice(-8).toUpperCase()}
                  </Link>
                  <small>{shopName(b.storeId)}</small>
                </td>
                <td>
                  <strong>{serviceName(b)}</strong>
                  <small className="admin-service-mode">
                    {serviceModeLabel(l, b.quote.fulfillmentMode ?? 'HOME_VISIT')}
                  </small>
                  <small>
                    {staffName(b.assignedListingId)} ·{' '}
                    {Math.round((b.quote.endAt - b.quote.startAt) / 60000)} {at(l, 'minutes')}
                  </small>
                </td>
                <td>
                  {dateTime(l, b.quote.startAt)}
                  <small>JST</small>
                </td>
                {!compact && <td>{dateTime(l, b.createdAt)}</td>}
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
                    onClick={(e) => {
                      orderTrigger.current = e.currentTarget;
                    }}
                    scroll={false}
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
  const reviewSections = [
    'qualification',
    'venues',
    'media',
    'storefront',
    'services',
    'directory',
    'quality',
    'aftercare',
    'history',
  ] as const;
  const reviewCounts = {
    qualification: todo?.onboarding ?? 0,
    venues: todo?.venues ?? 0,
    media: todo?.media ?? 0,
    storefront: todo?.storefronts ?? 0,
    services: todo?.services ?? 0,
    directory: 0,
    quality: 0,
    aftercare: todo?.aftercare ?? 0,
    history: 0,
  };
  const requestedSection = query.get('section');
  const availableSections = reviewSections.filter(
    (key) =>
      canAdmin(actor, 'supply.write') ||
      !['qualification', 'venues', 'media', 'storefront', 'services'].includes(key),
  );
  const reviewSection =
    availableSections.find((key) => key === requestedSection) ??
    availableSections.find((key) => reviewCounts[key] > 0) ??
    (canAdmin(actor, 'supply.write') ? 'qualification' : 'directory');
  function reviewDetail(target: ReviewTarget | undefined = review?.target) {
    if (!target) return null;
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
              <dt>{c.label === 'routing' ? ot(l, 'routing') : at(l, c.label)}</dt>
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
      <AdminNavigation
        locale={l}
        active={tab}
        counts={Object.fromEntries(visibleTabs.map((view) => [view, tabCount(view)]))}
        hrefs={Object.fromEntries(visibleTabs.map((view) => [view, href(view)]))}
      />
      <div className="admin-content">
        <header className="admin-heading">
          <div>
            <span className="eyebrow">HOGULINK / OPERATIONS</span>
            <h1 tabIndex={-1}>{at(l, tab === 'overview' ? 'title' : tab)}</h1>
            <p>
              {tab === 'customers'
                ? ot(l, 'customerHelp')
                : tab === 'members'
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
        {(error || readError) && !review && !resolution && (
          <p className="notice error" role="alert">
            {error || readError}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {hasRole && !data && (
          <section className="admin-panel admin-empty" aria-busy={fetching}>
            {error || readError ? (
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
                {canAdmin(actor, 'cases.read') && urgentCount > 0 && (
                  <section className="admin-panel admin-priority" aria-live="polite">
                    <div className="admin-panel-heading">
                      <h2>{ot(l, 'priority')}</h2>
                      <Link href={href('safety')}>
                        {at(l, 'all')}
                        <ArrowUpRight size={15} />
                      </Link>
                    </div>
                    <div>
                      {openSafety
                        .slice()
                        .sort(
                          (a, b) =>
                            Number(b.type === 'SOS') - Number(a.type === 'SOS') ||
                            Number(!!a.handling) - Number(!!b.handling) ||
                            a.createdAt - b.createdAt,
                        )
                        .slice(0, 3)
                        .map((s) => (
                          <Link
                            href={href('safety', s.bookingId)}
                            key={s.id}
                            className={s.type === 'SOS' ? 'admin-critical-event' : undefined}
                          >
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
                            <span className="admin-pill warning">
                              {s.handling?.ownerName ?? ot(l, 'unassigned')}
                            </span>
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
                <AdminTodoBoard
                  locale={l}
                  todo={todo}
                  links={{
                    safety: href('safety'),
                    orders: `${href('orders')}&section=alerts`,
                    cases: `/${l}/admin/support`,
                    review: href('review'),
                    quality: `/${l}/admin/quality`,
                    content: `/${l}/admin/safety-review`,
                    finance: href('finance'),
                  }}
                />
                <AdminMetrics locale={l} data={data} canFinance={canAdmin(actor, 'finance.read')} />
                <div className="admin-overview-grid admin-overview-single">
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
                <section className="admin-panel">
                  <div className="admin-panel-heading">
                    <h2>{at(l, 'recentOrders')}</h2>
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
                  <details
                    className="admin-monitor-disclosure"
                    open={query.get('section') === 'alerts'}
                  >
                    <summary>
                      {at(l, 'orders')} · {todo?.orderAlerts?.open ?? 0}
                    </summary>
                    <OrderMonitor
                      key={`${actor.id}:${actor.adminRole}:${actor.adminSessionVersion}`}
                      locale={l}
                      actor={actor}
                      storeName={shopName}
                    />
                  </details>
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
                    {(['all', 'today', 'upcoming', 'custom'] as const).map((v) => (
                      <option value={v} key={v}>
                        {v === 'custom'
                          ? ot(l, 'customDates')
                          : at(l, v === 'all' ? 'allDates' : v)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={ot(l, 'allModes')}
                    value={fulfillmentMode}
                    onChange={(e) => setFulfillmentMode(e.target.value)}
                  >
                    <option value="">{ot(l, 'allModes')}</option>
                    {(['HOME_VISIT', 'IN_STORE'] as const).map((mode) => (
                      <option key={mode} value={mode}>
                        {serviceModeLabel(l, mode)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={ot(l, 'sort')}
                    value={orderSort}
                    onChange={(e) => setOrderSort(e.target.value)}
                  >
                    <option value="newest">{ot(l, 'newest')}</option>
                    <option value="visit">{ot(l, 'visitFirst')}</option>
                    <option value="amount">{ot(l, 'amountHigh')}</option>
                  </select>
                  {period === 'custom' && (
                    <>
                      <label>
                        {ot(l, 'dateFrom')}
                        <input
                          type="date"
                          value={dateFrom}
                          max={dateTo || undefined}
                          onChange={(e) => setDateFrom(e.target.value)}
                        />
                      </label>
                      <label>
                        {ot(l, 'dateTo')}
                        <input
                          type="date"
                          value={dateTo}
                          min={dateFrom || undefined}
                          onChange={(e) => setDateTo(e.target.value)}
                        />
                      </label>
                    </>
                  )}
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
                  <MobileSheet
                    open={true}
                    onClose={() =>
                      router.replace(`${href('orders')}&focus=${selectedOrder.id}`, {
                        scroll: false,
                      })
                    }
                    title={`${at(l, 'details')} · ${selectedOrder.id.slice(-8).toUpperCase()}`}
                    locale={l}
                    className="admin-order-drawer"
                  >
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
                          <p className="admin-service-mode">
                            {serviceModeLabel(
                              l,
                              selectedOrder.quote.fulfillmentMode ?? 'HOME_VISIT',
                            )}
                          </p>
                          {selectedOrder.quote.fulfillmentMode === 'IN_STORE' &&
                            selectedOrder.quote.venue && <p>{selectedOrder.quote.venue.address}</p>}
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
                      <details className="admin-order-history" open>
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
                  </MobileSheet>
                )}
                <p className="admin-footnote">{at(l, 'exportHelp')}</p>
              </>
            )}
            {tab === 'customers' && <AdminCustomers locale={l} actor={actor} />}
            {tab === 'review' && (
              <>
                <nav className="admin-section-tabs" aria-label={ot(l, 'reviewQueue')}>
                  {availableSections.map((key) => (
                    <Link
                      href={`${href('review')}&section=${key}`}
                      key={key}
                      aria-current={reviewSection === key ? 'page' : undefined}
                    >
                      {key === 'services' ? mo(l, 'reviews') : ot(l, key)}
                      {reviewCounts[key] > 0 && <b>{reviewCounts[key]}</b>}
                    </Link>
                  ))}
                </nav>
                {reviewSection === 'qualification' && canAdmin(actor, 'supply.write') && (
                  <OnboardingReview locale={l} onChanged={() => void refresh()} />
                )}
                {reviewSection === 'services' && canAdmin(actor, 'supply.write') && (
                  <ServiceProposalReviews locale={l} onChanged={() => void refresh()} />
                )}
                {reviewSection === 'venues' && canAdmin(actor, 'supply.write') && (
                  <VenueReviews locale={l} />
                )}
                {reviewSection === 'media' && canAdmin(actor, 'supply.write') && (
                  <MediaReview locale={l} />
                )}
                {reviewSection === 'storefront' && canAdmin(actor, 'supply.write') && (
                  <StorefrontReviews key={actor.id} locale={l} />
                )}
                {reviewSection === 'aftercare' && canAdmin(actor, 'supply.read') && (
                  <SuspensionImpactPanel locale={l} orderHref={(id) => href('orders', id)} />
                )}
                {reviewSection === 'quality' && canAdmin(actor, 'supply.read') && (
                  <ShopQuality locale={l} />
                )}
                {reviewSection === 'directory' && (
                  <>
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
                              <h3>
                                <Link
                                  scroll={false}
                                  href={`${href('review')}&section=directory&entity=${encodeURIComponent(target.id)}&entityType=${target.type}`}
                                >
                                  {target.name} ↗
                                </Link>
                              </h3>
                              <p>{target.subtitle}</p>
                              <div className="admin-checks">
                                {target.checks.map((c) => (
                                  <span key={c.label}>
                                    {c.ok ? <Check size={13} /> : <X size={13} />}{' '}
                                    {c.label === 'routing' ? ot(l, 'routing') : at(l, c.label)} ·{' '}
                                    {ot(l, c.ok ? 'ready' : 'incomplete')}
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
                            <details className="admin-supply-actions">
                              <summary>{ot(l, 'moreActions')}</summary>
                              <div>
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
                            </details>
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
                  </>
                )}
                {reviewSection === 'history' && (
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
                )}
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
                    <Link className="button secondary" href={href('customers')}>
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
                <div
                  className={`admin-safety-grid ${requestedBooking && !safetyCases.length ? 'admin-safety-focused' : ''}`}
                >
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
                        {s.location && <SharedLocation locale={l} location={s.location} />}

                        {canAdmin(actor, 'safety.write') && (
                          <SafetyHandlingPanel
                            locale={l}
                            actor={actor}
                            event={s}
                            assignees={data.assignees}
                            onChanged={refresh}
                          />
                        )}
                        <details className="admin-emergency-lookup">
                          <summary>
                            {l === 'ja'
                              ? '緊急時の所在地確認'
                              : l === 'en'
                                ? 'Emergency location access'
                                : '紧急查看服务地点'}
                          </summary>
                          {s.status === 'OPEN' && <EmergencyLookup locale={l} eventId={s.id} />}
                        </details>
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
                  {(!requestedBooking || safetyCases.length > 0) && (
                    <AdminCaseQueue
                      locale={l}
                      cases={safetyCases}
                      handling={data.caseHandling}
                      actorId={actor!.id}
                      assignees={data.assignees}
                      shopName={shopName}
                    />
                  )}
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
                              <strong title={a.action}>{auditLabel(l, a.action)}</strong>
                            </td>
                            <td>{operator(a)}</td>
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
        open={tab === 'review' && !!profileTarget}
        locale={l}
        title={ot(l, 'details')}
        className="admin-order-drawer"
        onClose={() => router.replace(`${href('review')}&section=directory`, { scroll: false })}
      >
        {profileTarget && data && (
          <section className="admin-panel">
            {reviewDetail(profileTarget)}
            <div className="admin-section-tabs">
              <Link
                href={`/${l}/admin?${new URLSearchParams({ tab: 'orders', store: profileTarget.storeId })}`}
              >
                {at(l, 'orders')} ↗
              </Link>
              <Link href={`${href('review')}&section=quality`}>{ot(l, 'quality')} ↗</Link>
              {canAdmin(actor, 'finance.read') && (
                <Link href={`${href('finance')}&section=plans&storeId=${profileTarget.storeId}`}>
                  {at(l, 'plan')} ↗
                </Link>
              )}
            </div>
            {profileTarget.type === 'STORE' && (
              <>
                <h3>{at(l, 'LISTING')}</h3>
                <div className="admin-customer-records">
                  {data.listings
                    .filter((x) => x.storeId === profileTarget.id)
                    .map((x) => (
                      <Link
                        key={x.id}
                        href={`${href('review')}&section=directory&entity=${encodeURIComponent(x.id)}&entityType=LISTING`}
                      >
                        <strong>{x.name[l]}</strong>
                      </Link>
                    ))}
                </div>
              </>
            )}
            <h3>{ot(l, 'orders')}</h3>
            {orderTable(
              data.bookings
                .filter((b) =>
                  profileTarget.type === 'STORE'
                    ? b.storeId === profileTarget.id
                    : profileTarget.type === 'LISTING'
                      ? b.assignedListingId === profileTarget.id
                      : b.quote.offeringId === profileTarget.id,
                )
                .slice(0, 5),
              true,
            )}
          </section>
        )}
      </MobileSheet>
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
