import { ModePrices } from './service-mode';
import { providerModePrices } from '@/lib/consumer-model';
import Link from 'next/link';
import { fulfillmentMode } from '@hogulink/contracts';
import { ArrowRight, BadgeCheck, Languages, Clock3, ArrowUpRight } from 'lucide-react';
import {
  travelFeeFor,
  effectiveServicePrice,
  type Listing,
  type Locale,
  type Offering,
} from '@hogulink/contracts';
import type { PublicStore } from '@/lib/api';
import { money, t, languageNames } from '@/lib/i18n';
import { dt } from '@/lib/desktop-i18n';
import { nominatedTotal } from '@/lib/desktop-model';
import { h5Portrait } from '@/lib/h5-media';
import { ht } from '@/lib/h5-i18n';
import { visitPreferences } from '@/lib/visit-model';
export function TherapistCard({
  listing,
  store,
  offerings,
  locale,
  mode = 'SCHEDULED',
  offering,
  slots,
  area,
  language,
  nominationFee,
  demo = false,
}: {
  listing: Listing;
  store: PublicStore;
  offerings: Offering[];
  locale: Locale;
  mode?: string;
  offering?: Offering;
  slots?: number[];
  area?: string;
  language?: string;
  nominationFee?: number;
  demo?: boolean;
}) {
  const selected =
    offering ??
    offerings
      .filter(
        (x) =>
          x.storeId === store.id &&
          x.approved &&
          x.regulatoryCategory === 'RELAXATION' &&
          listing.offeringIds.includes(x.id),
      )
      .sort(
        (a, b) =>
          effectiveServicePrice(a, Date.now()).price - effectiveServicePrice(b, Date.now()).price,
      )[0];
  if (!selected) return null;
  const bookingHref = (start?: number) =>
    `/${locale}/book/${listing.slug}?${new URLSearchParams({ mode, ...(fulfillmentMode(selected) === 'IN_STORE' ? { fulfillmentMode: 'IN_STORE' } : {}), offering: selected.id, ...(area ? { area } : {}), ...(language ? { language } : {}), ...(start ? { start: String(start) } : {}) })}`;
  const profileHref = `/${locale}/therapists/${listing.slug}?${new URLSearchParams({ mode, ...(fulfillmentMode(selected) === 'IN_STORE' ? { fulfillmentMode: 'IN_STORE' } : {}), offering: selected.id, ...(area ? { area } : {}), ...(language ? { language } : {}) })}`;
  return (
    <article className="therapist-card">
      <Link className="portrait-link" href={profileHref} tabIndex={-1} aria-hidden="true">
        <img src={h5Portrait(listing, demo)} alt="" width="600" height="440" loading="lazy" />
        {h5Portrait(listing, demo) !== listing.photo && (
          <span className="portrait-sample">{ht(locale, 'sample')}</span>
        )}
        <span className={`availability ${listing.onDuty ? 'online' : ''}`}>
          <i />
          {t(locale, listing.onDuty ? 'available' : 'byAppointment')}
        </span>
        <span className="portrait-arrow">
          <ArrowUpRight size={19} />
        </span>
      </Link>
      <div className="card-body">
        <div className="card-info">
          <div className="card-title">
            <Link href={profileHref}>
              <h3>{listing.name[locale]}</h3>
            </Link>
            <span className="verified" title={t(locale, 'verified')}>
              <BadgeCheck size={16} />
              {t(locale, 'verified')}
            </span>
          </div>
          <Link
            className="shop-link"
            href={`/${locale}/shops/${store.slug}?${new URLSearchParams({ ...visitPreferences({ area, language, mode, ...(fulfillmentMode(selected) === 'IN_STORE' ? { fulfillmentMode: 'IN_STORE' } : {}) }), offering: selected.id })}`}
          >
            {store.name[locale]}
            <ArrowUpRight size={12} />
          </Link>
          <p className="card-language">
            <Languages size={14} />
            {listing.languages.map((x) => languageNames[x]).join(' · ')}
          </p>
          <p className="card-description">{listing.description[locale]}</p>
          <span className="service-setting">
            {fulfillmentMode(selected) === 'IN_STORE'
              ? locale === 'zh-cn'
                ? '到店服务'
                : locale === 'ja'
                  ? '来店サービス'
                  : 'In-store service'
              : dt(locale, listing.hotelOnly ? 'hotel' : 'homeHotel')}{' '}
            · {selected.durationMinutes} {t(locale, 'minutes')}
          </span>
        </div>
        <div className="card-bottom">
          <div>
            <ModePrices
              locale={locale}
              prices={providerModePrices(store, offerings, [listing], area)}
            />
            <small>{dt(locale, 'total')}</small>
          </div>
          <Link
            className="card-cta"
            href={bookingHref()}
            aria-label={`${listing.name[locale]} · ${t(locale, 'book')}`}
          >
            <span className="mobile-card-book">{t(locale, 'book')}</span>
            <ArrowRight size={19} />
          </Link>
        </div>
        {mode === 'SCHEDULED' && offering && (
          <div className="slot-preview">
            <span>
              <Clock3 size={13} />
              {dt(locale, 'next')}
            </span>
            <div>
              {slots === undefined ? (
                <small>{dt(locale, 'unavailable')}</small>
              ) : slots.length ? (
                slots.slice(0, 3).map((slot) => (
                  <Link key={slot} href={bookingHref(slot)}>
                    {new Intl.DateTimeFormat(locale, {
                      timeZone: 'Asia/Tokyo',
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hourCycle: 'h23',
                    }).format(slot)}
                  </Link>
                ))
              ) : (
                <Link href={bookingHref()}>{dt(locale, 'noSlots')}</Link>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
export function PriceLines({
  locale,
  quote,
}: {
  locale: Locale;
  quote: {
    serviceFee: number;
    nominationFee: number;
    transportFee: number;
    timeSurcharge?: number;
    total: number;
  };
}) {
  return (
    <dl className="price-lines">
      <div>
        <dt>{t(locale, 'serviceFee')}</dt>
        <dd>{money(locale, quote.serviceFee)}</dd>
      </div>
      <div>
        <dt>{t(locale, 'nominationFee')}</dt>
        <dd>{money(locale, quote.nominationFee)}</dd>
      </div>
      <div>
        <dt>{t(locale, 'transportFee')}</dt>
        <dd>{money(locale, quote.transportFee)}</dd>
      </div>
      {!!quote.timeSurcharge && (
        <div>
          <dt>{t(locale, 'timeSurcharge')}</dt>
          <dd>{money(locale, quote.timeSurcharge)}</dd>
        </div>
      )}
      <div className="price-total">
        <dt>{t(locale, 'total')}</dt>
        <dd>{money(locale, quote.total)}</dd>
      </div>
    </dl>
  );
}
