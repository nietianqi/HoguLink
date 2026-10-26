'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Check,
  Clock3,
  LockKeyhole,
  LoaderCircle,
  ArrowRight,
  MapPin,
  ShieldCheck,
  Store as StoreIcon,
  PencilLine,
} from 'lucide-react';
import type {
  Address,
  Booking,
  Hold,
  Locale,
  Localized,
  Quote,
  AcceptanceMode,
  SavedAddress,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { t, errorText, dateTime, areaName, languageNames } from '@/lib/i18n';
import { PriceLines } from './catalog';
import { VisitSteps } from './visit-shared';
import { vt, policyText, acceptanceHelp } from '@/lib/visit-i18n';
import { restoreVisitAddress, withServiceMode } from '@/lib/visit-model';
import { MobilePriceDock } from './mobile-ui';
import { mt } from '@/lib/mobile-i18n';
import { xt } from '@/lib/exception-i18n';
import { af } from '@/lib/customer-flow-i18n';
import {
  applyAddress,
  checkoutDraft,
  flowDraftPrefix,
  packCheckoutDraft,
} from '@/lib/customer-flow-model';
import { CheckoutAddresses } from './address-book';
import { MobileSheet } from './mobile-ui';
import { holdSecondsRemaining, visitTimeRange } from '@/lib/booking-presentation';
import { ca } from '@/lib/customer-auth-i18n';
import { VenueInfo } from './service-mode';
import { sv } from '@/lib/service-mode-i18n';
type CheckoutData = {
  serverNow?: number;
  hold: Hold;
  quote: Quote;
  legalName: string;
  storeName: Localized;
  storeSlug: string;
  payment?: { id: string; status: string };
  visit: {
    listingSlug: string;
    listingName?: Localized;
    photo?: string;
    offeringName?: Localized;
    durationMinutes: number;
    hotelOnly: boolean;
    acceptanceMode: AcceptanceMode;
  };
};
export function Checkout({ locale: l, holdId }: { locale: Locale; holdId: string }) {
  const router = useRouter();
  const [data, setData] = useState<CheckoutData>();
  const [error, setError] = useState('');
  const [loadCode, setLoadCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentId, setPaymentId] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [ready, setReady] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [review, setReview] = useState<Address | null>(null);
  const [phone, setPhone] = useState('');
  const [reviewPhone, setReviewPhone] = useState('');
  useEffect(() => {
    setPhone('');
    setReviewPhone('');
  }, [holdId, sessionVersion]);
  const inStore = data?.quote.fulfillmentMode === 'IN_STORE';
  const [instantUnavailable, setInstantUnavailable] = useState(false);
  const [sourceLabel, setSourceLabel] = useState('');
  const generation = useRef(0),
    touched = useRef(false),
    submitLock = useRef(false),
    retryKey = useRef('');
  const holdClock = useRef({ serverNow: 0, local: 0 });
  const [address, setAddress] = useState<Address>({
    name: '',
    type: 'HOTEL',
    area: '',
    detail: '',
    hotelName: '',
    room: '',
    hotelPermission: false,
  });
  useEffect(() => {
    const invalid = () => {
      generation.current++;
      setData(undefined);
      setReview(null);
      setPaymentId('');
      setReady(false);
      setError(t(l, 'loginRequired'));
      setLoadCode('UNAUTHENTICATED');
    };
    const changed = () => {
      invalid();
      setSessionVersion((v) => v + 1);
    };
    window.addEventListener('hogulink-session-invalid', invalid);
    window.addEventListener('hogulink-session-changed', changed);
    return () => {
      window.removeEventListener('hogulink-session-invalid', invalid);
      window.removeEventListener('hogulink-session-changed', changed);
    };
  }, [l]);
  useEffect(() => {
    let cancelled = false;
    const gen = ++generation.current;
    setReady(false);
    setData(undefined);
    setReview(null);
    setSourceLabel('');
    setPaymentId('');
    retryKey.current = '';
    setAgreed(false);
    setError('');
    setLoadCode('');
    setPaymentStatus('');
    setInstantUnavailable(false);
    api<{ bookingId: string | null }>(`booking-holds/${holdId}/submission`)
      .then((result) => {
        if (cancelled || gen !== generation.current) return;
        if (result.bookingId) {
          router.replace(`/${l}/account/bookings/${result.bookingId}`);
          return;
        }
        return api<CheckoutData>(`booking-holds/${holdId}`);
      })
      .then((value) => {
        if (cancelled || gen !== generation.current || !value) return;
        setData(value);
        setPaymentId(value.payment?.id ?? '');
        const serverNow = value.serverNow ?? Math.max(Date.now(), value.hold.createdAt);
        holdClock.current = { serverNow, local: performance.now() };
        setRemaining(holdSecondsRemaining(value.hold.expiresAt, serverNow, 0, value.hold.active));
        try {
          const prefix = `${flowDraftPrefix}${value.hold.customerId}:`;
          const exact = sessionStorage.getItem(`${prefix}${holdId}`);
          const restored = checkoutDraft(
            exact ?? sessionStorage.getItem(`${prefix}edit`),
            value.hold.customerId,
            value.quote.area,
            value.visit.hotelOnly,
          );
          const next =
            restored ?? restoreVisitAddress(null, value.quote.area, value.visit.hotelOnly);
          if (!exact && next.type === 'HOTEL') next.room = '';
          touched.current = !!(next.name || next.detail);
          setAddress(next);
          sessionStorage.removeItem(`${prefix}edit`);
        } catch {
          touched.current = false;
          setAddress(restoreVisitAddress(null, value.quote.area, value.visit.hotelOnly));
        }
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled && gen === generation.current) {
          setError(errorText(l, e instanceof ClientError ? e.code : undefined));
          setLoadCode(e instanceof ClientError ? e.code : 'error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [holdId, l, sessionVersion, router]);
  useEffect(() => {
    if (ready && data?.hold.id === holdId) {
      try {
        sessionStorage.setItem(
          `${flowDraftPrefix}${data.hold.customerId}:${holdId}`,
          packCheckoutDraft(data.hold.customerId, address),
        );
      } catch {}
    }
  }, [address, holdId, ready, data?.hold.id]);
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(
      () =>
        setRemaining(
          holdSecondsRemaining(
            data.hold.expiresAt,
            holdClock.current.serverNow,
            performance.now() - holdClock.current.local,
            data.hold.active,
          ),
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [data]);
  const [paymentStatus, setPaymentStatus] = useState('');
  async function editVisit() {
    if (!data) return;
    const gen = generation.current;
    setBusy(true);
    setError('');
    try {
      await api(`booking-holds/${holdId}`, undefined, 'DELETE');
      if (gen !== generation.current) return;
      try {
        sessionStorage.setItem(
          `${flowDraftPrefix}${data.hold.customerId}:edit`,
          packCheckoutDraft(data.hold.customerId, address),
        );
        sessionStorage.removeItem(`${flowDraftPrefix}${data.hold.customerId}:${holdId}`);
      } catch {}
      const q = data.quote;
      router.push(
        `/${l}/book/${data.visit.listingSlug}?${new URLSearchParams({ fulfillmentMode: q.fulfillmentMode ?? 'HOME_VISIT', modeConfirmed: '1', offering: q.offeringId, mode: instantUnavailable ? 'SCHEDULED' : q.bookingMode, nomination: q.nominationType, area: q.area, language: q.requiredLanguage, ...(instantUnavailable ? {} : { start: String(q.startAt) }) })}`,
      );
    } catch (e) {
      if (gen !== generation.current) return;
      setError(errorText(l, e instanceof ClientError ? e.code : undefined));
      setBusy(false);
    }
  }
  async function authorize(passed: boolean) {
    const gen = generation.current;
    setBusy(true);
    setError('');
    try {
      const payment = await api<{ id: string; status: string }>('payments/demo-authorizations', {
        holdId,
        challengePassed: passed,
      });
      if (gen !== generation.current) return;
      setPaymentId(payment.id);
      setPaymentStatus(payment.status);
    } catch (e) {
      if (gen !== generation.current) return;
      if (e instanceof ClientError && ['PAYMENT_FAILED', 'HOLD_EXPIRED'].includes(e.code)) {
        setPaymentId('');
        setRemaining(0);
        setData((previous) =>
          previous
            ? { ...previous, hold: { ...previous.hold, active: false, expiresAt: 0 } }
            : previous,
        );
        try {
          if (data)
            sessionStorage.setItem(
              `${flowDraftPrefix}${data.hold.customerId}:edit`,
              packCheckoutDraft(data.hold.customerId, address),
            );
        } catch {}
      }
      setError(errorText(l, e instanceof ClientError ? e.code : undefined));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !paymentId || !agreed || remaining === 0) return;
    setReview(structuredClone(address));
    setReviewPhone(phone.trim());
  }
  async function confirmSubmit() {
    if (!data || !review || !paymentId || !agreed || remaining === 0 || submitLock.current) return;
    submitLock.current = true;
    const gen = generation.current;
    setBusy(true);
    setError('');
    try {
      const keyName = `${flowDraftPrefix}${data.hold.customerId}:key:${holdId}`;
      if (!retryKey.current) {
        try {
          retryKey.current = sessionStorage.getItem(keyName) ?? '';
        } catch {}
        if (!retryKey.current) retryKey.current = crypto.randomUUID();
        try {
          sessionStorage.setItem(keyName, retryKey.current);
        } catch {}
      }
      const booking = await api<Booking>(
        'bookings',
        {
          holdId,
          quoteId: data.quote.id,
          paymentId,
          ...(inStore
            ? { contact: { name: review.name.trim(), phone: reviewPhone } }
            : { address: review }),
          termsAccepted: agreed,
          policyVersion: data.quote.cancellationPolicy.version,
        },
        'POST',
        retryKey.current,
      );
      if (gen !== generation.current) return;
      try {
        sessionStorage.removeItem(`${flowDraftPrefix}${data.hold.customerId}:${holdId}`);
        sessionStorage.removeItem(`${flowDraftPrefix}${data.hold.customerId}:edit`);
      } catch {}
      router.push(
        withServiceMode(`/${l}/account/bookings/${booking.id}`, data.quote.fulfillmentMode),
      );
    } catch (e) {
      if (gen !== generation.current) return;
      try {
        const recovery = await api<{ bookingId: string | null }>(
          `booking-holds/${holdId}/submission`,
        );
        if (recovery.bookingId && gen === generation.current) {
          router.replace(`/${l}/account/bookings/${recovery.bookingId}`);
          return;
        }
      } catch {}
      if (
        e instanceof ClientError &&
        [
          'HOLD_EXPIRED',
          'PRICE_CHANGED',
          'SHOP_RULES_CHANGED',
          'QUOTE_EXPIRED',
          'LISTING_UNAVAILABLE',
          'INSTANT_UNAVAILABLE',
        ].includes(e.code)
      ) {
        if (e.code === 'INSTANT_UNAVAILABLE') {
          setInstantUnavailable(true);
          setReview(null);
        }
        setRemaining(0);
        setData((previous) =>
          previous
            ? { ...previous, hold: { ...previous.hold, active: false, expiresAt: 0 } }
            : previous,
        );
      }
      setError(errorText(l, e instanceof ClientError ? e.code : undefined));
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }
  function field<K extends keyof Address>(key: K, value: Address[K]) {
    touched.current = true;
    setSourceLabel('');
    setAddress((previous) =>
      key === 'type'
        ? {
            ...previous,
            type: value as Address['type'],
            hotelName: '',
            room: '',
            hotelPermission: false,
          }
        : {
            ...previous,
            [key]: value,
            ...(key === 'hotelName' || key === 'room' || key === 'detail'
              ? { hotelPermission: false }
              : {}),
          },
    );
  }
  function chooseAddress(item: SavedAddress, suggest = false) {
    if (!data || (suggest && touched.current)) return;
    const next = applyAddress(item, data.quote.area, data.visit.hotelOnly);
    if (!next) return;
    touched.current = true;
    setAddress(next);
    setSourceLabel(item.label);
  }
  if (!data || data.hold.id !== holdId)
    return (
      <div className="form-card">
        {error && <h1>{vt(l, 'checkoutUnavailable')}</h1>}
        <p role={error ? 'alert' : 'status'}>{error || t(l, 'waiting')}</p>
        {error && (
          <div className="button-row">
            {loadCode === 'UNAUTHENTICATED' ? (
              <Link
                className="button"
                href={`/${l}/account/access?${new URLSearchParams({ returnTo: `/${l}/checkout/${holdId}` })}`}
              >
                {ca(l, 'login')}
              </Link>
            ) : (
              ![
                'HOLD_EXPIRED',
                'QUOTE_EXPIRED',
                'PRICE_CHANGED',
                'SHOP_RULES_CHANGED',
                'LISTING_UNAVAILABLE',
              ].includes(loadCode) && (
                <button
                  type="button"
                  className="button"
                  onClick={() => setSessionVersion((v) => v + 1)}
                >
                  {t(l, 'refresh')}
                </button>
              )
            )}
            <Link className="button secondary" href={`/${l}/therapists`}>
              {vt(l, 'chooseAnotherTime')}
            </Link>
          </div>
        )}
      </div>
    );
  return (
    <>
      <VisitSteps locale={l} step={2} inStore={inStore} />
      <div className="visit-page-heading">
        <span className="eyebrow small">{vt(l, 'step2')}</span>
        <h1>{t(l, 'checkout')}</h1>
        <p>{vt(l, 'checkoutText')}</p>
      </div>
      <nav className="checkout-section-nav" aria-label={t(l, 'checkout')}>
        <a href="#checkout-address">01 · {inStore ? sv(l, 'venue') : t(l, 'address')}</a>
        <a href="#checkout-payment">02 · {t(l, 'payment')}</a>
        <a href="#checkout-policy">03 · {t(l, 'policy')}</a>
      </nav>
      <p className="service-mode-summary">
        <strong>{sv(l, inStore ? 'IN_STORE' : 'HOME_VISIT')}</strong>
        <span>{inStore ? data.quote.venue?.address : sv(l, 'homeChoice')}</span>
      </p>
      <div className="booking-layout visit-booking-layout checkout-layout">
        <div className="mobile-checkout-recap">
          <span>{mt(l, 'review')}</span>
          <strong>
            {data.quote.nominationType === 'FREE' ? t(l, 'free') : data.visit.listingName?.[l]} ·{' '}
            {data.storeName[l]}
          </strong>
          <p>
            {data.visit.offeringName?.[l]} · {data.visit.durationMinutes} {t(l, 'minutes')}
          </p>
          <time>{visitTimeRange(l, data.quote.startAt, data.quote.endAt)}</time>
          <button type="button" className="text-button" disabled={busy} onClick={editVisit}>
            {vt(l, 'edit')}
          </button>
        </div>
        <form id="checkout-form" className="form-card visit-form checkout-form" onSubmit={submit}>
          <div className="visit-form-heading" id="checkout-address">
            <span>01</span>
            <h2>{inStore ? sv(l, 'venue') : t(l, 'addressType')}</h2>
          </div>
          <p
            className={`hold-timer ${remaining === 0 ? 'error-message' : ''}`}
            role="timer"
            aria-live="off"
          >
            <Clock3 size={16} />
            {remaining > 0
              ? `${t(l, 'timeHeld')} · ${t(l, 'expires')} ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
              : t(l, 'expired')}
          </p>
          {remaining === 0 && (
            <div className="exception-panel" role="alert">
              <p>{error || t(l, 'expired')}</p>
              <button
                type="button"
                className="button secondary"
                onClick={editVisit}
                disabled={busy}
              >
                {xt(l, 'retryTime')}
              </button>
            </div>
          )}
          <fieldset disabled={busy || remaining === 0}>
            <legend className="sr-only">{t(l, 'checkout')}</legend>
            {inStore ? (
              <>
                {data.quote.venue && <VenueInfo locale={l} venue={data.quote.venue} />}
                <label className="field">
                  {t(l, 'name')}
                  <input
                    required
                    minLength={2}
                    maxLength={80}
                    autoComplete="name"
                    value={address.name}
                    onChange={(e) => field('name', e.target.value)}
                  />
                </label>
                <label className="field">
                  {sv(l, 'phone')}
                  <input
                    required
                    minLength={5}
                    maxLength={40}
                    type="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <div className="checkout-area">
                  <MapPin size={18} />
                  <div>
                    <strong>{areaName(l, data.quote.area)}</strong>
                    <small>{vt(l, 'addressPrivacy')}</small>
                  </div>
                  <button type="button" className="text-button" onClick={editVisit} disabled={busy}>
                    {vt(l, 'edit')}
                  </button>
                </div>
                {data.visit.hotelOnly && (
                  <p className="notice">
                    <ShieldCheck size={16} />
                    {vt(l, 'hotelHelp')}
                  </p>
                )}
                <CheckoutAddresses
                  key={`${data.hold.customerId}:${holdId}`}
                  locale={l}
                  owner={data.hold.customerId}
                  holdId={holdId}
                  area={data.quote.area}
                  hotelOnly={data.visit.hotelOnly}
                  address={address}
                  disabled={busy || remaining === 0}
                  onChoose={(item) => chooseAddress(item)}
                  onSuggest={(item) => chooseAddress(item, true)}
                />
                {sourceLabel && (
                  <p className="flow-muted" role="status">
                    {af(l, 'picked')} · {sourceLabel}
                  </p>
                )}
                <div className="checkout-address-fields">
                  <label className="field">
                    {t(l, 'name')}
                    <input
                      name="name"
                      value={address.name}
                      autoComplete="name"
                      required
                      minLength={2}
                      maxLength={80}
                      onChange={(e) => field('name', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    {t(l, 'addressType')}
                    <select
                      value={address.type}
                      onChange={(e) => field('type', e.target.value as Address['type'])}
                    >
                      <option value="HOTEL">{t(l, 'hotel')}</option>
                      <option value="HOME" disabled={data.visit.hotelOnly}>
                        {t(l, 'home')}
                      </option>
                    </select>
                  </label>
                  <label className="field checkout-full-field">
                    {t(l, 'address')}
                    <input
                      name="address"
                      autoComplete="street-address"
                      value={address.detail}
                      required
                      minLength={5}
                      maxLength={250}
                      onChange={(e) => field('detail', e.target.value)}
                    />
                  </label>
                  {address.type === 'HOTEL' && (
                    <>
                      <div className="field-grid">
                        <label className="field">
                          {t(l, 'hotelName')}
                          <input
                            value={address.hotelName}
                            required
                            maxLength={100}
                            onChange={(e) => field('hotelName', e.target.value)}
                          />
                        </label>
                        <label className="field">
                          {t(l, 'room')}
                          <input
                            value={address.room}
                            required
                            maxLength={30}
                            onChange={(e) => field('room', e.target.value)}
                          />
                        </label>
                      </div>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={address.hotelPermission}
                          required
                          onChange={(e) => field('hotelPermission', e.target.checked)}
                        />
                        <span>{t(l, 'hotelPermission')}</span>
                      </label>
                    </>
                  )}
                </div>
                <hr />
              </>
            )}
            <div className="visit-form-heading">
              <span>02</span>
              <h3>
                <LockKeyhole size={18} />
                {t(l, 'payment')}
              </h3>
            </div>
            <div className="payment-box" id="checkout-payment">
              <strong>{t(l, 'paymentDemo')}</strong>
              <p>{t(l, 'payExplain')}</p>
              {paymentId ? (
                <p className="success">
                  <Check size={18} />
                  {(paymentStatus || data.payment?.status) === 'METHOD_SAVED'
                    ? vt(l, 'paySaved')
                    : t(l, 'authorized')}
                </p>
              ) : (
                <div className="button-row">
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => authorize(true)}
                  >
                    {t(l, 'authorize')}
                  </button>
                  <button type="button" className="text-button" onClick={() => authorize(false)}>
                    {t(l, 'declinePayment')}
                  </button>
                </div>
              )}
            </div>
            <div className="visit-form-heading" id="checkout-policy">
              <span>03</span>
              <h3>{t(l, 'policy')}</h3>
            </div>
            <p className="policy-text">
              {policyText(l, data.quote.cancellationPolicy, data.quote.bookingMode)}
            </p>
            <p className="visit-help">
              {vt(l, 'frozenQuote')}{' '}
              <Link className="underlined" href={`/${l}/guides/terms`}>
                {t(l, 'terms')}
              </Link>
            </p>
            <label className="checkbox">
              <input
                required
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>{t(l, 'agree')}</span>
            </label>
            {error && (
              <p className="error-message desktop-flow-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button full checkout-submit"
              disabled={busy || !paymentId || !agreed || remaining === 0}
            >
              {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}{' '}
              {af(l, 'review')}
            </button>
            <p className="visit-help">{acceptanceHelp(l, data.visit.acceptanceMode)}</p>
          </fieldset>
        </form>
        <aside className="summary-card visit-summary checkout-summary">
          <span className="eyebrow small">{vt(l, 'session')}</span>
          <div className="mini-profile">
            {data.visit.photo ? (
              <img src={data.visit.photo} width="64" height="64" alt="" />
            ) : (
              <span className="summary-shop-icon">
                <StoreIcon size={27} />
              </span>
            )}
            <div>
              <h3>
                {data.quote.nominationType === 'FREE' ? t(l, 'free') : data.visit.listingName?.[l]}
              </h3>
              <Link href={`/${l}/shops/${data.storeSlug}`}>{data.storeName[l]}</Link>
            </div>
          </div>
          <dl className="visit-summary-facts">
            <div>
              <dt>{vt(l, 'session')}</dt>
              <dd>
                {data.visit.offeringName?.[l]} · {data.visit.durationMinutes} {t(l, 'minutes')}
              </dd>
            </div>
            <div>
              <dt>{vt(l, 'visitWindow')}</dt>
              <dd>{visitTimeRange(l, data.quote.startAt, data.quote.endAt)}</dd>
            </div>
            <div>
              <dt>{vt(l, 'location')}</dt>
              <dd>
                {areaName(l, data.quote.area)}
                {data.quote.requiredLanguage
                  ? ` · ${languageNames[data.quote.requiredLanguage]}`
                  : ''}
              </dd>
            </div>
          </dl>
          <PriceLines locale={l} quote={data.quote} />
          <p className="summary-estimate">{vt(l, 'frozenQuote')}</p>
          <div className="booking-desktop-action">
            {remaining === 0 ? (
              <button type="button" className="button full" onClick={editVisit} disabled={busy}>
                {xt(l, 'retryTime')}
              </button>
            ) : !paymentId ? (
              <a className="button full" href="#checkout-payment">
                {mt(l, 'payment')}
              </a>
            ) : !agreed ? (
              <a className="button full" href="#checkout-policy">
                {mt(l, 'agree')}
              </a>
            ) : (
              <button className="button full" form="checkout-form" type="submit" disabled={busy}>
                {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}
                {af(l, 'review')}
              </button>
            )}
            <p>{vt(l, 'requestNote')}</p>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
          </div>
          <button
            type="button"
            className="button secondary full"
            onClick={editVisit}
            disabled={busy}
          >
            <PencilLine size={16} />
            {vt(l, 'edit')}
          </button>
          <p className="visit-help">{vt(l, 'editHint')}</p>
          <div className="summary-provider">
            <ShieldCheck size={18} />
            <div>
              <h4>{vt(l, 'business')}</h4>
              <p>{data.legalName}</p>
              <Link className="underlined" href={`/${l}/shops/${data.storeSlug}#business-info`}>
                {t(l, 'legal')} ↗
              </Link>
            </div>
          </div>
          <p className="visit-help">{vt(l, 'paymentHelp')}</p>
        </aside>
        <MobilePriceDock
          locale={l}
          quote={data.quote}
          note={`${dateTime(l, data.quote.startAt)} JST · ${vt(l, 'frozenQuote')}`}
          error={error}
        >
          {remaining === 0 ? (
            <button type="button" className="button" onClick={editVisit} disabled={busy}>
              {xt(l, 'retryTime')}
            </button>
          ) : !paymentId ? (
            <a className="button" href="#checkout-payment">
              {mt(l, 'payment')}
            </a>
          ) : !agreed ? (
            <a className="button" href="#checkout-policy">
              {mt(l, 'agree')}
            </a>
          ) : (
            <button className="button" form="checkout-form" type="submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <>
                  {af(l, 'review')}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          )}
        </MobilePriceDock>
      </div>
      <MobileSheet
        locale={l}
        open={!!review}
        title={af(l, 'reviewTitle')}
        onClose={() => {
          if (!busy) setReview(null);
        }}
      >
        {review && (
          <div className="flow-sheet-content checkout-final-review">
            <p>{af(l, 'reviewHelp')}</p>
            <dl>
              <div>
                <dt>{sv(l, 'mode')}</dt>
                <dd>{sv(l, inStore ? 'IN_STORE' : 'HOME_VISIT')}</dd>
              </div>
              <div>
                <dt>{t(l, 'shopProvider')}</dt>
                <dd>
                  {data.storeName[l]}
                  <br />
                  {data.legalName}
                </dd>
              </div>
              <div>
                <dt>{af(l, 'serviceItem')}</dt>
                <dd>
                  {data.visit.offeringName?.[l]} · {data.visit.durationMinutes} {t(l, 'minutes')}
                </dd>
              </div>
              <div>
                <dt>{af(l, 'therapistChoice')}</dt>
                <dd>
                  {data.quote.nominationType === 'FREE'
                    ? t(l, 'free')
                    : data.visit.listingName?.[l]}
                </dd>
              </div>
              <div>
                <dt>{vt(l, 'visitWindow')}</dt>
                <dd>{visitTimeRange(l, data.quote.startAt, data.quote.endAt)}</dd>
              </div>
              <div>
                <dt>{inStore ? sv(l, 'venue') : t(l, 'address')}</dt>
                <dd>
                  {review.name}
                  <br />
                  {inStore
                    ? data.quote.venue?.address
                    : `${areaName(l, review.area)} · ${review.detail}`}
                  {inStore && (
                    <>
                      <br />
                      {reviewPhone}
                    </>
                  )}
                  {!inStore && review.type === 'HOTEL' && (
                    <>
                      <br />
                      {review.hotelName} / {review.room}
                    </>
                  )}
                </dd>
              </div>
            </dl>
            {!inStore && review.type === 'HOTEL' && (
              <p className="flow-muted">{af(l, 'hotelReconfirm')}</p>
            )}
            <PriceLines locale={l} quote={data.quote} />
            <p className="flow-muted">
              {(paymentStatus || data.payment?.status) === 'METHOD_SAVED'
                ? vt(l, 'paySaved')
                : t(l, 'payExplain')}
            </p>
            <p className="flow-muted">
              {policyText(l, data.quote.cancellationPolicy, data.quote.bookingMode)}
            </p>
            {remaining === 0 && (
              <p className="quality-error" role="alert">
                {t(l, 'expired')}
              </p>
            )}
            {error && (
              <p className="quality-error" role="alert">
                {error}
              </p>
            )}
            <div className="flow-actions">
              <button className="quality-button" disabled={busy} onClick={() => setReview(null)}>
                {af(l, 'cancel')}
              </button>
              <button
                className="quality-primary"
                disabled={busy || remaining === 0}
                onClick={() => void confirmSubmit()}
              >
                {busy ? t(l, 'waiting') : af(l, 'confirm')}
              </button>
            </div>
          </div>
        )}
      </MobileSheet>
    </>
  );
}
