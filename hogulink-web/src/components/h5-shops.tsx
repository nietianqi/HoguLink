import Link from 'next/link';

import type { ListingStats, Locale, PublicStore } from '@hogulink/contracts';
import { areaName } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { cui } from '@/lib/customer-ui-i18n';

import { acceptanceLabel } from '@/lib/visit-i18n';
import { shopMonogram, shopTone, type ShopCard } from '@/lib/shop-model';

import { H5Price } from './h5-business';
import { ShopStatsNotice } from './shop-stats-notice';

const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), text);

export const shopAreaText = (l: Locale, areas: string[]) =>
  `${areas
    .slice(0, 2)
    .map((a) => areaName(l, a))
    .join(' · ')}${areas.length > 2 ? ` +${areas.length - 2}` : ''}`;

export function ShopFacts({ locale: l, stats }: { locale: Locale; stats?: ListingStats }) {
  if (!stats) return <ShopStatsNotice locale={l} />;
  if (!stats.reviewCount && !stats.completed90d && !stats.favorites)
    return <p className="shop-no-history">{ht(l, 'shopNoHistory')}</p>;
  return (
    <dl className="h5-detail-stats shop-hero-stats" aria-label={ht(l, 'shopStatsNote')}>
      {stats.rating !== null && (
        <div>
          <dt>{ht(l, 'statRating')}</dt>
          <dd>{stats.rating.toFixed(1)}</dd>
        </div>
      )}
      {stats.reviewCount > 0 && (
        <div>
          <dt>{ht(l, 'statReviews')}</dt>
          <dd>{stats.reviewCount}</dd>
        </div>
      )}
      {stats.completed90d > 0 && (
        <div>
          <dt>{ht(l, 'statCompleted')}</dt>
          <dd>{stats.completed90d}</dd>
        </div>
      )}
      {stats.favorites > 0 && (
        <div>
          <dt>{ht(l, 'statFavorites')}</dt>
          <dd>{stats.favorites}</dd>
        </div>
      )}
    </dl>
  );
}

/** A designed shop mark instead of a stock photo: it never implies premises the shop does not have. */
export function H5ShopCover({
  store,
  className = '',
  children,
}: {
  store: Pick<PublicStore, 'id' | 'name'>;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`h5-shop-cover tone-${shopTone(store.id)} ${className}`}>
      <span className="h5-shop-cover-letter" aria-hidden="true">
        {shopMonogram(store)}
      </span>
      <span className="h5-shop-cover-line" aria-hidden="true">
        LOCAL CARE · TOKYO
      </span>
      {children}
    </div>
  );
}

export function H5ShopLogo({ store, size = 'md' }: { store: PublicStore; size?: 'md' | 'lg' }) {
  return (
    <span className={`h5-shop-logo tone-${shopTone(store.id)} is-${size}`} aria-hidden="true">
      {shopMonogram(store)}
    </span>
  );
}

export function H5ShopCard({
  locale: l,
  card,
  href,
}: {
  locale: Locale;
  card: ShopCard;
  href: string;
}) {
  const { store, members, fromTotal, fromDuration, fromCompare } = card;
  return (
    <Link className="ui-shop-card ui-card" href={href}>
      <H5ShopLogo store={store} />
      <div>
        <h3>{store.name[l]}</h3>
        <p>
          {shopAreaText(l, store.areas)} ·{' '}
          {fill(ht(l, members.length === 1 ? 'shopTeamOne' : 'shopTeam'), { n: members.length })}
        </p>
        <p>{acceptanceLabel(l, store.acceptanceMode)}</p>
        <span className="ui-shop-price">
          <H5Price
            locale={l}
            total={fromTotal}
            compareTotal={fromCompare}
            promotionEndsAt={card.fromPromotionEndsAt}
          />
          <small>{cui(l, 'serviceFrom').replace('{n}', String(fromDuration))}</small>
        </span>
      </div>
      <span className="ui-shop-enter">
        <span>{ht(l, 'enterShop')}</span>
        <span aria-hidden="true"> →</span>
      </span>
    </Link>
  );
}
