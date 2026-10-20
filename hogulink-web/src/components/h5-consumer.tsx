'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
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
  Handshake,
  Megaphone,
  ReceiptText,
  TicketPercent,
} from 'lucide-react';
import type { Actor, Locale, MobileBootstrap } from '@hogulink/contracts';
import { type Catalog } from '@/lib/api';
import { areaName, areas, languageNames, localeMap, locales, t } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { serviceChoices } from '@/lib/consumer-model';
import { usePathname, useSearchParams } from 'next/navigation';
import { ut } from '@/lib/consumer-i18n';
import { h5Portrait } from '@/lib/h5-media';
import { H5EmptyArt, H5PageHeading, H5PortraitThumbnail } from './h5-overlays';
import { MobileSheet } from './mobile-ui';
import { H5Badges, H5Price } from './h5-business';
import { H5ShopSection } from './h5-shops';
import { shopCards, shopCardHref } from '@/lib/shop-model';
import type { ShopStatsMap } from '@/lib/shop-stats';

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

export function H5Home({
  locale: l,
  catalog,
  q,
  shopStats = {},
}: {
  locale: Locale;
  catalog: Catalog;
  q: Record<string, string>;
  /** Missing entries remain unknown and expose retry, distinct from real zero counts. */
  shopStats?: ShopStatsMap;
}) {
  const carry = Object.fromEntries(
    ['area', 'language', 'mode'].flatMap((k) => (q[k] ? [[k, q[k]]] : [])),
  );
  const choices = serviceChoices(catalog, carry);
  // Shop-run limited prices that are live right now; hidden entirely when none run.
  const offers = serviceChoices(catalog, { ...carry, promotions: true })
    .sort((a, b) => (a.promotionEndsAt ?? 0) - (b.promotionEndsAt ?? 0))
    .slice(0, 6);
  const featured = [60, 90, 120].flatMap(
    (duration) => choices.find((x) => x.offering.durationMinutes === duration) ?? [],
  );
  const featuredStores = new Set(featured.map((choice) => choice.store.id));
  for (const choice of choices) {
    if (featured.length >= 5) break;
    if (featuredStores.has(choice.store.id)) continue;
    featured.push(choice);
    featuredStores.add(choice.store.id);
  }
  const path = (base: string, changes: Record<string, string> = {}) =>
    `/${l}/${base}?${new URLSearchParams({ ...carry, ...changes })}`;
  const shops = shopCards(catalog, { ...carry, locale: l }, shopStats).slice(0, 3);
  const shopCarry = Object.fromEntries(
    ['area', 'language'].flatMap((k) => (q[k] ? [[k, q[k]]] : [])),
  );
  return (
    <section className="h5-home h5-surface" aria-label={ht(l, 'projects')}>
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
            <small>{ht(l, 'tokyo')}</small>
          </div>
          <H5Language locale={l} compact />
          <div className="h5-hero-copy">
            <h1>{ht(l, 'homeHeadline')}</h1>
            <p>{ht(l, 'homeSubline')}</p>
            <small>{ht(l, 'homeAssurance')}</small>
          </div>
        </section>
        <nav className="h5-shortcuts" aria-label={ut(l, 'utilities')}>
          {(
            [
              [TicketPercent, 'card', 'services?promo=1'],
              [Handshake, 'partner', 'onboarding?role=MERCHANT'],
              [Heart, 'savedShops', 'account/favorites?type=shops'],
              [History, 'history', 'account/history'],
            ] as const
          ).map(([Icon, key, href]) => (
            <Link key={key} href={`/${l}/${href}`}>
              <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
              <span>{ht(l, key)}</span>
            </Link>
          ))}
        </nav>
      </div>
      <div className="h5-home-sections">
        <div className="h5-feature-grid">
          <section className="h5-category-card">
            <div className="h5-section-title">
              <h2>{ht(l, 'categories')}</h2>
              <Link href={path('services')}>
                {t(l, 'all')}
                <ChevronRight size={12} />
              </Link>
            </div>
            <div>
              {([60, 90] as const).map((duration, i) => (
                <Link key={duration} href={path('services', { duration: String(duration) })}>
                  <H5PortraitThumbnail
                    photo={
                      catalog.listings[i]
                        ? h5Portrait(catalog.listings[i], catalog.demo)
                        : '/images/h5-relaxation.png'
                    }
                    size={56}
                  />
                  <span>{ht(l, i ? 'long' : 'short')}</span>
                </Link>
              ))}
            </div>
          </section>
          <Link className="h5-safety-card" href={`/${l}/guides/booking-and-safety`}>
            <Image
              src="/images/h5-booking-care.png"
              alt=""
              fill
              sizes="(max-width:760px) 48vw, 190px"
              loading="eager"
            />
            <div>
              <h2>{ht(l, 'safety')}</h2>
              <p>{ht(l, 'safetySub')}</p>
              <span>
                {ht(l, 'learn')}
                <ChevronRight size={12} />
              </span>
            </div>
          </Link>
        </div>
        <H5ShopSection
          locale={l}
          cards={shops}
          demo={catalog.demo}
          href={(_, card) => shopCardHref(l, card, shopCarry)}
          allHref={`/${l}/discover?${new URLSearchParams({ ...shopCarry, tab: 'shops' })}`}
        />
        {!!offers.length && (
          <section className="h5-offers" aria-labelledby="h5-offers-title">
            <div className="h5-section-title">
              <h2 id="h5-offers-title">
                <TicketPercent size={17} aria-hidden="true" />
                {ht(l, 'promotions')}
              </h2>
              <Link href={path('services', { promo: '1' })}>
                {ht(l, 'allPromotions')}
                <ChevronRight size={12} />
              </Link>
            </div>
            <p className="h5-offers-sub">{ht(l, 'promotionsSub')}</p>
            <div className="h5-offer-rail">
              {offers.map(({ offering, store, total, compareTotal, promotionEndsAt }) => (
                <Link
                  key={offering.id}
                  className="h5-offer-card"
                  href={path('services', {
                    duration: String(offering.durationMinutes),
                    offering: offering.id,
                  })}
                >
                  <span className="h5-offer-meta">
                    {offering.durationMinutes} {t(l, 'minutes')}
                  </span>
                  <strong className="h5-offer-name">{offering.name[l]}</strong>
                  <small className="h5-offer-store">{store.name[l]}</small>
                  <H5Price
                    locale={l}
                    total={total}
                    compareTotal={compareTotal}
                    promotionEndsAt={promotionEndsAt}
                  />
                  <span className="h5-offer-cta">
                    {ht(l, 'bookNow')}
                    <ChevronRight size={12} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
        <div className="h5-section-title h5-recommended-title">
          <h2>{ht(l, 'projects')}</h2>
          <Link href={path('services')}>
            {ht(l, 'allProjects')}
            <ChevronRight size={13} />
          </Link>
        </div>
        <div className="h5-project-list">
          {featured.map(({ offering, store, total, compareTotal, promotionEndsAt }, index) => (
            <article className="h5-project-card" key={offering.id}>
              <Link
                className="h5-project-image"
                aria-label={`${offering.name[l]} · ${offering.durationMinutes} ${t(l, 'minutes')} · ${store.name[l]} · ${ht(l, 'reserve')}`}
                href={path('services', {
                  duration: String(offering.durationMinutes),
                  offering: offering.id,
                })}
              >
                <Image
                  src={
                    offering.durationMinutes === 120
                      ? '/images/h5-service-120.png'
                      : offering.durationMinutes === 90
                        ? '/images/h5-service-90.png'
                        : '/images/h5-treatment.png'
                  }
                  alt=""
                  fill
                  sizes="(max-width:360px) 86px, 102px"
                  loading={index < 2 ? 'eager' : 'lazy'}
                />
                <span>{ht(l, 'serviceIllustration')}</span>
              </Link>
              <div className="h5-project-copy">
                <div>
                  <h3>{offering.name[l]}</h3>
                  <span className="h5-tag">
                    {offering.durationMinutes} {t(l, 'minutes')}
                  </span>
                </div>
                <p>{store.name[l]}</p>
                <H5Badges
                  locale={l}
                  promotion={!!promotionEndsAt}
                  freeTravel={offering.transportFee === 0}
                />
                <small>{ht(l, 'total')}</small>
                <div className="h5-project-bottom">
                  <H5Price locale={l} total={total} compareTotal={compareTotal} />
                  <Link
                    className="h5-primary"
                    aria-label={`${ht(l, 'reserve')} · ${offering.name[l]} · ${offering.durationMinutes} ${t(l, 'minutes')} · ${store.name[l]}`}
                    href={path('services', {
                      duration: String(offering.durationMinutes),
                      offering: offering.id,
                    })}
                  >
                    {ht(l, 'reserve')}
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
        {!featured.length && (
          <div className="h5-home-empty" role="status">
            <CalendarDays size={27} />
            <h3>{ht(l, 'homeNoMatches')}</h3>
            <p>{ht(l, 'homeNoMatchesHelp')}</p>
            <div>
              <Link href={path('services', { mode: 'SCHEDULED' })}>{ht(l, 'scheduled')}</Link>
              <Link href={`/${l}/therapists`}>{ht(l, 'allTherapists')}</Link>
            </div>
          </div>
        )}
        <Link className="h5-region-strip" href={path('therapists')}>
          <MapPin size={17} />
          <strong>{ht(l, 'regions')}</strong>
          <span>{ht(l, 'tokyo')}</span>
          <ChevronRight size={15} />
        </Link>
        <Link className="h5-partner-banner" href={`/${l}/onboarding?role=MERCHANT`}>
          <Store size={30} />
          <div>
            <strong>{ht(l, 'partner')}</strong>
            <small>{ht(l, 'welcomeSub')}</small>
          </div>
          <ArrowRight size={20} />
        </Link>
        <p className="h5-footnote">{catalog.demo ? ht(l, 'sampleNote') : ht(l, 'regionsHelp')}</p>
      </div>
    </section>
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
