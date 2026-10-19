'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  Leaf,
  ShieldCheck,
  Globe2,
  UserRound,
  MapPin,
  ChevronLeft,
} from 'lucide-react';
import { mt } from '@/lib/mobile-i18n';
import { ut } from '@/lib/consumer-i18n';
import { xt } from '@/lib/discovery-i18n';
import type { Locale } from '@hogulink/contracts';
import { localeMap, locales, t } from '@/lib/i18n';
import { ct } from '@/lib/care-i18n';
import { dt } from '@/lib/desktop-i18n';
export function Header({ locale }: { locale: Locale }) {
  const path = usePathname();
  const query = useSearchParams();
  const workspace = /^\/(ja|en|zh-cn)\/(merchant|staff|admin|account)(\/|$)/.test(path);
  const base = path.split('/').slice(0, 3).join('/');
  return (
    <>
      <div className="demo-bar">
        <span>
          <span className="demo-dot" />
          {t(locale, 'demo')}
        </span>
        <nav aria-label="Demo workspaces">
          <Link href={`/${locale}/merchant`}>
            {t(locale, 'merchant')}
            <ArrowUpRight size={11} />
          </Link>
          <Link href={`/${locale}/staff`}>
            {t(locale, 'staff')}
            <ArrowUpRight size={11} />
          </Link>
          <Link href={`/${locale}/admin`}>
            {t(locale, 'admin')}
            <ArrowUpRight size={11} />
          </Link>
        </nav>
      </div>
      <header className={`header wrap ${workspace ? 'workspace-header' : ''}`}>
        {/\/(therapists|shops|book)\//.test(path) && (
          <Link
            className="mobile-back"
            href={
              path.includes('/book/')
                ? `${path.replace('/book/', '/therapists/')}?${query}`
                : path.includes('/shops/')
                  ? `/${locale}/discover?${new URLSearchParams({ tab: 'shops', ...Object.fromEntries(['area', 'language'].flatMap((key) => (query.get(key) ? [[key, query.get(key)!]] : []))) })}`
                  : `/${locale}?${new URLSearchParams(Object.fromEntries(['mode', 'area', 'language'].flatMap((key) => (query.get(key) ? [[key, query.get(key)!]] : []))))}#discover`
            }
            aria-label={mt(locale, 'back')}
          >
            <ChevronLeft size={22} />
          </Link>
        )}
        <Link href={`/${locale}`} className="logo" aria-label="HoguLink home">
          <span className="logo-icon">
            <Leaf size={23} />
          </span>
          Hogu<span>Link</span>
        </Link>
        {workspace ? (
          <nav className="main-nav workspace-header-nav">
            <Link href={base.endsWith('/account') ? `${base}/bookings` : base}>
              {dt(locale, 'workspace')}
            </Link>
            <span>/</span>
            <Link href={`${base}/support`}>{ct(locale, 'center')}</Link>
          </nav>
        ) : (
          <nav className="main-nav">
            <Link href={`/${locale}`} aria-current={path === `/${locale}` ? 'page' : undefined}>
              {t(locale, 'explore')}
            </Link>
            <Link
              href={`/${locale}/discover`}
              aria-current={path === `/${locale}/discover` ? 'page' : undefined}
            >
              {xt(locale, 'discover')}
            </Link>
            <Link
              href={`/${locale}/services`}
              aria-current={path === `/${locale}/services` ? 'page' : undefined}
            >
              {ut(locale, 'services')}
            </Link>
            <Link href={`/${locale}#how`}>{t(locale, 'how')}</Link>
            <Link href={`/${locale}#safety`}>{t(locale, 'safety')}</Link>
          </nav>
        )}
        <div className="header-actions">
          <label className="locale-label">
            <Globe2 size={16} />
            <span className="sr-only">Language</span>
            <select
              aria-label="Language"
              value={locale}
              onChange={(e) =>
                window.location.assign(
                  `${path.replace(/^\/(ja|en|zh-cn)(?=\/|$)/, `/${e.target.value}`)}${query.size ? `?${query.toString()}` : ''}`,
                )
              }
            >
              {locales.map((x) => (
                <option key={x} value={x}>
                  {localeMap[x].label}
                </option>
              ))}
            </select>
          </label>
          <Link
            className="account-link"
            href={base.endsWith('/admin') ? base : `/${locale}/account`}
          >
            <UserRound size={17} />
            <span>{base.endsWith('/admin') ? t(locale, 'admin') : ut(locale, 'mine')}</span>
          </Link>
        </div>
      </header>
    </>
  );
}
export function Footer({ locale }: { locale: Locale }) {
  return (
    <footer>
      <div className="wrap footer-content">
        <div>
          <Link className="logo" href={`/${locale}`}>
            <Leaf size={22} />
            Hogu<span>Link</span>
          </Link>
          <p>{t(locale, 'footer')}</p>
        </div>
        <div className="footer-links">
          <Link href={`/${locale}/account/support`}>{ct(locale, 'center')}</Link>
          <Link href={`/${locale}/guides/booking-and-safety`}>{t(locale, 'safety')}</Link>
          <Link href={`/${locale}/guides/terms`}>{t(locale, 'terms')}</Link>
          <Link href={`/${locale}/shops/nagi-tokyo`}>{t(locale, 'legal')}</Link>
        </div>
        <details className="mobile-demo-workspaces">
          <summary>
            {locale === 'ja'
              ? 'デモの管理画面'
              : locale === 'en'
                ? 'Demo workspaces'
                : '演示工作台'}
          </summary>
          <div>
            {(['merchant', 'staff', 'admin'] as const).map((role) => (
              <Link key={role} href={`/${locale}/${role}`}>
                {t(locale, role)}
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </div>
        </details>
      </div>
      <div className="wrap footer-bottom">
        <span>© 2026 HoguLink · Local development preview</span>
        <span>{t(locale, 'nonMedical')}</span>
      </div>
    </footer>
  );
}
export function LocationTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="location-tag">
      <MapPin size={13} />
      {children}
    </span>
  );
}
export function DemoNotice({ locale }: { locale: Locale }) {
  return (
    <p className="notice">
      <ShieldCheck size={17} />
      {t(locale, 'supportText')}
    </p>
  );
}
