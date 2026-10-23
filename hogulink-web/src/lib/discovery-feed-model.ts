import type { DiscoveryPost, DiscoveryTab, Locale } from '@hogulink/contracts';
import { discoveryTabs } from '@hogulink/contracts/discovery';
import { h5Portrait } from './h5-media';
import { visitPreferences } from './visit-model';
export type DiscoveryQuery = {
  tab: DiscoveryTab;
  area?: string;
  language?: string;
  search?: string;
  mode?: 'INSTANT' | 'SCHEDULED';
};
export function discoveryQuery(raw: Record<string, unknown>): DiscoveryQuery {
  return {
    tab: discoveryTabs.includes(raw.tab as DiscoveryTab)
      ? (raw.tab as DiscoveryTab)
      : 'recommended',
    ...(typeof raw.area === 'string' &&
    ['shinjuku', 'shibuya', 'minato', 'chuo', 'taito'].includes(raw.area)
      ? { area: raw.area }
      : {}),
    ...(typeof raw.language === 'string' && ['ja', 'en', 'zh'].includes(raw.language)
      ? { language: raw.language }
      : {}),
    ...(raw.mode === 'INSTANT' || raw.mode === 'SCHEDULED' ? { mode: raw.mode } : {}),
    ...(typeof raw.search === 'string' && raw.search.trim()
      ? { search: raw.search.normalize('NFKC').trim().slice(0, 80) }
      : {}),
  };
}
export function discoveryParams(q: DiscoveryQuery) {
  return new URLSearchParams(Object.entries(q).filter(([, v]) => !!v));
}
/** Booking mode stays in navigation URLs; editorial APIs accept content filters only. */
export function discoveryApiParams(q: DiscoveryQuery, kind: 'feed' | 'detail' = 'feed') {
  const filters =
    kind === 'detail'
      ? { area: q.area, language: q.language }
      : { tab: q.tab, area: q.area, language: q.language, search: q.search };
  return new URLSearchParams(
    Object.entries(filters).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1],
    ),
  );
}
export function discoveryCarry(q: DiscoveryQuery) {
  return new URLSearchParams(visitPreferences(q));
}
export function postImage(post: DiscoveryPost, index = 0) {
  const photo = post.images[index] ?? post.images[0];
  return post.kind === 'therapist' && index === 0
    ? h5Portrait({ slug: post.author.slug ?? '', photo }, post.sample)
    : photo;
}
export function postHref(l: Locale, post: DiscoveryPost, q: DiscoveryQuery) {
  return `/${l}/discover/${post.id}?${discoveryParams(q)}`;
}
export function authorHref(l: Locale, p: DiscoveryPost, q: DiscoveryQuery) {
  return p.author.kind === 'editor'
    ? '#more-content'
    : `/${l}/${p.author.kind === 'shop' ? 'shops' : 'therapists'}/${p.author.slug}?${discoveryCarry(q)}`;
}
export function postBookingHref(l: Locale, p: DiscoveryPost, q: DiscoveryQuery) {
  return p.author.kind === 'therapist'
    ? `/${l}/book/${p.author.slug}?${discoveryCarry(q)}`
    : p.author.kind === 'shop'
      ? `/${l}/shops/${p.author.slug}?${discoveryCarry(q)}`
      : `/${l}/therapists?${discoveryCarry(q)}`;
}
