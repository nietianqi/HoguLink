'use client';
import { Heart, MessageCircle, Navigation } from 'lucide-react';
import type { ListingStats, Locale } from '@hogulink/contracts';
import { areaName } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { directoryDistance } from '@/lib/therapist-directory-model';

/** The same public counts and consented distance on home cards and the directory. */
export function TherapistFacts({
  locale: l,
  name,
  stats,
  point,
  areas,
  locating,
  disabled = false,
  onLocate,
  counts = true,
}: {
  locale: Locale;
  name: string;
  stats?: ListingStats;
  point: { lat: number; lng: number } | null;
  areas: string[];
  locating: boolean;
  disabled?: boolean;
  onLocate: () => void;
  /** Off where the card already shows rating and review count, so only distance remains. */
  counts?: boolean;
}) {
  const distance = directoryDistance(point, areas);
  const distanceLabel = distance
    ? ht(l, 'distance')
        .replace('{area}', areaName(l, distance.area))
        .replace('{km}', distance.displayKm)
    : ht(l, 'distanceUnavailable');
  return (
    <div className="h5-directory-facts">
      {counts && (
        <>
          <span
            title={
              stats
                ? ht(l, 'favoritesCount').replace('{n}', String(stats.favorites))
                : ht(l, 'statsUnavailable')
            }
          >
            <Heart size={12} aria-hidden="true" />
            <span className="sr-only">{ht(l, 'statFavorites')} </span>
            {stats?.favorites ?? '—'}
          </span>
          <span
            title={
              stats
                ? ht(l, 'reviews').replace('{n}', String(stats.reviewCount))
                : ht(l, 'statsUnavailable')
            }
          >
            <MessageCircle size={12} aria-hidden="true" />
            <span className="sr-only">{ht(l, 'statReviews')} </span>
            {stats?.reviewCount ?? '—'}
          </span>
        </>
      )}
      {distance ? (
        <span className="h5-directory-distance" title={distanceLabel}>
          <Navigation size={12} aria-hidden="true" />
          <span className="sr-only">{distanceLabel}</span>
          <span aria-hidden="true">
            {ht(l, 'distanceShort').replace('{km}', distance.displayKm)}
          </span>
        </span>
      ) : point ? (
        <span title={distanceLabel}>
          <Navigation size={12} aria-hidden="true" />
          {distanceLabel}
        </span>
      ) : (
        <button
          type="button"
          className="h5-directory-locate"
          aria-label={`${ht(l, 'locateDistanceHelp')} · ${name}`}
          disabled={locating || disabled}
          onClick={onLocate}
        >
          <Navigation size={12} aria-hidden="true" />
          {ht(l, locating ? 'locating' : 'locateDistance')}
        </button>
      )}
    </div>
  );
}
