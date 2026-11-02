'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, Leaf, Store, UserRound, X } from 'lucide-react';
import type { Locale } from '@hogulink/contracts';
import { areaName, languageNames, t } from '@/lib/i18n';
import { sv } from '@/lib/service-mode-i18n';
import { bf } from '@/lib/booking-browse-i18n';
import {
  asBrowseKind,
  browseKinds,
  browseKind,
  browseHref,
  browseHomeHref,
  browseListHref,
  browseListKey,
  browseLastKey,
  browseListQuery,
  browseScrollKey,
  readBrowseList,
  type BrowseKind,
} from '@/lib/booking-browse-model';

const scrollStorage = 'hogulink-booking-scroll-v1';
const restoreStorage = 'hogulink-booking-restore-v1';
function restoreTarget(href: string) {
  try {
    const target = new URL(href, window.location.origin);
    const key = browseScrollKey(target.pathname, Object.fromEntries(target.searchParams));
    if (key) sessionStorage.setItem(restoreStorage, key);
  } catch {}
}
export function BrowseReturnLink({
  locale,
  fallback,
  q,
  home = false,
  className,
}: {
  locale: Locale;
  fallback: BrowseKind;
  q: Record<string, string>;
  home?: boolean;
  className?: string;
}) {
  const source = home || q.from === 'home' ? 'home' : (asBrowseKind(q.from) ?? fallback);
  const kind = source === 'home' ? (asBrowseKind(q.homeBrowse) ?? fallback) : source;
  const initial =
    source === 'home' ? browseHomeHref(locale, kind, q) : browseListHref(locale, kind, q);
  const [target, setTarget] = useState({ initial, href: initial });
  useEffect(() => {
    if (source === 'home') return;
    try {
      const stored = sessionStorage.getItem(browseListKey(kind));
      setTarget({
        initial,
        href: stored ? browseListHref(locale, kind, readBrowseList(kind, stored)) : initial,
      });
    } catch {}
  }, [initial, locale, kind, source]);
  const href = target.initial === initial ? target.href : initial;
  return (
    <Link
      className={className}
      href={href}
      prefetch={false}
      onClick={() => restoreTarget(href)}
      aria-label={bf(locale, source === 'home' ? 'backHome' : 'backList')}
    >
      <ChevronLeft size={22} aria-hidden="true" />
      <span>{bf(locale, source === 'home' ? 'backHome' : 'backList')}</span>
    </Link>
  );
}
export function BookingBrowseHeader({
  locale: l,
  kind,
  q,
}: {
  locale: Locale;
  kind: BrowseKind;
  q: Record<string, string>;
}) {
  const key = JSON.stringify(browseListQuery(kind, q));
  useEffect(() => {
    try {
      sessionStorage.setItem(browseListKey(kind), key);
      sessionStorage.setItem(browseLastKey, kind);
    } catch {}
  }, [key, kind]);
  return (
    <header className="booking-browse-header">
      <div className="booking-browse-heading">
        <BrowseReturnLink locale={l} fallback={kind} q={q} home className="booking-browse-back" />
        <h1>{bf(l, 'booking')}</h1>
        <select
          className="booking-browse-locale"
          aria-label="Language"
          value={l}
          onChange={(event) =>
            window.location.assign(`/${event.target.value}/${kind}?${new URLSearchParams(q)}`)
          }
        >
          <option value="zh-cn">中文</option>
          <option value="ja">日本語</option>
          <option value="en">EN</option>
        </select>
      </div>
      <nav className="booking-browse-tabs" aria-label={bf(l, 'dimensions')}>
        {browseKinds.map((item, index) => {
          const Icon = [Leaf, UserRound, Store][index];
          return (
            <Link
              key={item}
              href={item === kind ? browseListHref(l, item, q) : browseHref(l, item, q)}
              prefetch={false}
              aria-current={item === kind ? 'page' : undefined}
            >
              <Icon size={19} aria-hidden="true" />
              {bf(l, item)}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
export function BrowseFilterChips({
  locale: l,
  kind,
  q,
}: {
  locale: Locale;
  kind: BrowseKind;
  q: Record<string, string>;
}) {
  const chips: Array<[string, string]> = [];
  if (q.area) chips.push(['area', areaName(l, q.area)]);
  if (q.language) chips.push(['language', languageNames[q.language] ?? q.language]);
  if (q.fulfillmentMode === 'HOME_VISIT' || q.fulfillmentMode === 'IN_STORE')
    chips.push(['fulfillmentMode', sv(l, q.fulfillmentMode)]);
  if (q.mode === 'INSTANT') chips.push(['mode', t(l, 'instant')]);
  if (q.search) chips.push(['search', q.search]);
  if (q.date) chips.push(['date', q.date]);
  if (q.maxTotal && Number(q.maxTotal) > 0) chips.push(['maxTotal', `JPY ≤ ${q.maxTotal}`]);
  if (!chips.length) return null;
  return (
    <div className="booking-filter-chips" aria-label={bf(l, 'applied')}>
      {chips.map(([key, label]) => {
        const query = { ...q };
        delete query[key];
        delete query.shopPage;
        return (
          <Link
            key={key}
            href={browseListHref(l, kind, query)}
            prefetch={false}
            aria-label={`${bf(l, 'clear')} · ${label}`}
          >
            {label}
            <X size={12} aria-hidden="true" />
          </Link>
        );
      })}
      <Link href={`/${l}/${kind}`} prefetch={false}>
        {bf(l, 'clear')}
      </Link>
    </div>
  );
}

/** Bounded, device-only public list positions. Holds, addresses and credentials are never stored. */
export function BrowseHistoryManager() {
  const path = usePathname(),
    params = useSearchParams();
  const key = browseScrollKey(path, Object.fromEntries(params));
  const current = useRef<{ key: string | null; y: number }>({ key: null, y: 0 });
  useEffect(() => {
    const save = () => {
      const value = current.current;
      if (!value.key) return;
      try {
        const raw = JSON.parse(sessionStorage.getItem(scrollStorage) ?? '{}');
        const entries = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        entries[value.key] = { y: value.y, at: Date.now() };
        sessionStorage.setItem(
          scrollStorage,
          JSON.stringify(
            Object.fromEntries(
              Object.entries(entries)
                .sort(
                  ([, a], [, b]) =>
                    Number((b as { at: number }).at) - Number((a as { at: number }).at),
                )
                .slice(0, 16),
            ),
          ),
        );
      } catch {}
    };
    const scrolling = () => {
      current.current.y = Math.max(0, Math.min(200000, window.scrollY));
    };
    const pop = () => restoreTarget(window.location.href);
    const click = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) save();
    };
    window.addEventListener('scroll', scrolling, { passive: true });
    window.addEventListener('pagehide', save);
    window.addEventListener('popstate', pop);
    document.addEventListener('click', click, true);
    document.addEventListener('visibilitychange', save);
    return () => {
      save();
      window.removeEventListener('scroll', scrolling);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('popstate', pop);
      document.removeEventListener('click', click, true);
      document.removeEventListener('visibilitychange', save);
    };
  }, []);
  useEffect(() => {
    current.current = { key, y: window.scrollY };
    if (!key) return;
    let first = 0,
      second = 0;
    try {
      if (sessionStorage.getItem(restoreStorage) === key) {
        sessionStorage.removeItem(restoreStorage);
        const item = JSON.parse(sessionStorage.getItem(scrollStorage) ?? '{}')[key];
        if (item && Number.isFinite(item.y) && item.y >= 0 && item.y <= 200000)
          first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() =>
              window.scrollTo({ top: item.y, behavior: 'instant' }),
            );
          });
      }
    } catch {}
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [key]);
  return null;
}

export function useBookingEntry(locale: Locale, path: string, q: Record<string, string>) {
  const current = browseKind(path);
  const [last, setLast] = useState<BrowseKind>('therapists');
  useEffect(() => {
    try {
      if (current) {
        sessionStorage.setItem(browseLastKey, current);
        setLast(current);
      } else setLast(asBrowseKind(sessionStorage.getItem(browseLastKey)) ?? 'therapists');
    } catch {}
  }, [path, current]);
  return browseHref(locale, current ?? last, q);
}
