'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import {
  ArrowRight,
  ChevronRight,
  Globe2,
  Headphones,
  Heart,
  History,
  MapPin,
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
} from 'lucide-react';
import type { Actor, Locale, MobileBootstrap } from '@hogulink/contracts';
import { areaName, localeMap, locales, t } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { af } from '@/lib/customer-flow-i18n';
import { xt } from '@/lib/discovery-i18n';
import { usePathname, useSearchParams } from 'next/navigation';

import { H5EmptyArt, H5PageHeading } from './h5-overlays';
import { MobileSheet } from './mobile-ui';

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

export function H5AccountFeatures({ locale: l }: { locale: Locale }) {
  return (
    <nav className="ui-coming-links" aria-label={ht(l, 'card')}>
      <Link href={`/${l}/account/benefits`}>
        {ht(l, 'coupons')}
        <span>{ht(l, 'coming')}</span>
      </Link>
      <Link href={`/${l}/account/benefits#wallet`}>
        {ht(l, 'wallet')}
        <span>{ht(l, 'coming')}</span>
      </Link>
    </nav>
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
        {[
          { Icon: Heart, label: ht(l, 'favorites'), href: 'account/favorites' },
          { Icon: Store, label: xt(l, 'shopFavorites'), href: 'account/favorites?type=shops' },
          { Icon: History, label: ht(l, 'footprints'), href: 'account/history' },
          { Icon: MapPin, label: af(l, 'addresses'), href: 'account/addresses' },
          { Icon: ShieldCheck, label: ht(l, 'complaint'), href: 'account/support' },
          { Icon: ReceiptText, label: t(l, 'terms'), href: 'guides/terms' },
        ].map(({ Icon, label, href }) => (
          <Link key={href} href={`/${l}/${href}`}>
            <Icon size={20} />
            <span>{label}</span>
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
      <Link className="ui-partner-link" href={`/${l}/onboarding?role=MERCHANT`}>
        <Handshake size={20} />
        {ht(l, 'partner')}
        <ChevronRight size={16} />
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
