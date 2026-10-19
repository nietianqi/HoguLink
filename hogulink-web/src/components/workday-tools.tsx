import Link from 'next/link';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import type { Locale } from '@hogulink/contracts';
import { wt } from '@/lib/workday-i18n';
export function WorkdayTools({
  locale,
  items,
}: {
  locale: Locale;
  items: { href: string; label: string; icon: LucideIcon; count?: number }[];
}) {
  return (
    <nav className="workday-tools" aria-label={wt(locale, 'common')}>
      {items.map(({ href, label, icon: Icon, count }) => (
        <Link href={href} key={href}>
          <Icon size={20} strokeWidth={1.6} />
          <span>{label}</span>
          {count !== undefined && count > 0 ? (
            <b>{count > 99 ? '99+' : count}</b>
          ) : (
            <ArrowUpRight size={15} />
          )}
        </Link>
      ))}
    </nav>
  );
}
