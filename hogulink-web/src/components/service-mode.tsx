'use client';
import {
  fulfillmentModes,
  type FulfillmentMode,
  type Locale,
  type PublicVenue,
  type VenueSnapshot,
} from '@hogulink/contracts';
import { sv } from '@/lib/service-mode-i18n';
import { money, t } from '@/lib/i18n';
import type { ModePrice } from '@/lib/consumer-model';

export function ModePrices({
  locale: l,
  prices,
  from = true,
}: {
  locale: Locale;
  prices: ModePrice[];
  from?: boolean;
}) {
  const sameDuration = prices.every((p) => p.durationMinutes === prices[0]?.durationMinutes);
  return (
    <span className="service-mode-prices">
      {prices.map((p) => (
        <span className="service-mode-price" key={p.mode}>
          <span className="service-mode-tag">{sv(l, p.mode)}</span>
          <strong>{money(l, p.total)}</strong>
          {from && <small>{l === 'ja' ? '〜' : l === 'en' ? 'from' : '起'}</small>}
          {!sameDuration && (
            <small>
              {' '}
              / {p.durationMinutes} {t(l, 'minutes')}
            </small>
          )}
        </span>
      ))}
      {sameDuration && prices[0] && (
        <small className="service-mode-duration">
          {prices[0].durationMinutes} {t(l, 'minutes')}
        </small>
      )}
    </span>
  );
}

export function ServiceModePicker({
  locale: l,
  value,
  onChange,
  home = true,
  inStore = true,
}: {
  locale: Locale;
  value: FulfillmentMode | null;
  onChange: (mode: FulfillmentMode) => void;
  home?: boolean;
  inStore?: boolean;
}) {
  return (
    <div className="service-mode-selection" id="service-mode-choice">
      <h3>{sv(l, 'chooseMode')}</h3>
      {!value && <p className="visit-help">{sv(l, 'chooseModeHelp')}</p>}
      <div className="choice-grid service-mode-picker" role="group" aria-label={sv(l, 'mode')}>
        {fulfillmentModes.map((mode) => (
          <button
            key={mode}
            type="button"
            className={`choice ${value === mode ? 'active' : ''}`}
            disabled={mode === 'IN_STORE' ? !inStore : !home}
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
          >
            <span>
              <strong>{sv(l, mode)}</strong>
              <small>{sv(l, mode === 'HOME_VISIT' ? 'homeChoice' : 'storeChoice')}</small>
              {(mode === 'HOME_VISIT' ? !home : !inStore) && (
                <small>{sv(l, 'modeUnavailable')}</small>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
export function VenueInfo({
  locale: l,
  venue,
}: {
  locale: Locale;
  venue: VenueSnapshot | PublicVenue;
}) {
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.latitude},${venue.longitude}`)}`;
  return (
    <section className="exception-panel venue-info" aria-label={sv(l, 'venue')}>
      <h3>{sv(l, 'venue')}</h3>
      <p>{venue.address}</p>
      {venue.directions && <p>{venue.directions}</p>}
      {'photos' in venue && (
        <div className="venue-photo-list">
          {venue.photos.slice(0, 3).map((src) => (
            <a key={src} href={src} target="_blank" rel="noopener noreferrer">
              <img src={src} alt={sv(l, 'venue')} width={120} height={90} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <div className="booking-actions">
        <a className="text-button" href={map} target="_blank" rel="noopener noreferrer">
          {sv(l, 'navigate')} ↗
        </a>
        <a className="text-button" href={`tel:${venue.contact}`}>
          {venue.contact}
        </a>
      </div>
      <p className="flow-muted">{sv(l, 'inStoreHelp')}</p>
    </section>
  );
}
