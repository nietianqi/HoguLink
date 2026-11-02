import type { Locale } from '@hogulink/contracts';
import { directoryQuery } from './therapist-directory-model';

export const browseKinds = ['services', 'therapists', 'shops'] as const;
export type BrowseKind = (typeof browseKinds)[number];
const wards = ['shinjuku', 'shibuya', 'minato', 'chuo', 'taito'];
export const browseLastKey = 'hogulink-booking-tab-v1';
export const browseListKey = (kind: BrowseKind) => `hogulink-booking-list-v1:${kind}`;
export function asBrowseKind(value: unknown): BrowseKind | null {
  return browseKinds.includes(value as BrowseKind) ? (value as BrowseKind) : null;
}
export function browseKind(path: string) {
  return asBrowseKind(path.match(/^\/(?:ja|en|zh-cn)\/(services|therapists|shops)\/?$/)?.[1]);
}
/** Only shared browsing preferences cross dimensions; transaction consent never does. */
export function browsePreferences(raw: Record<string, unknown>): Record<string, string> {
  return {
    ...(typeof raw.area === 'string' && wards.includes(raw.area) ? { area: raw.area } : {}),
    ...(typeof raw.language === 'string' && ['ja', 'en', 'zh'].includes(raw.language)
      ? { language: raw.language }
      : {}),
    ...(raw.fulfillmentMode === 'HOME_VISIT' || raw.fulfillmentMode === 'IN_STORE'
      ? { fulfillmentMode: raw.fulfillmentMode }
      : {}),
    ...(raw.fulfillmentMode === 'IN_STORE'
      ? { mode: 'SCHEDULED' }
      : raw.mode === 'INSTANT' || raw.mode === 'SCHEDULED'
        ? { mode: raw.mode }
        : {}),
  };
}
function search(raw: unknown) {
  return typeof raw === 'string' ? raw.normalize('NFKC').trim().slice(0, 80) : '';
}
export function browseSource(raw: Record<string, unknown>): Record<string, string> {
  return {
    ...(asBrowseKind(raw.from) || raw.from === 'home' ? { from: raw.from as string } : {}),
    ...(asBrowseKind(raw.homeBrowse) ? { homeBrowse: raw.homeBrowse as string } : {}),
  };
}
export function shopDirectoryQuery(raw: Record<string, unknown>): Record<string, string> {
  return {
    ...browsePreferences(raw),
    ...(search(raw.search) ? { search: search(raw.search) } : {}),
    ...(raw.sort === 'name' ? { sort: 'name' } : { sort: 'price' }),
    ...(typeof raw.shopPage === 'string' && /^[1-9]\d{0,6}$/.test(raw.shopPage)
      ? { shopPage: raw.shopPage }
      : {}),
  };
}
export function serviceDirectoryQuery(raw: Record<string, unknown>): Record<string, string> {
  return {
    ...browsePreferences(raw),
    mode: raw.fulfillmentMode !== 'IN_STORE' && raw.mode === 'INSTANT' ? 'INSTANT' : 'SCHEDULED',
    ...(typeof raw.duration === 'string' && ['60', '90', '120'].includes(raw.duration)
      ? { duration: raw.duration }
      : {}),
    ...(search(raw.search) ? { search: search(raw.search) } : {}),
    ...(raw.sort === 'price' ? { sort: 'price' } : {}),
    ...(raw.promo === '1' ? { promo: '1' } : {}),
    ...(typeof raw.offering === 'string' && /^[\w-]{1,120}$/.test(raw.offering)
      ? { offering: raw.offering }
      : {}),
    ...browseSource(raw),
  };
}
/** Restorable list state is specific to each list and excludes old selections. */
export function browseListQuery(kind: BrowseKind, raw: Record<string, unknown>) {
  if (kind === 'shops') return shopDirectoryQuery(raw);
  if (kind === 'services') {
    const { offering, from, homeBrowse, ...query } = serviceDirectoryQuery(raw);
    return query;
  }
  const query = directoryQuery(raw);
  if (raw.filters === 'advanced') {
    query.filters = 'advanced';
    if (typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) query.date = raw.date;
    if (['10000', '15000', '20000'].includes(String(raw.maxTotal)))
      query.maxTotal = String(raw.maxTotal);
    if (raw.acceptance === 'auto' || raw.acceptance === 'manual') query.acceptance = raw.acceptance;
    if (raw.view === 'list' || raw.view === 'grid') query.view = raw.view;
    if (query.mode === 'INSTANT') {
      delete query.date;
      if (query.sort === 'earliest') query.sort = 'recommended';
    }
  }
  return query;
}
const href = (locale: Locale, path: string, query: Record<string, string>) => {
  const params = new URLSearchParams(query);
  return `/${locale}${path}${params.size ? `?${params}` : ''}`;
};
export const browseHref = (locale: Locale, kind: BrowseKind, raw: Record<string, unknown> = {}) =>
  href(locale, `/${kind}`, browsePreferences(raw));
export const browseListHref = (
  locale: Locale,
  kind: BrowseKind,
  raw: Record<string, unknown> = {},
) => href(locale, `/${kind}`, browseListQuery(kind, raw));
export const browseHomeHref = (
  locale: Locale,
  kind: BrowseKind,
  raw: Record<string, unknown> = {},
) => href(locale, '', { ...browsePreferences(raw), browse: kind });
export function readBrowseList(kind: BrowseKind, raw: string | null) {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? browseListQuery(kind, value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
export function browseScrollKey(path: string, raw: Record<string, unknown>) {
  const locale = path.match(/^\/(ja|en|zh-cn)(?:\/|$)/)?.[1] as Locale | undefined;
  if (!locale) return null;
  const kind = browseKind(path);
  const query = kind
    ? browseListQuery(kind, raw)
    : path === `/${locale}`
      ? {
          ...browsePreferences(raw),
          mode: browsePreferences(raw).mode ?? 'SCHEDULED',
          browse: asBrowseKind(raw.browse) ?? 'services',
        }
      : null;
  if (!query) return null;
  return `${path}?${new URLSearchParams(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)))}`;
}
