'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  FileCheck2,
  History,
  LayoutDashboard,
  Leaf,
  ListChecks,
  MessageSquareWarning,
  Server,
  ShieldCheck,
  Star,
  UsersRound,
  Wallet,
  CircleHelp,
  UserSearch,
} from 'lucide-react';
import { canAdmin, type Locale } from '@hogulink/contracts';
import { adminTabs, adminTabAllowed, at, type AdminTab } from '@/lib/admin-i18n';
import { ot } from '@/lib/admin-operations-i18n';
import { locales, localeMap } from '@/lib/i18n';
import { useSession } from './booking-form';

type Active = AdminTab | 'support' | 'quality' | 'content';
const icons = {
  overview: LayoutDashboard,
  orders: ListChecks,
  customers: UserSearch,
  review: FileCheck2,
  safety: ShieldCheck,
  finance: Wallet,
  audit: History,
  system: Server,
  members: UsersRound,
};
export function AdminNavigation({
  locale: l,
  active,
  counts = {},
  hrefs = {},
}: {
  locale: Locale;
  active: Active;
  counts?: Partial<Record<AdminTab, number>>;
  hrefs?: Partial<Record<AdminTab, string>>;
}) {
  const { actor } = useSession();
  const path = usePathname(),
    query = useSearchParams();
  const links = adminTabs
    .filter((view) => !actor || actor.role !== 'ADMIN' || adminTabAllowed(actor, view))
    .map((view) => ({
      view: view as Active,
      label: at(l, view),
      href: hrefs[view] ?? `/${l}/admin?tab=${view}`,
      Icon: icons[view],
      count: counts[view] ?? 0,
    }));
  if (canAdmin(actor, 'cases.read'))
    links.push({
      view: 'support',
      label: at(l, 'support'),
      href: `/${l}/admin/support`,
      Icon: CircleHelp,
      count: 0,
    });
  if (canAdmin(actor, 'supply.write'))
    links.push({
      view: 'quality',
      label: at(l, 'experienceNav'),
      href: `/${l}/admin/quality`,
      Icon: Star,
      count: 0,
    });
  if (canAdmin(actor, 'safety.write'))
    links.push({
      view: 'content',
      label: at(l, 'contentNav'),
      href: `/${l}/admin/safety-review`,
      Icon: MessageSquareWarning,
      count: 0,
    });
  const navigation = (mobile: boolean) => (
    <nav className={mobile ? 'admin-mobile-tabs' : undefined} aria-label={at(l, 'portal')}>
      {links.map(({ view, label, href, Icon, count }) => (
        <Link key={view} href={href} aria-current={view === active ? 'page' : undefined}>
          <Icon size={18} aria-hidden="true" />
          {label}
          {count > 0 && <b>{count}</b>}
        </Link>
      ))}
    </nav>
  );
  return (
    <>
      <aside className="admin-sidebar">
        <Link className="admin-wordmark" href={`/${l}/admin`}>
          <span>
            <Leaf size={24} />
          </span>
          <strong>
            HoguLink<small>{at(l, 'portal')}</small>
          </strong>
        </Link>
        {navigation(false)}
        <div className="admin-sidebar-bottom">
          <label className="admin-language">
            {ot(l, 'language')}
            <select
              value={l}
              onChange={(e) =>
                window.location.assign(
                  `${path.replace(/^\/(ja|en|zh-cn)(?=\/|$)/, `/${e.target.value}`)}${query.size ? `?${query.toString()}` : ''}`,
                )
              }
            >
              {locales.map((value) => (
                <option key={value} value={value}>
                  {localeMap[value].label}
                </option>
              ))}
            </select>
          </label>
          <Link href={`/${l}`}>
            {l === 'ja' ? 'サービスサイトへ' : l === 'en' ? 'Service website' : '查看顾客网站'}
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </aside>
      <div className="admin-mobile-navigation">
        {navigation(true)}
        <label className="admin-language">
          <span className="sr-only">{ot(l, 'language')}</span>
          <select
            value={l}
            onChange={(e) =>
              window.location.assign(
                `${path.replace(/^\/(ja|en|zh-cn)(?=\/|$)/, `/${e.target.value}`)}${query.size ? `?${query.toString()}` : ''}`,
              )
            }
          >
            {locales.map((value) => (
              <option key={value} value={value}>
                {localeMap[value].label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
export function AdminFrame({
  locale,
  active,
  children,
}: {
  locale: Locale;
  active: Active;
  children: ReactNode;
}) {
  return (
    <div className="admin-page admin-subpage">
      <div className="admin-layout">
        <AdminNavigation locale={locale} active={active} />
        <div className="admin-content">{children}</div>
      </div>
    </div>
  );
}
