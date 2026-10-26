'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useId, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  Clock3,
  Globe2,
  Headphones,
  Heart,
  History,
  Leaf,
  MapPin,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Ticket,
  UserRound,
  Wallet,
  Check,
  ChevronDown,
  Bell,
  Megaphone,
  ReceiptText,
  TicketPercent,
  Languages,
} from 'lucide-react';
import type { Actor, Locale, MobileBootstrap } from '@hogulink/contracts';
import { type Catalog } from '@/lib/api';
import { areaName, areas, languageNames, localeMap, locales, t } from '@/lib/i18n';
import { sv } from '@/lib/service-mode-i18n';
import { withServiceMode } from '@/lib/visit-model';
import { ht } from '@/lib/h5-i18n';
import {
  featuredServices,
  featuredTherapists,
  browseServiceChoices as serviceChoices,
} from '@/lib/consumer-model';
import { usePathname, useSearchParams } from 'next/navigation';
import { ut } from '@/lib/consumer-i18n';
import { h5Portrait, h5ServiceImage } from '@/lib/h5-media';
import { H5EmptyArt, H5PageHeading, H5PortraitThumbnail } from './h5-overlays';
import { MobileSheet } from './mobile-ui';
import { ModePrices } from './service-mode';
import { choiceModePrices } from '@/lib/consumer-model';
import { H5Price, useDeviceLocation } from './h5-business';
import { H5ShopCard, H5ShopCover, H5ShopLogo, shopAreaText } from './h5-shops';
import { shopCards, shopCardHref } from '@/lib/shop-model';
import type { ShopStatsMap, ListingStatsMap } from '@/lib/shop-stats';
import { DesktopTherapistPick } from './desktop-therapist-pick';

export function H5Language({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  const path = usePathname(),
    query = useSearchParams();
  const [open, setOpen] = useState(false);
  const languageHref = (l: Locale) =>
    `${path.replace(/^\/(ja|en|zh-cn)(?=\/|$)/, `/${l}`)}${query.size ? `?${query}` : ''}`;
  if (compact)
    return (
      <div className="h5-language h5-language-compact">
        <button
          type="button"
          className="h5-language-trigger"
          aria-label={ht(locale, 'language')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span>
            <Globe2 size={13} />
            {({ 'zh-cn': '中文', ja: '日本語', en: 'EN' } as const)[locale]}
            <ChevronDown size={11} />
          </span>
        </button>
        <MobileSheet
          locale={locale}
          title={ht(locale, 'language')}
          open={open}
          onClose={() => setOpen(false)}
          className="h5-language-sheet"
        >
          <nav aria-label={ht(locale, 'language')}>
            {locales.map((l) => (
              <a
                key={l}
                href={languageHref(l)}
                aria-current={l === locale ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                <span lang={localeMap[l].code}>{localeMap[l].label}</span>
                {l === locale && <Check size={18} />}
              </a>
            ))}
          </nav>
        </MobileSheet>
      </div>
    );
  return (
    <label className="h5-language">
      <Globe2 size={14} />
      <span className="sr-only">{ht(locale, 'language')}</span>
      <select
        aria-label={ht(locale, 'language')}
        value={locale}
        onChange={(e) => window.location.assign(languageHref(e.target.value as Locale))}
      >
        {locales.map((l) => (
          <option key={l} value={l}>
            {localeMap[l].label}
          </option>
        ))}
      </select>
    </label>
  );
}

type HomeProps = {
  locale: Locale;
  catalog: Catalog;
  q: Record<string, string>;
  shopStats?: ShopStatsMap;
  listingStats?: ListingStatsMap;
  desktop?: boolean;
};

export function H5Home({ locale: l, catalog, q, shopStats }: HomeProps) {
  const carry = Object.fromEntries(
    ['area', 'language', 'mode', 'fulfillmentMode'].flatMap((k) => (q[k] ? [[k, q[k]]] : [])),
  );
  const path = (base: string) => `/${l}/${base}?${new URLSearchParams(carry)}`;
  return (
    <section className="h5-home h5-surface" aria-label={ht(l, 'home')}>
      <div className="h5-home-header">
        <section className="h5-home-hero">
          <Image
            className="h5-hero-art"
            src="/images/h5-home-banner.png"
            alt={ht(l, 'bannerArt')}
            width={2068}
            height={760}
            sizes="(max-width:760px) 100vw, 390px"
            loading="eager"
            fetchPriority="high"
          />
          <div className="h5-brand">
            <Leaf size={19} />
            <strong>HoguLink</strong>
            <Link className="h5-home-area" href={path('therapists')}>
              {q.area ? areaName(l, q.area) : ht(l, 'tokyo')}
              <ChevronDown size={11} aria-hidden="true" />
            </Link>
          </div>
          <H5Language locale={l} compact />
          <div className="h5-hero-copy">
            <h1>{ht(l, 'homeHeadline')}</h1>
            <p>{q.fulfillmentMode === 'IN_STORE' ? sv(l, 'IN_STORE') : ht(l, 'homeSubline')}</p>
          </div>
        </section>
      </div>
      <HomeRecommendations locale={l} catalog={catalog} q={q} shopStats={shopStats} />
    </section>
  );
}

export function HomeRecommendations({
  locale: l,
  catalog,
  q,
  shopStats = {},
  listingStats = {},
  desktop = false,
}: HomeProps) {
  const [dimension, setDimension] = useState<'services' | 'therapists' | 'shops'>('services');
  const browseId = useId();
  const carry = Object.fromEntries(
    ['area', 'language', 'mode', 'fulfillmentMode'].flatMap((k) => (q[k] ? [[k, q[k]]] : [])),
  );
  const choices = serviceChoices(catalog, carry);
  // Shop-run limited prices that are live right now; hidden entirely when none run.
  const offers = serviceChoices(catalog, { ...carry, promotions: true })
    .sort((a, b) => (a.promotionEndsAt ?? 0) - (b.promotionEndsAt ?? 0))
    .slice(0, 6);
  const featured = featuredServices(choices);
  const path = (base: string, changes: Record<string, string> = {}) =>
    `/${l}/${base}?${new URLSearchParams({ ...carry, ...changes })}`;
  const shops = shopCards(catalog, { ...carry, locale: l }, shopStats).slice(0, 4);
  const therapists = featuredTherapists(choices);
  const shopListHref = path('discover', { tab: 'shops' });
  const offer = offers[0];
  const emptyState = (
    <div className="h5-home-empty" role="status">
      <CalendarDays size={27} aria-hidden="true" />
      <h3>{ht(l, 'homeNoRecommendations')}</h3>
      <p>{ht(l, 'homeNoMatchesHelp')}</p>
      <div>
        <Link href={path('services', { mode: 'SCHEDULED' })}>{ht(l, 'scheduled')}</Link>
        <Link href={withServiceMode(`/${l}/therapists`, q.fulfillmentMode)}>
          {ht(l, 'allTherapists')}
        </Link>
      </div>
    </div>
  );
  const titlePrefix = desktop ? 'desktop-home' : 'h5-home';
  const offerTitleId = desktop ? 'desktop-home-offers-title' : 'h5-offers-title';
  const location = useDeviceLocation();
  const [locationNote, setLocationNote] = useState('');
  async function locateDistance() {
    const point = await location.request();
    setLocationNote(point ? '' : ht(l, 'locationDenied'));
  }
  return (
    <div className={`h5-home-sections${desktop ? ' customer-home-browse' : ''}`}>
      {offer && (
        <section className="h5-home-offer" aria-labelledby={offerTitleId}>
          <div className="h5-home-offer-intro">
            <h2 id={offerTitleId}>
              <TicketPercent size={17} aria-hidden="true" />
              {ht(l, 'card')}
            </h2>
            <Link href={path('services', { promo: '1' })}>
              {ht(l, 'allPromotions')}
              <ChevronRight size={12} />
            </Link>
            <p>{ht(l, 'homeOffersHelp')}</p>
          </div>
          <Link
            className="h5-home-offer-detail"
            href={path('services', {
              duration: String(offer.offering.durationMinutes),
              offering: offer.offering.id,
            })}
          >
            <span className="h5-home-offer-menu">
              <span className="h5-offer-meta">
                {offer.offering.durationMinutes} {t(l, 'minutes')}
              </span>
              <strong>{offer.offering.name[l]}</strong>
              <span className="service-mode-tag">
                {sv(l, offer.offering.fulfillmentMode ?? 'HOME_VISIT')}
              </span>
            </span>
            <H5Price
              locale={l}
              total={offer.total}
              compareTotal={offer.compareTotal}
              promotionEndsAt={offer.promotionEndsAt}
            />
            <small className="h5-home-fee">{ht(l, 'total')}</small>
            <span className="h5-home-offer-cta">
              {ht(l, 'homeViewOffer')}
              <ChevronRight size={13} />
            </span>
          </Link>
        </section>
      )}
      <div className="h5-home-entrances" role="tablist" aria-label={ht(l, 'homeBrowse')}>
        {(
          [
            ['services', Leaf, 'homePickService'],
            ['therapists', UserRound, 'homePickTherapist'],
            ['shops', Store, 'homePickShop'],
          ] as const
        ).map(([value, Icon, key], index, tabs) => (
          <button
            type="button"
            role="tab"
            key={value}
            id={`${browseId}-${value}-tab`}
            aria-selected={dimension === value}
            aria-controls={`${browseId}-panel`}
            tabIndex={dimension === value ? 0 : -1}
            onClick={() => setDimension(value)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setDimension(tabs[next][0]);
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              buttons?.[next].focus();
            }}
          >
            <Icon size={27} strokeWidth={1.7} aria-hidden="true" />
            <strong>{ht(l, key)}</strong>
          </button>
        ))}
      </div>
      {desktop && locationNote && (
        <p className="h5-location-note" role="status">
          {locationNote}
        </p>
      )}
      <div
        id={`${browseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${browseId}-${dimension}-tab`}
        tabIndex={0}
      >
        {dimension === 'shops' && (
          <section
            className="h5-home-block h5-home-shops"
            aria-labelledby={`${titlePrefix}-shops-title`}
          >
            <div className="h5-home-section-heading">
              <h2 id={`${titlePrefix}-shops-title`}>{ht(l, 'homeShopsTitle')}</h2>
              <Link href={shopListHref}>
                {ht(l, 'allShops')}
                <ChevronRight size={13} />
              </Link>
              <p>{ht(l, 'homeShopsHelp')}</p>
            </div>
            <div className="h5-home-shop-rail">
              {shops.map((card) =>
                desktop ? (
                  <H5ShopCard
                    key={card.store.id}
                    locale={l}
                    card={card}
                    demo={catalog.demo}
                    href={shopCardHref(l, card, carry)}
                    layout="list"
                  />
                ) : (
                  <article className="h5-home-shop-card" key={card.store.id}>
                    <H5ShopCover store={card.store} />
                    <div className="h5-home-shop-body">
                      <H5ShopLogo store={card.store} />
                      <h3>
                        <Link href={shopCardHref(l, card, carry)} prefetch={false}>
                          {card.store.name[l]}
                        </Link>
                      </h3>
                      <p>
                        <MapPin size={12} aria-hidden="true" />
                        {shopAreaText(l, card.store.areas)}
                      </p>
                      <small>{ht(l, 'shopFees')}</small>
                      <div className="h5-home-shop-bottom">
                        <span>
                          <span className="h5-tag">
                            {card.fromDuration} {t(l, 'minutes')}
                          </span>
                          <ModePrices locale={l} prices={card.modePrices ?? []} />
                          <small>{ht(l, 'from')}</small>
                        </span>
                        <span className="h5-home-shop-cta" aria-hidden="true">
                          {ht(l, 'enterShop')}
                          <ChevronRight size={13} />
                        </span>
                      </div>
                    </div>
                  </article>
                ),
              )}
            </div>
            {!shops.length && emptyState}
          </section>
        )}
        {dimension === 'services' && (
          <section className="h5-home-block" aria-labelledby={`${titlePrefix}-services-title`}>
            <div className="h5-home-section-heading">
              <h2 id={`${titlePrefix}-services-title`}>{ht(l, 'homeServicesTitle')}</h2>
              <Link href={path('services')}>
                {ht(l, 'homeAllServices')}
                <ChevronRight size={13} />
              </Link>
              <p>{ht(l, 'total')}</p>
            </div>
            <div className="h5-home-service-list">
              {featured.map(
                (
                  { offering, store, members, total, compareTotal, promotionEndsAt, modePrices },
                  index,
                ) => (
                  <Link
                    className="h5-home-service-card"
                    key={offering.id}
                    href={path('services', {
                      duration: String(offering.durationMinutes),
                      offering: offering.id,
                    })}
                  >
                    <span className="h5-home-service-image">
                      <Image
                        src={h5ServiceImage(offering, catalog.demo)}
                        alt=""
                        fill
                        sizes="(max-width:359px) 82px, (max-width:760px) 100px, 100px"
                        loading={index < 2 ? 'eager' : 'lazy'}
                      />
                      <small>{ht(l, 'serviceIllustration')}</small>
                    </span>
                    <div className="h5-home-service-copy">
                      <div className="h5-home-service-heading">
                        <div className="h5-home-service-title">
                          <h3>{offering.name[l]}</h3>
                          <span className="h5-home-service-category">
                            {ht(l, 'homeServiceCategory')}
                          </span>
                        </div>
                        <small className="h5-home-service-count">
                          {ht(
                            l,
                            members.length === 1 ? 'homeServiceMember' : 'homeServiceMembers',
                          ).replace('{count}', String(members.length))}
                        </small>
                      </div>
                      <p className="h5-home-service-shop">
                        <Store size={11} aria-hidden="true" />
                        {store.name[l]}
                      </p>
                      <div className="h5-home-service-bottom">
                        <div className="h5-home-service-price">
                          <ModePrices locale={l} prices={modePrices} />
                        </div>
                        <span className="h5-home-service-cta">{ht(l, 'homeServiceBook')}</span>
                      </div>
                    </div>
                  </Link>
                ),
              )}
            </div>
            {!featured.length && emptyState}
          </section>
        )}
        {dimension === 'therapists' && (
          <section className="h5-home-block" aria-labelledby={`${titlePrefix}-therapists-title`}>
            <div className="h5-home-section-heading">
              <h2 id={`${titlePrefix}-therapists-title`}>{ht(l, 'homeTherapistsTitle')}</h2>
              <Link href={path('therapists')}>
                {ht(l, 'homeAllTherapists')}
                <ChevronRight size={13} />
              </Link>
              <p>{ht(l, 'homeTherapistsHelp')}</p>
            </div>
            <div className="h5-home-therapist-grid">
              {therapists.map(({ listing, choice }) =>
                desktop ? (
                  <DesktopTherapistPick
                    key={listing.id}
                    locale={l}
                    listing={listing}
                    choice={choice}
                    demo={catalog.demo}
                    stats={listingStats[listing.id]}
                    href={path(`therapists/${listing.slug}`, {
                      offering: choice.offering.id,
                      nomination: 'NOMINATED',
                    })}
                    point={location.point}
                    locating={location.state === 'locating'}
                    onLocate={() => void locateDistance()}
                  />
                ) : (
                  <Link
                    className="h5-home-therapist"
                    key={listing.id}
                    href={path(`therapists/${listing.slug}`, {
                      offering: choice.offering.id,
                      nomination: 'NOMINATED',
                    })}
                  >
                    <span className="h5-home-therapist-image">
                      <H5PortraitThumbnail photo={h5Portrait(listing, catalog.demo)} size={384} />
                    </span>
                    <div className="h5-home-therapist-info">
                      <h3>{listing.name[l]}</h3>
                      <p className="h5-home-therapist-shop">{choice.store.name[l]}</p>
                      <p className="h5-home-languages">
                        <Languages size={14} aria-hidden="true" />
                        <span className="h5-home-language-list">
                          {listing.languages.map((lang, index) => (
                            <span key={lang}>
                              {index > 0 ? '· ' : ''}
                              {languageNames[lang]}
                            </span>
                          ))}
                        </span>
                      </p>
                      <div className="h5-home-therapist-bottom">
                        <div className="h5-home-therapist-price">
                          <ModePrices
                            locale={l}
                            prices={choiceModePrices(choice.variants, listing.id)}
                          />
                        </div>
                        <span className="h5-home-times">
                          {ht(l, 'chooseTime')}
                          <ChevronRight size={14} aria-hidden="true" />
                        </span>
                      </div>
                    </div>
                  </Link>
                ),
              )}
            </div>
            {!!therapists.length && (
              <small className="h5-home-fee h5-home-section-fee">{ht(l, 'total')}</small>
            )}
            {!therapists.length && emptyState}
          </section>
        )}
      </div>
      <nav className="h5-home-assurance" aria-label={ht(l, 'bookingGuide')}>
        {(
          [
            [ReceiptText, 'homeClearFees', 'homeClearFeesHelp', `/${l}/guides/booking-and-safety`],
            [ShieldCheck, 'homeShopCare', 'homeShopCareHelp', `/${l}/guides/booking-and-safety`],
            [Headphones, 'orderSupport', 'homeSupportHelp', `/${l}/account/support`],
          ] as const
        ).map(([Icon, title, help, href]) => (
          <Link key={title} href={href}>
            <Icon size={22} aria-hidden="true" />
            <span>
              <strong>{ht(l, title)}</strong>
              <small>{ht(l, help)}</small>
            </span>
          </Link>
        ))}
      </nav>
      <Link className="h5-partner-banner" href={`/${l}/onboarding?role=MERCHANT`}>
        <Store size={30} />
        <div>
          <strong>{ht(l, 'partner')}</strong>
          <small>{ht(l, 'welcomeSub')}</small>
        </div>
        <ArrowRight size={20} />
      </Link>
      <Link className="h5-partner-banner" href={`/${l}/onboarding?role=STAFF`}>
        <UserRound size={30} />
        <div>
          <strong>{ht(l, 'therapistJoin')}</strong>
          <small>{ht(l, 'therapistJoinHelp')}</small>
        </div>
        <ArrowRight size={20} />
      </Link>
      {!catalog.demo && <p className="h5-footnote">{ht(l, 'regionsHelp')}</p>}
    </div>
  );
}

export function H5AccountFeatures({ locale: l }: { locale: Locale }) {
  return (
    <div className="h5-account-features">
      <Link href={`/${l}/account/benefits`} className="h5-account-coupon">
        <div>
          <strong>{ht(l, 'coupons')}</strong>
          <span>
            {ht(l, 'rules')}
            <ChevronRight size={12} />
          </span>
        </div>
        <p>
          <Ticket size={28} />
          <span>
            {ht(l, 'coming')}
            <small>{ht(l, 'couponShort')}</small>
          </span>
        </p>
      </Link>
      <Link href={`/${l}/account/benefits#wallet`} className="h5-account-wallet">
        <span>{ht(l, 'wallet')}</span>
        <Wallet size={22} />
        <strong>{ht(l, 'coming')}</strong>
      </Link>
    </div>
  );
}
export function H5AccountProfile({
  locale: l,
  actor,
  loading,
}: {
  locale: Locale;
  actor: Actor | null;
  loading: boolean;
}) {
  const signed = actor?.role === 'CUSTOMER';
  return (
    <div className="h5-account-profile">
      <div className="h5-profile-avatar">
        <UserRound size={32} />
      </div>
      <Link
        className="h5-profile-name"
        href={
          signed
            ? `/${l}/account/settings`
            : `/${l}/account/access?returnTo=${encodeURIComponent(`/${l}/account`)}`
        }
      >
        <h1>{ht(l, loading ? 'loading' : signed ? 'member' : 'guest')}</h1>
        <span>{ht(l, signed ? 'signed' : 'memberSub')}</span>
      </Link>
      <Link href={`/${l}/account/support`}>
        <Headphones size={20} />
        <small>{ht(l, 'support')}</small>
      </Link>
      <Link href={`/${l}/account/settings`}>
        <Settings size={20} />
        <small>{ht(l, 'settings')}</small>
      </Link>
    </div>
  );
}
export function H5AccountUtilities({ locale: l }: { locale: Locale }) {
  return (
    <div className="h5-account-utilities">
      <nav>
        {(
          [
            [Heart, 'favorites', 'account/favorites'],
            [History, 'footprints', 'account/history'],
            [ShieldCheck, 'complaint', 'account/support'],
          ] as const
        ).map(([Icon, key, href]) => (
          <Link key={key} href={`/${l}/${href}`}>
            <Icon size={20} />
            <span>{ht(l, key)}</span>
          </Link>
        ))}
      </nav>
      <Link className="h5-region-strip" href={`/${l}/therapists`}>
        <strong>{ht(l, 'regions')}</strong>
        <span>
          {ht(l, 'tokyo')} · {ht(l, 'chooseArea')}
        </span>
        <ChevronRight size={13} />
      </Link>
      <Link className="h5-account-guide" href={`/${l}/guides/booking-and-safety`}>
        <div>
          <strong>{ht(l, 'bookingGuide')}</strong>
          <small>{ht(l, 'guideSub')}</small>
          <span>
            HOGULINK <ArrowRight size={13} />
          </span>
        </div>
        <Image
          src="/images/h5-treatment.png"
          width={115}
          height={94}
          alt=""
          sizes="115px"
          loading="eager"
        />
      </Link>
      <div className="h5-trust-footer">
        <strong>{ht(l, 'ourService')}</strong>
        <div>
          {(
            [
              [Ticket, 'clearPrice'],
              [Store, 'shopService'],
              [ShieldCheck, 'privateAddress'],
              [Headphones, 'orderSupport'],
            ] as const
          ).map(([Icon, key]) => (
            <span key={key}>
              <Icon size={16} />
              {ht(l, key)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function H5MessageCategories({
  locale: l,
  unread = 0,
}: {
  locale: Locale;
  unread?: number;
}) {
  return (
    <nav className="h5-message-categories" aria-label={ht(l, 'allMessages')}>
      {(
        [
          [ReceiptText, 'orderServices', 'account/messages?channel=orders&filter=bookings'],
          [Megaphone, 'activityMessages', 'account/messages?channel=activity'],
          [Bell, 'systemMessages', 'account/messages?channel=system'],
          [Headphones, 'customerService', 'account/support'],
        ] as const
      ).map(([Icon, key, path]) => (
        <Link key={key} href={`/${l}/${path}`}>
          <span className="h5-message-icon">
            <Icon size={24} strokeWidth={1.8} aria-hidden="true" />
            {key === 'orderServices' && unread > 0 && (
              <b className="h5-message-count">{unread > 99 ? '99+' : unread}</b>
            )}
          </span>
          <strong>{ht(l, key)}</strong>
        </Link>
      ))}
    </nav>
  );
}

export function H5MessageNotice({
  locale: l,
  channel,
}: {
  locale: Locale;
  channel: 'activity' | 'system';
}) {
  return (
    <main id="main" className="wrap h5-notice-page h5-surface">
      <H5PageHeading
        locale={l}
        title={ht(l, channel === 'activity' ? 'activityMessages' : 'systemMessages')}
        back="account/messages"
      />
      <div className="h5-channel-empty">
        <H5EmptyArt />
        <h2>{ht(l, 'emptyMessages')}</h2>
        <p>{ht(l, channel === 'activity' ? 'activityHelp' : 'systemHelp')}</p>
      </div>
    </main>
  );
}

export function H5OrderPrompt({ locale: l, signed }: { locale: Locale; signed: boolean }) {
  return (
    <Link
      className="h5-order-prompt"
      href={
        signed
          ? `/${l}/therapists`
          : `/${l}/account/access?returnTo=${encodeURIComponent(`/${l}/account`)}`
      }
    >
      <Image src="/images/h5-empty-orders.png" width={60} height={60} alt="" sizes="60px" />
      <span>
        <strong>{ht(l, signed ? 'noActive' : 'guest')}</strong>
        <small>{ht(l, signed ? 'startVisit' : 'memberSub')}</small>
      </span>
      <b>
        {ht(l, signed ? 'reserve' : 'guest')}
        <ChevronRight size={13} />
      </b>
    </Link>
  );
}

export function H5Benefits({
  locale: l,
  bootstrap,
}: {
  locale: Locale;
  bootstrap: MobileBootstrap;
}) {
  return (
    <main id="main" className="wrap h5-benefits h5-surface">
      <H5PageHeading locale={l} title={ht(l, 'card')} />
      <section className="quality-card">
        <Ticket size={35} />
        <h2>
          {ht(l, 'coupons')} · {ht(l, 'coming')}
        </h2>
        <p>{ht(l, 'couponHelp')}</p>
      </section>
      <section className="quality-card" id="wallet">
        <Wallet size={35} />
        <h2>
          {ht(l, 'wallet')} · {ht(l, 'coming')}
        </h2>
        <p>{ht(l, 'walletHelp')}</p>
      </section>
      <section className="quality-card">
        <MapPin size={30} />
        <h2>{ht(l, 'regions')}</h2>
        <p>
          {bootstrap.serviceAreas.map((a) => areaName(l, a)).join(' · ') || ht(l, 'emptyServices')}
        </p>
        <small>{ht(l, 'regionsHelp')}</small>
      </section>
      <Link className="h5-primary" href={`/${l}/services`}>
        {ht(l, 'services')}
      </Link>
    </main>
  );
}
