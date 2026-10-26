'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { withServiceMode } from '@/lib/visit-model';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  CalendarDays,
  Search,
  LifeBuoy,
  X,
  ChevronUp,
  LayoutDashboard,
  ListChecks,
  UserRound,
  House,
  MessageCircle,
  Compass,
} from 'lucide-react';
import { xt } from '@/lib/discovery-i18n';
import { InboxUnreadBadge } from './inbox-badge';
import { st } from '@/lib/merchant-i18n';
import { ft } from '@/lib/staff-i18n';
import { at, adminTabAllowed, type AdminTab } from '@/lib/admin-i18n';
import type { Actor, Locale } from '@hogulink/contracts';
import { api } from '@/lib/api';
import { money, t } from '@/lib/i18n';
import { mt } from '@/lib/mobile-i18n';
import { ut } from '@/lib/consumer-i18n';
import { ht } from '@/lib/h5-i18n';
import { PriceLines } from './catalog';

// Native modal provides focus containment, Escape, and an inert background.
export function MobileSheet({
  open,
  onClose,
  title,
  locale,
  children,
  className,
  closeIcon,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  locale: Locale;
  children: ReactNode;
  className?: string;
  closeIcon?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const dialog = ref.current;
    if (!mounted || !open || !dialog) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
    };
  }, [open, mounted]);
  if (!mounted) return null;
  // Keep modal forms outside their trigger's form in the DOM. React events
  // still cross portal boundaries, so submit must also stop at the dialog.
  return createPortal(
    <dialog
      ref={ref}
      className={`mobile-sheet ${className ?? ''}`}
      aria-labelledby={titleId}
      onSubmit={(event) => event.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      {open && (
        <>
          <div className="sheet-heading">
            <h2 id={titleId}>{title}</h2>
            <button type="button" autoFocus onClick={onClose} aria-label={mt(locale, 'close')}>
              {closeIcon ?? <X size={21} />}
            </button>
          </div>
          {children}
        </>
      )}
    </dialog>,
    document.body,
  );
}

export function MobilePriceDock({
  locale,
  quote,
  note,
  error,
  children,
}: {
  locale: Locale;
  quote: {
    serviceFee: number;
    nominationFee: number;
    transportFee: number;
    timeSurcharge?: number;
    total: number;
  };
  note?: string;
  error?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mobile-action-dock">
        {error && (
          <p className="mobile-dock-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="dock-price"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <small>
            {t(locale, 'total')} · {mt(locale, 'fees')}
            <ChevronUp size={12} />
          </small>
          <strong>{money(locale, quote.total)}</strong>
        </button>
        {children}
      </div>
      <MobileSheet
        open={open}
        onClose={() => setOpen(false)}
        title={mt(locale, 'fees')}
        locale={locale}
      >
        <div className="sheet-price-content">
          {note && <p>{note}</p>}
          <PriceLines locale={locale} quote={quote} />
          <p>{t(locale, 'nonMedical')}</p>
          <button type="button" className="button full" onClick={() => setOpen(false)}>
            {mt(locale, 'close')}
          </button>
        </div>
      </MobileSheet>
    </>
  );
}

export function MobileNavigation({ locale }: { locale: Locale }) {
  const [adminActor, setAdminActor] = useState<Actor | null>(null);
  const path = usePathname();
  const query = useSearchParams();
  useEffect(() => {
    let baseline = window.visualViewport?.height ?? window.innerHeight;
    let width = window.innerWidth;
    const update = () => {
      const el = document.activeElement;
      const editing =
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement &&
          !['checkbox', 'radio', 'button', 'submit'].includes(el.type));
      const height = window.visualViewport?.height ?? window.innerHeight;
      if (window.innerWidth !== width) {
        baseline = height;
        width = window.innerWidth;
      }
      if (!editing) baseline = Math.max(baseline, height);
      document.documentElement.classList.toggle(
        'mobile-editing',
        editing && height < baseline - 120,
      );
    };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      document.documentElement.classList.remove('mobile-editing');
    };
  }, []);
  useEffect(() => {
    if (!path.includes('/admin')) return;
    let canceled = false;
    const invalidate = () => setAdminActor(null);
    window.addEventListener('hogulink-session-invalid', invalidate);
    api<Actor>('auth/session')
      .then((a) => {
        if (!canceled) setAdminActor(a);
      })
      .catch(() => {
        if (!canceled) setAdminActor(null);
      });
    return () => {
      canceled = true;
      window.removeEventListener('hogulink-session-invalid', invalidate);
    };
  }, [path]);
  if (
    /\/(therapists|shops|book|checkout|discover)\//.test(path) ||
    /\/admin\/(login|activate)/.test(path) ||
    /\/onboarding(\/|$)/.test(path)
  )
    return null;
  const role = path.match(/^\/(?:ja|en|zh-cn)\/(merchant|staff|admin)(?:\/|$)/)?.[1];
  const base = `/${locale}/${role ?? 'account'}`;
  const items =
    role === 'merchant'
      ? [
          {
            href: `${base}?tab=overview`,
            label: st(locale, 'overview'),
            Icon: LayoutDashboard,
            active: path === base && (!query.get('tab') || query.get('tab') === 'overview'),
          },
          {
            href: `${base}?tab=bookings`,
            label: mt(locale, 'bookings'),
            Icon: ListChecks,
            active: path === base && query.get('tab') === 'bookings',
          },
          {
            href: `${base}?tab=schedule`,
            label: st(locale, 'schedule'),
            Icon: CalendarDays,
            active: path === base && query.get('tab') === 'schedule',
          },
          {
            href: `${base}/support`,
            label: mt(locale, 'help'),
            Icon: LifeBuoy,
            active: path.endsWith('/support'),
          },
        ]
      : role === 'staff'
        ? [
            {
              href: `${base}?tab=overview`,
              label: ft(locale, 'overview'),
              Icon: LayoutDashboard,
              active: path === base && (!query.get('tab') || query.get('tab') === 'overview'),
            },
            {
              href: `${base}?tab=tasks`,
              label: ft(locale, 'tasks'),
              Icon: ListChecks,
              active: path === base && query.get('tab') === 'tasks',
            },
            {
              href: `${base}?tab=schedule`,
              label: ft(locale, 'schedule'),
              Icon: CalendarDays,
              active: path === base && query.get('tab') === 'schedule',
            },
            {
              href: `${base}?tab=profile`,
              label: ft(locale, 'profile'),
              Icon: UserRound,
              active: path === base && query.get('tab') === 'profile',
            },
          ]
        : role === 'admin'
          ? [
              {
                href: `${base}?tab=overview`,
                label: at(locale, 'overview'),
                Icon: LayoutDashboard,
                active: path === base && (!query.get('tab') || query.get('tab') === 'overview'),
              },
              {
                href: `${base}?tab=orders`,
                label: at(locale, 'orders'),
                Icon: ListChecks,
                active: path === base && query.get('tab') === 'orders',
              },
              {
                href: `${base}?tab=review`,
                label: at(locale, 'review'),
                Icon: UserRound,
                active: path === base && query.get('tab') === 'review',
              },
              {
                href: `${base}?tab=safety`,
                label: at(locale, 'safety'),
                Icon: LifeBuoy,
                active: path === base && query.get('tab') === 'safety',
              },
            ]
          : [
              {
                href: `/${locale}`,
                label: xt(locale, 'home'),
                Icon: House,
                active: path === `/${locale}`,
              },
              {
                href: `/${locale}/discover`,
                label: xt(locale, 'discover'),
                Icon: Compass,
                active: path.startsWith(`/${locale}/discover`) || path.includes('/guides/'),
              },
              {
                href: `/${locale}/therapists`,
                label: ht(locale, 'booking'),
                Icon: CalendarDays,
                active:
                  path.startsWith(`/${locale}/therapists`) ||
                  path.startsWith(`/${locale}/services`),
              },
              {
                href: `${base}/messages`,
                label: xt(locale, 'inbox'),
                Icon: MessageCircle,
                active: path.includes('/account/messages'),
              },
              {
                href: base,
                label: ut(locale, 'mine'),
                Icon: UserRound,
                active: path.startsWith(`${base}`) && !path.includes('/account/messages'),
              },
            ];
  const visibleItems =
    role === 'admin' && adminActor?.role === 'ADMIN'
      ? items.filter((item) =>
          adminTabAllowed(
            adminActor,
            (new URL(item.href, 'http://localhost').searchParams.get('tab') ??
              'overview') as AdminTab,
          ),
        )
      : items;
  return (
    <nav
      className={`mobile-bottom-nav ${role ? '' : 'h5-bottom-nav'}`}
      style={{ gridTemplateColumns: `repeat(${visibleItems.length},minmax(0,1fr))` }}
      aria-label={
        locale === 'ja' ? 'メインメニュー' : locale === 'en' ? 'Main navigation' : '底部导航'
      }
    >
      {visibleItems.map(({ href, label, Icon, active }, index) => (
        <Link
          href={role ? href : withServiceMode(href, query.get('fulfillmentMode'))}
          key={href}
          aria-label={!role && index === 0 ? label : undefined}
          aria-current={active ? 'page' : undefined}
        >
          {role ? (
            <Icon size={21} strokeWidth={active ? 2.3 : 1.6} />
          ) : index === 2 ? (
            <strong className="h5-nav-book-word">{ht(locale, 'booking')}</strong>
          ) : index === 0 && active ? (
            <strong className="h5-nav-home-word">Hogu</strong>
          ) : (
            <Icon className="h5-nav-icon" size={22} strokeWidth={active ? 2.2 : 1.7} />
          )}
          {href === `/${locale}/account/messages` && <InboxUnreadBadge />}
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
