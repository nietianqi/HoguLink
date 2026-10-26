import { ModePrices } from './service-mode';
import Link from 'next/link';
import { ChevronRight, Clock3, Languages, MapPin, ShieldCheck, Store } from 'lucide-react';
import type { ListingStats, Locale, PublicStore } from '@hogulink/contracts';
import { areaName, languageNames } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { h5Portrait } from '@/lib/h5-media';
import { acceptanceLabel } from '@/lib/visit-i18n';
import { shopMonogram, shopTone, type ShopCard } from '@/lib/shop-model';
import { H5PortraitThumbnail } from './h5-overlays';
import { H5Price, H5Stats } from './h5-business';
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
  demo,
  href,
  layout = 'rail',
}: {
  locale: Locale;
  card: ShopCard;
  demo: boolean;
  href: string;
  layout?: 'rail' | 'list';
}) {
  const { store, members, languages, fromTotal, fromDuration, fromCompare, promotion, stats } =
    card;
  return (
    <article className={`h5-shop-card is-${layout}`}>
      <H5ShopCover store={store}>
        <span className="h5-shop-cover-badges">
          <span className="h5-badge is-verified">
            <ShieldCheck size={11} aria-hidden="true" />
            {ht(l, 'shopReviewed')}
          </span>
          {promotion && <span className="h5-badge is-promo">{ht(l, 'promoTag')}</span>}
        </span>
      </H5ShopCover>
      <div className="h5-shop-body">
        <H5ShopLogo store={store} />
        <h3>
          <Link className="h5-shop-link" href={href} prefetch={false}>
            {store.name[l]}
          </Link>
        </h3>
        <p className="h5-shop-description">
          {store.description?.[l] || card.serviceNames.slice(0, 2).join(' · ')}
        </p>
        <H5Stats locale={l} stats={stats} />
        <p className="h5-shop-meta">
          <MapPin size={12} aria-hidden="true" />
          {shopAreaText(l, store.areas)}
        </p>
        <p className="h5-shop-meta h5-shop-languages">
          <Languages size={12} aria-hidden="true" />
          {languages.map((lang) => languageNames[lang]).join(' · ')}
        </p>
        <div className="h5-shop-team">
          <span className="h5-shop-avatars" aria-hidden="true">
            {members.slice(0, 4).map((m) => (
              <H5PortraitThumbnail key={m.id} photo={h5Portrait(m, demo)} size={26} />
            ))}
          </span>
          <span>
            {fill(ht(l, members.length === 1 ? 'shopTeamOne' : 'shopTeam'), { n: members.length })}
          </span>
          <span className="h5-shop-accept">
            <Clock3 size={11} aria-hidden="true" />
            {acceptanceLabel(l, store.acceptanceMode)}
          </span>
        </div>
        <div className="h5-shop-foot">
          <span className="h5-shop-from">
            <small>{fill(ht(l, 'shopFromMenu'), { n: fromDuration })}</small>
            <ModePrices locale={l} prices={card.modePrices ?? []} />
          </span>
          <span className="h5-shop-cta" aria-hidden="true">
            {ht(l, 'enterShop')}
            <ChevronRight size={13} />
          </span>
        </div>
      </div>
    </article>
  );
}

export function H5ShopSection({
  locale: l,
  cards,
  demo,
  href,
  allHref,
  id = 'h5-shops-title',
  className = '',
}: {
  locale: Locale;
  cards: ShopCard[];
  demo: boolean;
  href: (store: PublicStore, card: ShopCard) => string;
  allHref: string;
  id?: string;
  className?: string;
}) {
  if (!cards.length) return null;
  return (
    <section className={`h5-shops ${className}`} aria-labelledby={id}>
      <div className="h5-section-title">
        <h2 id={id}>
          <Store size={17} aria-hidden="true" />
          {ht(l, 'shopsTitle')}
        </h2>
        <Link href={allHref}>
          {ht(l, 'allShops')}
          <ChevronRight size={12} />
        </Link>
      </div>
      <p className="h5-shops-sub">{ht(l, 'shopFees')}</p>
      {cards.some((card) => !card.stats) && <ShopStatsNotice locale={l} />}
      <div className="h5-shop-rail">
        {cards.map((card) => (
          <H5ShopCard
            key={card.store.id}
            locale={l}
            card={card}
            demo={demo}
            href={href(card.store, card)}
          />
        ))}
      </div>
    </section>
  );
}

export function H5ShopList({
  locale: l,
  cards,
  demo,
  href,
  pagination,
}: {
  locale: Locale;
  cards: ShopCard[];
  demo: boolean;
  href: (store: PublicStore, card: ShopCard) => string;
  pagination?: { page: number; pages: number; previous: string; next: string };
}) {
  if (!cards.length) return null;
  return (
    <section className="h5-shop-list" aria-label={ht(l, 'shopsTitle')}>
      <p className="h5-shops-sub">{ht(l, 'shopFees')}</p>
      {cards.some((card) => !card.stats) && <ShopStatsNotice locale={l} />}
      <div className="shop-list-grid">
        {cards.map((card) => (
          <H5ShopCard
            key={card.store.id}
            locale={l}
            card={card}
            demo={demo}
            href={href(card.store, card)}
            layout="list"
          />
        ))}
      </div>
      {pagination && pagination.pages > 1 && (
        <nav className="shop-pagination" aria-label={ht(l, 'shopPages')}>
          {pagination.page > 1 && <Link href={pagination.previous}>{ht(l, 'shopPrevious')}</Link>}
          <span>
            {fill(ht(l, 'shopPageCount'), { page: pagination.page, pages: pagination.pages })}
          </span>
          {pagination.page < pagination.pages && (
            <Link href={pagination.next}>{ht(l, 'shopNext')}</Link>
          )}
        </nav>
      )}
      <p className="h5-footnote">{ht(l, 'shopStatsNote')}</p>
      <h2 className="h5-shop-feed-title">{ht(l, 'shopFeed')}</h2>
    </section>
  );
}
