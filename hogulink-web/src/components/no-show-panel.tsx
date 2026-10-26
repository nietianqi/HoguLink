'use client';
import { useEffect, useRef, useState } from 'react';
import {
  IN_STORE_NO_SHOW_REPLY_MINUTES,
  type Booking,
  type Locale,
  type Role,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, money } from '@/lib/i18n';
import { xt, exceptionError } from '@/lib/exception-i18n';
import { sv } from '@/lib/service-mode-i18n';
import { MobileSheet } from './mobile-ui';

type NoShowBooking = Pick<
  Booking,
  'id' | 'version' | 'status' | 'noShow' | 'arrivedAt' | 'checkIn'
> & {
  quote: Pick<
    Booking['quote'],
    'total' | 'transportFee' | 'cancellationPolicy' | 'fulfillmentMode' | 'startAt'
  >;
};
export function NoShowPanel({
  locale: l,
  booking: b,
  role,
  onUpdated,
}: {
  locale: Locale;
  booking: NoShowBooking;
  role: Role;
  onUpdated: () => Promise<unknown> | void;
}) {
  const [now, setNow] = useState(0),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [agreed, setAgreed] = useState(false);
  const request = useRef('');
  const inStore = b.quote.fulfillmentMode === 'IN_STORE';
  const atVenue = inStore && b.status === 'CONFIRMED' && !b.checkIn;
  const arrived = b.status === 'ARRIVED' || atVenue;
  const canContact = role === 'STAFF' || (inStore && role === 'MERCHANT');
  useEffect(() => {
    setText(xt(l, role === 'STAFF' ? 'contactText' : 'noteText'));
    setError('');
    setReview(false);
    setAgreed(false);
    request.current = '';
  }, [b.id, l, role]);
  useEffect(() => {
    if (!arrived || b.noShow?.status !== 'REPORTED') setReview(false);
  }, [b.status, b.noShow?.status]);
  useEffect(() => {
    if (!arrived || (role !== 'STAFF' && role !== 'MERCHANT')) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [b.id, b.status, role]);
  const policy = b.quote.cancellationPolicy.noShow,
    report = b.noShow;
  if (!(canContact && arrived) && !report) return null;
  if (!policy) return <p className="notice">{xt(l, 'legacy')}</p>;
  const fee = Math.floor(((b.quote.total - b.quote.transportFee) * policy.feeBps) / 10000);
  const ready =
    !!report && !!now && now >= report.waitUntil && report.contacts.length >= policy.minContacts;
  const last = report?.contacts.at(-1),
    nextContact = last ? last.at + policy.contactGapMinutes * 60000 : 0;
  async function act(action: 'CONTACT' | 'REPORT' | 'CONFIRM' | 'DISMISS') {
    const note = action === 'REPORT' ? xt(l, 'reportText') : text;
    if (note.trim().length < 10) {
      setError(xt(l, 'noteRequired'));
      return;
    }
    setBusy(true);
    setError('');
    request.current ||= crypto.randomUUID();
    try {
      await api(
        `bookings/${b.id}/no-show`,
        { version: b.version, action, text: note },
        'POST',
        request.current,
      );
      request.current = '';
      setReview(false);
      setAgreed(false);
      await onUpdated();
    } catch (e) {
      const code = e instanceof ClientError ? e.code : undefined;
      setError(exceptionError(l, code));
      if (code === 'VERSION_CONFLICT') {
        request.current = '';
        await onUpdated();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="exception-panel" aria-label={xt(l, 'title')}>
      <div className="exception-heading">
        <h3>{inStore ? sv(l, 'noShow') : xt(l, 'title')}</h3>
        <span>{xt(l, report?.status ?? 'CONTACTING')}</span>
      </div>
      <p>{inStore ? sv(l, 'noShowHelp') : xt(l, 'help')}</p>
      <dl className="exception-facts">
        <div>
          <dt>{xt(l, 'attempts')}</dt>
          <dd>
            {report?.contacts.length ?? 0} / {policy.minContacts}
          </dd>
        </div>
        {report && (
          <div>
            <dt>{xt(l, 'waitUntil')}</dt>
            <dd>{dateTime(l, report.waitUntil)} JST</dd>
          </div>
        )}
        {inStore && report?.status === 'REPORTED' && report.reportedAt !== undefined && (
          <div>
            <dt>{sv(l, 'replyUntil')}</dt>
            <dd>{dateTime(l, report.reportedAt + IN_STORE_NO_SHOW_REPLY_MINUTES * 60000)} JST</dd>
          </div>
        )}
        <div>
          <dt>{xt(l, report?.status === 'CONFIRMED' ? 'fee' : 'estimate')}</dt>
          <dd>{money(l, report?.fee ?? fee)}</dd>
        </div>
      </dl>
      {!!report?.contacts.length && (
        <ol className="exception-history">
          {report.contacts.map((c) => (
            <li key={c.id}>
              {xt(l, 'contact')} · {dateTime(l, c.at)} JST
            </li>
          ))}
        </ol>
      )}
      {report?.reviewNote && <p>{report.reviewNote}</p>}
      {inStore &&
        role === 'CUSTOMER' &&
        (report?.status === 'CONTACTING' || report?.status === 'REPORTED') && (
          <p className="notice">{sv(l, 'noShowReply')}</p>
        )}
      {canContact && arrived && (!report || report.status === 'CONTACTING') && (
        <>
          <label className="field">
            {xt(l, 'message')}
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                request.current = '';
              }}
              minLength={10}
              maxLength={500}
              disabled={busy}
              rows={3}
            />
          </label>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy || !now || now < nextContact || (inStore && now < b.quote.startAt)}
              onClick={() => void act('CONTACT')}
            >
              {xt(l, 'contact')}
            </button>
            <button className="button" disabled={busy || !ready} onClick={() => void act('REPORT')}>
              {xt(l, 'report')}
            </button>
          </div>
          {!!nextContact && now < nextContact && (
            <p>
              {xt(l, 'nextContact')} · {dateTime(l, nextContact)} JST
            </p>
          )}
          {!ready && <p>{xt(l, 'notReady')}</p>}
        </>
      )}
      {role === 'MERCHANT' &&
        arrived &&
        report &&
        ['CONTACTING', 'REPORTED'].includes(report.status) && (
          <>
            <label className="field">
              {xt(l, 'decisionNote')}
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  request.current = '';
                }}
                minLength={10}
                maxLength={500}
                disabled={busy}
                rows={3}
              />
            </label>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void act('DISMISS')}
              >
                {xt(l, 'dismiss')}
              </button>
              {report.status === 'REPORTED' && (
                <button
                  className="button"
                  disabled={busy || !ready}
                  onClick={() => {
                    setError('');
                    setAgreed(false);
                    setReview(true);
                  }}
                >
                  {xt(l, 'confirm')}
                </button>
              )}
            </div>
          </>
        )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <MobileSheet
        locale={l}
        open={review}
        onClose={() => {
          if (!busy) setReview(false);
        }}
        title={xt(l, 'confirm')}
      >
        <form
          className="exception-review"
          onSubmit={(e) => {
            e.preventDefault();
            void act('CONFIRM');
          }}
        >
          <strong>
            {xt(l, 'fee')} · {money(l, fee)}
          </strong>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <p>{xt(l, 'reviewHelp')}</p>
          <p>
            {xt(l, 'attempts')} · {report?.contacts.length ?? 0} / {policy.minContacts}
          </p>
          {report && (
            <p>
              {xt(l, 'waitUntil')} · {dateTime(l, report.waitUntil)} JST
            </p>
          )}
          <label className="checkbox">
            <input
              required
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>{xt(l, 'acknowledge')}</span>
          </label>
          <button className="button full" disabled={busy || !agreed || !ready}>
            {xt(l, 'charge')}
          </button>
        </form>
      </MobileSheet>
    </section>
  );
}
