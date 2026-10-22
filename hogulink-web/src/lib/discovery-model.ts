import type { Catalog } from './api';
import { serviceChoices } from './consumer-model';
import { visitPreferences } from './visit-model';

export function shopVisitContext(
  catalog: Catalog,
  storeId: string,
  filters: { area?: string; language?: string; mode?: string } = {},
) {
  const services = serviceChoices(catalog, filters).filter((s) => s.store.id === storeId);
  const members = [
    ...new Map(services.flatMap((s) => s.members.map((m) => [m.id, m] as const))).values(),
  ];
  return {
    services,
    members,
    carry: visitPreferences(filters),
  };
}

export function shopChoices(
  catalog: Catalog,
  filters: { area?: string; search?: string; language?: string; mode?: string } = {},
) {
  const choices = serviceChoices(catalog, filters);
  return catalog.stores
    .flatMap((store) => {
      const services = choices.filter((c) => c.store.id === store.id);
      if (!services.length) return [];
      return [
        {
          store,
          services,
          total: Math.min(...services.map((s) => s.freeTotal)),
          members: new Set(services.flatMap((s) => s.members.map((m) => m.id))).size,
        },
      ];
    })
    .sort((a, b) => a.total - b.total || a.store.id.localeCompare(b.store.id));
}
