'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  CalendarDays,
  Heart,
  History,
  LifeBuoy,
  MapPin,
  MessageCircle,
  Settings,
  UserRound,
} from 'lucide-react';
import type { Locale } from '@hogulink/contracts';
import { ut } from '@/lib/consumer-i18n';
import { xt } from '@/lib/discovery-i18n';
import { af } from '@/lib/customer-flow-i18n';
import { ht } from '@/lib/h5-i18n';
import { withServiceMode } from '@/lib/visit-model';

/** The account's own navigation; business workspaces remain separate. */
export function CustomerAccountNav({ locale: l }: { locale: Locale }) {
  const pathname = usePathname();
  const query = useSearchParams();
  const base = `/${l}/account`;
  if (pathname === `${base}/access`) return null;
  const items = [
    { path: '', label: ut(l, 'mine'), Icon: UserRound },
    { path: 'bookings', label: ut(l, 'bookings'), Icon: CalendarDays },
    { path: 'messages', label: xt(l, 'inbox'), Icon: MessageCircle },
    { path: 'favorites', label: ut(l, 'favorites'), Icon: Heart },
    { path: 'history', label: ut(l, 'history'), Icon: History },
    { path: 'addresses', label: af(l, 'addresses'), Icon: MapPin },
    { path: 'support', label: ut(l, 'support'), Icon: LifeBuoy },
    { path: 'settings', label: ht(l, 'settings'), Icon: Settings },
  ];
  const knownSection = items.some(
    ({ path }) =>
      !!path && (pathname === `${base}/${path}` || pathname.startsWith(`${base}/${path}/`)),
  );
  return (
    <nav className="customer-account-nav" aria-label={ht(l, 'accountNavigation')}>
      <div className="customer-account-nav-title">
        <span>
          <UserRound size={22} />
        </span>
        <strong>{ut(l, 'mine')}</strong>
      </div>
      <div>
        {items.map(({ path, label, Icon }) => {
          const href = `${base}${path ? `/${path}` : ''}`;
          const active = path
            ? pathname === href || pathname.startsWith(`${href}/`)
            : !knownSection;
          return (
            <Link
              key={href}
              href={withServiceMode(href, query.get('fulfillmentMode'))}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
