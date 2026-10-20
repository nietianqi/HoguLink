'use client';
import { useDemoAccess } from '@/lib/use-runtime';
import { goCustomerAccess } from './customer-signin';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  LifeBuoy,
  LockKeyhole,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  supportCategories,
  canAdmin,
  type Actor,
  type Booking,
  type CustomerBlock,
  type CustomerRestriction,
  type Locale,
  type PublicRestriction,
  type Role,
  type Store,
  type SafetyEvent,
  type SupportTicket,
  type TicketMessage,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, errorText, t } from '@/lib/i18n';
import { ct, categoryLabel, caseStatus, isCareKey } from '@/lib/care-i18n';
import { useSession } from './booking-form';
import { qt } from '@/lib/quality-i18n';
import { WorkspaceNav } from './workspace-nav';
import { dt } from '@/lib/desktop-i18n';
import { TicketHandlingPanel } from './ticket-handling-panel';
import Link from 'next/link';
import { et } from '@/lib/member-i18n';
import { ht, isHandlingKey } from '@/lib/handling-i18n';
import { RefundCasePanel } from './order-care';
import { af } from '@/lib/customer-flow-i18n';
import { ca } from '@/lib/customer-auth-i18n';
import { CaseDecisionPanel } from './case-decision';
import { gt, isGovernanceKey } from '@/lib/governance-i18n';
import type { CaseDecisionDetail } from '@hogulink/contracts';

type TicketDetail = {
  ticket: SupportTicket;
  messages: TicketMessage[];
  refundPending?: boolean;
  decision?: CaseDecisionDetail;
};
const activeCase = (ticket: SupportTicket) => !['RESOLVED', 'CLOSED'].includes(ticket.status);
export function CareCenter({
  locale: l,
  role,
  initialBookingId = '',
  initialTicketId = '',
  initialCategory,
}: {
  locale: Locale;
  role: Role;
  initialBookingId?: string;
  initialTicketId?: string;
  initialCategory?: string;
}) {
  const router = useRouter();
  const { actor, setActor, loading } = useSession();
  const demoAccess = useDemoAccess();
  const [demoShops, setDemoShops] = useState<Pick<Store, 'id' | 'name'>[]>([]);
  const [demoStaff, setDemoStaff] = useState<{ staffId: string; name: Store['name'] }[]>([]);
  const [account, setAccount] = useState(role === 'STAFF' ? 'staff-aoi' : 'store-nagi');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [blocks, setBlocks] = useState<CustomerBlock[]>([]);
  const [restrictions, setRestrictions] = useState<(CustomerRestriction | PublicRestriction)[]>([]);
  const [events, setEvents] = useState<SafetyEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [caseSearch, setCaseSearch] = useState('');
  const [caseFilter, setCaseFilter] = useState('all');
  const [selected, setSelected] = useState('');
  const preferredTicket = useRef(initialTicketId);
  const missingInitialTicket = useRef(false);
  const focusInitialTicket = useRef(initialTicketId);
  const [detail, setDetail] = useState<TicketDetail>();
  const [bookingId, setBookingId] = useState(initialBookingId);
  const [category, setCategory] = useState<'SERVICE_QUALITY' | (typeof supportCategories)[number]>(
    supportCategories.includes(initialCategory as (typeof supportCategories)[number])
      ? (initialCategory as (typeof supportCategories)[number])
      : 'SERVICE_QUALITY',
  );
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState('');
  const [appeal, setAppeal] = useState('');
  const [releaseRestriction, setReleaseRestriction] = useState(false);
  const [releaseBlock, setReleaseBlock] = useState(false);
  const [blockCustomer, setBlockCustomer] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [blockEnabled, setBlockEnabled] = useState(true);
  const [restrictedCustomer, setRestrictedCustomer] = useState('');
  const [restrictionReason, setRestrictionReason] = useState('');
  const [restrictionEnabled, setRestrictionEnabled] = useState(true);
  const [duration, setDuration] = useState(24);
  const [safetyNotes, setSafetyNotes] = useState<Record<string, string>>({});
  const loadVersion = useRef(0);
  const creationRetry = useRef({ body: '', key: '' });
  const creationLock = useRef(false);
  const signedIn = actor?.role === role && (role !== 'ADMIN' || canAdmin(actor, 'cases.read'));
  useEffect(() => {
    if (actor?.role === role) {
      const id = role === 'STAFF' ? actor.staffId : actor.storeId;
      if (id) setAccount(id);
    }
  }, [actor, role]);
  useEffect(() => {
    if (!detail || detail.ticket.id !== focusInitialTicket.current) return;
    focusInitialTicket.current = '';
    if (window.matchMedia('(max-width:760px)').matches)
      document.getElementById('case-detail')?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [detail]);
  function displayError(e: unknown) {
    const code = e instanceof ClientError ? e.code : '';
    return isCareKey(code)
      ? ct(l, code)
      : isHandlingKey(code)
        ? ht(l, code)
        : isGovernanceKey(code)
          ? gt(l, code)
          : errorText(l, code);
  }
  useEffect(() => {
    if (!demoAccess) return;
    Promise.all([
      api<Pick<Store, 'id' | 'name'>[]>('auth/demo-shops'),
      api<{ staffId: string; name: Store['name'] }[]>('auth/demo-staff'),
    ])
      .then(([shops, staff]) => {
        setDemoShops(shops);
        setDemoStaff(staff);
      })
      .catch(() => setError(t(l, 'error')));
  }, [l, demoAccess]);
  const refresh = useCallback(async () => {
    if (actor?.role !== role) return;
    if (role === 'ADMIN' && !canAdmin(actor, 'cases.read')) return;
    const generation = ++loadVersion.current;
    const [b, cases, shopBlocks, accountRestrictions, safety] = await Promise.all([
      api<Booking[]>('bookings'),
      api<SupportTicket[]>('support-tickets'),
      role === 'MERCHANT' ? api<CustomerBlock[]>('merchant/customer-blocks') : Promise.resolve([]),
      role === 'CUSTOMER'
        ? api<PublicRestriction[]>('customer/restrictions')
        : role === 'ADMIN' && canAdmin(actor, 'safety.write')
          ? api<CustomerRestriction[]>('admin/customer-restrictions')
          : Promise.resolve([]),
      role !== 'CUSTOMER' && (role !== 'ADMIN' || canAdmin(actor, 'safety.write'))
        ? api<SafetyEvent[]>('safety-events')
        : Promise.resolve([]),
    ]);
    if (generation !== loadVersion.current) return;
    setBookings(b);
    setTickets(cases);
    setBlocks(shopBlocks);
    setRestrictions(accountRestrictions);
    setEvents(safety);
    const preferred = preferredTicket.current;
    preferredTicket.current = '';
    if (preferred && !cases.some((x) => x.id === preferred)) {
      missingInitialTicket.current = true;
      setSelected('');
      setError(ct(l, 'linkedMissing'));
      return;
    }
    setSelected((previous) =>
      cases.some((x) => x.id === preferred)
        ? preferred
        : cases.some((x) => x.id === previous)
          ? previous
          : missingInitialTicket.current
            ? ''
            : (cases[0]?.id ?? ''),
    );
  }, [actor, role]);
  useEffect(() => {
    void refresh().catch((e) => setError(displayError(e)));
    return () => {
      loadVersion.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const tick = () => {
      if (!busy && document.visibilityState === 'visible')
        void refresh().catch((e) => setError(displayError(e)));
    };
    const timer = window.setInterval(tick, 15000);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [refresh, busy]);
  useEffect(() => {
    if (selected && missingInitialTicket.current) {
      missingInitialTicket.current = false;
      setError('');
    }
    setDetail(undefined);
    setDraft('');
    setReleaseBlock(false);
    setReleaseRestriction(false);
  }, [selected, signedIn]);
  useEffect(() => {
    let cancelled = false;
    if (!selected || !signedIn) {
      setDetail(undefined);
      return;
    }
    api<TicketDetail>(`support-tickets/${selected}`)
      .then((x) => {
        if (!cancelled) setDetail(x);
      })
      .catch((e) => {
        if (!cancelled) {
          setDetail(undefined);
          setError(displayError(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected, tickets, l, signedIn]);
  async function task(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setDraft('');
      await refresh();
      setNotice(ct(l, 'updated'));
    } catch (e) {
      setError(displayError(e));
      if (e instanceof ClientError && e.code === 'VERSION_CONFLICT')
        await refresh().catch(() => {});
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
    preferredTicket.current = initialTicketId;
    loadVersion.current++;
    setCaseSearch('');
    setCaseFilter('all');
    setBusy(true);
    setError('');
    try {
      setBookings([]);
      setTickets([]);
      setBlocks([]);
      setRestrictions([]);
      setEvents([]);
      setDetail(undefined);
      setSelected('');
      setSubject('');
      setDescription('');
      setDraft('');
      setAppeal('');
      setBlockReason('');
      setRestrictionReason('');
      setBlockCustomer('');
      setRestrictedCustomer('');
      setActor(
        await api<Actor>('auth/demo', {
          role,
          ...(role === 'STAFF' ? { staffId: account } : {}),
          ...(role === 'MERCHANT' ? { storeId: account } : {}),
        }),
      );
    } catch (e) {
      setError(displayError(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (creationLock.current || busy) return;
    creationLock.current = true;
    let createdId = '';
    try {
      await task(async () => {
        const body = { ...(bookingId ? { bookingId } : {}), category, subject, description };
        const fingerprint = JSON.stringify(body);
        if (creationRetry.current.body !== fingerprint)
          creationRetry.current = { body: fingerprint, key: crypto.randomUUID() };
        const ticket =
          role === 'STAFF'
            ? await api<SupportTicket>('staff/customer-feedback', { bookingId, text: description })
            : await api<SupportTicket>(
                'customer/support-tickets',
                body,
                'POST',
                creationRetry.current.key,
              );
        creationRetry.current = { body: '', key: '' };
        createdId = ticket.id;
        setSelected(ticket.id);
        setCaseSearch('');
        setCaseFilter('all');
        setSubject('');
        setDescription('');
      });
      if (createdId && role === 'CUSTOMER')
        router.replace(
          `/${l}/account/support?ticket=${encodeURIComponent(createdId)}#case-detail`,
          { scroll: false },
        );
    } finally {
      creationLock.current = false;
    }
  }
  function ticketAction(action: 'ESCALATE' | 'RESOLVE' | 'CLOSE' | 'REOPEN') {
    if (!detail) return;
    void task(() =>
      api(`support-tickets/${detail.ticket.id}/actions`, {
        version: detail.ticket.version,
        action,
        text: draft,
        releaseRestriction: action === 'RESOLVE' && releaseRestriction,
        releaseShopBlock: action === 'RESOLVE' && releaseBlock,
      }),
    );
  }
  const customers = [...new Map(bookings.map((b) => [b.customerId, b])).values()];
  const currentBlock = blocks.find((x) => x.customerId === blockCustomer);
  const currentRestriction = restrictions.find((x) => x.id === restrictedCustomer) as
    CustomerRestriction | undefined;
  const privateIssue = [
    'MERCHANT_UNREACHABLE',
    'QUALIFICATION',
    'SAFETY',
    'PRIVACY',
    'FINANCIAL',
  ].includes(category);
  const ticket = detail?.ticket;
  const reporter = ticket?.reporterId === actor?.id;
  function ticketTitle(value: SupportTicket) {
    return value.category === 'APPEAL'
      ? ct(l, 'APPEAL')
      : value.reporterRole === 'STAFF'
        ? ct(l, 'privateFeedback')
        : value.subject;
  }
  const visibleTickets = tickets.filter((item) => {
    if (caseFilter === 'open' && !activeCase(item)) return false;
    if (caseFilter === 'high' && (item.priority !== 'HIGH' || !activeCase(item))) return false;
    if (caseFilter === 'resolved' && activeCase(item)) return false;
    return `${item.id} ${ticketTitle(item)}`
      .toLocaleLowerCase()
      .includes(caseSearch.trim().toLocaleLowerCase());
  });
  useEffect(() => {
    if (missingInitialTicket.current && !selected) return;
    if (!visibleTickets.some((item) => item.id === selected)) {
      const next = visibleTickets[0]?.id ?? '';
      if (next !== selected) setSelected(next);
    }
  }, [caseSearch, caseFilter, tickets, selected]);
  return (
    <div className="workspace-layout">
      <WorkspaceNav locale={l} role={role} active="support" actor={actor} />
      <div className="workspace-content">
        <div className="workspace-title">
          <div>
            {role !== 'CUSTOMER' && <span className="eyebrow small">HOGULINK / CARE</span>}
            <h1>
              <LifeBuoy size={26} />
              {ct(l, 'center')}
            </h1>
            <p>{ct(l, 'subtitle')}</p>
          </div>
          {signedIn && (
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
        <div className="account-panel">
          <span className="account-avatar">
            <ShieldCheck size={24} />
          </span>
          <div>
            <strong>
              {signedIn
                ? (actor.displayName ??
                  (role === 'MERCHANT'
                    ? demoShops.find((s) => s.id === actor.storeId)?.name[l]
                    : demoStaff.find((x) => x.staffId === actor.staffId)?.name[l]) ??
                  t(
                    l,
                    role === 'CUSTOMER'
                      ? 'customer'
                      : role === 'ADMIN'
                        ? 'admin'
                        : role === 'MERCHANT'
                          ? 'merchant'
                          : 'staff',
                  ))
                : t(l, 'loginRequired')}
            </strong>
            <p>{ct(l, 'demoNote')}</p>
          </div>
          {demoAccess && role === 'MERCHANT' && (
            <select
              aria-label={t(l, 'shop')}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              {demoShops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name[l]}
                </option>
              ))}
            </select>
          )}
          {demoAccess && role === 'STAFF' && (
            <select
              aria-label={t(l, 'chooseStaff')}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              {demoStaff.map((s) => (
                <option key={s.staffId} value={s.staffId}>
                  {s.name[l]}
                </option>
              ))}
            </select>
          )}
          {!(role === 'ADMIN' && actor?.adminRole && actor.id !== 'demo-admin') &&
            (role !== 'CUSTOMER' || !signedIn) && (
              <button className="button small" disabled={busy || loading} onClick={login}>
                {role === 'CUSTOMER' ? ca(l, 'login') : ct(l, 'login')}
              </button>
            )}
          {role === 'ADMIN' && (
            <Link className="button secondary small" href={`/${l}/admin`}>
              {et(l, 'back')}
            </Link>
          )}
        </div>
        {role === 'ADMIN' && actor?.role === 'ADMIN' && !canAdmin(actor, 'cases.read') && (
          <p className="notice" role="status">
            {et(l, 'denied')}
          </p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="success notice" role="status">
            <Check size={16} />
            {notice}
          </p>
        )}
        {signedIn && (
          <>
            {role === 'CUSTOMER' &&
              restrictions.map((r) => (
                <section className="restriction-panel" key={r.id}>
                  <h2>
                    <ShieldAlert size={21} />
                    {ct(l, 'restriction')}
                  </h2>
                  <p>{ct(l, 'restrictedText')}</p>
                  <p>
                    <strong>
                      {ct(l, 'expires')}: {dateTime(l, r.expiresAt)} JST
                    </strong>
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void task(async () => {
                        const item = await api<SupportTicket>('customer/restriction-appeals', {
                          version: r.version,
                          text: appeal,
                        });
                        setSelected(item.id);
                        setAppeal('');
                      });
                    }}
                  >
                    <label className="field">
                      {ct(l, 'appealText')}
                      <textarea
                        aria-label={ct(l, 'appealText')}
                        value={appeal}
                        minLength={10}
                        maxLength={3000}
                        required
                        onChange={(e) => setAppeal(e.target.value)}
                      />
                    </label>
                    <button className="button small" disabled={busy}>
                      {ct(l, 'submitAppeal')}
                    </button>
                  </form>
                </section>
              ))}
            {(role === 'CUSTOMER' || role === 'STAFF') && (
              <details className="care-create" open={!!initialBookingId}>
                <summary>
                  {role === 'STAFF' ? ct(l, 'privateFeedback') : ct(l, 'create')} <span>＋</span>
                </summary>
                <form onSubmit={submit}>
                  <fieldset disabled={busy}>
                    <legend className="sr-only">{ct(l, 'create')}</legend>
                    <label className="field">
                      {ct(l, 'related')}
                      <select
                        aria-label={ct(l, 'related')}
                        value={bookingId}
                        required={role === 'STAFF' || !privateIssue}
                        onChange={(e) => setBookingId(e.target.value)}
                      >
                        <option value="">
                          {privateIssue && role === 'CUSTOMER'
                            ? ct(l, 'noBooking')
                            : ct(l, 'selectBooking')}
                        </option>
                        {bookings.map((b) => (
                          <option key={b.id} value={b.id}>
                            {dateTime(l, b.quote.startAt)} · {b.id.slice(-8)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {role === 'CUSTOMER' && (
                      <>
                        <label className="field">
                          {ct(l, 'category')}
                          <select
                            aria-label={ct(l, 'category')}
                            value={category}
                            onChange={(e) => setCategory(e.target.value as typeof category)}
                          >
                            {supportCategories
                              .filter((x) => x !== 'APPEAL')
                              .map((x) => (
                                <option key={x} value={x}>
                                  {categoryLabel(l, x)}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="field">
                          {ct(l, 'subject')}
                          <input
                            value={subject}
                            required
                            minLength={3}
                            maxLength={120}
                            onChange={(e) => setSubject(e.target.value)}
                          />
                        </label>
                      </>
                    )}
                    <label className="field">
                      {ct(l, 'description')}
                      <textarea
                        aria-label={ct(l, 'description')}
                        value={description}
                        required
                        minLength={10}
                        maxLength={3000}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </label>
                    <p className="care-privacy">
                      <LockKeyhole size={15} />
                      {role === 'STAFF'
                        ? ct(l, 'feedbackHelp')
                        : ct(l, privateIssue ? 'confidential' : 'shared')}
                    </p>
                    <button className="button" disabled={busy}>
                      {ct(l, 'submit')}
                    </button>
                  </fieldset>
                </form>
              </details>
            )}
            <div className="care-layout">
              <section className="case-list" id="case-list" aria-label={ct(l, 'myCases')}>
                <div className="case-list-heading">
                  <h2>{ct(l, 'myCases')}</h2>
                  <span>
                    {visibleTickets.length} / {tickets.length}
                  </span>
                </div>
                <div className="case-filters">
                  <input
                    type="search"
                    aria-label={dt(l, 'caseSearch')}
                    placeholder={dt(l, 'caseSearch')}
                    value={caseSearch}
                    onChange={(e) => setCaseSearch(e.target.value)}
                  />
                  <select
                    aria-label={dt(l, 'allCases')}
                    value={caseFilter}
                    onChange={(e) => setCaseFilter(e.target.value)}
                  >
                    <option value="all">{dt(l, 'allCases')}</option>
                    <option value="open">{dt(l, 'openCases')}</option>
                    <option value="high">{dt(l, 'highPriority')}</option>
                    <option value="resolved">{dt(l, 'resolvedCases')}</option>
                  </select>
                </div>
                {!visibleTickets.length && <p className="muted care-empty">{ct(l, 'empty')}</p>}
                {visibleTickets.map((item) => (
                  <button
                    className={`case-list-item ${selected === item.id ? 'selected' : ''}`}
                    key={item.id}
                    onClick={() => {
                      setSelected(item.id);
                      if (role === 'CUSTOMER')
                        router.replace(
                          `/${l}/account/support?ticket=${encodeURIComponent(item.id)}#case-detail`,
                          { scroll: false },
                        );
                      if (window.matchMedia('(max-width: 760px)').matches)
                        document.getElementById('case-detail')?.scrollIntoView({
                          block: 'start',
                          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                            ? 'instant'
                            : 'smooth',
                        });
                    }}
                    aria-pressed={selected === item.id}
                  >
                    <span
                      className={`status-badge ${item.priority === 'HIGH' ? 'priority-high' : ''}`}
                    >
                      {caseStatus(l, item.status)}
                    </span>
                    <strong>{ticketTitle(item)}</strong>
                    <small>
                      {categoryLabel(l, item.category)} · {dateTime(l, item.updatedAt)}
                    </small>
                    {item.visibility === 'PLATFORM_ONLY' && <LockKeyhole size={13} />}
                  </button>
                ))}
              </section>
              <section className="case-detail" id="case-detail">
                <a className="mobile-case-back" href="#case-list">
                  ← {ct(l, 'myCases')}
                </a>
                {!ticket ? (
                  <div className="care-empty">
                    <MessageSquare size={30} />
                    <p>{ct(l, 'choose')}</p>
                  </div>
                ) : (
                  <>
                    <div className="case-detail-heading">
                      <span className="eyebrow small">
                        {role === 'CUSTOMER'
                          ? `${ct(l, 'caseReference')} ${ticket.id.slice(-8).toUpperCase()}`
                          : `CASE / ${ticket.id.slice(-8).toUpperCase()} · v${ticket.version}`}
                      </span>
                      <h2>{ticketTitle(ticket)}</h2>
                      <div className="button-row">
                        <span className="status-badge">{caseStatus(l, ticket.status)}</span>
                        {ticket.priority === 'HIGH' && (
                          <span className="care-priority">{ct(l, 'high')}</span>
                        )}
                        <span className="muted">{categoryLabel(l, ticket.category)}</span>
                      </div>
                    </div>
                    <p className="care-privacy">
                      <LockKeyhole size={14} />
                      {ct(l, ticket.visibility === 'PLATFORM_ONLY' ? 'confidential' : 'shared')}
                    </p>
                    {['NEEDS_MERCHANT', 'PLATFORM_ESCALATED'].includes(ticket.status) && (
                      <p className="muted">
                        {ct(l, 'deadline')}: {dateTime(l, ticket.dueAt)} JST
                      </p>
                    )}
                    <div className="case-description">{ticket.description}</div>
                    {ticket.refundRequestId && actor && role !== 'STAFF' && (
                      <RefundCasePanel
                        key={ticket.id}
                        locale={l}
                        ticket={ticket}
                        actor={actor}
                        onUpdated={() => void task(refresh)}
                      />
                    )}
                    {detail?.refundPending && <p className="notice">{af(l, 'cannotClose')}</p>}
                    {ticket.bookingId && (
                      <p className="muted">
                        {ct(l, 'related')}: {ticket.bookingId.slice(-8)}
                        {role === 'CUSTOMER' && (
                          <Link
                            className="governance-link"
                            href={`/${l}/account/bookings/${ticket.bookingId}`}
                          >
                            {ct(l, 'openBooking')} ↗
                          </Link>
                        )}
                        {role === 'MERCHANT' && (
                          <Link
                            className="governance-link"
                            href={`/${l}/merchant?tab=bookings&booking=${encodeURIComponent(ticket.bookingId)}`}
                          >
                            {gt(l, 'gatherFacts')}
                          </Link>
                        )}
                      </p>
                    )}
                    {role === 'ADMIN' && actor && (
                      <TicketHandlingPanel
                        key={`${actor.id}:${ticket.id}`}
                        locale={l}
                        ticket={ticket}
                        actor={actor}
                        onConflict={refresh}
                      />
                    )}
                    <div className="case-thread">
                      {actor && role !== 'STAFF' && (
                        <CaseDecisionPanel
                          key={`${actor.id}:${ticket.id}`}
                          locale={l}
                          actor={actor}
                          ticket={ticket}
                          messages={detail?.messages ?? []}
                          onUpdated={() => void task(refresh)}
                        />
                      )}
                      {detail?.decision?.current && detail.decision.state !== 'READY_TO_CLOSE' && (
                        <p className="notice">{gt(l, 'blocked')}</p>
                      )}
                      {detail?.messages.map((m) => (
                        <article key={m.id}>
                          <div>
                            <strong>
                              {t(
                                l,
                                m.role === 'CUSTOMER'
                                  ? 'customer'
                                  : m.role === 'MERCHANT'
                                    ? 'merchant'
                                    : m.role === 'STAFF'
                                      ? 'staff'
                                      : 'admin',
                              )}
                            </strong>
                            <time>{dateTime(l, m.createdAt)}</time>
                          </div>
                          <p>{m.text}</p>
                        </article>
                      ))}
                    </div>
                    {ticket.resolution && (
                      <div className="case-resolution">
                        <strong>
                          <Check size={16} />
                          {ct(l, 'decision')}
                        </strong>
                        <p>{ticket.resolution}</p>
                      </div>
                    )}
                    {(activeCase(ticket) || reporter) && (
                      <div className="case-compose">
                        <label className="field">
                          {ct(l, 'reply')}
                          <textarea
                            aria-label={ct(l, 'reply')}
                            value={draft}
                            maxLength={3000}
                            placeholder={ct(l, 'replyPlaceholder')}
                            onChange={(e) => setDraft(e.target.value)}
                          />
                        </label>
                        {role === 'ADMIN' &&
                          canAdmin(actor, 'safety.write') &&
                          activeCase(ticket) &&
                          ticket.category === 'APPEAL' && (
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={releaseRestriction}
                                onChange={(e) => setReleaseRestriction(e.target.checked)}
                              />
                              {ct(l, 'releaseRestriction')}
                            </label>
                          )}
                        {role === 'ADMIN' &&
                          canAdmin(actor, 'safety.write') &&
                          activeCase(ticket) &&
                          ticket.reporterRole === 'STAFF' && (
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={releaseBlock}
                                onChange={(e) => setReleaseBlock(e.target.checked)}
                              />
                              {ct(l, 'releaseBlock')}
                            </label>
                          )}
                        <div className="button-row">
                          {activeCase(ticket) && (
                            <>
                              <button
                                className="button small"
                                disabled={busy || draft.trim().length < 3}
                                onClick={() =>
                                  task(() =>
                                    api(`support-tickets/${ticket.id}/messages`, {
                                      version: ticket.version,
                                      text: draft,
                                    }),
                                  )
                                }
                              >
                                {ct(l, 'send')}
                              </button>
                              {ticket.status !== 'PLATFORM_ESCALATED' && role !== 'ADMIN' && (
                                <button
                                  className="button secondary small"
                                  disabled={busy || draft.trim().length < 3}
                                  onClick={() => ticketAction('ESCALATE')}
                                >
                                  {ct(l, 'escalate')}
                                </button>
                              )}
                              {(role === 'ADMIN' ||
                                (role === 'MERCHANT' &&
                                  ticket.status !== 'PLATFORM_ESCALATED')) && (
                                <button
                                  className="button secondary small"
                                  disabled={
                                    busy ||
                                    draft.trim().length < 3 ||
                                    detail?.refundPending ||
                                    (!!detail?.decision?.current &&
                                      detail.decision.state !== 'READY_TO_CLOSE')
                                  }
                                  onClick={() => {
                                    if (!detail?.refundPending) void ticketAction('RESOLVE');
                                  }}
                                  title={detail?.refundPending ? af(l, 'cannotClose') : undefined}
                                >
                                  {ct(l, 'resolve')}
                                </button>
                              )}
                            </>
                          )}
                          {ticket.status === 'RESOLVED' && reporter && (
                            <button
                              className="button small"
                              disabled={busy || draft.trim().length < 3}
                              onClick={() => ticketAction('CLOSE')}
                            >
                              {ct(l, 'close')}
                            </button>
                          )}
                          {!activeCase(ticket) && reporter && (
                            <button
                              className="button secondary small"
                              disabled={busy || draft.trim().length < 3}
                              onClick={() => ticketAction('REOPEN')}
                            >
                              {ct(l, 'reopen')}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
            {role === 'MERCHANT' && (
              <section className="form-card top-space">
                <h2>{ct(l, 'blocks')}</h2>
                <p className="muted">{ct(l, 'blockHelp')}</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void task(() =>
                      api(
                        `merchant/customer-blocks/${encodeURIComponent(blockCustomer)}`,
                        {
                          active: blockEnabled,
                          reason: blockReason,
                          version: currentBlock?.version ?? 0,
                        },
                        'PUT',
                      ),
                    );
                  }}
                >
                  <fieldset disabled={busy}>
                    <div className="field-grid">
                      <label className="field">
                        {ct(l, 'customer')}
                        <select
                          aria-label={ct(l, 'customer')}
                          required
                          value={blockCustomer}
                          onChange={(e) => {
                            setBlockCustomer(e.target.value);
                            const value = blocks.find((x) => x.customerId === e.target.value);
                            setBlockReason(value?.reason ?? '');
                            setBlockEnabled(value?.active ?? true);
                          }}
                        >
                          <option value="">{ct(l, 'customer')}</option>
                          {customers.map((b) => (
                            <option key={b.customerId} value={b.customerId}>
                              {b.customerId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        {ct(l, 'privateReason')}
                        <input
                          value={blockReason}
                          disabled={!!currentBlock?.reviewRequired}
                          minLength={3}
                          maxLength={1000}
                          required
                          onChange={(e) => setBlockReason(e.target.value)}
                        />
                      </label>
                    </div>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={blockEnabled}
                        disabled={!!currentBlock?.reviewRequired}
                        onChange={(e) => setBlockEnabled(e.target.checked)}
                      />
                      {ct(l, 'blockActive')}
                    </label>
                    <button
                      className="button small"
                      disabled={busy || !blockCustomer || !!currentBlock?.reviewRequired}
                    >
                      {ct(l, 'saveBlock')}
                    </button>
                  </fieldset>
                </form>
                <div className="care-records">
                  {blocks.map((block) => (
                    <div key={block.id}>
                      <div>
                        <strong>{block.customerId}</strong>
                        <p>{block.reviewRequired ? ct(l, 'reviewRequired') : block.reason}</p>
                        <small>
                          {ct(l, block.active ? 'active' : 'inactive')} · v{block.version}
                        </small>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => {
                          setBlockCustomer(block.customerId);
                          setBlockReason(block.reason);
                          setBlockEnabled(block.active);
                        }}
                      >
                        {ct(l, 'editing')}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {role === 'ADMIN' && canAdmin(actor, 'safety.write') && (
              <section className="form-card top-space">
                <h2>{ct(l, 'restrictions')}</h2>
                <p className="muted">{ct(l, 'restrictionHelp')}</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void task(() =>
                      api('admin/customer-restrictions', {
                        customerId: restrictedCustomer,
                        active: restrictionEnabled,
                        reason: restrictionReason,
                        expiresAt: Date.now() + duration * 60 * 60_000,
                        version: currentRestriction?.version ?? 0,
                      }),
                    );
                  }}
                >
                  <fieldset disabled={busy}>
                    <div className="field-grid">
                      <label className="field">
                        {ct(l, 'customer')}
                        <select
                          aria-label={ct(l, 'customer')}
                          required
                          value={restrictedCustomer}
                          onChange={(e) => {
                            setRestrictedCustomer(e.target.value);
                            const value = restrictions.find((x) => x.id === e.target.value) as
                              CustomerRestriction | undefined;
                            setRestrictionReason(value?.reason ?? '');
                            setRestrictionEnabled(value?.active ?? true);
                          }}
                        >
                          <option value="">{ct(l, 'customer')}</option>
                          {[
                            ...new Set([
                              ...customers.map((b) => b.customerId),
                              ...restrictions.map((r) => r.id),
                            ]),
                          ].map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        {ct(l, 'duration')}
                        <select
                          aria-label={ct(l, 'duration')}
                          value={duration}
                          onChange={(e) => setDuration(Number(e.target.value))}
                        >
                          {[1, 24, 72, 168, 720].map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="field">
                      {ct(l, 'privateReason')}
                      <textarea
                        aria-label={ct(l, 'privateReason')}
                        value={restrictionReason}
                        minLength={3}
                        maxLength={1000}
                        required
                        onChange={(e) => setRestrictionReason(e.target.value)}
                      />
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={restrictionEnabled}
                        onChange={(e) => setRestrictionEnabled(e.target.checked)}
                      />
                      {ct(l, 'enabled')}
                    </label>
                    <button className="button small" disabled={busy || !restrictedCustomer}>
                      {ct(l, 'saveRestriction')}
                    </button>
                  </fieldset>
                </form>
                <div className="care-records">
                  {(restrictions as CustomerRestriction[]).map((r) => (
                    <div key={r.id}>
                      <div>
                        <strong>{r.id}</strong>
                        <p>{r.reason}</p>
                        <small>
                          {ct(
                            l,
                            !r.active
                              ? 'inactive'
                              : r.expiresAt <= Date.now()
                                ? 'expired'
                                : 'active',
                          )}{' '}
                          · {dateTime(l, r.expiresAt)} · v{r.version}
                        </small>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => {
                          setRestrictedCustomer(r.id);
                          setRestrictionReason(r.reason);
                          setRestrictionEnabled(r.active);
                        }}
                      >
                        {ct(l, 'editing')}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {role !== 'CUSTOMER' && (role !== 'ADMIN' || canAdmin(actor, 'safety.write')) && (
              <section className="form-card top-space">
                <h2>{ct(l, 'safetyEvents')}</h2>
                <p className="muted">{ct(l, 'safetyNote')}</p>
                {!events.length && <p>{ct(l, 'noSafety')}</p>}
                {events.map((event) => (
                  <article className="care-safety-event" key={event.id}>
                    <div className="button-row">
                      <ShieldAlert size={19} />
                      <strong>
                        {event.type === 'MISSED_CHECK_IN'
                          ? qt(l, 'MISSED_CHECK_IN')
                          : event.type === 'SOS'
                            ? t(l, 'sos')
                            : t(l, 'terminate')}
                      </strong>
                      <span className="status-badge">
                        {ct(l, event.status === 'OPEN' ? 'open' : 'resolved')}
                      </span>
                      <small>
                        {dateTime(l, event.createdAt)} · {event.bookingId.slice(-8)}
                      </small>
                    </div>
                    {role === 'ADMIN' && event.resolution && (
                      <p className="case-description">{event.resolution}</p>
                    )}
                    {role === 'ADMIN' && event.status === 'OPEN' && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void task(() =>
                            api(`admin/safety-events/${event.id}/resolve`, {
                              version: event.version ?? 1,
                              text: safetyNotes[event.id] ?? '',
                            }),
                          );
                        }}
                      >
                        <label className="field">
                          {ct(l, 'safetyResolution')}
                          <textarea
                            aria-label={`${ct(l, 'safetyResolution')} ${event.id.slice(-8)}`}
                            value={safetyNotes[event.id] ?? ''}
                            minLength={10}
                            maxLength={3000}
                            required
                            onChange={(e) =>
                              setSafetyNotes((previous) => ({
                                ...previous,
                                [event.id]: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <button className="button secondary small" disabled={busy}>
                          {ct(l, 'resolveSafety')}
                        </button>
                      </form>
                    )}
                  </article>
                ))}
              </section>
            )}
            <p className="notice top-space">
              <ShieldCheck size={17} />
              {ct(l, 'demoNote')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
