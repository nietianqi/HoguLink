'use client';
import { InStoreOrder } from './in-store-order';
import { rt } from '@/lib/runtime-i18n';
import { useDemoAccess } from '@/lib/use-runtime';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coffee,
  Leaf,
  LifeBuoy,
  ListChecks,
  MapPin,
  MessageCircle,
  Navigation,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  UserRound,
} from 'lucide-react';
import type {
  Actor,
  Booking,
  Listing,
  Locale,
  Message,
  Offering,
  TimeOffRequest,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { areaName, dateTime, errorText, languageNames, statusText, t } from '@/lib/i18n';
import { ft, staffTabs, type StaffTab, type StaffTextKey } from '@/lib/staff-i18n';
import { NoShowPanel } from './no-show-panel';
import {
  canProgress,
  canRespond,
  focusTask,
  isOpenTask,
  nextEvent,
  staffNumbers,
} from '@/lib/staff-model';
import { japanDay } from '@/lib/desktop-model';
import { japanInput, parseJapanInput } from '@/lib/merchant-model';
import { useSession } from './booking-form';
import { MobileSheet } from './mobile-ui';
import { PartnerEntry } from './partner-portal';
import { QualityEntry, ArrivalPanel, SafetyDeskPanel } from './quality-workspace';
import { OrderCoordination, StaffCooperationInbox } from './order-coordination';
import { wt } from '@/lib/workday-i18n';
import { WorkdayTools } from './workday-tools';
import { CompletionPanel } from './completion-panel';
import { PartnerOrderFlow } from './partner-order-flow';
import { pf } from '@/lib/partner-flow-i18n';

type Block = {
  id: string;
  startAt: number;
  endAt: number;
  reason: TimeOffRequest['reason'];
  active: boolean;
};
type Workspace = {
  listing: Listing;
  store: {
    id: string;
    name: Record<Locale, string>;
    areas: string[];
    emergencyContact: string;
    acceptanceMode: string;
  };
  eligible: boolean;
  dutyExpiresAt: number;
  offerings: Offering[];
  blocks: Block[];
  requests: TimeOffRequest[];
  safety: { id: string; bookingId: string; type: string; status: string; createdAt: number }[];
};
type Review = { booking: Booking; action: 'ack' | 'decline' | 'COMPLETE' | 'SAFETY_TERMINATION' };
const icons = { overview: Sparkles, tasks: ListChecks, schedule: CalendarDays, profile: UserRound };
const eventLabels: Record<string, StaffTextKey> = {
  EN_ROUTE: 'enRoute',
  ARRIVED: 'arrived',
  START: 'begin',
  COMPLETE: 'complete',
};
const reasons = ['scheduleConflict', 'health', 'transport', 'safetyConcern', 'other'] as const;

export function StaffWorkspace({ locale: l }: { locale: Locale }) {
  const router = useRouter();
  const query = useSearchParams(),
    requested = query.get('tab') as StaffTab;
  const tab = staffTabs.includes(requested) ? requested : 'overview';
  const { actor, setActor, loading } = useSession();
  const demoAccess = useDemoAccess();
  const [demoStaff, setDemoStaff] = useState<
      { staffId: string; name: Listing['name']; storeName: Listing['name'] }[]
    >([]),
    [data, setData] = useState<Workspace>(),
    [bookings, setBookings] = useState<Booking[]>([]);
  const [account, setAccount] = useState('staff-aoi'),
    [busy, setBusy] = useState(false),
    [fetching, setFetching] = useState(false),
    [error, setError] = useState(''),
    [readError, setReadError] = useState(''),
    [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now()),
    [updated, setUpdated] = useState<number>(),
    [day, setDay] = useState(japanDay(Date.now())),
    [filter, setFilter] = useState('active'),
    [search, setSearch] = useState('');
  const [review, setReview] = useState<Review | null>(null),
    [eta, setEta] = useState(45),
    [reason, setReason] = useState<(typeof reasons)[number]>('scheduleConflict'),
    [note, setNote] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false),
    [leaveDraft, setLeaveDraft] = useState({
      start: '',
      end: '',
      reason: 'BREAK' as TimeOffRequest['reason'],
    });
  const [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(''),
    [messageState, setMessageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const messageGeneration = useRef(0),
    sendLock = useRef(false);
  const [requestLimit, setRequestLimit] = useState(12);
  const generation = useRef(0),
    retry = useRef({ payload: '', key: '' });
  const hasRole = actor?.role === 'STAFF';
  useEffect(() => {
    if (actor?.role === 'STAFF' && actor.onboardingOnly)
      router.replace(`/${l}/onboarding?role=STAFF`);
  }, [actor, l, router]);
  const href = (view: StaffTab, booking?: string) =>
    `/${l}/staff?${new URLSearchParams({ tab: view, ...(booking ? { booking } : {}) })}${booking ? '#staff-task-detail' : ''}`;
  const fail = useCallback(
    (e: unknown) => {
      const code = e instanceof ClientError ? e.code : undefined;
      setError(
        code === 'INVALID_TIME' || code === 'REQUEST_LIMIT' ? ft(l, code) : errorText(l, code),
      );
    },
    [l],
  );
  const refresh = useCallback(async () => {
    if (actor?.role !== 'STAFF' || actor.onboardingOnly) return;
    const version = ++generation.current;
    setFetching(true);
    try {
      const [workspace, orders] = await Promise.all([
        api<Workspace>('staff/workspace'),
        api<Booking[]>('bookings'),
      ]);
      if (version !== generation.current) return;
      setData(workspace);
      setBookings(orders);
      setAccount(workspace.listing.staffId);
      setUpdated(Date.now());
      setNow(Date.now());
      setReadError('');
    } catch (e) {
      if (version === generation.current) {
        setReadError(errorText(l, e instanceof ClientError ? e.code : undefined));
        if (e instanceof ClientError && ['FORBIDDEN', 'UNAUTHENTICATED'].includes(e.code)) {
          setData(undefined);
          setBookings([]);
          setMessages([]);
        }
      }
    } finally {
      if (version === generation.current) setFetching(false);
    }
  }, [actor, l]);
  useEffect(() => {
    if (!demoAccess) return;
    api<{ staffId: string; name: Listing['name']; storeName: Listing['name'] }[]>('auth/demo-staff')
      .then(setDemoStaff)
      .catch(fail);
  }, [fail, demoAccess]);
  useEffect(() => {
    setData(undefined);
    setBookings([]);
    setMessages([]);
    setDraft('');
    setReview(null);
    setLeaveOpen(false);
    setReadError('');
    void refresh();
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      generation.current++;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [refresh]);
  async function login() {
    generation.current++;
    setData(undefined);
    setBookings([]);
    setMessages([]);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setActor(await api<Actor>('auth/demo', { role: 'STAFF', staffId: account }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function mutate(fn: () => Promise<unknown>, success = ft(l, 'saved')) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await refresh();
      setNotice(success);
      return true;
    } catch (e) {
      fail(e);
      if (
        e instanceof ClientError &&
        [
          'VERSION_CONFLICT',
          'INVALID_STATE',
          'INVALID_TRANSITION',
          'STAFF_VISIT_IN_PROGRESS',
        ].includes(e.code)
      ) {
        setReview(null);
        await refresh();
      }
      return false;
    } finally {
      setBusy(false);
    }
  }
  const items = bookings
    .filter(
      (b) =>
        (filter === 'all' ||
          (filter === 'pending'
            ? canRespond(b)
            : filter === 'history'
              ? !isOpenTask(b)
              : isOpenTask(b))) &&
        `${b.id} ${areaName(l, b.quote.area)} ${data?.offerings.find((o) => o.id === b.quote.offeringId)?.name[l] ?? ''}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) =>
      filter === 'history'
        ? b.updatedAt - a.updatedAt
        : Number(canRespond(b)) - Number(canRespond(a)) || a.quote.startAt - b.quote.startAt,
    );
  const requestedBooking = query.get('booking');
  useEffect(() => {
    if (requestedBooking) {
      setFilter('all');
      setSearch('');
    }
  }, [requestedBooking]);
  const selected = requestedBooking ? bookings.find((b) => b.id === requestedBooking) : items[0];
  const selectedId = selected?.id,
    messageAllowed = !!selected && canProgress(selected) && !!selected.address;
  useEffect(() => {
    setMessages([]);
    setDraft('');
  }, [selectedId, actor?.id]);
  const loadMessages = useCallback(async () => {
    const generation = ++messageGeneration.current;
    setMessageState('loading');
    if (!messageAllowed || !selectedId) {
      setMessages([]);
      return;
    }
    try {
      const value = await api<Message[]>(`staff/tasks/${selectedId}/messages`);
      if (generation !== messageGeneration.current) return;
      setMessages(value);
      setMessageState('ready');
    } catch {
      if (generation === messageGeneration.current) setMessageState('error');
    }
  }, [selectedId, actor?.id, messageAllowed]);
  useEffect(() => {
    void loadMessages();
    return () => {
      messageGeneration.current++;
    };
  }, [loadMessages, selected?.version, updated]);
  const stats = staffNumbers(bookings, now),
    focus = focusTask(bookings),
    online = !!data?.listing.onDuty && data.dutyExpiresAt > now;
  const upcoming = bookings
    .filter((b) => isOpenTask(b) && b.quote.endAt > now)
    .sort((a, b) => a.quote.startAt - b.quote.startAt);
  const time = (at: number) =>
    new Intl.DateTimeFormat(l, {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(at);
  const offering = (b: Booking) =>
    b.quote.serviceName?.[l] ??
    data?.offerings.find((o) => o.id === b.quote.offeringId)?.name[l] ??
    ft(l, 'service');
  const duration = (b: Booking) => Math.round((b.quote.endAt - b.quote.startAt) / 60000);
  const taskStatus = (b: Booking) =>
    b.replacementConsent === 'PENDING' && b.proposedListingId
      ? wt(l, 'consentPending')
      : isOpenTask(b) && ['DECLINED', 'WITHDRAWN'].includes(b.staffTaskStatus)
        ? ft(l, 'rearranging')
        : canRespond(b)
          ? ft(l, 'pending')
          : statusText(l, b.status);
  function openReview(b: Booking, action: Review['action']) {
    setReview({ booking: b, action });
    setEta(b.arrivalMinutes ?? 45);
    setReason('scheduleConflict');
    setNote('');
    setError('');
  }
  async function submitReview() {
    if (!review) return;
    const { booking: b, action } = review;
    const path =
      action === 'SAFETY_TERMINATION'
        ? 'staff/safety-alerts'
        : `staff/tasks/${b.id}/${action === 'COMPLETE' ? 'events' : action === 'decline' && b.staffTaskStatus === 'ACKNOWLEDGED' ? 'withdraw' : action}`;
    const payload = {
      version: b.version,
      ...(action === 'ack' && b.quote.bookingMode === 'INSTANT' ? { arrivalMinutes: eta } : {}),
      ...(action === 'decline' ? { reason: `${reason}: ${note.trim() || ft(l, reason)}` } : {}),
      ...(action === 'COMPLETE' ? { event: 'COMPLETE' } : {}),
      ...(action === 'SAFETY_TERMINATION' ? { bookingId: b.id, type: action } : {}),
    };
    if (await mutate(() => api(path, payload))) setReview(null);
  }
  function openLeave() {
    const start = Math.max(
      Date.parse(`${day}T09:00:00+09:00`),
      Math.ceil((Date.now() + 60000) / 900000) * 900000,
    );
    setLeaveDraft({ start: japanInput(start), end: japanInput(start + 3600000), reason: 'BREAK' });
    setLeaveOpen(true);
    setError('');
    retry.current = { payload: '', key: '' };
  }
  function dutyCard() {
    return (
      <section className="staff-panel staff-duty">
        <div className="staff-panel-title">
          <h2>{ft(l, 'standby')}</h2>
          <span className={`staff-state ${online ? 'online' : ''}`}>
            <i />
            {ft(l, online ? 'online' : data?.listing.onDuty ? 'expired' : 'offline')}
          </span>
        </div>
        <p>{ft(l, 'dutyHelp')}</p>
        {online && (
          <div className="staff-expiry">
            <Clock3 size={15} />
            {ft(l, 'until')} <strong>{time(data!.dutyExpiresAt)} JST</strong>
          </div>
        )}
        <div className="staff-areas">
          <MapPin size={15} />
          {data?.store.areas.map((a) => areaName(l, a)).join(' · ')}
        </div>
        {!data?.eligible && <p className="staff-warning">{ft(l, 'dutyBlocked')}</p>}
        {data?.store.acceptanceMode === 'MANUAL' && (
          <p className="staff-warning">{ft(l, 'manual')}</p>
        )}
        <div className="staff-action-row">
          <button
            className="button"
            disabled={busy || !data?.eligible || data.store.acceptanceMode === 'MANUAL'}
            onClick={() =>
              mutate(() =>
                api(
                  'staff/duty-status',
                  { onDuty: true, expectedAt: data?.listing.dutyUpdatedAt },
                  'PUT',
                ),
              )
            }
          >
            {ft(l, online ? 'renew' : 'on')}
          </button>
          {data?.listing.onDuty && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                mutate(() =>
                  api(
                    'staff/duty-status',
                    { onDuty: false, expectedAt: data.listing.dutyUpdatedAt },
                    'PUT',
                  ),
                )
              }
            >
              {ft(l, 'off')}
            </button>
          )}
        </div>
      </section>
    );
  }
  function taskRow(b: Booking) {
    return (
      <Link
        className={`staff-task-row ${selected?.id === b.id && tab === 'tasks' ? 'selected' : ''}`}
        href={href('tasks', b.id)}
        key={b.id}
      >
        <time>
          <strong>{time(b.quote.startAt)}</strong>
          <small>{japanDay(b.quote.startAt).slice(5).replace('-', ' / ')}</small>
        </time>
        <div>
          <span className={`staff-tag ${canRespond(b) ? 'attention' : ''}`}>{taskStatus(b)}</span>
          <h3>{offering(b)}</h3>
          <p>
            {areaName(l, b.quote.area)} · {duration(b)} {t(l, 'minutes')}
          </p>
          {canRespond(b) && (
            <small className="staff-deadline">
              {ft(l, 'respondBy')} {time(b.deadline)}
            </small>
          )}
        </div>
        <ChevronRight size={18} />
      </Link>
    );
  }
  function taskDetail(b: Booking) {
    const event = nextEvent(b),
      closed = !isOpenTask(b),
      waiting = ['DECLINED', 'WITHDRAWN'].includes(b.staffTaskStatus);
    return (
      <article className="staff-panel staff-detail" key={b.id}>
        {requestedBooking && (
          <Link className="workday-task-back" href={href('tasks')}>
            {ft(l, 'all')} · {ft(l, 'tasks')}
            <ArrowUpRight size={15} />
          </Link>
        )}
        <div className="staff-detail-top">
          <span className="eyebrow">VISIT / {b.id.slice(-8).toUpperCase()}</span>
          <span className="staff-tag">{taskStatus(b)}</span>
        </div>
        <PartnerOrderFlow locale={l} booking={b} role="STAFF" />
        <InStoreOrder locale={l} booking={b} role="STAFF" onUpdated={refresh} />
        <section
          className="staff-fulfillment-section"
          id={`fulfillment-${b.id}`}
          aria-label={pf(l, 'fulfillment')}
        >
          <div className="partner-section-heading">
            <span>01</span>
            <h3>{pf(l, 'fulfillment')}</h3>
          </div>
          <p className="flow-muted">{pf(l, 'taskHelp')}</p>
          <CompletionPanel
            locale={l}
            booking={b}
            role="STAFF"
            onUpdated={() => void mutate(refresh)}
          />
          {!closed && (
            <div className="staff-detail-action">
              {canRespond(b) && (
                <>
                  <p className="staff-deadline">
                    <Clock3 size={15} />
                    {ft(l, 'respondBy')} {dateTime(l, b.deadline)} ·{' '}
                    {Math.max(0, Math.ceil((b.deadline - now) / 60000))} {t(l, 'minutes')}
                  </p>
                  <button
                    className="button full"
                    disabled={busy || b.deadline <= now}
                    onClick={() => openReview(b, 'ack')}
                  >
                    {ft(l, 'accept')}
                    <CheckCheck size={18} />
                  </button>
                </>
              )}
              {event && !['START', 'COMPLETE'].includes(event) && (
                <button
                  className="button full"
                  disabled={busy}
                  onClick={() =>
                    event === 'COMPLETE'
                      ? openReview(b, 'COMPLETE')
                      : mutate(() =>
                          api(`staff/tasks/${b.id}/events`, { version: b.version, event }),
                        )
                  }
                >
                  {ft(l, eventLabels[event])}
                  <ArrowRight size={18} />
                </button>
              )}
              {b.replacementConsent === 'PENDING' && b.proposedListingId && (
                <p className="notice">{ft(l, 'waitingConsent')}</p>
              )}
              {waiting && <p className="notice">{ft(l, 'waitingShop')}</p>}
              {['ACCEPTED', 'CONFIRMED'].includes(b.status) &&
                ['OFFERED', 'ACKNOWLEDGED'].includes(b.staffTaskStatus) &&
                b.replacementConsent !== 'PENDING' && (
                  <button
                    className="staff-text-button"
                    disabled={busy}
                    onClick={() => openReview(b, 'decline')}
                  >
                    {ft(l, 'decline')}
                  </button>
                )}
            </div>
          )}
          <section className="staff-location">
            <MapPin size={20} />
            <div>
              <h3>
                {ft(l, 'location')} · {areaName(l, b.quote.area)}
              </h3>
              {b.address ? (
                <>
                  <strong>
                    {b.address.type === 'HOTEL'
                      ? `${ft(l, 'hotel')} · ${b.address.hotelName}`
                      : ft(l, 'home')}
                  </strong>
                  <p>
                    {b.address.detail} {b.address.room}
                  </p>
                  <p>{b.address.name}</p>
                </>
              ) : (
                <p>
                  <ShieldCheck size={14} />
                  {ft(l, 'privateAddress')}
                </p>
              )}
            </div>
          </section>
          {b.status === 'CONFIRMED' && canProgress(b) && (
            <div className="staff-preparation">
              <Coffee size={18} />
              <div>
                <h3>{ft(l, 'preparation')}</h3>
                <p>{ft(l, 'preparationHelp')}</p>
                <small>{ft(l, 'buffer')}</small>
              </div>
            </div>
          )}
          {!closed && b.quote.fulfillmentMode !== 'IN_STORE' && (
            <ArrivalPanel locale={l} booking={b} staff onUpdated={() => void refresh()} />
          )}
          {b.status === 'IN_SERVICE' && (
            <SafetyDeskPanel locale={l} role="STAFF" bookingId={b.id} />
          )}
          <NoShowPanel locale={l} booking={b} role="STAFF" onUpdated={refresh} />
        </section>
        {actor && (
          <OrderCoordination
            key={`${actor.id}:${b.id}`}
            locale={l}
            booking={b}
            actor={actor}
            showNext={false}
            onUpdated={() => void refresh()}
          />
        )}
        <div className="staff-contact-section" id={`contact-${b.id}`}>
          {messageAllowed && selectedId === b.id && (
            <section className="staff-messages">
              <h3>
                <MessageCircle size={17} />
                {ft(l, 'messages')}
              </h3>
              {messageState === 'error' && (
                <p className="notice error" role="alert">
                  {ft(l, 'messagesFailed')}{' '}
                  <button type="button" className="text-button" onClick={() => void loadMessages()}>
                    {ft(l, 'retryMessages')}
                  </button>
                </p>
              )}
              <div className="staff-message-list" aria-busy={messageState === 'loading'}>
                {messageState === 'loading' ? (
                  <p role="status">{ft(l, 'loading')}</p>
                ) : messages.length ? (
                  messages.map((m) => (
                    <div key={m.id} className={m.role === 'STAFF' ? 'mine' : ''}>
                      <span>{m.text}</span>
                      <small>
                        {m.role === 'STAFF' ? ft(l, 'you') : statusText(l, m.role)} ·{' '}
                        {time(m.createdAt)}
                      </small>
                    </div>
                  ))
                ) : messageState === 'ready' ? (
                  <p>{ft(l, 'noMessages')}</p>
                ) : null}
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const text = draft.trim();
                  if (!text || messageState !== 'ready' || sendLock.current) return;
                  sendLock.current = true;
                  try {
                    if (
                      await mutate(async () => {
                        const value = await api<Message[]>(`staff/tasks/${b.id}/messages`, {
                          text,
                        });
                        setMessages(value);
                      })
                    )
                      setDraft('');
                  } finally {
                    sendLock.current = false;
                  }
                }}
              >
                <label className="sr-only" htmlFor="staff-message">
                  {ft(l, 'messages')}
                </label>
                <textarea
                  id="staff-message"
                  value={draft}
                  maxLength={500}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={ft(l, 'messagePlaceholder')}
                  rows={2}
                />
                <button
                  className="button secondary"
                  disabled={busy || !draft.trim() || messageState !== 'ready'}
                >
                  {ft(l, 'send')}
                </button>
              </form>
            </section>
          )}
          <section className="staff-task-safety">
            <div>
              <ShieldCheck size={19} />
              <h3>{ft(l, 'support')}</h3>
            </div>
            <p className="staff-task-contact">
              <small>{ft(l, 'contact')}</small>
              <strong>
                {data?.store.emergencyContact?.startsWith('demo_')
                  ? ft(l, 'demoContact')
                  : data?.store.emergencyContact || '—'}
              </strong>
            </p>
            {data?.safety.some(
              (event) =>
                event.bookingId === b.id && event.type === 'SOS' && event.status === 'OPEN',
            ) && (
              <p className="notice" role="status">
                {ft(l, 'sosSaved')}
              </p>
            )}
            {!closed && (
              <div className="staff-action-row">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    mutate(
                      () =>
                        api('staff/safety-alerts', {
                          bookingId: b.id,
                          version: b.version,
                          type: 'SOS',
                        }),
                      ft(l, 'sosSaved'),
                    )
                  }
                >
                  {ft(l, 'sos')}
                </button>
                <button
                  className="staff-text-button danger"
                  disabled={busy}
                  onClick={() => openReview(b, 'SAFETY_TERMINATION')}
                >
                  {ft(l, 'terminate')}
                </button>
              </div>
            )}
            <Link href={`/${l}/staff/support?booking=${encodeURIComponent(b.id)}`}>
              {ft(l, 'feedback')}
              <ArrowUpRight size={15} />
            </Link>
            <small>{ft(l, 'noPublic')}</small>
            <small>{ft(l, 'demo')}</small>
          </section>
        </div>
      </article>
    );
  }
  return (
    <div className="staff-layout workday-staff">
      <aside className="staff-sidebar">
        <Link className="staff-wordmark" href={href('overview')}>
          <Leaf size={25} />
          <strong>
            HoguLink<small>THERAPIST SPACE</small>
          </strong>
        </Link>
        <div className="staff-identity">
          {data?.listing.photo ? (
            <Image src={data.listing.photo} alt="" width={72} height={72} loading="eager" />
          ) : (
            <span>
              <UserRound size={29} />
            </span>
          )}
          <strong>{data?.listing.name[l] ?? ft(l, 'portal')}</strong>
          <small>{data?.store.name[l] ?? 'HoguLink'}</small>
        </div>
        <nav aria-label={ft(l, 'portal')}>
          {staffTabs.map((view) => {
            const Icon = icons[view];
            return (
              <Link key={view} href={href(view)} aria-current={view === tab ? 'page' : undefined}>
                <Icon size={18} />
                {ft(l, view)}
                {view === 'tasks' && stats.pending > 0 && <b>{stats.pending}</b>}
              </Link>
            );
          })}
          <Link href={`/${l}/staff/support`}>
            <LifeBuoy size={18} />
            {ft(l, 'support')}
          </Link>
        </nav>
        <div className="staff-sidebar-foot">
          <ShieldCheck size={23} />
          <p>{ft(l, 'noPublic')}</p>
          <Link href={`/${l}`}>
            {t(l, 'back')}
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </aside>
      <div className="staff-content">
        <header className="staff-heading">
          <div>
            <span className="eyebrow">HOGULINK / THERAPIST</span>
            <h1>{ft(l, tab)}</h1>
            <p>{tab === 'overview' ? wt(l, 'workHelp') : ft(l, 'portal')}</p>
          </div>
          <div className="staff-heading-tools">
            <time>
              {new Intl.DateTimeFormat(l, {
                timeZone: 'Asia/Tokyo',
                month: 'short',
                day: 'numeric',
                weekday: 'short',
              }).format(now)}
              <small>JAPAN STANDARD TIME</small>
            </time>
            <button
              className="staff-icon-button"
              disabled={!hasRole || fetching || busy}
              onClick={() => {
                setError('');
                void refresh();
              }}
              aria-label={ft(l, 'refresh')}
            >
              <RefreshCw size={18} className={fetching ? 'staff-spinning' : ''} />
            </button>
            <Link
              className="staff-icon-button"
              href={`/${l}/staff/support`}
              aria-label={ft(l, 'support')}
            >
              <LifeBuoy size={19} />
            </Link>
          </div>
        </header>
        <details
          className="staff-account"
          open={!hasRole}
          hidden={!!actor?.partnerAccountId || !demoAccess}
        >
          <summary>
            {ft(l, 'identity')} ·{' '}
            {actor?.role === 'STAFF' ? (data?.listing.name[l] ?? account) : ft(l, 'login')}
          </summary>
          <div>
            <p>{ft(l, 'loginHelp')}</p>
            <label className="sr-only" htmlFor="staff-account">
              {ft(l, 'identity')}
            </label>
            <select id="staff-account" value={account} onChange={(e) => setAccount(e.target.value)}>
              {demoStaff.map((x) => (
                <option value={x.staffId} key={x.staffId}>
                  {x.name[l]} · {x.storeName[l]}
                </option>
              ))}
            </select>
            <button
              className="button secondary"
              disabled={busy || loading || !demoStaff.length}
              onClick={login}
            >
              {ft(l, 'login')}
            </button>
          </div>
        </details>
        {!hasRole && (
          <Link className="button secondary" href={`/${l}/onboarding?role=STAFF`}>
            {rt(l, 'partnerLogin')}
          </Link>
        )}
        {(error || readError) && !review && !leaveOpen && (
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
          <div className="staff-panel staff-empty" aria-busy={fetching}>
            {error || readError ? (
              <button
                className="button secondary"
                onClick={() => {
                  setError('');
                  void refresh();
                }}
              >
                {ft(l, 'refresh')}
              </button>
            ) : (
              ft(l, 'loading')
            )}
          </div>
        )}
        {data && hasRole && (
          <>
            {tab === 'overview' && (
              <>
                <div className="staff-overview-grid">
                  <section className="staff-focus">
                    <div className="staff-focus-label">
                      <span>
                        <i />
                        {ft(l, 'next')}
                      </span>
                      <Navigation size={22} />
                    </div>
                    {focus ? (
                      <>
                        <span className="staff-tag">{taskStatus(focus)}</span>
                        <h2>{offering(focus)}</h2>
                        <p>
                          {dateTime(l, focus.quote.startAt)} · {duration(focus)} {t(l, 'minutes')}
                        </p>
                        <div className="staff-focus-place">
                          <MapPin size={18} />
                          {areaName(l, focus.quote.area)}
                          <small>
                            {ft(l, focus.quote.bookingMode === 'INSTANT' ? 'instant' : 'scheduled')}
                          </small>
                        </div>
                        {canRespond(focus) && (
                          <p className="staff-focus-deadline">
                            {ft(l, 'respondBy')} {dateTime(l, focus.deadline)}
                          </p>
                        )}
                        <Link className="button inverse" href={href('tasks', focus.id)}>
                          {wt(l, 'workNow')}
                          <ArrowRight size={18} />
                        </Link>
                      </>
                    ) : (
                      <>
                        <Sparkles size={38} strokeWidth={1} />
                        <h2>{ft(l, 'focusEmpty')}</h2>
                        <p>{ft(l, 'emptyHint')}</p>
                        <Link className="button inverse" href={href('schedule')}>
                          {ft(l, 'schedule')}
                          <ArrowRight size={18} />
                        </Link>
                      </>
                    )}
                  </section>
                </div>
                <WorkdayTools
                  locale={l}
                  items={[
                    {
                      href: href('tasks'),
                      label: ft(l, 'tasks'),
                      icon: ListChecks,
                      count: stats.pending,
                    },
                    { href: href('schedule'), label: ft(l, 'schedule'), icon: CalendarDays },
                    { href: `/${l}/staff/support`, label: ft(l, 'support'), icon: ShieldCheck },
                    { href: href('profile'), label: ft(l, 'profile'), icon: UserRound },
                  ]}
                />
                <div className="staff-stat-grid workday-staff-stats">
                  <div>
                    <span>{ft(l, 'pending')}</span>
                    <strong>{stats.pending}</strong>
                    <ListChecks size={20} />
                  </div>
                  <div>
                    <span>{ft(l, 'today')}</span>
                    <strong>{stats.today}</strong>
                    <CalendarDays size={20} />
                  </div>
                  <div>
                    <span>{ft(l, 'duration')}</span>
                    <strong>
                      {stats.minutes}
                      <small> {t(l, 'minutes')}</small>
                    </strong>
                    <Clock3 size={20} />
                    <small>{ft(l, 'allTime')}</small>
                  </div>
                </div>
                <div className="staff-overview-bottom">
                  {dutyCard()}
                  <section className="staff-panel">
                    <div className="staff-panel-title">
                      <h2>{ft(l, 'agenda')}</h2>
                      <Link href={href('schedule')}>
                        {ft(l, 'all')}
                        <ArrowUpRight size={16} />
                      </Link>
                    </div>
                    {upcoming.length ? (
                      upcoming.slice(0, 3).map(taskRow)
                    ) : (
                      <div className="staff-empty">
                        <CalendarDays size={28} />
                        <p>{ft(l, 'calendarEmpty')}</p>
                      </div>
                    )}
                  </section>
                  <section className="staff-safety-card">
                    <ShieldCheck size={28} strokeWidth={1.4} />
                    <h2>{ft(l, 'safety')}</h2>
                    <p>{ft(l, 'safetyHelp')}</p>
                    <div>
                      <small>{ft(l, 'contact')}</small>
                      <strong>
                        {data.store.emergencyContact?.startsWith('demo_')
                          ? ft(l, 'demoContact')
                          : data.store.emergencyContact || '—'}
                      </strong>
                    </div>
                    <Link href={`/${l}/staff/support`}>
                      {ft(l, 'support')}
                      <ArrowUpRight size={17} />
                    </Link>
                    <small>{ft(l, 'demo')}</small>
                  </section>
                </div>
              </>
            )}
            {(tab === 'tasks' || tab === 'overview') && actor && (
              <StaffCooperationInbox
                key={actor.id}
                locale={l}
                actor={actor}
                excludeBookingId={tab === 'tasks' ? selected?.id : undefined}
              />
            )}
            {tab === 'tasks' && (
              <div className="staff-tasks-grid" data-focused={!!requestedBooking}>
                <section className="staff-panel staff-queue">
                  <div className="staff-filters">
                    {(['active', 'pending', 'history', 'all'] as const).map((f) => (
                      <button
                        key={f}
                        aria-pressed={filter === f}
                        onClick={() => {
                          setFilter(f);
                          router.replace(href('tasks'), { scroll: false });
                        }}
                      >
                        {ft(l, f)}
                      </button>
                    ))}
                  </div>
                  <label className="sr-only" htmlFor="staff-search">
                    {ft(l, 'search')}
                  </label>
                  <input
                    id="staff-search"
                    type="search"
                    placeholder={ft(l, 'search')}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      if (requestedBooking) router.replace(href('tasks'), { scroll: false });
                    }}
                  />
                  <div>
                    {items.length ? (
                      items.map(taskRow)
                    ) : (
                      <div className="staff-empty">
                        <ListChecks size={28} />
                        <p>{ft(l, 'noTasks')}</p>
                      </div>
                    )}
                  </div>
                </section>
                <div id="staff-task-detail">
                  {selected ? (
                    taskDetail(selected)
                  ) : (
                    <section className="staff-panel staff-empty">
                      <ListChecks size={35} />
                      <p>{ft(l, 'select')}</p>
                    </section>
                  )}
                </div>
              </div>
            )}
            {tab === 'schedule' && (
              <>
                <section className="staff-panel">
                  <div className="staff-panel-title">
                    <div>
                      <h2>{ft(l, 'schedule')}</h2>
                      <p>{ft(l, 'buffer')}</p>
                    </div>
                    <button className="button" onClick={openLeave} disabled={busy}>
                      <Plus size={17} />
                      {ft(l, 'leave')}
                    </button>
                  </div>
                  <div className="staff-calendar-toolbar">
                    <button
                      className="staff-icon-button"
                      aria-label={l === 'ja' ? '前の週' : l === 'en' ? 'Previous week' : '上一周'}
                      onClick={() =>
                        setDay(japanDay(Date.parse(day + 'T12:00:00+09:00') - 7 * 86400000))
                      }
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <label>
                      {ft(l, 'day')}
                      <input
                        type="date"
                        value={day}
                        onChange={(e) => e.target.value && setDay(e.target.value)}
                      />
                    </label>
                    <button
                      className="staff-icon-button"
                      aria-label={l === 'ja' ? '次の週' : l === 'en' ? 'Next week' : '下一周'}
                      onClick={() =>
                        setDay(japanDay(Date.parse(day + 'T12:00:00+09:00') + 7 * 86400000))
                      }
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                  <div className="staff-week">
                    {Array.from({ length: 7 }, (_, i) => {
                      const at = Date.parse(day + 'T12:00:00+09:00') + (i - 3) * 86400000,
                        d = japanDay(at),
                        count = bookings.filter(
                          (b) =>
                            (isOpenTask(b) || b.status === 'COMPLETED') &&
                            japanDay(b.quote.startAt) === d,
                        ).length;
                      return (
                        <button key={d} onClick={() => setDay(d)} aria-pressed={d === day}>
                          <small>
                            {new Intl.DateTimeFormat(l, {
                              weekday: 'short',
                              timeZone: 'Asia/Tokyo',
                            }).format(at)}
                          </small>
                          <strong>{d.slice(-2)}</strong>
                          <span>{count > 0 ? '•' : '·'}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="staff-agenda">
                    {(() => {
                      const events = [
                        ...bookings
                          .filter(
                            (b) =>
                              (isOpenTask(b) || b.status === 'COMPLETED') &&
                              b.quote.startAt < Date.parse(day + 'T00:00:00+09:00') + 86400000 &&
                              b.quote.endAt > Date.parse(day + 'T00:00:00+09:00'),
                          )
                          .map((b) => ({
                            id: b.id,
                            start: b.quote.startAt,
                            end: b.quote.endAt,
                            booking: b,
                            reason: undefined,
                          })),
                        ...data.blocks
                          .filter(
                            (b) =>
                              b.startAt < Date.parse(day + 'T00:00:00+09:00') + 86400000 &&
                              b.endAt > Date.parse(day + 'T00:00:00+09:00'),
                          )
                          .map((b) => ({
                            id: b.id,
                            start: b.startAt,
                            end: b.endAt,
                            booking: undefined,
                            reason: b.reason,
                          })),
                      ].sort((a, b) => a.start - b.start);
                      return events.length ? (
                        events.map((e) => (
                          <div
                            key={e.id}
                            className={`staff-agenda-item ${e.booking ? '' : 'blocked'}`}
                          >
                            <time>
                              {japanDay(e.start) !== day ? dateTime(l, e.start) : time(e.start)}
                              <small>
                                — {japanDay(e.end) !== day ? dateTime(l, e.end) : time(e.end)}
                              </small>
                            </time>
                            <div>
                              {e.booking ? (
                                <Link href={href('tasks', e.id)}>
                                  <strong>{offering(e.booking)}</strong>
                                  <p>
                                    {areaName(l, e.booking.quote.area)} ·{' '}
                                    {statusText(l, e.booking.status)}
                                  </p>
                                  <small>{ft(l, 'buffer')}</small>
                                </Link>
                              ) : (
                                <>
                                  <strong>
                                    <Coffee size={16} />
                                    {ft(l, e.reason!)}
                                  </strong>
                                  <p>{ft(l, 'APPROVED')}</p>
                                </>
                              )}
                            </div>
                            {e.booking && <ArrowUpRight size={17} />}
                          </div>
                        ))
                      ) : (
                        <div className="staff-empty">
                          <CalendarDays size={30} />
                          <p>{ft(l, 'calendarEmpty')}</p>
                        </div>
                      );
                    })()}
                  </div>
                </section>
                <section className="staff-panel staff-requests">
                  <div className="staff-panel-title">
                    <h2>{ft(l, 'requests')}</h2>
                    <span className="staff-tag">
                      {data.requests.filter((r) => r.status === 'PENDING').length}{' '}
                      {ft(l, 'PENDING')}
                    </span>
                  </div>
                  <p>{ft(l, 'leaveHelp')}</p>
                  {data.requests.length ? (
                    data.requests.slice(0, requestLimit).map((r) => (
                      <article key={r.id}>
                        <Coffee size={19} />
                        <div>
                          <strong>{ft(l, r.reason)}</strong>
                          <p>
                            {dateTime(l, r.startAt)} — {dateTime(l, r.endAt)}
                          </p>
                          <span
                            className={`staff-tag ${r.status === 'PENDING' ? 'attention' : ''}`}
                          >
                            {ft(l, r.status)}
                          </span>
                          {r.status === 'APPROVED' &&
                            !data.blocks.some((b) => b.id === r.blockId) && (
                              <small>{ft(l, r.endAt <= now ? 'ended' : 'released')}</small>
                            )}
                        </div>
                        {r.status === 'PENDING' && (
                          <button
                            className="staff-text-button"
                            disabled={busy}
                            onClick={() =>
                              mutate(() =>
                                api(
                                  `staff/time-off-requests/${r.id}`,
                                  { version: r.version, decision: 'WITHDRAWN' },
                                  'PUT',
                                ),
                              )
                            }
                          >
                            {ft(l, 'withdraw')}
                          </button>
                        )}
                      </article>
                    ))
                  ) : (
                    <p className="staff-empty">{ft(l, 'calendarEmpty')}</p>
                  )}
                  {data.requests.length > requestLimit && (
                    <button
                      className="button secondary full"
                      onClick={() => setRequestLimit(data.requests.length)}
                    >
                      {ft(l, 'all')} · {data.requests.length}
                    </button>
                  )}
                </section>
              </>
            )}
            {tab === 'profile' && (
              <div className="staff-profile-grid">
                <section className="staff-panel staff-profile-card">
                  <Image
                    src={data.listing.photo || '/images/therapists/aoi.svg'}
                    alt={data.listing.name[l]}
                    width={120}
                    height={120}
                    loading="eager"
                  />
                  <span className="eyebrow">YOUR THERAPIST PROFILE</span>
                  <h2>{data.listing.name[l]}</h2>
                  <p>
                    <Store size={16} />
                    {data.store.name[l]}
                  </p>
                  <div className="staff-profile-bio">{data.listing.description[l]}</div>
                  <dl>
                    <div>
                      <dt>{ft(l, 'languages')}</dt>
                      <dd>{data.listing.languages.map((x) => languageNames[x]).join(' · ')}</dd>
                    </div>
                    <div>
                      <dt>{ft(l, 'area')}</dt>
                      <dd>{data.store.areas.map((x) => areaName(l, x)).join(' · ')}</dd>
                    </div>
                    {data.listing.hotelOnly && (
                      <div>
                        <dt>{ft(l, 'reason')}</dt>
                        <dd>{ft(l, 'hotelOnly')}</dd>
                      </div>
                    )}
                  </dl>
                  <p>{ft(l, 'profileHelp')}</p>
                  {data.listing.publicationStatus === 'PUBLISHED_INDEXABLE' && data.eligible && (
                    <Link
                      className="button secondary full"
                      href={`/${l}/therapists/${data.listing.slug}`}
                    >
                      {ft(l, 'publicPage')}
                      <ArrowUpRight size={16} />
                    </Link>
                  )}
                </section>
                <div>
                  <section className="staff-panel">
                    <div className="staff-panel-title">
                      <h2>{ft(l, 'membership')}</h2>
                      <ShieldCheck size={21} />
                    </div>
                    <div className="staff-credentials">
                      {(
                        [
                          ['identityVerified', data.listing.identityVerified],
                          ['membership', data.listing.membershipActive],
                          ['consent', data.listing.portraitConsent],
                          ['publication', data.listing.publicationStatus === 'PUBLISHED_INDEXABLE'],
                        ] as const
                      ).map(([key, ok]) => (
                        <div key={key}>
                          <span>{ft(l, key)}</span>
                          <strong className={ok ? '' : 'staff-warning'}>
                            {ok ? <Check size={16} /> : <Clock3 size={16} />}{' '}
                            {ft(l, ok ? 'valid' : 'needsReview')}
                          </strong>
                        </div>
                      ))}
                    </div>
                    <p>{ft(l, 'profileHelp')}</p>
                  </section>
                  <section className="staff-panel">
                    <div className="staff-panel-title">
                      <h2>{ft(l, 'service')}</h2>
                      <Leaf size={20} />
                    </div>
                    {data.offerings.map((o) => (
                      <div className="staff-service" key={o.id}>
                        <span>
                          {o.durationMinutes}
                          <small>{t(l, 'minutes')}</small>
                        </span>
                        <strong>{o.name[l]}</strong>
                        <small>
                          {o.approved && o.active !== false ? ft(l, 'valid') : ft(l, 'needsReview')}
                        </small>
                      </div>
                    ))}
                  </section>
                  {dutyCard()}
                </div>
              </div>
            )}
            <p className="workday-income-note">
              <Store size={17} />
              {wt(l, 'incomeHelp')}
            </p>
            <p className="staff-sync">
              {updated && (
                <>
                  {ft(l, 'updated')} {time(updated)} JST ·{' '}
                </>
              )}
              {ft(l, 'demo')}
            </p>
          </>
        )}
        <details className="workday-resources">
          <summary>{wt(l, 'resources')}</summary>
          <PartnerEntry locale={l} role="STAFF" />
          <QualityEntry locale={l} role="STAFF" />
        </details>
      </div>
      <MobileSheet
        open={!!review}
        onClose={() => {
          if (!busy) setReview(null);
        }}
        title={
          review
            ? ft(
                l,
                review.action === 'ack'
                  ? 'accept'
                  : review.action === 'decline'
                    ? 'decline'
                    : review.action === 'COMPLETE'
                      ? 'complete'
                      : 'terminate',
              )
            : ''
        }
        locale={l}
        className="merchant-dialog staff-dialog"
      >
        {review && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitReview();
            }}
          >
            <div className="staff-review-summary">
              <strong>{offering(review.booking)}</strong>
              <p>
                {dateTime(l, review.booking.quote.startAt)} ·{' '}
                {areaName(l, review.booking.quote.area)}
              </p>
            </div>
            <p>
              {ft(
                l,
                review.action === 'ack'
                  ? 'acceptHelp'
                  : review.action === 'decline'
                    ? 'declineHelp'
                    : review.action === 'COMPLETE'
                      ? 'completeHelp'
                      : 'terminateHelp',
              )}
            </p>
            {review.action === 'ack' && review.booking.quote.bookingMode === 'INSTANT' && (
              <fieldset>
                <legend>{ft(l, 'eta')}</legend>
                <p>{ft(l, 'etaHelp')}</p>
                <div className="staff-eta">
                  {[30, 40, 45, 50, 60].map((n) => (
                    <label key={n}>
                      <input
                        type="radio"
                        name="eta"
                        value={n}
                        checked={eta === n}
                        onChange={() => setEta(n)}
                      />
                      <span>
                        {n}
                        <small>{t(l, 'minutes')}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {review.action === 'decline' && (
              <>
                <label>
                  {ft(l, 'reason')}
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value as typeof reason)}
                  >
                    {reasons.map((r) => (
                      <option value={r} key={r}>
                        {ft(l, r)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {ft(l, 'note')}
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={200}
                    rows={3}
                  />
                </label>
              </>
            )}
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <div className="staff-action-row">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                {ft(l, 'cancel')}
              </button>
              <button className="button" disabled={busy}>
                {ft(l, 'confirm')}
              </button>
            </div>
          </form>
        )}
      </MobileSheet>
      <MobileSheet
        open={leaveOpen}
        onClose={() => {
          if (!busy) setLeaveOpen(false);
        }}
        title={ft(l, 'leave')}
        locale={l}
        className="merchant-dialog staff-dialog"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const startAt = parseJapanInput(leaveDraft.start),
              endAt = parseJapanInput(leaveDraft.end);
            if (
              !Number.isFinite(startAt) ||
              !Number.isFinite(endAt) ||
              startAt <= Date.now() ||
              endAt <= startAt
            ) {
              setError(ft(l, 'INVALID_TIME'));
              return;
            }
            const body = { startAt, endAt, reason: leaveDraft.reason },
              payload = JSON.stringify(body);
            if (retry.current.payload !== payload)
              retry.current = { payload, key: crypto.randomUUID() };
            if (await mutate(() => api('staff/time-off-requests', body, 'POST', retry.current.key)))
              setLeaveOpen(false);
          }}
        >
          <p>{ft(l, 'leaveHelp')}</p>
          <small>{ft(l, 'leaveRange')}</small>
          <label>
            {ft(l, 'start')}
            <input
              type="datetime-local"
              required
              value={leaveDraft.start}
              onChange={(e) => setLeaveDraft({ ...leaveDraft, start: e.target.value })}
            />
          </label>
          <label>
            {ft(l, 'end')}
            <input
              type="datetime-local"
              required
              value={leaveDraft.end}
              onChange={(e) => setLeaveDraft({ ...leaveDraft, end: e.target.value })}
            />
          </label>
          <label>
            {ft(l, 'reason')}
            <select
              value={leaveDraft.reason}
              onChange={(e) =>
                setLeaveDraft({ ...leaveDraft, reason: e.target.value as TimeOffRequest['reason'] })
              }
            >
              {(['BREAK', 'TIME_OFF', 'TRAINING'] as const).map((r) => (
                <option key={r} value={r}>
                  {ft(l, r)}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <div className="staff-action-row">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setLeaveOpen(false)}
            >
              {ft(l, 'cancel')}
            </button>
            <button className="button" disabled={busy}>
              {ft(l, 'submit')}
            </button>
          </div>
        </form>
      </MobileSheet>
    </div>
  );
}
