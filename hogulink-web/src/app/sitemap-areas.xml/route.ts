import { sitemapXml } from '@/lib/sitemap';
export function GET() {
  return sitemapXml('areas');
}
