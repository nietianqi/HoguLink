import type { Listing, ListingStats, Locale, PublicStore } from '@hogulink/contracts';
import type { Catalog } from './api';
import { serviceChoices } from './consumer-model';
import type { ShopStatsMap } from './shop-stats';

export type ShopCard = {
  store: PublicStore;
  /** Published, verified members who can take at least one shown service. */
  members: Listing[];
  languages: string[];
  durations: number[];
  /** Lowest shop-arranged total (no nomination fee, travel included), at today's price. */
  fromTotal: number;
  /** The actual menu behind the from-price, including when a longer menu is cheaper. */
  fromDuration: number;
  fromOfferingId: string;
  serviceNames: string[];
  /** Regular shop-arranged total for that same menu, only when a fair comparison exists. */
  fromCompare?: number;
  fromPromotionEndsAt?: number;
  promotion: boolean;
  freeTravel: boolean;
  stats?: ListingStats;
};

export function shopCards(
  catalog: Catalog,
  filters: {
    area?: string;
    language?: string;
    mode?: string;
    search?: string;
    locale?: Locale;
  } = {},
  stats: ShopStatsMap = {},
  now = Date.now(),
): ShopCard[] {
  const choices = serviceChoices(
    catalog,
    {
      area: filters.area,
      language: filters.language,
      mode: filters.mode,
      search: filters.search,
      locale: filters.locale,
    },
    now,
  );
  return catalog.stores
    .flatMap((store) => {
      const services = choices.filter((c) => c.store.id === store.id);
      if (!services.length) return [];
      const cheapest = services.reduce((a, b) =>
        b.freeTotal < a.freeTotal || (b.freeTotal === a.freeTotal && b.offering.id < a.offering.id)
          ? b
          : a,
      );
      const members = [
        ...new Map(services.flatMap((s) => s.members).map((m) => [m.id, m])).values(),
      ].sort((a, b) => a.id.localeCompare(b.id));
      return [
        {
          store,
          members,
          languages: ['ja', 'en', 'zh'].filter((lang) =>
            members.some((m) => m.languages.includes(lang)),
          ),
          durations: [...new Set(services.map((s) => s.offering.durationMinutes))].sort(
            (a, b) => a - b,
          ),
          fromTotal: cheapest.freeTotal,
          fromDuration: cheapest.offering.durationMinutes,
          fromOfferingId: cheapest.offering.id,
          serviceNames: [...new Set(services.map((s) => s.offering.name[filters.locale ?? 'ja']))],
          fromPromotionEndsAt: cheapest.promotionEndsAt,
          fromCompare:
            cheapest.compareTotal === undefined
              ? undefined
              : cheapest.compareTotal - (cheapest.total - cheapest.freeTotal),
          promotion: services.some((s) => s.promotionEndsAt !== undefined),
          freeTravel: services.some((s) => s.offering.transportFee === 0),
          stats: stats[store.id],
        },
      ];
    })
    .sort((a, b) => a.fromTotal - b.fromTotal || a.store.id.localeCompare(b.store.id));
}

export function shopPage(cards: ShopCard[], rawPage?: string) {
  const pages = Math.max(1, Math.ceil(cards.length / 12));
  const requested = /^\d{1,7}$/.test(rawPage ?? '') ? Number(rawPage) : 1;
  const page = Math.min(pages, Math.max(1, requested));
  return { items: cards.slice((page - 1) * 12, page * 12), page, pages, total: cards.length };
}

export function shopCardHref(
  locale: Locale,
  card: ShopCard,
  preferences: { area?: string; language?: string; mode?: string } = {},
) {
  return `/${locale}/shops/${card.store.slug}?${new URLSearchParams({
    ...(preferences.area ? { area: preferences.area } : {}),
    ...(preferences.language ? { language: preferences.language } : {}),
    ...(preferences.mode === 'INSTANT' ? { mode: 'INSTANT' } : {}),
    offering: card.fromOfferingId,
    nomination: 'FREE',
  })}`;
}

/** A stable palette per shop so covers stay recognisable without a stock photo. */
export function shopTone(storeId: string) {
  let hash = 0;
  for (const ch of storeId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (['jade', 'lagoon', 'sand', 'dusk', 'moss'] as const)[hash % 5];
}

export function shopMonogram(store: Pick<PublicStore, 'name'>) {
  return (store.name.en || store.name.ja).trim().charAt(0).toUpperCase() || 'H';
}
