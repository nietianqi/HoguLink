'use client';
import { ca } from '@/lib/customer-auth-i18n';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowLeft,
  Clock3,
  CalendarDays,
  ShieldCheck,
  Check,
  LoaderCircle,
  MapPin,
  ArrowUpRight,
  RefreshCw,
  Store as StoreIcon,
} from 'lucide-react';
import {
  timeSurchargeAt,
  travelFeeFor,
  fulfillmentMode,
  venueAvailable,
  listingSupports,
  type FulfillmentMode,
  type Actor,
  type Hold,
  type Listing,
  type Locale,
  type Offering,
  type Quote,
} from '@hogulink/contracts';
import type { PublicStore, BookingRules } from '@/lib/api';
import { api, ClientError } from '@/lib/api';
import {
  t,
  areaName,
  money,
  dateTime,
  errorText,
  languageNames,
  surchargeNote,
  areaTravelNote,
} from '@/lib/i18n';
import { vt, acceptanceHelp, policyText } from '@/lib/visit-i18n';
import {
  visitServices,
  visitTeam,
  visitTotal,
  visitSelection,
  withServiceMode,
} from '@/lib/visit-model';
import { japanDay } from '@/lib/desktop-model';
import { PriceLines } from './catalog';
import { MobilePriceDock } from './mobile-ui';
import { mt } from '@/lib/mobile-i18n';
import { qt } from '@/lib/quality-i18n';
import { visibleVisitTimes, visitTimeRange } from '@/lib/booking-presentation';
import { ServiceModePicker, VenueInfo } from './service-mode';
import { sv } from '@/lib/service-mode-i18n';
import { chosenServiceMode } from '@/lib/service-mode-model';

export function useSession() {
  const [actor, setActor] = useState<Actor | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let generation = 0,
      live = true;
    const invalidate = () => {
      generation++;
      setActor(null);
      setLoading(false);
    };
    const refresh = () => {
      const gen = ++generation;
      api<Actor>('auth/session')
        .then((next) => {
          if (live && gen === generation) setActor(next);
        })
        .catch(() => {
          if (live && gen === generation) setActor(null);
        })
        .finally(() => {
          if (live && gen === generation) setLoading(false);
        });
    };
    window.addEventListener('hogulink-session-invalid', invalidate);
    window.addEventListener('hogulink-session-changed', refresh);
    refresh();
    return () => {
      live = false;
      generation++;
      window.removeEventListener('hogulink-session-invalid', invalidate);
      window.removeEventListener('hogulink-session-changed', refresh);
    };
  }, []);
  return { actor, setActor, loading };
}
export type PlannerProps = {
  locale: Locale;
  listing: Listing;
  store: PublicStore;
  offerings: Offering[];
  team?: Listing[];
  rules?: BookingRules;
  defaultNomination?: 'NOMINATED' | 'FREE';
};
export function VisitBackLink({
  locale,
  listing,
}: {
  locale: Locale;
  listing: Pick<Listing, 'slug' | 'name'>;
}) {
  const query = useSearchParams();
  return (
    <Link
      className="back-link"
      href={`/${locale}/therapists/${listing.slug}?${new URLSearchParams(visitSelection(Object.fromEntries(query)))}`}
    >
      <ArrowLeft size={15} />
      {listing.name[locale]}
    </Link>
  );
}
function useVisit(props: PlannerProps) {
  const { locale: l, listing, store, offerings } = props;
  const team = props.team ?? [listing];
  const query = useSearchParams();
  const [serviceMode, setServiceMode] = useState<FulfillmentMode | null>(() =>
    chosenServiceMode(Object.fromEntries(query)),
  );
  const [editingMode, setEditingMode] = useState(
    () => !chosenServiceMode(Object.fromEntries(query)),
  );
  const [modeChanged, setModeChanged] = useState(false);
  const inStore = serviceMode === 'IN_STORE';
  const pricingRules =
    inStore && store.venue && store.bookingRules
      ? {
          ...store.bookingRules,
          nominationFee: store.venue.nominationFee,
          cancellationPolicy:
            store.venue.cancellationPolicy ?? store.bookingRules.cancellationPolicy,
          businessHours: store.venue.businessHours,
          timeSurcharges: store.venue.timeSurcharges,
          areaTransportFees: undefined,
        }
      : store.bookingRules;
  const [nomination, setNomination] = useState(
    query.get('nomination') === 'FREE' || props.defaultNomination === 'FREE' ? 'FREE' : 'NOMINATED',
  );
  const [mode, setMode] = useState<'INSTANT' | 'SCHEDULED'>(
    !inStore && query.get('mode') === 'INSTANT' && store.acceptanceMode !== 'MANUAL'
      ? 'INSTANT'
      : 'SCHEDULED',
  );
  const [offeringId, setOfferingId] = useState(query.get('offering') ?? '');
  const options =
    serviceMode && (inStore ? venueAvailable(store) : store.homeVisitsEnabled !== false)
      ? visitServices(offerings, listing, team, nomination, serviceMode)
      : [];
  const offering = options.find((o) => o.id === offeringId);
  const members =
    offering && serviceMode
      ? visitTeam(team, listing, offering.id, nomination, '', 'SCHEDULED', serviceMode)
      : [];
  const languages = [...new Set(members.flatMap((x) => x.languages))];
  const [language, setLanguage] = useState(query.get('language') ?? '');
  const safeLanguage = languages.includes(language) ? language : '';
  const [homeArea, setArea] = useState(
    store.areas.includes(query.get('area') ?? '') ? query.get('area')! : store.areas[0],
  );
  const area = inStore && store.venue ? store.venue.area : homeArea;
  const [start, setStart] = useState(query.get('start') ?? '');
  const [day, setDay] = useState(
    query.get('start') &&
      Number.isFinite(new Date(Number(query.get('start'))).getTime()) &&
      Number(query.get('start')) > 0
      ? japanDay(Number(query.get('start')))
      : '',
  );
  const [error, setError] = useState('');
  const [slotChanged, setSlotChanged] = useState(false);
  const startRef = useRef(start);
  startRef.current = start;
  const [retry, setRetry] = useState(0);
  const key = [listing.id, offering?.id, nomination, safeLanguage, mode, area, serviceMode].join(
    '|',
  );
  const [availability, setAvailability] = useState<{
    key: string;
    slots: number[];
    state: 'loading' | 'ready' | 'error';
  }>({ key: '', slots: [], state: 'loading' });
  const ready = availability.key === key && availability.state === 'ready';
  const slots = ready ? availability.slots : [];
  const pending = availability.key !== key || availability.state === 'loading';
  useEffect(() => {
    let cancelled = false;
    if (!serviceMode || !offering) return;
    setAvailability({ key, slots: [], state: 'loading' });
    setError('');
    const params = new URLSearchParams({
      offeringId: offering.id,
      language: safeLanguage,
      mode,
      area,
      fulfillmentMode: serviceMode,
    });
    const path =
      nomination === 'FREE'
        ? `public/stores/${store.slug}/free-availability?${params}`
        : `public/staff-listings/${listing.id}/availability?${params}`;
    api<{ slots: number[] }>(path)
      .then((data) => {
        if (cancelled) return;
        setAvailability({ key, slots: data.slots, state: 'ready' });
        if (mode === 'INSTANT') setStart(String(data.slots[0] ?? ''));
        else if (startRef.current && !data.slots.includes(Number(startRef.current))) {
          setSlotChanged(true);
          setStart('');
        }
      })
      .catch(() => {
        if (!cancelled) setAvailability({ key, slots: [], state: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [key, retry]);
  const representative = nomination === 'FREE' ? (members[0] ?? listing) : listing;
  const instantAllowed =
    !inStore &&
    store.acceptanceMode !== 'MANUAL' &&
    !!offering &&
    visitTeam(team, listing, offering.id, nomination, safeLanguage, 'INSTANT', 'HOME_VISIT')
      .length > 0;
  const validStart =
    !!serviceMode &&
    ready &&
    slots.includes(Number(start)) &&
    (mode !== 'INSTANT' || instantAllowed);
  const params = new URLSearchParams({
    ...(serviceMode ? { fulfillmentMode: serviceMode, modeConfirmed: '1' } : {}),
    mode,
    nomination,
    offering: offering?.id ?? '',
    area,
    language: safeLanguage,
    ...(validStart ? { start } : {}),
  });
  const href = `/${l}/book/${representative.slug}?${params}`;
  useEffect(() => {
    // Preserve the browsed menu/language across a refresh while the customer is still choosing.
    // They are preferences, not a confirmed mode or a valid timeslot.
    if (!serviceMode) return;
    const url = new URL(window.location.href);
    for (const [name, value] of params) url.searchParams.set(name, value);
    if (!validStart) url.searchParams.delete('start');
    window.history.replaceState(null, '', url);
  }, [mode, nomination, offering?.id, area, safeLanguage, start, validStart, serviceMode]);
  function chooseService(id: string) {
    setOfferingId(id);
    setStart('');
    setSlotChanged(false);
  }
  function chooseNomination(value: string) {
    setNomination(value);
    setStart('');
    setSlotChanged(false);
  }
  function chooseStart(value: string) {
    setStart(value);
    setSlotChanged(false);
    setError('');
  }
  return {
    ...props,
    store: { ...store, bookingRules: pricingRules },
    serviceMode,
    inStore,
    editingMode,
    setEditingMode,
    modeChanged,
    setServiceMode: (value: FulfillmentMode) => {
      setEditingMode(false);
      if (serviceMode === value) return;
      const current = offerings.find((o) => o.id === offeringId) ?? offering;
      const targetId = current
        ? value === 'IN_STORE'
          ? `${current.id.replace(/-in-store$/, '')}-in-store`
          : current.id.replace(/-in-store$/, '')
        : '';
      const replacement = visitServices(offerings, listing, team, nomination, value).find(
        (o) => o.id === targetId && o.durationMinutes === current?.durationMinutes,
      );
      setServiceMode(value);
      setMode(value === 'IN_STORE' ? 'SCHEDULED' : mode);
      setOfferingId(replacement?.id ?? '');
      setStart('');
      setDay('');
      setSlotChanged(false);
      setModeChanged(!!serviceMode);
    },
    team,
    nomination,
    setNomination: chooseNomination,
    mode,
    setMode: (value: string) => {
      setMode(value === 'INSTANT' ? 'INSTANT' : 'SCHEDULED');
      setStart('');
      setSlotChanged(false);
    },
    options,
    offering,
    languages,
    language: safeLanguage,
    setLanguage,
    area,
    setArea,
    start,
    setStart: chooseStart,
    day,
    setDay,
    error,
    setError,
    slotChanged,
    availability,
    slots,
    pending,
    ready,
    validStart,
    instantAllowed,
    representative,
    href,
    reload: () => setRetry((n) => n + 1),
    chooseService,
    estimated: offering
      ? visitTotal(
          offering,
          nomination,
          pricingRules?.nominationFee ?? props.rules?.nominationFee ?? 500,
          Date.now(),
          validStart ? timeSurchargeAt(pricingRules, Number(start)) : 0,
          inStore ? 0 : travelFeeFor(offering, pricingRules, area),
        )
      : undefined,
  };
}
type Visit = ReturnType<typeof useVisit>;
const visitPriceNote = (v: Visit) =>
  v.inStore
    ? sv(v.locale, v.nomination === 'FREE' ? 'inStoreFreePriceNote' : 'inStorePriceNote')
    : vt(v.locale, v.nomination === 'FREE' ? 'freeTotalNote' : 'totalNote');
function VisitModeChoice({ visit: v }: { visit: Visit }) {
  const l = v.locale;
  const can = (mode: FulfillmentMode) =>
    (mode === 'IN_STORE' ? venueAvailable(v.store) : v.store.homeVisitsEnabled !== false) &&
    visitServices(v.offerings, v.listing, v.team, v.nomination, mode).length > 0;
  return (
    <>
      {v.serviceMode && !v.editingMode ? (
        <div className="service-mode-summary" id="service-mode-choice">
          <span>
            <strong>{sv(l, v.serviceMode)}</strong>
            <small>{sv(l, v.inStore ? 'storeChoice' : 'homeChoice')}</small>
          </span>
          <button type="button" className="text-button" onClick={() => v.setEditingMode(true)}>
            {sv(l, 'changeMode')}
          </button>
        </div>
      ) : (
        <ServiceModePicker
          locale={l}
          value={v.serviceMode}
          onChange={v.setServiceMode}
          home={can('HOME_VISIT')}
          inStore={can('IN_STORE')}
        />
      )}
      {v.modeChanged && (
        <p className="visit-help" role="status">
          {sv(l, 'modeChanged')}
        </p>
      )}
    </>
  );
}
function ServicePicker({ visit: v, compact = false }: { visit: Visit; compact?: boolean }) {
  const l = v.locale;
  return (
    <div
      className={`visit-service-picker ${compact ? 'compact' : ''}`}
      role="group"
      aria-label={t(l, 'services')}
    >
      {v.options.map((o) => (
        <button
          type="button"
          key={o.id}
          className={o.id === v.offering?.id ? 'selected' : ''}
          onClick={() => v.chooseService(o.id)}
          aria-pressed={o.id === v.offering?.id}
        >
          <span className="service-duration">
            {o.durationMinutes}
            <small>{t(l, 'minutes')}</small>
          </span>
          <span className="service-choice-name">
            {o.name[l]}
            <small>{visitPriceNote(v)}</small>
          </span>
          <strong>
            {money(
              l,
              visitTotal(
                o,
                v.nomination,
                v.store.bookingRules?.nominationFee ?? v.rules?.nominationFee ?? 500,
                Date.now(),
                0,
                travelFeeFor(o, v.store.bookingRules, v.area),
              ).total,
            )}
          </strong>
          <span className="selection-dot">{o.id === v.offering?.id && <Check size={12} />}</span>
        </button>
      ))}
      {!v.options.length && <p className="notice">{vt(l, 'noService')}</p>}
    </div>
  );
}
function AvailabilityPicker({ visit: v, compact = false }: { visit: Visit; compact?: boolean }) {
  const l = v.locale;
  const [expanded, setExpanded] = useState(false);
  const days = [...new Set(v.slots.map(japanDay))];
  const day = days.includes(v.day) ? v.day : days[0];
  const times = v.slots.filter((slot) => japanDay(slot) === day);
  const time = (slot: number) =>
    new Intl.DateTimeFormat(l, {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(slot);
  if (!v.offering)
    return <p className="notice">{vt(l, v.options.length ? 'selectSession' : 'noService')}</p>;
  return (
    <div className="visit-availability" aria-busy={v.pending}>
      <div className="availability-label">
        <span>
          <CalendarDays size={16} />
          {t(l, 'start')}
        </span>
        <small>JST</small>
      </div>
      {v.pending ? (
        <div className="availability-state" role="status">
          <LoaderCircle className="spin" size={20} />
          <p>{vt(l, 'loadingSlots')}</p>
        </div>
      ) : v.availability.state === 'error' ? (
        <div className="availability-state" role="alert">
          <p>{t(l, 'error')}</p>
          <button type="button" className="text-button" onClick={v.reload}>
            <RefreshCw size={14} />
            {vt(l, 'retry')}
          </button>
        </div>
      ) : !v.slots.length ? (
        <div className="availability-state">
          <Clock3 size={22} />
          <p>{vt(l, v.mode === 'INSTANT' ? 'noInstant' : 'emptySlots')}</p>
          <button type="button" className="text-button" onClick={v.reload}>
            {vt(l, 'retry')}
          </button>
          {v.mode === 'INSTANT' && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => v.setMode('SCHEDULED')}
            >
              {vt(l, 'chooseScheduled')}
            </button>
          )}
        </div>
      ) : v.mode === 'INSTANT' ? (
        <div className="instant-arrival">
          <Clock3 size={22} />
          <div>
            <strong>{dateTime(l, v.slots[0])} · JST</strong>
            <p>{t(l, 'arrival')}</p>
          </div>
        </div>
      ) : (
        <>
          <div
            className="visit-day-picker"
            style={{ gridTemplateColumns: `repeat(${days.length},minmax(0,1fr))` }}
            role="group"
            aria-label={vt(l, 'selectTime')}
          >
            {days.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={day === d}
                onClick={() => {
                  if (day !== d) {
                    v.setDay(d);
                    v.setStart('');
                    setExpanded(false);
                  }
                }}
              >
                <span>
                  {new Intl.DateTimeFormat(l, { timeZone: 'Asia/Tokyo', weekday: 'short' }).format(
                    new Date(d + 'T12:00:00+09:00'),
                  )}
                </span>
                <strong>
                  {new Intl.DateTimeFormat(l, {
                    timeZone: 'Asia/Tokyo',
                    month: 'numeric',
                    day: 'numeric',
                  }).format(new Date(d + 'T12:00:00+09:00'))}
                </strong>
                <small>
                  {v.slots.filter((x) => japanDay(x) === d).length}{' '}
                  {l === 'en' ? 'times' : l === 'ja' ? '枠' : '个时段'}
                </small>
              </button>
            ))}
          </div>
          <div
            className={`visit-time-picker ${compact ? 'compact' : ''}`}
            role="group"
            aria-label={vt(l, 'selectTime')}
          >
            {visibleVisitTimes(times, Number(v.start), expanded, compact ? 8 : 12).map((slot) => (
              <button
                type="button"
                key={slot}
                aria-pressed={v.start === String(slot)}
                onClick={() => v.setStart(String(slot))}
              >
                {time(slot)}
              </button>
            ))}
          </div>
          {times.length > (compact ? 8 : 12) && (
            <button type="button" className="show-times" onClick={() => setExpanded((n) => !n)}>
              {vt(l, expanded ? 'fewerTimes' : 'moreTimes')}
            </button>
          )}
        </>
      )}
      {v.slotChanged && (
        <p className="selection-warning" role="status">
          {vt(l, 'staleSlot')}
        </p>
      )}
      {v.validStart && (
        <p className="visit-selected-time" role="status">
          <Check size={16} />
          <span>
            {vt(l, 'selectedTime')}
            <strong>
              {visitTimeRange(
                l,
                Number(v.start),
                Number(v.start) + v.offering.durationMinutes * 60000,
              )}
            </strong>
          </span>
        </p>
      )}
      <p className="availability-disclaimer">{vt(l, 'slotHint')}</p>
    </div>
  );
}
export function BookingPreview(props: PlannerProps) {
  const v = useVisit(props),
    l = props.locale;
  return (
    <section className="booking-preview" id="reserve">
      <span className="eyebrow small">YOUR MOMENT OF CALM</span>
      <h2>{vt(l, 'plan')}</h2>
      <p className="preview-subtitle">{vt(l, 'preview')}</p>
      <VisitModeChoice visit={v} />
      {v.inStore && v.store.venue && <VenueInfo locale={l} venue={v.store.venue} />}
      <div hidden={!v.serviceMode}>
        <div className="preview-context">
          <MapPin size={15} />
          <span>
            {areaName(l, v.area)}
            {v.language ? ` · ${languageNames[v.language]}` : ''}
          </span>
          <span className="preview-nomination">
            {t(l, v.nomination === 'FREE' ? 'free' : 'nominated')}
          </span>
        </div>
        <ServicePicker visit={v} compact />
        <AvailabilityPicker visit={v} compact />
        <div className="preview-checkout">
          {v.estimated && (
            <div className="preview-total">
              <span>
                {t(l, 'total')}
                <small>{visitPriceNote(v)}</small>
              </span>
              <strong>{money(l, v.estimated.total)}</strong>
            </div>
          )}
          {v.validStart ? (
            <Link className="button full" href={v.href}>
              {t(l, 'book')}
              <ArrowRight size={16} />
            </Link>
          ) : (
            <button className="button full" disabled>
              {vt(l, 'selectTime')}
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
      <p className="preview-assurance">
        <ShieldCheck size={14} />
        {vt(l, 'paymentHelp')}
      </p>
      {v.estimated && (
        <MobilePriceDock locale={l} quote={v.estimated} note={vt(l, 'estimate')}>
          {v.validStart ? (
            <Link className="button" href={v.href}>
              {t(l, 'book')}
              <ArrowRight size={17} />
            </Link>
          ) : (
            <a className="button" href="#reserve">
              {mt(l, 'chooseTime')}
              <ArrowRight size={17} />
            </a>
          )}
        </MobilePriceDock>
      )}
    </section>
  );
}
export function BookingForm(props: PlannerProps) {
  const query = useSearchParams();
  const v = useVisit(props),
    l = props.locale;
  const router = useRouter();
  const { actor, setActor, loading } = useSession();
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  async function login() {
    const returnTo = v.href;
    router.push(`/${l}/account/access?${new URLSearchParams({ returnTo })}`);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitLock.current || !v.serviceMode || !v.validStart || !v.offering) return;
    if (actor?.role !== 'CUSTOMER') {
      v.setError(t(l, 'loginRequired'));
      return;
    }
    submitLock.current = true;
    setBusy(true);
    v.setError('');
    try {
      const quote = await api<Quote>('quotes', {
        listingId: v.representative.id,
        offeringId: v.offering.id,
        bookingMode: v.mode,
        fulfillmentMode: v.serviceMode,
        nominationType: v.nomination,
        startAt: Number(v.start),
        area: v.area,
        requiredLanguage: v.language,
      });
      const hold = await api<Hold>('booking-holds', { quoteId: quote.id });
      router.push(withServiceMode(`/${l}/checkout/${hold.id}`, v.serviceMode));
    } catch (e) {
      v.setError(errorText(l, e instanceof ClientError ? e.code : undefined));
      if (e instanceof ClientError && ['SLOT_CONFLICT', 'INSTANT_UNAVAILABLE'].includes(e.code)) {
        v.setStart('');
        v.reload();
      }
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="booking-layout visit-booking-layout">
      <form id="visit-form" className="form-card visit-form" onSubmit={submit}>
        {query.get('rebook') === '1' && <p className="quality-note">{qt(l, 'rebookNotice')}</p>}
        <nav hidden={!v.serviceMode} className="mobile-form-jumps" aria-label={t(l, 'booking')}>
          <a href="#visit-service">01 · {vt(l, 'session')}</a>
          <a href="#visit-preference">02 · {t(l, 'nomination')}</a>
          <a href="#visit-time">03 · {mt(l, 'chooseTime')}</a>
        </nav>
        <fieldset disabled={busy}>
          <legend className="sr-only">{t(l, 'booking')}</legend>
          <VisitModeChoice visit={v} />
          {v.inStore && v.store.venue && <VenueInfo locale={l} venue={v.store.venue} />}
          <div hidden={!v.serviceMode}>
            <div className="visit-form-section" id="visit-service">
              <div className="visit-form-heading">
                <span>01</span>
                <h2>{vt(l, 'serviceMenu')}</h2>
              </div>
              <ServicePicker visit={v} />
            </div>
            <div className="visit-form-section" id="visit-preference">
              <div className="visit-form-heading">
                <span>02</span>
                <h2>{t(l, 'nomination')}</h2>
              </div>
              <div className="preference-picker">
                <button
                  type="button"
                  className={v.nomination === 'NOMINATED' ? 'selected' : ''}
                  aria-pressed={v.nomination === 'NOMINATED'}
                  onClick={() => v.setNomination('NOMINATED')}
                >
                  <img src={v.listing.photo} alt="" width="46" height="46" />
                  <span>
                    <strong>
                      {v.listing.name[l]} · {t(l, 'nominated')}
                    </strong>
                    <small>{vt(l, 'nominatedHelp')}</small>
                  </span>
                  <span className="preference-fee">
                    +{' '}
                    {money(l, v.store.bookingRules?.nominationFee ?? v.rules?.nominationFee ?? 500)}
                  </span>
                </button>
                <button
                  type="button"
                  className={v.nomination === 'FREE' ? 'selected' : ''}
                  aria-pressed={v.nomination === 'FREE'}
                  onClick={() => v.setNomination('FREE')}
                >
                  <span className="preference-icon">
                    <StoreIcon size={22} />
                  </span>
                  <span>
                    <strong>{t(l, 'free')}</strong>
                    <small>{vt(l, 'freeHelp')}</small>
                  </span>
                  <span className="preference-fee">{money(l, 0)}</span>
                </button>
              </div>
              {!v.inStore && v.nomination === 'NOMINATED' && v.listing.hotelOnly && (
                <p className="notice">
                  <MapPin size={16} />
                  {vt(l, 'hotelHelp')}
                </p>
              )}
            </div>
            <div className="visit-form-section" id="visit-time">
              <div className="visit-form-heading">
                <span>03</span>
                <h2>{t(l, 'mode')}</h2>
              </div>
              <div className="choice-grid">
                <button
                  type="button"
                  className={`choice ${v.mode === 'SCHEDULED' ? 'active' : ''}`}
                  onClick={() => v.setMode('SCHEDULED')}
                  aria-pressed={v.mode === 'SCHEDULED'}
                >
                  <CalendarDays size={19} />
                  {t(l, 'scheduled')}
                </button>
                <button
                  type="button"
                  disabled={!v.instantAllowed}
                  className={`choice ${v.mode === 'INSTANT' ? 'active' : ''}`}
                  onClick={() => v.setMode('INSTANT')}
                  aria-pressed={v.mode === 'INSTANT'}
                >
                  <Clock3 size={19} />
                  {t(l, 'instant')}
                </button>
              </div>
              {!v.instantAllowed && (
                <p className="visit-help">
                  {v.inStore ? sv(l, 'scheduleOnly') : vt(l, 'noInstant')}
                </p>
              )}
              <div className="field-grid">
                {!v.inStore && (
                  <label className="field">
                    {t(l, 'area')}
                    <select value={v.area} onChange={(e) => v.setArea(e.target.value)}>
                      {v.store.areas.map((a) => (
                        <option key={a} value={a}>
                          {areaName(l, a)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="field">
                  {t(l, 'language')}
                  <select value={v.language} onChange={(e) => v.setLanguage(e.target.value)}>
                    <option value="">{t(l, 'allLanguages')}</option>
                    {v.languages.map((lang) => (
                      <option key={lang} value={lang}>
                        {languageNames[lang] ?? lang}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <AvailabilityPicker visit={v} />
            </div>
            <div className="login-panel">
              <ShieldCheck size={22} />
              <div>
                <strong>
                  {actor?.role === 'CUSTOMER' ? t(l, 'signedIn') : t(l, 'loginRequired')}
                </strong>
                <p>{ca(l, 'help')}</p>
              </div>
              {actor?.role !== 'CUSTOMER' && (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={loading}
                  onClick={login}
                >
                  {ca(l, 'login')} / {ca(l, 'register')}
                </button>
              )}
            </div>
            {v.error && (
              <p className="error-message desktop-flow-error" role="alert">
                {v.error}
              </p>
            )}
            <button
              className="button full visit-submit"
              disabled={busy || actor?.role !== 'CUSTOMER' || !v.validStart}
            >
              {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}{' '}
              {t(l, 'getQuote')}
            </button>
            <p className="visit-help">{acceptanceHelp(l, v.store.acceptanceMode)}</p>
          </div>
        </fieldset>
      </form>
      <aside className="summary-card visit-summary">
        <span className="eyebrow small">{vt(l, 'session')}</span>
        <div className="mini-profile">
          {v.nomination === 'NOMINATED' ? (
            <img src={v.listing.photo} width="64" height="64" alt="" />
          ) : (
            <span className="summary-shop-icon">
              <StoreIcon size={27} />
            </span>
          )}
          <div>
            <h3>{v.nomination === 'NOMINATED' ? v.listing.name[l] : t(l, 'free')}</h3>
            <Link href={`/${l}/shops/${v.store.slug}`}>
              {v.store.name[l]}
              <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>
        {!v.serviceMode && <p>{sv(l, 'chooseModeHelp')}</p>}
        <div hidden={!v.serviceMode}>
          <p className="service-mode-tag">{v.serviceMode ? sv(l, v.serviceMode) : ''}</p>
          <dl className="visit-summary-facts">
            <div>
              <dt>{vt(l, 'session')}</dt>
              <dd>
                {v.offering ? (
                  <>
                    {v.offering.name[l]} · {v.offering.durationMinutes} {t(l, 'minutes')}
                  </>
                ) : (
                  vt(l, 'selectSession')
                )}
              </dd>
            </div>
            <div>
              <dt>{vt(l, 'visitWindow')}</dt>
              <dd>
                {v.validStart && v.offering
                  ? visitTimeRange(
                      l,
                      Number(v.start),
                      Number(v.start) + v.offering.durationMinutes * 60000,
                    )
                  : vt(l, 'selectTime')}
              </dd>
            </div>
            <div>
              <dt>{v.inStore ? sv(l, 'venue') : vt(l, 'location')}</dt>
              <dd>
                {v.inStore ? v.store.venue?.address : areaName(l, v.area)}
                {v.language ? ` · ${languageNames[v.language]}` : ''}
              </dd>
            </div>
          </dl>
          {v.estimated && <PriceLines locale={l} quote={v.estimated} />}
          {v.store.bookingRules?.timeSurcharges?.length ? (
            <p className="summary-estimate">
              {surchargeNote(l, v.store.bookingRules.timeSurcharges)}
            </p>
          ) : null}
          {v.store.bookingRules?.areaTransportFees ? (
            <p className="summary-estimate">
              {areaTravelNote(l, v.store.bookingRules.areaTransportFees, v.store.areas)}
            </p>
          ) : null}
          <p className="summary-estimate">{vt(l, 'estimate')}</p>
          <div className="booking-desktop-action">
            {!v.validStart ? (
              <a className="button full" href={v.offering ? '#visit-time' : '#visit-service'}>
                {vt(l, v.offering ? 'selectTime' : 'selectSession')}
                <ArrowRight size={16} />
              </a>
            ) : actor?.role !== 'CUSTOMER' ? (
              <button
                type="button"
                className="button full"
                disabled={busy || loading}
                onClick={login}
              >
                {ca(l, 'login')} / {ca(l, 'register')}
              </button>
            ) : (
              <button form="visit-form" type="submit" className="button full" disabled={busy}>
                {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}
                {t(l, 'getQuote')}
              </button>
            )}
            <p>{v.inStore ? sv(l, 'inStoreNextStep') : vt(l, 'nextStepHelp')}</p>
            {v.error && (
              <p className="error-message" role="alert">
                {v.error}
              </p>
            )}
          </div>
        </div>
        <div className="summary-provider">
          <ShieldCheck size={18} />
          <div>
            <h4>{vt(l, 'business')}</h4>
            <p>{v.store.legalName}</p>
          </div>
        </div>
        <p className="visit-help">{vt(l, 'paymentHelp')}</p>
        <details className="summary-policy" hidden={!v.serviceMode}>
          <summary>{t(l, 'policy')}</summary>
          <p>
            {(v.store.bookingRules ?? v.rules)
              ? policyText(l, (v.store.bookingRules ?? v.rules)!.cancellationPolicy, v.mode)
              : t(l, 'policyText')}
          </p>
        </details>
        <p className="subtle-note">
          <Check size={14} />
          {t(l, 'nonMedical')}
        </p>
      </aside>
      {v.estimated && (
        <MobilePriceDock
          locale={l}
          quote={v.estimated}
          note={`${vt(l, 'estimate')}${v.validStart ? ` · ${dateTime(l, Number(v.start))} JST` : ''}`}
          error={v.error}
        >
          {!v.validStart ? (
            <a className="button" href="#visit-time">
              {mt(l, 'chooseTime')}
              <ArrowRight size={17} />
            </a>
          ) : actor?.role !== 'CUSTOMER' ? (
            <button type="button" className="button" disabled={busy || loading} onClick={login}>
              {busy ? <LoaderCircle className="spin" size={17} /> : mt(l, 'login')}
            </button>
          ) : (
            <button
              form="visit-form"
              type="submit"
              className="button"
              disabled={busy || !v.validStart}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <>
                  {mt(l, 'continue')}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          )}
        </MobilePriceDock>
      )}
    </div>
  );
}
