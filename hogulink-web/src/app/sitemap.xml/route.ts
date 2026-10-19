import { sitemapNames } from '@/lib/sitemap';
export function GET() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapNames.map((x) => `<sitemap><loc>${base}/sitemap-${x}.xml</loc></sitemap>`).join('')}</sitemapindex>`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
}
