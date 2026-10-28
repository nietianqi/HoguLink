import Link from 'next/link';
import { qt } from '@/lib/quality-i18n';
import { ut } from '@/lib/consumer-i18n';
import { xt } from '@/lib/discovery-i18n';
import { MessageCircle, MapPin } from 'lucide-react';
import { af } from '@/lib/customer-flow-i18n';
import {
  CalendarDays,
  LifeBuoy,
  ArrowUpRight,
  Leaf,
  ReceiptText,
  ShieldCheck,
  History,
  UsersRound,
  SlidersHorizontal,
  Settings2,
  LayoutDashboard,
  ListChecks,
  FileCheck2,
  Server,
  Wallet,
} from 'lucide-react';
import { canAdmin, type Actor, type Locale, type Role } from '@hogulink/contracts';
import { ct } from '@/lib/care-i18n';
import { dt } from '@/lib/desktop-i18n';
import { t } from '@/lib/i18n';
import { st } from '@/lib/merchant-i18n';
import { MerchantNavigation } from './merchant-navigation';
import { ft } from '@/lib/staff-i18n';
import { at, adminTabs, adminTabAllowed } from '@/lib/admin-i18n';
export function WorkspaceNav(props: Parameters<typeof LegacyWorkspaceNav>[0]) {
  return props.role === 'MERCHANT' ? (
    <MerchantNavigation locale={props.locale} />
  ) : (
    <LegacyWorkspaceNav {...props} />
  );
}
function LegacyWorkspaceNav({
  locale,
  role,
  active,
  actor,
}: {
  locale: Locale;
  role: Role;
  active: 'bookings' | 'support' | 'favorites';
  actor?: Actor | null;
}) {
  const base = `/${locale}/${role === 'CUSTOMER' ? 'account' : role.toLowerCase()}`;
  if (role === 'ADMIN') return null;
  return (
    <nav className="workspace-nav" data-role={role} aria-label={ct(locale, 'center')}>
      <div className="workspace-brand">
        <span>
          <Leaf size={22} />
        </span>
        <strong>
          HoguLink<small>{dt(locale, 'workspace')}</small>
        </strong>
      </div>
      <span className="workspace-nav-label">{dt(locale, 'activity')}</span>
      {role === 'CUSTOMER' && (
        <Link href={`${base}/addresses`}>
          <MapPin size={16} />
          {af(locale, 'addresses')}
        </Link>
      )}
      {role === 'CUSTOMER' && (
        <Link href={`${base}/messages`}>
          <MessageCircle size={16} />
          {xt(locale, 'inbox')}
        </Link>
      )}
      {role === 'CUSTOMER' && (
        <Link href={`${base}`}>
          <UsersRound size={16} />
          {ut(locale, 'mine')}
        </Link>
      )}
      {role === 'CUSTOMER' && (
        <Link
          href={`${base}/favorites`}
          className={active === 'favorites' ? 'active' : ''}
          aria-current={active === 'favorites' ? 'page' : undefined}
        >
          <UsersRound size={16} />
          {qt(locale, 'favorites')}
        </Link>
      )}
      {role === 'MERCHANT' && (
        <Link href={`${base}?tab=overview`}>
          <LayoutDashboard size={16} />
          {st(locale, 'overview')}
        </Link>
      )}
      {role === 'STAFF' && (
        <Link href={`${base}?tab=overview`}>
          <LayoutDashboard size={16} />
          {ft(locale, 'overview')}
        </Link>
      )}
      <Link
        href={
          role === 'CUSTOMER'
            ? `${base}/bookings`
            : role === 'MERCHANT'
              ? `${base}?tab=bookings`
              : role === 'STAFF'
                ? `${base}?tab=tasks`
                : base
        }
        className={active === 'bookings' ? 'active' : ''}
        aria-current={active === 'bookings' ? 'page' : undefined}
      >
        <CalendarDays size={16} />
        {role === 'CUSTOMER'
          ? t(locale, 'orders')
          : role === 'MERCHANT'
            ? st(locale, 'bookings')
            : role === 'STAFF'
              ? ft(locale, 'tasks')
              : ct(locale, 'bookings')}
      </Link>
      {role === 'STAFF' && (
        <>
          <Link href={`${base}?tab=schedule`}>
            <CalendarDays size={16} />
            {ft(locale, 'schedule')}
          </Link>
          <Link href={`${base}?tab=profile`}>
            <UsersRound size={16} />
            {ft(locale, 'profile')}
          </Link>
        </>
      )}
      {role === 'MERCHANT' && (
        <>
          <Link href={`${base}?tab=schedule`}>
            <CalendarDays size={16} />
            {st(locale, 'schedule')}
          </Link>
          <Link href={`${base}?tab=team`}>
            <UsersRound size={16} />
            {st(locale, 'team')}
          </Link>
          <Link href={`${base}?tab=services`}>
            <SlidersHorizontal size={16} />
            {st(locale, 'services')}
          </Link>
          <Link href={`${base}?tab=settings`}>
            <Settings2 size={16} />
            {st(locale, 'settings')}
          </Link>
        </>
      )}
      <Link
        href={`${base}/support`}
        className={active === 'support' ? 'active' : ''}
        aria-current={active === 'support' ? 'page' : undefined}
      >
        <LifeBuoy size={16} />
        {ct(locale, 'center')}
      </Link>
      {role === 'MERCHANT' && (
        <>
          <span className="workspace-nav-label">{dt(locale, 'tools')}</span>
          {role === 'MERCHANT' ? (
            <Link href={`${base}?tab=finance`}>
              <ReceiptText size={16} />
              {st(locale, 'finance')}
            </Link>
          ) : (
            <>
              <Link href={`${base}#moderation`}>
                <ShieldCheck size={16} />
                {t(locale, 'moderation')}
              </Link>
              <Link href={`${base}#audit`}>
                <History size={16} />
                {t(locale, 'audit')}
              </Link>
            </>
          )}
        </>
      )}
      <div className="workspace-nav-bottom">
        <small>{dt(locale, 'timezone')}</small>
        <Link href={`/${locale}`}>
          <ArrowUpRight size={16} />
          {dt(locale, 'back')}
        </Link>
      </div>
    </nav>
  );
}
