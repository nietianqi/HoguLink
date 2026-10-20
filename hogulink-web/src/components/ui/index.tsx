import Link from 'next/link';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import type { ListingStats, Locale } from '@hogulink/contracts';
import { H5Price } from '../h5-business';
import { MobileSheet } from '../mobile-ui';
import { ht } from '@/lib/h5-i18n';

export function Button({
  href,
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { href?: string; variant?: 'primary' | 'secondary' }) {
  const style = `ui-button is-${variant} ${className}`;
  return href ? (
    <Link href={href} className={style}>
      {children}
    </Link>
  ) : (
    <button className={style} {...props}>
      {children}
    </button>
  );
}
export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <article className={`ui-card ${className}`} {...props} />;
}
export function SectionHeading({
  children,
  href,
  action,
}: {
  children: ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="ui-section-heading">
      <h2>{children}</h2>
      {href && (
        <Link href={href}>
          {action} <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}
export function Badge({ children, offer = false }: { children: ReactNode; offer?: boolean }) {
  return <span className={`ui-badge ${offer ? 'is-offer' : ''}`}>{children}</span>;
}
export const Price = H5Price;
export function Rating({ locale: l, stats }: { locale: Locale; stats?: ListingStats }) {
  if (!stats) return null;
  return (
    <span className="ui-rating">
      {stats.rating === null
        ? ht(l, 'noReviews')
        : `★ ${stats.rating.toFixed(1)} · ${stats.reviewCount}`}
      {stats.completed90d > 0 && ` · ${ht(l, 'statCompleted')} ${stats.completed90d}`}
    </span>
  );
}
export function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Link className="ui-filter-chip" href={href} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
}
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="ui-action-bar">{children}</div>;
}
export function EmptyState({
  children,
  href,
  action,
}: {
  children: ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="ui-empty" role="status">
      <p>{children}</p>
      {href && (
        <Button href={href} variant="secondary">
          {action}
        </Button>
      )}
    </div>
  );
}
export const Dialog = MobileSheet;
