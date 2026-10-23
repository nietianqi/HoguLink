'use client';
import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Navigation, Star, TicketPercent, Truck, Zap } from 'lucide-react';
import { nearestArea, type ListingStats, type Locale } from '@hogulink/contracts';
import { areaName, money, t } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';

const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), text);

/** Real aggregated facts only: approved reviews, completed visits, favorites. */
export function H5Stats({
  locale: l,
  stats,
  compact = false,
  showReviews = true,
}: {
  locale: Locale;
  stats?: ListingStats;
  compact?: boolean;
  showReviews?: boolean;
}) {
  if (!stats)
    return <p className="h5-stats h5-stats-unavailable">{ht(l, 'shopStatsUnavailable')}</p>;
  return (
    <p className={`h5-stats ${compact ? 'is-compact' : ''}`}>
      {stats.rating !== null ? (
        <>
          <span className="h5-stats-rating">
            <Star size={12} aria-hidden="true" />
            {fill(ht(l, 'rating'), { rating: stats.rating.toFixed(1) })}
          </span>
          {showReviews && <span>{fill(ht(l, 'reviews'), { n: stats.reviewCount })}</span>}
        </>
      ) : (
        <span className="h5-stats-empty">{ht(l, 'noReviews')}</span>
      )}
      {stats.completed90d > 0 && (
        <span>{fill(ht(l, 'completed90d'), { n: stats.completed90d })}</span>
      )}
      {!compact && stats.favorites > 0 && (
        <span>{fill(ht(l, 'favoritesCount'), { n: stats.favorites })}</span>
      )}
    </p>
  );
}

export function H5Badges({
  locale: l,
  freeTravel,
  instantNow,
  promotion,
  verified,
}: {
  locale: Locale;
  freeTravel?: boolean;
  instantNow?: boolean;
  promotion?: boolean;
  verified?: string;
}) {
  if (!freeTravel && !instantNow && !promotion && !verified) return null;
  return (
    <span className="h5-badges">
      {verified && (
        <span className="h5-badge is-verified">
          <BadgeCheck size={11} aria-hidden="true" />
          {verified}
        </span>
      )}
      {promotion && (
        <span className="h5-badge is-promo">
          <TicketPercent size={11} aria-hidden="true" />
          {ht(l, 'promoTag')}
        </span>
      )}
      {instantNow && (
        <span className="h5-badge is-instant">
          <Zap size={11} aria-hidden="true" />
          {ht(l, 'instantNow')}
        </span>
      )}
      {freeTravel && (
        <span className="h5-badge is-travel">
          <Truck size={11} aria-hidden="true" />
          {ht(l, 'freeTravel')}
        </span>
      )}
    </span>
  );
}

/** Price as charged now; the regular price is struck through only when the comparison is fair. */
export function H5Price({
  locale: l,
  total,
  compareTotal,
  durationMinutes,
  promotionEndsAt,
  size = 'md',
}: {
  locale: Locale;
  total: number;
  compareTotal?: number;
  durationMinutes?: number;
  promotionEndsAt?: number;
  size?: 'md' | 'lg';
}) {
  return (
    <span className={`h5-price is-${size} ${promotionEndsAt ? 'is-promo' : ''}`}>
      <strong>
        <span className="sr-only">{ht(l, promotionEndsAt ? 'promoPrice' : 'priceLabel')} </span>
        {money(l, total)}
      </strong>
      {durationMinutes !== undefined && (
        <small>
          {' '}
          / {durationMinutes} {t(l, 'minutes')}
        </small>
      )}
      {compareTotal !== undefined && compareTotal > total && (
        <del>
          <span className="sr-only">{ht(l, 'regularPrice')} </span>
          {money(l, compareTotal)}
        </del>
      )}
      {promotionEndsAt && (
        <em className="h5-price-until">
          {fill(ht(l, 'promoUntil'), {
            date: new Intl.DateTimeFormat(l, {
              timeZone: 'Asia/Tokyo',
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            }).format(promotionEndsAt),
          })}
        </em>
      )}
    </span>
  );
}

type Point = { lat: number; lng: number };
const geoKey = 'hogulink-device-location-v1';
const geoTtl = 30 * 60_000;

/**
 * Device-only location. Coordinates stay in this browser tab (sessionStorage)
 * and are never sent to HoguLink; the server only receives the nearest area key.
 */
export function useDeviceLocation() {
  const [point, setPoint] = useState<Point | null>(null);
  const [state, setState] = useState<'idle' | 'locating' | 'denied'>('idle');
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(geoKey) || 'null');
      if (saved && Date.now() - saved.at < geoTtl) setPoint({ lat: saved.lat, lng: saved.lng });
    } catch {}
  }, []);
  const request = useCallback(
    () =>
      new Promise<Point | null>((resolve) => {
        if (!('geolocation' in navigator)) {
          setState('denied');
          return resolve(null);
        }
        setState('locating');
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            // Round to ~100 m before keeping it anywhere.
            const next = {
              lat: Math.round(pos.coords.latitude * 1000) / 1000,
              lng: Math.round(pos.coords.longitude * 1000) / 1000,
            };
            try {
              sessionStorage.setItem(geoKey, JSON.stringify({ ...next, at: Date.now() }));
            } catch {}
            setPoint(next);
            setState('idle');
            resolve(next);
          },
          () => {
            setState('denied');
            resolve(null);
          },
          { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 10_000 },
        );
      }),
    [],
  );
  return { point, state, request };
}

export function H5Distance({
  locale: l,
  point,
  areas,
}: {
  locale: Locale;
  point: Point | null;
  areas: string[];
}) {
  if (!point) return null;
  const near = nearestArea(point, areas);
  if (!near) return null;
  return (
    <span className="h5-distance">
      <Navigation size={11} aria-hidden="true" />
      {fill(ht(l, 'distance'), {
        area: areaName(l, near.area),
        km: near.km < 10 ? near.km.toFixed(1) : Math.round(near.km),
      })}
    </span>
  );
}
