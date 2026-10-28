'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { Locale, Localized } from '@hogulink/contracts';
import { merchantTabs, st } from '@/lib/merchant-i18n';
import { localeMap } from '@/lib/i18n';
import { mo } from '@/lib/merchant-operations-i18n';
import {
  Leaf,
  LayoutDashboard,
  ListChecks,
  CalendarDays,
  UsersRound,
  SlidersHorizontal,
  Store,
  ReceiptText,
  Settings2,
  LifeBuoy,
} from 'lucide-react';
const icons = {
  overview: LayoutDashboard,
  bookings: ListChecks,
  schedule: CalendarDays,
  team: UsersRound,
  services: SlidersHorizontal,
  storefront: Store,
  finance: ReceiptText,
  settings: Settings2,
};
export function MerchantNavigation({
  locale: l,
  name,
  count = 0,
  cases = 0,
}: {
  locale: Locale;
  name?: Localized;
  count?: number;
  cases?: number;
}) {
  const path = usePathname(),
    query = useSearchParams();
  const selected = path.includes('/support')
    ? 'support'
    : path.includes('/quality')
      ? 'quality'
      : (query.get('tab') ?? 'overview');
  return (
    <aside className="merchant-sidebar merchant-primary-nav">
      <Link className="merchant-wordmark" href={`/${l}/merchant`}>
        <span>
          <Leaf size={22} />
        </span>
        <strong>
          HoguLink<small>{st(l, 'overview')}</small>
        </strong>
      </Link>
      {name && (
        <div className="merchant-shop-stamp">
          <Store size={18} />
          <span>{name[l]}</span>
        </div>
      )}
      <nav aria-label={st(l, 'overview')}>
        {merchantTabs.map((k) => {
          const Icon = icons[k];
          return (
            <Link
              href={`/${l}/merchant?tab=${k}`}
              key={k}
              aria-current={selected === k ? 'page' : undefined}
            >
              <Icon size={18} />
              {st(l, k)}
              {k === 'bookings' && count > 0 && <span>{count}</span>}
            </Link>
          );
        })}
        <Link
          href={`/${l}/merchant/support`}
          aria-current={selected === 'support' ? 'page' : undefined}
        >
          <LifeBuoy size={18} />
          {st(l, 'support')}
          {cases > 0 && <span>{cases}</span>}
        </Link>
      </nav>
      <details
        className="merchant-mobile-tools"
        id="merchant-tools"
        open={query.get('tools') === '1'}
      >
        <summary>{mo(l, 'more')}</summary>
        <nav>
          {merchantTabs
            .filter((k) => !['overview', 'bookings', 'schedule'].includes(k))
            .map((k) => (
              <Link href={`/${l}/merchant?tab=${k}`} key={k}>
                {st(l, k)}
              </Link>
            ))}
          <Link href={`/${l}/merchant/support`}>{st(l, 'support')}</Link>
        </nav>
      </details>
      <label className="merchant-language">
        <span>{localeMap[l].label}</span>
        <select
          aria-label="Language"
          value={l}
          onChange={(e) =>
            window.location.assign(
              path.replace(/^\/(ja|en|zh-cn)/, `/${e.target.value}`) +
                (query.size ? `?${query}` : ''),
            )
          }
        >
          {Object.entries(localeMap).map(([key, v]) => (
            <option key={key} value={key}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
    </aside>
  );
}
