'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, LifeBuoy, ReceiptText, RefreshCw } from 'lucide-react';
import type {
  Actor,
  Booking,
  Locale,
  OrderCare,
  RefundCase,
  RefundRequestView,
  SupportTicket,
} from '@hogulink/contracts';
import { api } from '@/lib/api';
import { dateTime, money, statusText, t } from '@/lib/i18n';
import { bookingStage } from '@/lib/customer-flow-model';
import { caseStatus } from '@/lib/care-i18n';
import { af, flowError, refundStatus } from '@/lib/customer-flow-i18n';
import { MobileSheet } from './mobile-ui';
import { wt } from '@/lib/workday-i18n';
import { customerShowAmounts } from '@/lib/customer-order-model';
import { pc } from '@/lib/pc-consumer-i18n';

export function OrderCarePanel({
  locale: l,
  booking: b,
  onUpdated,
  showProgress = true,
}: {
  locale: Locale;
  booking: Booking;
  onUpdated: () => void;
  showProgress?: boolean;
}) {
  const [data, setData] = useState<OrderCare>(),
    [open, setOpen] = useState(false),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [loadedVersion, setLoadedVersion] = useState<number>();
  const latestOrder = useRef({ version: b.version, onUpdated });
  latestOrder.current = { version: b.version, onUpdated };
  const retry = useRef({ body: '', key: '' }),
    generation = useRef(0),
    lock = useRef(false);
  const load = useCallback(async () => {
    const gen = ++generation.current;
    setLoading(true);
    try {
      const next = await api<OrderCare>(`customer/bookings/${b.id}/care`);
      if (gen === generation.current) {
        setData(next);
        setLoadedVersion(next.bookingVersion ?? b.version);
        setError('');
        if (
          next.bookingVersion !== undefined &&
          next.bookingVersion !== latestOrder.current.version
        )
          latestOrder.current.onUpdated();
      }
    } catch (e) {
      if (gen === generation.current) {
        setLoadedVersion(undefined);
        setError(flowError(l, e));
      }
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [b.id, b.version, l]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  const pending = data?.requests.find((r) => r.status === 'PENDING');
  const latest = data?.requests[0];
  const stage = bookingStage(b.status);
  const current = loadedVersion === b.version && !loading;
  return (
    <section
      className="order-care-panel"
      id={`aftercare-${b.id}`}
      aria-busy={loading}
      aria-labelledby={`care-title-${b.id}`}
    >
      {showProgress && (
        <div className="order-journey">
          <strong>
            {t(l, 'timeline')} ·{' '}
            {b.replacementConsent === 'PENDING' && b.proposedListingId
              ? wt(l, 'consentPending')
              : statusText(l, b.status)}
          </strong>
          {stage !== null && (
            <ol aria-label={t(l, 'timeline')}>
              {(['requestStep', 'confirmationStep', 'visitStep', 'completeStep'] as const).map(
                (key, i) => (
                  <li
                    key={key}
                    data-done={i <= stage}
                    aria-current={i === stage ? 'step' : undefined}
                  >
                    {af(l, key)}
                  </li>
                ),
              )}
            </ol>
          )}
        </div>
      )}
      <div className="flow-section-head">
        <h3 id={`care-title-${b.id}`}>
          <LifeBuoy size={19} />
          {af(l, 'aftercare')}
        </h3>
        <button
          className="quality-link"
          disabled={loading}
          onClick={() => void load()}
          aria-label={af(l, 'refresh')}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="flow-muted">{af(l, 'aftercareHelp')}</p>
      {!data && loading && (
        <p className="flow-muted" role="status">
          {af(l, 'loading')}
        </p>
      )}
      {data && (
        <>
          {customerShowAmounts(data) ? (
            <dl className="order-care-amounts">
              <div>
                <dt>{af(l, 'charged')}</dt>
                <dd>{money(l, data.captured)}</dd>
              </div>
              <div>
                <dt>{af(l, 'refunded')}</dt>
                <dd>{money(l, data.refunded)}</dd>
              </div>
              <div>
                <dt>{af(l, 'remaining')}</dt>
                <dd>{money(l, data.remaining)}</dd>
              </div>
            </dl>
          ) : (
            <p className="flow-muted">{pc(l, 'noCharge')}</p>
          )}
          {data.captured === 0 && customerShowAmounts(data) && (
            <p className="flow-muted">{af(l, 'authorizationHelp')}</p>
          )}
          {data.captured > 0 && (
            <p className="care-next-step">
              {af(
                l,
                pending
                  ? 'refundWaitingHelp'
                  : data.canRequest
                    ? 'refundAvailableHelp'
                    : data.remaining === 0
                      ? 'refundSettledHelp'
                      : 'refundUnavailableHelp',
              )}
            </p>
          )}
          {latest && (
            <div className="care-refund-progress">
              <div className="flow-section-head">
                <h4>{af(l, 'refundProgress')}</h4>
                <span className={`care-refund-status refund-${latest.status.toLowerCase()}`}>
                  {refundStatus(l, latest.status)}
                </span>
              </div>
              {latest.status !== 'WITHDRAWN' && (
                <ol aria-label={af(l, 'refundProgress')}>
                  {(['refundReceived', 'refundReview', 'refundOutcome'] as const).map((key, i) => {
                    const current = latest.status === 'PENDING' ? 1 : 2;
                    return (
                      <li
                        key={key}
                        data-done={i <= current}
                        aria-current={i === current ? 'step' : undefined}
                      >
                        <span>{String(i + 1).padStart(2, '0')}</span>
                        {af(l, key)}
                      </li>
                    );
                  })}
                </ol>
              )}
              <dl className="care-refund-summary">
                <div>
                  <dt>{af(l, 'refundRequestedAmount')}</dt>
                  <dd>{money(l, latest.amount)}</dd>
                </div>
                {latest.approvedAmount !== undefined && (
                  <div>
                    <dt>{af(l, 'refundApprovedAmount')}</dt>
                    <dd>{money(l, latest.approvedAmount)}</dd>
                  </div>
                )}
              </dl>
              {latest.decision && <p>{latest.decision}</p>}
              <Link
                className="quality-link"
                href={`/${l}/account/support?ticket=${latest.ticketId}#case-detail`}
              >
                {af(l, 'viewRefundCase')}
                <ArrowUpRight size={15} />
              </Link>
            </div>
          )}
          <div className="flow-actions">
            <Link
              className="quality-button"
              href={`/${l}/account/support?booking=${b.id}&category=${data.captured > 0 ? 'PRICE_OR_REFUND' : 'SERVICE_QUALITY'}`}
            >
              {af(l, 'help')}
              <ArrowUpRight size={15} />
            </Link>
            {data.canRequest && (
              <button
                className="quality-primary"
                disabled={busy || !current}
                onClick={() => {
                  setAmount(String(data.remaining));
                  setOpen(true);
                }}
              >
                {af(l, 'refund')}
              </button>
            )}
            {pending && (
              <Link
                className="quality-button"
                href={`/${l}/account/support?ticket=${pending.ticketId}#case-detail`}
              >
                {af(l, 'refundPending')}
                <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
          <div className="order-care-cases">
            {data.cases.length === 0 ? (
              <p className="flow-muted">{af(l, 'noCases')}</p>
            ) : (
              data.cases.map((c) => (
                <Link key={c.id} href={`/${l}/account/support?ticket=${c.id}#case-detail`}>
                  <ReceiptText size={18} />
                  <span>
                    <strong>{c.subject}</strong>
                    <small>
                      #{c.id.slice(-8).toUpperCase()} · {caseStatus(l, c.status)} ·{' '}
                      {dateTime(l, c.updatedAt)}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              ))
            )}
          </div>
        </>
      )}
      {error && (
        <p className="quality-error" role="alert">
          {error}
          <button className="quality-link" disabled={loading} onClick={() => void load()}>
            {af(l, 'refresh')}
          </button>
        </p>
      )}
      <MobileSheet
        locale={l}
        open={open}
        title={af(l, 'refundTitle')}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        {data && (
          <form
            className="flow-sheet-content flow-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (lock.current || !data.canRequest || !current) return;
              lock.current = true;
              setBusy(true);
              setError('');
              const body = { bookingVersion: b.version, amount: Number(amount), reason, locale: l },
                json = JSON.stringify(body);
              if (retry.current.body !== json)
                retry.current = { body: json, key: crypto.randomUUID() };
              try {
                const r = await api<RefundRequestView>(
                  `customer/bookings/${b.id}/refund-requests`,
                  body,
                  'POST',
                  retry.current.key,
                );
                setOpen(false);
                setReason('');
                await load();
                onUpdated();
                window.dispatchEvent(new Event('hogulink-inbox-updated'));
              } catch (e) {
                await load();
                onUpdated();
                setError(flowError(l, e));
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            <p>{af(l, 'refundIntro')}</p>
            <p className="flow-muted">
              {b.legalNameSnapshot} · {af(l, 'remaining')} {money(l, data.remaining)}
            </p>
            <fieldset disabled={busy || !current}>
              <label>
                {af(l, 'amount')}
                <input
                  type="number"
                  inputMode="numeric"
                  required
                  min={1}
                  max={data.remaining}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                {af(l, 'reason')}
                <textarea
                  required
                  minLength={10}
                  maxLength={1000}
                  value={reason}
                  placeholder={af(l, 'reasonHint')}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <p className="flow-muted">{af(l, 'demoRefund')}</p>
              {error && (
                <p className="quality-error" role="alert">
                  {error}
                </p>
              )}
              <div className="flow-actions">
                <button className="quality-button" type="button" onClick={() => setOpen(false)}>
                  {af(l, 'cancel')}
                </button>
                <button className="quality-primary" disabled={!data.canRequest}>
                  {af(l, 'sendRequest')}
                </button>
              </div>
            </fieldset>
            {!current && (
              <p className="flow-muted" role="status">
                {af(l, 'refreshBeforeAction')}
              </p>
            )}
            {error && (
              <button
                type="button"
                className="quality-button"
                disabled={busy || loading}
                onClick={() => void load()}
              >
                {af(l, 'refresh')}
              </button>
            )}
          </form>
        )}
      </MobileSheet>
    </section>
  );
}
export function RefundCasePanel({
  locale: l,
  ticket,
  actor,
  onUpdated,
}: {
  locale: Locale;
  ticket: SupportTicket;
  actor: Actor;
  onUpdated: () => void;
}) {
  const [data, setData] = useState<RefundCase | null>(),
    [amount, setAmount] = useState(''),
    [text, setText] = useState(''),
    [confirm, setConfirm] = useState<'APPROVE' | 'REJECT' | 'WITHDRAW' | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedVersion, setLoadedVersion] = useState<number>();
  const retry = useRef({ body: '', key: '' }),
    gen = useRef(0),
    lock = useRef(false);
  const load = useCallback(async () => {
    const request = ++gen.current;
    setLoading(true);
    try {
      const next = await api<RefundCase | null>(`support-tickets/${ticket.id}/refund-request`);
      if (request === gen.current) {
        setData(next);
        setLoadedVersion(ticket.version);
        if (next)
          setAmount(
            (previous) => previous || String(Math.min(next.remaining, next.request.amount)),
          );
        setError('');
      }
    } catch (e) {
      if (request === gen.current) {
        setLoadedVersion(undefined);
        setError(flowError(l, e));
      }
    } finally {
      if (request === gen.current) setLoading(false);
    }
  }, [ticket.id, ticket.version, l]);
  useEffect(() => {
    void load();
    return () => {
      gen.current++;
    };
  }, [load]);
  const r = data?.request,
    pending = r?.status === 'PENDING',
    current = loadedVersion === ticket.version && !loading,
    cap = r && data ? Math.min(r.amount, data.remaining) : 0;
  async function decide() {
    if (!data || !r || !confirm || lock.current || !current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const body = {
        version: r.version,
        bookingVersion: data.bookingVersion,
        action: confirm,
        amount: confirm === 'APPROVE' ? Number(amount) : 0,
        text:
          confirm === 'WITHDRAW'
            ? {
                ja: '返金申請を取り下げます。今回は返金しません。',
                en: 'I withdraw this refund request without processing a refund.',
                'zh-cn': '本人确认撤回本次退款申请，本次不进行退款处理。',
              }[l]
            : text,
      },
      json = JSON.stringify(body);
    if (retry.current.body !== json) retry.current = { body: json, key: crypto.randomUUID() };
    try {
      await api(`refund-requests/${r.id}/decision`, body, 'POST', retry.current.key);
      setConfirm(null);
      setText('');
      await load();
      onUpdated();
      window.dispatchEvent(new Event('hogulink-inbox-updated'));
    } catch (e) {
      await load();
      setConfirm(null);
      setError(flowError(l, e));
      onUpdated();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!data)
    return error ? (
      <p role="alert" className="quality-error">
        {error}
        <button className="quality-link" onClick={() => void load()}>
          {af(l, 'refresh')}
        </button>
      </p>
    ) : (
      <p role="status">{af(l, 'loading')}</p>
    );
  return (
    <section className="refund-case-panel">
      <div className="flow-section-head">
        <h3>{af(l, 'refund')}</h3>
        <strong>{refundStatus(l, data.request.status)}</strong>
      </div>
      <dl className="order-care-amounts">
        <div>
          <dt>{af(l, 'requested')}</dt>
          <dd>{money(l, data.request.amount)}</dd>
        </div>
        {data.request.approvedAmount !== undefined && (
          <div>
            <dt>{af(l, 'actualRefund')}</dt>
            <dd>{money(l, data.request.approvedAmount)}</dd>
          </div>
        )}
        <div>
          <dt>{af(l, 'remaining')}</dt>
          <dd>{money(l, data.remaining)}</dd>
        </div>
      </dl>
      <p className="flow-muted">{af(l, 'demoRefund')}</p>
      {data.request.decision && <p>{data.request.decision}</p>}
      {pending && actor.role === 'CUSTOMER' && (
        <button
          className="quality-button"
          disabled={busy || !current}
          onClick={() => setConfirm('WITHDRAW')}
        >
          {af(l, 'withdraw')}
        </button>
      )}
      {pending && actor.role === 'MERCHANT' && (
        <form
          className="flow-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!current || busy) return;
            setConfirm('APPROVE');
          }}
        >
          <label>
            {af(l, 'approvedAmount')}
            <input
              type="number"
              inputMode="numeric"
              required
              min={1}
              max={cap}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(cap)}
            />
          </label>
          <label>
            {af(l, 'decision')}
            <textarea
              required
              minLength={10}
              maxLength={1000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={af(l, 'reasonHint')}
            />
          </label>
          <div className="flow-actions">
            <button className="quality-primary" disabled={busy || !current || cap < 1}>
              {af(l, 'approve')}
            </button>
            <button
              className="quality-button"
              type="button"
              disabled={busy || !current || text.trim().length < 10}
              onClick={() => setConfirm('REJECT')}
            >
              {af(l, 'reject')}
            </button>
          </div>
          <p className="flow-muted">{af(l, 'decisionHelp')}</p>
        </form>
      )}
      {actor.role === 'CUSTOMER' && (
        <Link className="quality-link" href={`/${l}/account/bookings/${data.request.bookingId}`}>
          {t(l, 'orders')} ↗
        </Link>
      )}
      {error && (
        <p className="quality-error" role="alert">
          {error}
          <button
            type="button"
            className="quality-link"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            {af(l, 'refresh')}
          </button>
        </p>
      )}
      <MobileSheet
        locale={l}
        open={!!confirm}
        title={af(l, confirm === 'WITHDRAW' ? 'withdrawConfirm' : 'decisionConfirm')}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
      >
        <div className="flow-sheet-content">
          <p>{af(l, confirm === 'WITHDRAW' ? 'withdrawHelp' : 'decisionHelp')}</p>
          <strong>
            {af(
              l,
              confirm === 'WITHDRAW'
                ? 'withdraw'
                : confirm === 'REJECT'
                  ? 'reject'
                  : Number(amount) === data.request.amount
                    ? 'approve'
                    : 'approvePartial',
            )}
          </strong>
          <p>
            {af(l, 'requested')} {money(l, data.request.amount)} · {af(l, 'actualRefund')}{' '}
            {money(l, confirm === 'APPROVE' ? Number(amount) : 0)}
          </p>
          {confirm !== 'WITHDRAW' && <p>{text}</p>}
          <p className="flow-muted">{af(l, 'demoRefund')}</p>
          <div className="flow-actions">
            <button className="quality-button" disabled={busy} onClick={() => setConfirm(null)}>
              {af(l, 'cancel')}
            </button>
            <button
              className="quality-primary"
              disabled={
                busy ||
                !current ||
                (confirm === 'APPROVE' &&
                  (!Number.isSafeInteger(Number(amount)) ||
                    Number(amount) < 1 ||
                    Number(amount) > cap))
              }
              onClick={() => void decide()}
            >
              {af(l, confirm === 'WITHDRAW' ? 'withdrawConfirm' : 'decisionConfirm')}
            </button>
          </div>
        </div>
      </MobileSheet>
    </section>
  );
}
