'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  CalendarDays,
  Leaf,
  LifeBuoy,
  ListChecks,
  Sparkles,
  UserRound,
  Globe2,
} from 'lucide-react';
import type { Listing, Locale, Localized } from '@hogulink/contracts';
import { ft, staffTabs } from '@/lib/staff-i18n';
import { so } from '@/lib/staff-operations-i18n';
import { localeMap, t } from '@/lib/i18n';
const icons = { overview: Sparkles, tasks: ListChecks, schedule: CalendarDays, profile: UserRound };
export function StaffLanguage({ locale: l }: { locale: Locale }) {
  const path = usePathname(),
    query = useSearchParams();
  return (
    <label className="staff-language">
      <Globe2 size={16} aria-hidden="true" />
      <select
        aria-label="Language"
        value={l}
        onChange={(e) =>
          window.location.assign(
            path.replace(/^\/(ja|en|zh-cn)(?=\/|$)/, `/${e.target.value}`) +
              (query.size ? `?${query}` : '') +
              window.location.hash,
          )
        }
      >
        {Object.entries(localeMap).map(([key, value]) => (
          <option key={key} value={key}>
            {value.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function StaffNavigation({
  locale: l,
  listing,
  storeName,
  count = 0,
}: {
  locale: Locale;
  listing?: Pick<Listing, 'name' | 'photo'>;
  storeName?: Localized;
  count?: number;
}) {
  const path = usePathname(),
    query = useSearchParams();
  const selected = path.includes('/support')
    ? 'support'
    : path.includes('/quality')
      ? 'profile'
      : (query.get('tab') ?? 'overview');
  return (
    <aside className="staff-sidebar">
      <Link className="staff-wordmark" href={`/${l}/staff`}>
        <Leaf size={25} />
        <strong>
          HoguLink<small>{so(l, 'workspace')}</small>
        </strong>
      </Link>
      {listing && (
        <div className="staff-identity">
          {listing.photo ? (
            <Image src={listing.photo} alt="" width={72} height={72} />
          ) : (
            <span>
              <UserRound size={29} />
            </span>
          )}
          <strong>{listing.name[l]}</strong>
          {storeName && <small>{storeName[l]}</small>}
        </div>
      )}
      <nav aria-label={so(l, 'workspace')}>
        {staffTabs.map((view) => {
          const Icon = icons[view];
          return (
            <Link
              key={view}
              href={`/${l}/staff?tab=${view}`}
              aria-current={selected === view ? 'page' : undefined}
            >
              <Icon size={18} />
              {ft(l, view)}
              {view === 'tasks' && count > 0 && <b>{count}</b>}
            </Link>
          );
        })}
        <Link
          href={`/${l}/staff/support`}
          aria-current={selected === 'support' ? 'page' : undefined}
        >
          <LifeBuoy size={18} />
          {ft(l, 'support')}
        </Link>
      </nav>
      <div className="staff-sidebar-foot">
        <Link href={`/${l}`}>
          {t(l, 'back')}
          <Leaf size={15} />
        </Link>
      </div>
    </aside>
  );
}
