import { serverApi, type Catalog } from './api';
import { locales, localeMap, areas } from './i18n';
const base = () => process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
export const sitemapNames = ['therapists', 'shops', 'areas', 'services', 'guides'] as const;
export async function sitemapXml(kind: (typeof sitemapNames)[number]) {
  let paths: string[] = [];
  // Development entities must not enter a real search index.
  if (process.env.SEO_INDEXING_ENABLED === 'true') {
    const c = await serverApi<Catalog>('public/staff-listings');
    if (!c.demo) {
      paths =
        kind === 'therapists'
          ? c.listings.map((x) => `/therapists/${x.slug}`)
          : kind === 'shops'
            ? c.stores.map((x) => `/shops/${x.slug}`)
            : kind === 'areas'
              ? Object.keys(areas)
                  .filter((x) => c.stores.some((s) => s.areas.includes(x)))
                  .map((x) => `/areas/tokyo/${x}`)
              : kind === 'services'
                ? ['/services/relaxation']
                : ['/guides/booking-and-safety'];
    }
  }
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${paths.flatMap((path) => locales.map((locale) => `<url><loc>${base()}/${locale}${path}</loc>${locales.map((other) => `<xhtml:link rel="alternate" hreflang="${localeMap[other].code}" href="${base()}/${other}${path}"/>`).join('')}</url>`)).join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'no-store' } },
  );
}
