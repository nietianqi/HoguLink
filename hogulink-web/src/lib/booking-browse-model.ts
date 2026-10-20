import type { Locale } from '@hogulink/contracts';
import { directoryQuery } from './therapist-directory-model';
import { serviceChoices } from './consumer-model';

export type BrowseView = 'therapists' | 'shops' | 'services';
export function browseQuery(raw: Record<string, unknown>) {
  const view: BrowseView =
    raw.view === 'shops' || raw.view === 'services' ? raw.view : 'therapists';
  const q = directoryQuery(raw);
  if (view !== 'therapists') {
    if (q.sort !== 'price') q.sort = 'recommended';
    delete q.near;
  }
  // An unspecified duration means all menus for shops and services.
  if (view !== 'therapists' && !['60', '90', '120'].includes(String(raw.duration)))
    delete q.duration;
  return {
    ...q,
    view,
    ...(raw.promo === '1' ? { promo: '1' } : {}),
    ...(typeof raw.offering === 'string' ? { offering: raw.offering.slice(0, 120) } : {}),
  } as Record<string, string> & { view: BrowseView };
}
export function browseHref(l: Locale, raw: Record<string, unknown>) {
  return `/${l}/therapists?${new URLSearchParams(browseQuery(raw))}`;
}
/** Switching views carries preferences, never a selected menu, cursor or checkout state. */
export function browseTab(l: Locale, q: Record<string, string>, view: BrowseView) {
  return browseHref(l, {
    ...Object.fromEntries(
      Object.entries(q).filter(([k]) =>
        ['area', 'language', 'duration', 'mode', 'search', 'travel', 'sort', 'near'].includes(k),
      ),
    ),
    view,
  });
}
export function groupedServices(choices: ReturnType<typeof serviceChoices>, sort?: string) {
  const groups = new Map<
    string,
    {
      key: string;
      items: typeof choices;
      from: (typeof choices)[number];
      durations: number[];
      shops: number;
    }
  >();
  for (const item of choices) {
    const key = JSON.stringify(
      ['ja', 'en', 'zh-cn'].map((l) => item.offering.name[l as Locale].normalize('NFKC').trim()),
    );
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      if (item.freeTotal < group.from.freeTotal) group.from = item;
    } else groups.set(key, { key, items: [item], from: item, durations: [], shops: 0 });
  }
  const result = [...groups.values()].map((group) => ({
    ...group,
    durations: [...new Set(group.items.map((c) => c.offering.durationMinutes))].sort(
      (a, b) => a - b,
    ),
    shops: new Set(group.items.map((c) => c.store.id)).size,
  }));
  return sort === 'price'
    ? result.sort((a, b) => a.from.freeTotal - b.from.freeTotal || a.key.localeCompare(b.key))
    : result;
}
