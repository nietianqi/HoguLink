import type { StorefrontContent, BusinessHours, Locale } from '@hogulink/contracts';

export function storefrontHours(h: BusinessHours, l: Locale) {
  const clock = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const next =
    h.endMinute <= h.startMinute ? (l === 'ja' ? '翌日 ' : l === 'en' ? 'next day ' : '次日 ') : '';
  return `${clock(h.startMinute)}–${next}${clock(h.endMinute)}`;
}
/** An editorial order never restores withdrawn or otherwise ineligible supply. */
export function storefrontOrder<T extends { id: string }>(items: T[], ids: string[] = []): T[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length));
}
export function storefrontChecklist(c: StorefrontContent) {
  return {
    logo: !!c.logoId,
    cover: !!c.coverId,
    gallery: c.photoIds.length >= 3,
    introduction: Object.values(c.about).every((x) => x.trim().length >= 8),
  };
}
