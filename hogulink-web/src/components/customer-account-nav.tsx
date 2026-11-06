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
import { usePcLayout } from '@/lib/use-pc-layout';
import { pa } from '@/lib/pc-account-i18n';
import { InboxUnreadBadge } from './inbox-badge';
import { useSession } from './booking-form';

/** The account's own navigation; business workspaces remain separate. */
export function CustomerAccountNav({ locale: l }: { locale: Locale }) {
  const pathname = usePathname();
  const query = useSearchParams();
  const isPc = usePcLayout();
  const { actor } = useSession();
  const base = `/${l}/account`;
  if (pathname === `${base}/access`) return null;
  const items = [
    { path: '', label: isPc ? pa(l, 'overview') : ut(l, 'mine'), Icon: UserRound },
    { path: 'bookings', label: ut(l, 'bookings'), Icon: CalendarDays },
    { path: 'messages', label: xt(l, 'inbox'), Icon: MessageCircle },
    { path: 'favorites', label: isPc ? pa(l, 'saved') : ut(l, 'favorites'), Icon: Heart },
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
    <nav
      className="customer-account-nav"
      aria-label={ht(l, 'accountNavigation')}
      data-pc-ready={isPc}
    >
      <div className="customer-account-nav-title">
        <span>
          <UserRound size={22} />
        </span>
        <strong>{isPc ? pa(l, 'center') : ut(l, 'mine')}</strong>
      </div>
      <div>
        {items
          .filter(({ path }) => !isPc || path !== 'history')
          .map(({ path, label, Icon }) => {
            const href = `${base}${path ? `/${path}` : ''}`;
            const active = path
              ? pathname === href ||
                pathname.startsWith(`${href}/`) ||
                (isPc && path === 'favorites' && pathname === `${base}/history`)
              : !knownSection;
            return (
              <Link
                key={href}
                href={withServiceMode(href, query.get('fulfillmentMode'))}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                {isPc && path === 'messages' && actor?.role === 'CUSTOMER' && <InboxUnreadBadge />}
              </Link>
            );
          })}
      </div>
    </nav>
  );
}

export function CustomerSavedTabs({ locale: l }: { locale: Locale }) {
  const path = usePathname();
  const isPc = usePcLayout();
  if (!isPc || ![`/${l}/account/favorites`, `/${l}/account/history`].includes(path)) return null;
  return (
    <nav className="pc-saved-tabs" aria-label={pa(l, 'saved')}>
      {(['favorites', 'history'] as const).map((section) => (
        <Link
          key={section}
          href={`/${l}/account/${section}`}
          aria-current={path.endsWith(`/${section}`) ? 'page' : undefined}
        >
          {pa(l, section === 'favorites' ? 'savedItems' : 'history')}
        </Link>
      ))}
    </nav>
  );
}
