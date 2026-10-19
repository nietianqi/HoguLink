'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Scale, CheckCircle2, Clock3, AlertTriangle } from 'lucide-react';
import {
  canAdmin,
  type Actor,
  type CaseDecisionDetail,
  type Locale,
  type RefundCase,
  type SupportTicket,
  type TicketMessage,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, money } from '@/lib/i18n';
import { gt } from '@/lib/governance-i18n';
import { governanceError } from './order-monitor';
import { MobileSheet } from './mobile-ui';
export function CaseDecisionPanel({
  locale: l,
  actor,
  ticket,
  messages,
  onUpdated,
}: {
  locale: Locale;
  actor: Actor;
  ticket: SupportTicket;
  messages: TicketMessage[];
  onUpdated: () => void;
}) {
  const [data, setData] = useState<CaseDecisionDetail>(),
    [refund, setRefund] = useState<RefundCase | null>(null),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [outcome, setOutcome] = useState<'REFUND' | 'NO_REFUND' | 'FOLLOW_UP'>('FOLLOW_UP'),
    [amount, setAmount] = useState('0'),
    [summary, setSummary] = useState(''),
    [reason, setReason] = useState(''),
    [refs, setRefs] = useState<string[]>([]),
    [absent, setAbsent] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const gen = useRef(0),
    lock = useRef(false),
    retry = useRef({ body: '', key: '' });
  const [receiptOpen, setReceiptOpen] = useState(false),
    [receiptText, setReceiptText] = useState('');
  const reviewSnapshot = useRef({
      ticketVersion: 0,
      version: 0,
      bookingVersion: 0,
      refundVersion: 0,
    }),
    receiptSnapshot = useRef({ version: 0, ticketVersion: 0 });
  const admin = canAdmin(actor, 'cases.write'),
    shared = ticket.visibility === 'SHOP_AND_CUSTOMER';
  const load = useCallback(async () => {
    const n = ++gen.current;
    try {
      const [d, r] = await Promise.all([
        api<CaseDecisionDetail>(`support-tickets/${ticket.id}/decision`),
        ticket.refundRequestId
          ? api<RefundCase | null>(`support-tickets/${ticket.id}/refund-request`)
          : Promise.resolve(null),
      ]);
      if (n === gen.current) {
        setData(d);
        setRefund(r);
        setError('');
      }
    } catch (e) {
      if (n === gen.current) {
        setData(undefined);
        setError(governanceError(l, e));
      }
    }
  }, [ticket.id, ticket.version, ticket.refundRequestId, l]);
  useEffect(() => {
    void load();
    return () => {
      gen.current++;
    };
  }, [load]);
  if (!shared || actor.role === 'STAFF') return null;
  if (!data)
    return error ? (
      <p role="alert" className="quality-error">
        {error}
        <button className="quality-link" onClick={() => void load()}>
          {gt(l, 'refresh')}
        </button>
      </p>
    ) : null;
  const c = data.current,
    pending = refund?.request.status === 'PENDING',
    cap = refund ? Math.min(refund.remaining, refund.request.amount) : 0;
  if (!c && !admin) return null;
  function start() {
    if (!data) return;
    reviewSnapshot.current = {
      ticketVersion: ticket.version,
      version: data.current?.version ?? 0,
      bookingVersion: data.bookingVersion,
      refundVersion: data.refundVersion,
    };
    setOutcome(pending ? 'REFUND' : 'FOLLOW_UP');
    setAmount(pending ? String(cap) : '0');
    setSummary('');
    setReason('');
    setRefs([]);
    setAbsent(false);
    setConfirmed(false);
    setError('');
    setOpen(true);
  }
  async function publish() {
    if (!data || lock.current || !confirmed) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const body = {
        ...reviewSnapshot.current,
        outcome,
        amount: outcome === 'REFUND' ? Number(amount) : 0,
        summary,
        reason,
        evidenceIds: refs,
        merchantUnreachable: absent,
      },
      json = JSON.stringify(body);
    if (retry.current.body !== json) retry.current = { body: json, key: crypto.randomUUID() };
    try {
      await api(`support-tickets/${ticket.id}/decision`, body, 'POST', retry.current.key);
      setOpen(false);
      await load();
      onUpdated();
      window.dispatchEvent(new Event('hogulink-inbox-updated'));
    } catch (e) {
      await load();
      onUpdated();
      if (
        !(e instanceof ClientError) ||
        !['EVIDENCE_REQUIRED', 'INVALID_EVIDENCE', 'APPEAL_EVIDENCE_REQUIRED'].includes(e.code)
      )
        setOpen(false);
      setError(governanceError(l, e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function acknowledge() {
    if (!c || lock.current) return;
    lock.current = true;
    setBusy(true);
    const body = { ...receiptSnapshot.current, text: receiptText },
      json = JSON.stringify(body);
    if (retry.current.body !== json) retry.current = { body: json, key: crypto.randomUUID() };
    try {
      await api(
        `support-tickets/${ticket.id}/decision/acknowledgment`,
        body,
        'POST',
        retry.current.key,
      );
      setReceiptOpen(false);
      setReceiptText('');
      await load();
      onUpdated();
    } catch (e) {
      await load();
      onUpdated();
      setReceiptOpen(false);
      setError(governanceError(l, e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="case-decision" aria-label={gt(l, 'decision')}>
      <div className="governance-heading">
        <h3>
          <Scale size={20} />
          {gt(l, 'decision')}
        </h3>
        {c && <span className="admin-pill">v{c.version}</span>}
      </div>
      <p className="governance-muted">{gt(l, 'decisionHelp')}</p>
      {c ? (
        <>
          <div className={`decision-state ${data.state === 'NEEDS_REVIEW' ? 'review' : ''}`}>
            {data.state === 'READY_TO_CLOSE' ? (
              <CheckCircle2 size={17} />
            ) : data.state === 'NEEDS_REVIEW' ? (
              <AlertTriangle size={17} />
            ) : (
              <Clock3 size={17} />
            )}{' '}
            {data.state &&
              gt(
                l,
                data.state === 'READY_TO_CLOSE' && ['RESOLVED', 'CLOSED'].includes(ticket.status)
                  ? 'closedDecision'
                  : data.state,
              )}
          </div>
          <dl className="decision-facts">
            <div>
              <dt>{gt(l, 'outcome')}</dt>
              <dd>
                {gt(l, c.outcome)}
                {c.outcome === 'REFUND' && ` · ${money(l, c.amount)}`}
              </dd>
            </div>
            <div>
              <dt>{gt(l, 'summary')}</dt>
              <dd>{c.summary}</dd>
            </div>
            <div>
              <dt>{gt(l, 'reason')}</dt>
              <dd>{c.reason}</dd>
            </div>
          </dl>
          {c.merchantUnreachable && <p className="governance-muted">{gt(l, 'absent')}</p>}
          <p className="governance-stamp">{dateTime(l, c.createdAt)}</p>
          {data.receipt && (
            <div className="decision-receipt">
              <strong>{gt(l, 'receipt')}</strong>
              <p>{data.receipt.text}</p>
              <small>{dateTime(l, data.receipt.at)}</small>
            </div>
          )}
          {actor.role === 'MERCHANT' &&
            c.outcome === 'FOLLOW_UP' &&
            !data.receipt &&
            data.state !== 'NEEDS_REVIEW' &&
            ticket.status === 'PLATFORM_ESCALATED' && (
              <button
                className="button secondary"
                onClick={() => {
                  receiptSnapshot.current = { version: c.version, ticketVersion: ticket.version };
                  setError('');
                  setReceiptOpen(true);
                }}
              >
                {gt(l, 'acknowledge')}
              </button>
            )}
          {data.history.length > 1 && (
            <details className="decision-history">
              <summary>
                {gt(l, 'history')} ({data.history.length - 1})
              </summary>
              {data.history.slice(1).map((h) => (
                <article key={h.id}>
                  <strong>
                    v{h.version} · {gt(l, h.outcome)}
                    {h.amount > 0 && ` · ${money(l, h.amount)}`}
                  </strong>
                  <p>{h.summary}</p>
                  <p>{h.reason}</p>
                  <small>{dateTime(l, h.createdAt)}</small>
                </article>
              ))}
            </details>
          )}
        </>
      ) : (
        <p>{gt(l, 'noDecision')}</p>
      )}
      {error && (
        <p role="alert" className="quality-error">
          {error}
        </p>
      )}
      {admin && ticket.status === 'PLATFORM_ESCALATED' && ticket.bookingId && (
        <button className="button secondary" onClick={start}>
          {gt(l, c ? 'revise' : 'publish')}
        </button>
      )}
      <p className="governance-muted decision-boundary">{gt(l, 'publicHelp')}</p>
      <MobileSheet
        open={receiptOpen}
        onClose={() => {
          if (!busy) setReceiptOpen(false);
        }}
        title={gt(l, 'acknowledge')}
        locale={l}
      >
        <form
          className="governance-form"
          onSubmit={(e) => {
            e.preventDefault();
            void acknowledge();
          }}
        >
          <p>{gt(l, 'receiptHelp')}</p>
          <fieldset disabled={busy}>
            <label>
              {gt(l, 'receipt')}
              <textarea
                required
                minLength={10}
                maxLength={1000}
                value={receiptText}
                onChange={(e) => setReceiptText(e.target.value)}
              />
            </label>
            <button className="button full" disabled={receiptText.trim().length < 10}>
              {gt(l, 'acknowledge')}
            </button>
          </fieldset>
        </form>
      </MobileSheet>{' '}
      <MobileSheet
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={gt(l, c ? 'revise' : 'publish')}
        locale={l}
        className="decision-sheet"
      >
        <form
          className="governance-form"
          onSubmit={(e) => {
            e.preventDefault();
            void publish();
          }}
        >
          <p>{gt(l, 'publicHelp')}</p>
          <fieldset disabled={busy}>
            <label>
              {gt(l, 'outcome')}
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as typeof outcome)}
              >
                {(['REFUND', 'NO_REFUND', 'FOLLOW_UP'] as const)
                  .filter((k) => pending || k === 'FOLLOW_UP')
                  .map((k) => (
                    <option key={k} value={k}>
                      {gt(l, k)}
                    </option>
                  ))}
              </select>
            </label>
            {outcome === 'REFUND' && (
              <label>
                {gt(l, 'amount')}
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={cap}
                  step={1}
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            )}
            <label>
              {gt(l, 'summary')}
              <textarea
                required
                minLength={20}
                maxLength={2000}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </label>
            <label>
              {gt(l, 'reason')}
              <textarea
                required
                minLength={20}
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="decision-evidence">
              <h3>{gt(l, 'evidence')}</h3>
              <p className="governance-muted">{gt(l, 'evidenceHelp')}</p>
              <blockquote>{ticket.description}</blockquote>
              {messages
                .filter((m) => ['MESSAGE', 'REOPEN'].includes(m.kind))
                .map((m) => (
                  <label className="decision-check" key={m.id}>
                    <input
                      type="checkbox"
                      checked={refs.includes(m.id)}
                      onChange={(e) =>
                        setRefs((v) =>
                          e.target.checked ? [...v, m.id] : v.filter((id) => id !== m.id),
                        )
                      }
                    />
                    <span>
                      <strong>
                        {gt(
                          l,
                          m.role === 'MERCHANT'
                            ? 'merchant'
                            : m.role === 'CUSTOMER'
                              ? 'customer'
                              : 'platform',
                        )}{' '}
                        · {dateTime(l, m.createdAt)}
                      </strong>
                      <span>{m.text}</span>
                    </span>
                  </label>
                ))}
            </div>
            {!messages.some((m) => m.role === 'MERCHANT' && m.kind === 'MESSAGE') && (
              <label className="decision-check">
                <input
                  type="checkbox"
                  checked={absent}
                  disabled={Date.now() < ticket.createdAt + 24 * 3600000}
                  onChange={(e) => setAbsent(e.target.checked)}
                />
                <span>{gt(l, 'absent')}</span>
              </label>
            )}
            <label className="decision-check">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>{gt(l, 'confirm')}</span>
            </label>
            {error && (
              <p role="alert" className="quality-error">
                {error}
              </p>
            )}
            <button
              className="button full"
              disabled={
                !confirmed ||
                summary.trim().length < 20 ||
                reason.trim().length < 20 ||
                (!absent &&
                  !messages.some(
                    (m) => m.role === 'MERCHANT' && m.kind === 'MESSAGE' && refs.includes(m.id),
                  )) ||
                refs.length > 30
              }
            >
              {gt(l, 'publish')}
            </button>
          </fieldset>
        </form>
      </MobileSheet>
    </section>
  );
}
