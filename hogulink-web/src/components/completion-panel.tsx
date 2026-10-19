'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Clock3, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';
import type { Booking, Locale, Role } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, money } from '@/lib/i18n';
import { cpt } from '@/lib/completion-i18n';
import { MobileSheet } from './mobile-ui';

type View = {
  serverNow: number;
  bookingVersion: number;
  eligibleAt?: number;
  completion: Booking['completion'] | null;
};
export function CompletionPanel({
  locale: l,
  booking: b,
  role,
  onUpdated,
}: {
  locale: Locale;
  booking: Booking;
  role: Role;
  onUpdated: () => void;
}) {
  const [view, setView] = useState<View>(),
    [now, setNow] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [action, setAction] = useState<string>(),
    [note, setNote] = useState(''),
    [consent, setConsent] = useState(false);
  const clock = useRef({ server: 0, local: 0 }),
    retry = useRef<{ payload: string; key: string } | null>(null);
  const generation = useRef(0);
  const latest = useRef({ version: b.version, onUpdated });
  latest.current = { version: b.version, onUpdated };
  const relevant =
    ['ARRIVED', 'IN_SERVICE', 'AWAITING_COMPLETION'].includes(b.status) || !!b.completion;
  const load = useCallback(async () => {
    const request = ++generation.current;
    const value = await api<View>(`bookings/${b.id}/completion`);
    if (request !== generation.current) return value;
    clock.current = { server: value.serverNow, local: Date.now() };
    setNow(value.serverNow);
    setView(value);
    if (value.bookingVersion !== latest.current.version) latest.current.onUpdated();
    return value;
  }, [b.id]);
  useEffect(() => {
    if (!relevant) return;
    let active = true;
    const refresh = () =>
      load().catch(() => {
        if (active) setError(cpt(l, 'error'));
      });
    void refresh();
    const poll = setInterval(refresh, 15000),
      tick = setInterval(
        () => setNow(clock.current.server + Math.max(0, Date.now() - clock.current.local)),
        1000,
      );
    return () => {
      active = false;
      generation.current++;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load, relevant, b.version, l]);
  if (!relevant) return null;
  const c = view?.completion ?? b.completion,
    status = c?.status,
    eligibleAt = view?.eligibleAt;
  const current = !!view && view.bookingVersion === b.version;
  const short = !!c && (!!c.timingInvalid || c.endedAt < c.eligibleAt);
  const remaining = eligibleAt ? Math.max(0, Math.ceil((eligibleAt - now) / 60000)) : 0;
  const open = (next: string) => {
    setAction(next);
    setNote('');
    setConsent(false);
    setError('');
    retry.current = null;
  };
  async function submit() {
    if (!action || !view) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'START' || action === 'REQUEST') {
        await api(`staff/tasks/${b.id}/events`, {
          version: view.bookingVersion,
          event: action === 'START' ? 'START' : 'COMPLETE',
        });
      } else {
        const payload = {
          version: view.bookingVersion,
          action,
          ...(['CONFIRM', 'REAUTHORIZE'].includes(action)
            ? { expectedAmount: b.quote.total }
            : { note }),
        };
        const encoded = JSON.stringify(payload);
        if (retry.current?.payload !== encoded)
          retry.current = { payload: encoded, key: crypto.randomUUID() };
        await api(`bookings/${b.id}/completion`, payload, 'POST', retry.current.key);
      }
      setAction(undefined);
      retry.current = null;
      await load();
    } catch (e) {
      setError(cpt(l, e instanceof ClientError ? e.code : 'error'));
      if (e instanceof ClientError && e.code === 'VERSION_CONFLICT') {
        retry.current = null;
        await load();
      }
    } finally {
      setBusy(false);
    }
  }
  const title =
    action === 'REQUEST'
      ? 'request'
      : action === 'START'
        ? 'start'
        : action === 'CONFIRM'
          ? 'confirm'
          : action === 'REAUTHORIZE'
            ? 'reauthorize'
            : action === 'DISPUTE'
              ? b.status === 'IN_SERVICE'
                ? 'stop'
                : 'dispute'
              : action === 'EXCEPTION'
                ? 'exception'
                : action === 'REVIEW'
                  ? 'review'
                  : 'void';
  const locked = busy || !current;
  return (
    <section
      className={`completion-panel ${status && !['PENDING', 'CONFIRMED', 'VOIDED'].includes(status) ? 'needs-review' : ''}`}
      aria-label={cpt(l, 'title')}
    >
      <div className="completion-heading">
        <span className="completion-icon">
          <ShieldCheck size={22} />
        </span>
        <div>
          <span className="eyebrow">SERVICE ASSURANCE</span>
          <h3>{cpt(l, 'title')}</h3>
        </div>
        {status && <span className="completion-status">{cpt(l, status)}</span>}
      </div>
      <p className="completion-intro">{cpt(l, 'intro')}</p>
      <dl className="completion-times">
        <div>
          <dt>{cpt(l, 'scheduled')}</dt>
          <dd>{dateTime(l, b.quote.startAt)}</dd>
        </div>
        {b.startedAt !== undefined && (
          <div>
            <dt>{cpt(l, 'started')}</dt>
            <dd>{dateTime(l, b.startedAt)}</dd>
          </div>
        )}
        {eligibleAt !== undefined && (
          <div>
            <dt>{cpt(l, 'eligible')}</dt>
            <dd>{dateTime(l, eligibleAt)}</dd>
          </div>
        )}
        {c && (
          <div>
            <dt>{cpt(l, 'ended')}</dt>
            <dd>{dateTime(l, c.endedAt)}</dd>
          </div>
        )}
        {status === 'PENDING' && (
          <div>
            <dt>{cpt(l, 'due')}</dt>
            <dd>{dateTime(l, c!.confirmBy)}</dd>
          </div>
        )}
      </dl>
      {b.status === 'IN_SERVICE' && remaining > 0 && (
        <p className="completion-countdown">
          <Clock3 size={17} />
          {cpt(l, 'wait')} <strong>{remaining}</strong>
        </p>
      )}
      {short && status !== 'VOIDED' && (
        <p className="completion-advice">
          <AlertCircle size={18} />
          {cpt(l, 'short')}
        </p>
      )}
      {status && !['CONFIRMED', 'VOIDED'].includes(status) && (
        <p className="completion-advice">{cpt(l, 'reviewOnly')}</p>
      )}
      <div className="completion-actions">
        {role === 'STAFF' && b.status === 'ARRIVED' && (
          <>
            <button
              className="button"
              disabled={locked || now < b.quote.startAt}
              onClick={() => open('START')}
            >
              {cpt(l, 'start')}
              <ArrowRight size={16} />
            </button>
            {now < b.quote.startAt && <small>{cpt(l, 'startWait')}</small>}
          </>
        )}
        {role === 'STAFF' && b.status === 'IN_SERVICE' && (
          <button
            className="button"
            disabled={locked || eligibleAt === undefined || now < eligibleAt}
            onClick={() => open('REQUEST')}
          >
            {cpt(l, 'request')}
            <ArrowRight size={16} />
          </button>
        )}
        {role === 'CUSTOMER' && b.status === 'AWAITING_COMPLETION' && status === 'PENDING' && (
          <button
            className="button"
            disabled={locked || short || now >= c!.confirmBy}
            onClick={() => open('CONFIRM')}
          >
            {cpt(l, 'confirm')}
            <ArrowRight size={16} />
          </button>
        )}
        {role === 'CUSTOMER' && status === 'PAYMENT_REVIEW' && (
          <button className="button" disabled={locked} onClick={() => open('REAUTHORIZE')}>
            {cpt(l, 'reauthorize')}
          </button>
        )}
        {role === 'CUSTOMER' && ['IN_SERVICE', 'AWAITING_COMPLETION'].includes(b.status) && (
          <button className="button secondary" disabled={locked} onClick={() => open('DISPUTE')}>
            {cpt(l, b.status === 'IN_SERVICE' ? 'stop' : 'dispute')}
          </button>
        )}
        {['STAFF', 'MERCHANT'].includes(role) && b.status === 'IN_SERVICE' && (
          <button className="button secondary" disabled={locked} onClick={() => open('EXCEPTION')}>
            {cpt(l, 'exception')}
          </button>
        )}
        {role === 'MERCHANT' && b.status === 'AWAITING_COMPLETION' && (
          <>
            {status && ['DISPUTED', 'TIMED_OUT'].includes(status) && !short && (
              <button className="button" disabled={locked} onClick={() => open('REVIEW')}>
                {cpt(l, 'review')}
              </button>
            )}
            <button className="button secondary" disabled={locked} onClick={() => open('VOID')}>
              {cpt(l, 'void')}
            </button>
          </>
        )}
        {c?.ticketId && role !== 'STAFF' && (
          <Link
            className="text-button"
            href={`/${l}/${role === 'CUSTOMER' ? 'account/support' : role.toLowerCase() + '/support'}?${role === 'CUSTOMER' ? 'ticket' : 'case'}=${encodeURIComponent(c.ticketId)}#case-detail`}
          >
            {cpt(l, 'case')} ↗
          </Link>
        )}
      </div>
      {!!c?.history.length && (
        <details className="completion-history">
          <summary>
            {cpt(l, 'history')} · {c.history.length}
          </summary>
          <ol>
            {c.history.map((h, i) => (
              <li key={i}>
                <strong>{cpt(l, h.action)}</strong>
                <time>{dateTime(l, h.at)}</time>
                {h.note && <p>{h.note}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {error && !action && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <MobileSheet
        open={!!action}
        onClose={() => {
          if (!busy) setAction(undefined);
        }}
        title={cpt(l, title)}
        locale={l}
        className="completion-dialog"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p>
            {cpt(
              l,
              action === 'CONFIRM'
                ? 'confirmHelp'
                : action === 'REAUTHORIZE'
                  ? 'reauthorizeHelp'
                  : action === 'VOID'
                    ? 'voidHelp'
                    : action === 'REVIEW'
                      ? 'reviewHelp'
                      : action === 'DISPUTE'
                        ? b.status === 'IN_SERVICE'
                          ? 'stopHelp'
                          : 'disputeHelp'
                        : action === 'EXCEPTION'
                          ? 'exceptionHelp'
                          : 'intro',
            )}
          </p>
          {action === 'CONFIRM' ? (
            <>
              <div className="completion-amount">
                <span>{cpt(l, 'amount')}</span>
                <strong>{money(l, b.quote.total)}</strong>
              </div>
              <label className="completion-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  required
                />
                {cpt(l, 'consent')}
              </label>
            </>
          ) : action === 'REAUTHORIZE' ? (
            <div className="completion-amount">
              <span>{cpt(l, 'reauthorize')}</span>
              <strong>{money(l, b.quote.total)}</strong>
            </div>
          ) : (
            !['START', 'REQUEST'].includes(action ?? '') && (
              <label className="completion-note">
                {cpt(l, 'note')}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  minLength={10}
                  maxLength={1000}
                  required
                  rows={4}
                />
              </label>
            )
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="completion-actions">
            <button
              className="button"
              disabled={busy || (action === 'CONFIRM' && !consent)}
              type="submit"
            >
              {cpt(l, 'submit')}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => setAction(undefined)}
            >
              {cpt(l, 'cancel')}
            </button>
          </div>
        </form>
      </MobileSheet>
    </section>
  );
}
