'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ClipboardCheck, Clock3, RefreshCw } from 'lucide-react';
import type {
  Actor,
  Booking,
  Coordination,
  HandoffView,
  Locale,
  StaffHandoffItem,
} from '@hogulink/contracts';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/i18n';
import { caseStatus } from '@/lib/care-i18n';
import { ot, coordinationError, type CoordinationText } from '@/lib/coordination-i18n';
import { nextWork } from '@/lib/coordination-model';
import { MobileSheet } from './mobile-ui';
import { gt } from '@/lib/governance-i18n';
import { bt } from '@/lib/finance-i18n';
import { cpt } from '@/lib/completion-i18n';
import { pf } from '@/lib/partner-flow-i18n';

function HandoffCard({
  locale: l,
  item: h,
  role,
  onUpdated,
}: {
  locale: Locale;
  item: HandoffView;
  role: 'STAFF' | 'MERCHANT';
  onUpdated: () => void;
}) {
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const lock = useRef(false),
    retry = useRef({ body: '', key: '' }),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function act(action: 'REPLY' | 'RESOLVE' | 'REOPEN') {
    if (lock.current || text.trim().length < 10) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const body = { version: h.version, action, text },
      fingerprint = JSON.stringify(body);
    if (retry.current.body !== fingerprint)
      retry.current = { body: fingerprint, key: crypto.randomUUID() };
    try {
      await api(`work-handoffs/${h.id}/actions`, body, 'POST', retry.current.key);
      if (live.current) {
        setText('');
        setConfirm(false);
        onUpdated();
        window.dispatchEvent(new Event('hogulink-coordination-updated'));
      }
    } catch (e) {
      if (live.current) {
        setConfirm(false);
        setError(coordinationError(l, e));
        onUpdated();
      }
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <article className="handoff-card">
      <header>
        <strong>{ot(l, h.topic)}</strong>
        <span>{ot(l, h.status)}</span>
      </header>
      <small>
        #{h.id.slice(-8).toUpperCase()} · {dateTime(l, h.updatedAt)} JST
      </small>
      <ol className="handoff-messages">
        {h.messages.map((m, i) => (
          <li key={`${m.at}:${i}`}>
            <span>
              {ot(l, m.role === 'STAFF' ? 'therapist' : 'shop')} · {dateTime(l, m.at)}
            </span>
            <p>{m.text}</p>
          </li>
        ))}
      </ol>
      {(h.status !== 'RESOLVED' || role === 'MERCHANT') && (
        <form
          className="flow-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(h.status === 'RESOLVED' ? 'REOPEN' : 'REPLY');
          }}
        >
          <label>
            {ot(l, 'facts')}
            <textarea
              required
              minLength={10}
              maxLength={1500}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={ot(l, 'hint')}
              disabled={busy}
            />
          </label>
          <div className="flow-actions">
            <button className="quality-button" disabled={busy || text.trim().length < 10}>
              {ot(l, h.status === 'RESOLVED' ? 'reopen' : 'reply')}
            </button>
            {role === 'MERCHANT' && h.status !== 'RESOLVED' && (
              <button
                type="button"
                className="quality-primary"
                disabled={busy || text.trim().length < 10}
                onClick={() => setConfirm(true)}
              >
                {ot(l, 'resolve')}
              </button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="quality-error">
          {error}
        </p>
      )}
      <MobileSheet
        locale={l}
        open={confirm}
        title={ot(l, 'resolveTitle')}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
      >
        <div className="flow-sheet-content">
          <p>{ot(l, 'resolveHelp')}</p>
          <p>{text}</p>
          <div className="flow-actions">
            <button className="quality-button" disabled={busy} onClick={() => setConfirm(false)}>
              {ot(l, 'cancel')}
            </button>
            <button className="quality-primary" disabled={busy} onClick={() => void act('RESOLVE')}>
              {ot(l, 'resolve')}
            </button>
          </div>
        </div>
      </MobileSheet>
    </article>
  );
}

export function OrderCoordination({
  locale: l,
  booking: b,
  actor,
  onUpdated,
  showNext = true,
}: {
  locale: Locale;
  booking: Booking;
  actor: Actor;
  onUpdated: () => void;
  showNext?: boolean;
}) {
  const [data, setData] = useState<Coordination>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false),
    [withdrawOpen, setWithdrawOpen] = useState(false),
    [withdrawReason, setWithdrawReason] = useState(''),
    [topic, setTopic] = useState<'VISIT_NOTE' | 'SERVICE_ISSUE'>('VISIT_NOTE'),
    [text, setText] = useState(''),
    [ticket, setTicket] = useState(''),
    [busy, setBusy] = useState(false);
  const gen = useRef(0),
    live = useRef(true),
    lock = useRef(false),
    retry = useRef({ body: '', key: '' }),
    latest = useRef({ onUpdated, version: b.version });
  latest.current = { onUpdated, version: b.version };
  const load = useCallback(async () => {
    const request = ++gen.current;
    setLoading(true);
    try {
      const next = await api<Coordination>(`bookings/${b.id}/coordination`);
      if (request === gen.current && live.current) {
        setData(next);
        setError('');
        if (next.bookingVersion !== latest.current.version) latest.current.onUpdated();
      }
    } catch (e) {
      if (request === gen.current && live.current) setError(coordinationError(l, e));
    } finally {
      if (request === gen.current && live.current) setLoading(false);
    }
  }, [b.id, l, actor.id]);
  useEffect(() => {
    live.current = true;
    const update = () => void load(),
      poll = window.setInterval(() => {
        if (document.visibilityState === 'visible') void load();
      }, 15000);
    window.addEventListener('hogulink-coordination-updated', update);
    window.addEventListener('focus', update);
    return () => {
      live.current = false;
      gen.current++;
      clearInterval(poll);
      window.removeEventListener('hogulink-coordination-updated', update);
      window.removeEventListener('focus', update);
    };
  }, [load]);
  useEffect(() => {
    void load();
  }, [b.version, load]);
  const internal = actor.role === 'MERCHANT' || actor.role === 'STAFF',
    canCreate =
      !!b.assignedStaffId &&
      b.staffTaskStatus !== 'NOT_SENT' &&
      (actor.role === 'MERCHANT' ||
        (actor.role === 'STAFF' && !['CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status)));
  return (
    <section className="coordination-panel" id={`cooperation-${b.id}`} aria-busy={loading}>
      <header className="flow-section-head">
        <h3>
          <ClipboardCheck size={19} />
          {ot(l, 'title')}
        </h3>
        <button
          className="quality-link"
          disabled={loading}
          aria-label={ot(l, 'refresh')}
          onClick={() => void load()}
        >
          <RefreshCw size={16} />
        </button>
      </header>
      {loading && !data && (
        <p className="flow-muted" role="status">
          {pf(l, 'loading')}
        </p>
      )}
      {showNext && (
        <div className="coordination-next">
          <span>{ot(l, 'next')}</span>
          <p>{ot(l, nextWork(b))}</p>
          {b.replacementConsent === 'PENDING' && data?.proposedName && (
            <strong>
              {ot(l, 'proposed')} · {data.proposedName[l]}
            </strong>
          )}
          {!['visit', 'closed', 'completionPending', 'completionReview'].includes(nextWork(b)) && (
            <small>
              <Clock3 size={13} />
              {ot(l, 'deadline')} ·{' '}
              {dateTime(
                l,
                b.replacementConsent === 'PENDING'
                  ? (b.replacementDeadline ?? b.deadline)
                  : b.deadline,
              )}{' '}
              JST
            </small>
          )}
        </div>
      )}
      {!showNext && b.replacementConsent === 'PENDING' && data?.proposedName && (
        <p className="coordination-proposed">
          <strong>
            {ot(l, 'proposed')} · {data.proposedName[l]}
          </strong>
          <span>{ot(l, 'consent')}</span>
        </p>
      )}
      {actor.role === 'MERCHANT' && b.replacementConsent === 'PENDING' && b.proposedListingId && (
        <button className="quality-button" disabled={busy} onClick={() => setWithdrawOpen(true)}>
          {ot(l, 'withdraw')}
        </button>
      )}
      {!!data?.platformAttention?.length && (
        <div className="coordination-platform">
          <strong>{gt(l, 'attention')}</strong>
          <ul>
            {data.platformAttention.map((a) => (
              <li key={a.kind}>{gt(l, a.kind)}</li>
            ))}
          </ul>
          {actor.role !== 'CUSTOMER' && <p>{gt(l, 'attentionHelp')}</p>}
        </div>
      )}
      {data && (
        <>
          {actor.role === 'MERCHANT' && b.capturedAmount > 0 && (
            <Link
              className="governance-link"
              href={`/${l}/merchant?tab=finance&booking=${encodeURIComponent(b.id)}&month=${new Date(b.updatedAt + 9 * 3600000).toISOString().slice(0, 7)}`}
            >
              {bt(l, 'title')}
              <ArrowUpRight size={14} />
            </Link>
          )}
          <details className="coordination-history">
            <summary>
              {ot(l, 'history')} · {data.timeline.length}
            </summary>
            <ol>
              {data.timeline.map((a) => (
                <li key={a.id}>
                  <span>
                    {a.action.startsWith('COMPLETION_')
                      ? cpt(l, a.action.slice(11))
                      : ot(l, a.action as CoordinationText)}
                  </span>
                  <time>{dateTime(l, a.at)} JST</time>
                </li>
              ))}
            </ol>
          </details>
          {actor.role === 'MERCHANT' && (
            <div className="coordination-cases">
              <h4>{ot(l, 'cases')}</h4>
              {!data.cases.length && <p>{ot(l, 'noCases')}</p>}
              {data.cases.map((c) => (
                <div className="coordination-case" key={c.id}>
                  <Link href={`/${l}/merchant/support?case=${c.id}#case-detail`}>
                    <span>
                      <strong>{c.subject}</strong>
                      <small>
                        {caseStatus(l, c.status)}
                        {c.refundPending && ` · ${ot(l, 'pendingRefund')}`}
                      </small>
                    </span>
                    <ArrowUpRight size={16} />
                  </Link>
                  <button
                    className="quality-link"
                    disabled={!canCreate}
                    onClick={() => {
                      setTicket(c.id);
                      setOpen(true);
                    }}
                  >
                    {ot(l, 'request')}
                  </button>
                </div>
              ))}
            </div>
          )}
          {internal && (
            <div className="coordination-internal">
              <div className="flow-section-head">
                <h4>{ot(l, 'internal')}</h4>
                {canCreate && (
                  <button
                    className="quality-button"
                    onClick={() => {
                      setTicket('');
                      setOpen(true);
                    }}
                  >
                    {ot(l, actor.role === 'MERCHANT' ? 'request' : 'report')}
                  </button>
                )}
              </div>
              <p className="flow-muted">{ot(l, 'privacy')}</p>
              {!data.handoffs.length && <p className="flow-muted">{ot(l, 'noHandoffs')}</p>}
              {data.handoffs.map((h) => (
                <HandoffCard
                  key={`${actor.id}:${h.id}`}
                  locale={l}
                  item={h}
                  role={actor.role as 'STAFF' | 'MERCHANT'}
                  onUpdated={() => void load()}
                />
              ))}
            </div>
          )}
        </>
      )}
      {error && (
        <div className="quality-error" role="alert">
          {error}
          <button className="quality-button" disabled={loading} onClick={() => void load()}>
            {pf(l, 'retry')}
          </button>
        </div>
      )}
      <MobileSheet
        locale={l}
        open={withdrawOpen}
        title={ot(l, 'withdraw')}
        onClose={() => {
          if (!busy) setWithdrawOpen(false);
        }}
      >
        <form
          className="flow-sheet-content flow-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            try {
              await api(`merchant/bookings/${b.id}/replacement-withdrawal`, {
                version: b.version,
                reason: withdrawReason,
              });
              if (live.current) {
                setWithdrawOpen(false);
                setWithdrawReason('');
                await load();
                latest.current.onUpdated();
              }
            } catch (e) {
              if (live.current) {
                await load();
                setWithdrawOpen(false);
                setError(coordinationError(l, e));
              }
            } finally {
              lock.current = false;
              if (live.current) setBusy(false);
            }
          }}
        >
          <p>{ot(l, 'withdrawHelp')}</p>
          <label>
            {ot(l, 'facts')}
            <textarea
              required
              minLength={10}
              maxLength={300}
              value={withdrawReason}
              disabled={busy}
              onChange={(e) => setWithdrawReason(e.target.value)}
            />
          </label>
          <div className="flow-actions">
            <button
              type="button"
              className="quality-button"
              disabled={busy}
              onClick={() => setWithdrawOpen(false)}
            >
              {ot(l, 'cancel')}
            </button>
            <button className="quality-primary" disabled={busy}>
              {ot(l, 'withdraw')}
            </button>
          </div>
        </form>
      </MobileSheet>
      <MobileSheet
        locale={l}
        open={open}
        title={ot(l, actor.role === 'MERCHANT' ? 'request' : 'report')}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <form
          className="flow-sheet-content flow-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current || !data) return;
            lock.current = true;
            setBusy(true);
            setError('');
            const body = {
                bookingVersion: data.bookingVersion,
                topic: actor.role === 'MERCHANT' ? 'AFTERCARE_FACTS' : topic,
                text,
                ...(ticket ? { ticketId: ticket } : {}),
              },
              fingerprint = JSON.stringify(body);
            if (retry.current.body !== fingerprint)
              retry.current = { body: fingerprint, key: crypto.randomUUID() };
            try {
              await api(`bookings/${b.id}/handoffs`, body, 'POST', retry.current.key);
              if (live.current) {
                setOpen(false);
                setText('');
                await load();
                window.dispatchEvent(new Event('hogulink-coordination-updated'));
              }
            } catch (e) {
              if (live.current) {
                await load();
                setError(coordinationError(l, e));
              }
            } finally {
              lock.current = false;
              if (live.current) setBusy(false);
            }
          }}
        >
          <p>{ot(l, 'privacy')}</p>
          {data?.staffName && <strong>{data.staffName[l]}</strong>}
          <fieldset disabled={busy}>
            {actor.role === 'STAFF' && (
              <label>
                {ot(l, 'topic')}
                <select value={topic} onChange={(e) => setTopic(e.target.value as typeof topic)}>
                  <option value="VISIT_NOTE">{ot(l, 'VISIT_NOTE')}</option>
                  <option value="SERVICE_ISSUE">{ot(l, 'SERVICE_ISSUE')}</option>
                </select>
              </label>
            )}
            <label>
              {ot(l, 'facts')}
              <textarea
                required
                minLength={10}
                maxLength={1500}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={ot(l, 'hint')}
              />
            </label>
            {error && (
              <p role="alert" className="quality-error">
                {error}
              </p>
            )}
            <div className="flow-actions">
              <button className="quality-button" type="button" onClick={() => setOpen(false)}>
                {ot(l, 'cancel')}
              </button>
              <button className="quality-primary">{ot(l, 'send')}</button>
            </div>
          </fieldset>
        </form>
      </MobileSheet>
    </section>
  );
}

export function StaffCooperationInbox({
  locale: l,
  actor,
  excludeBookingId,
}: {
  locale: Locale;
  actor: Actor;
  excludeBookingId?: string;
}) {
  const [items, setItems] = useState<StaffHandoffItem[]>([]),
    [error, setError] = useState(''),
    [limit, setLimit] = useState(4);
  const gen = useRef(0);
  const load = useCallback(async () => {
    const request = ++gen.current;
    try {
      const next = await api<StaffHandoffItem[]>('staff/handoffs');
      if (request === gen.current) {
        setItems(next);
        setError('');
      }
    } catch (e) {
      if (request === gen.current) setError(coordinationError(l, e));
    }
  }, [actor.id, l]);
  useEffect(() => {
    void load();
    const update = () => void load(),
      poll = window.setInterval(() => {
        if (document.visibilityState === 'visible') void load();
      }, 15000);
    window.addEventListener('hogulink-coordination-updated', update);
    return () => {
      gen.current++;
      clearInterval(poll);
      window.removeEventListener('hogulink-coordination-updated', update);
    };
  }, [load]);
  const visibleItems = items.filter((h) => h.bookingId !== excludeBookingId);
  if (!visibleItems.length && !error) return null;
  return (
    <section className="coordination-panel staff-cooperation">
      <header className="flow-section-head">
        <h2>
          {ot(l, 'inbox')} · {visibleItems.filter((x) => x.status !== 'RESOLVED').length}
        </h2>
        <button className="quality-link" onClick={() => void load()}>
          {ot(l, 'refresh')}
        </button>
      </header>
      <p className="flow-muted">{ot(l, 'inboxHelp')}</p>
      {!visibleItems.length && <p>{ot(l, 'noHandoffs')}</p>}
      {visibleItems.slice(0, limit).map((h) => (
        <div key={h.id}>
          <p className="handoff-order-ref">
            <Link
              href={`/${l}/staff?tab=tasks&booking=${encodeURIComponent(h.bookingId)}#cooperation-${h.bookingId}`}
            >
              #{h.bookingId.slice(-8).toUpperCase()} · {dateTime(l, h.startAt)} JST{' '}
              <ArrowUpRight size={14} />
            </Link>
          </p>
          <HandoffCard locale={l} item={h} role="STAFF" onUpdated={() => void load()} />
        </div>
      ))}
      {visibleItems.length > limit && (
        <button className="quality-button" onClick={() => setLimit((n) => n + 4)}>
          + {Math.min(4, visibleItems.length - limit)}
        </button>
      )}
      {error && (
        <p role="alert" className="quality-error">
          {error}
        </p>
      )}
    </section>
  );
}
