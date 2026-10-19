import type { Metadata } from 'next';
import type { Locale } from '@hogulink/contracts';
import { locales, localeMap } from './i18n';
export function seo(
  locale: Locale,
  path: string,
  title: string,
  description: string,
  _index = true,
): Metadata {
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}${path}`,
      languages: Object.fromEntries([
        ...locales.map((l) => [localeMap[l].code, `/${l}${path}`]),
        ['x-default', `/ja${path}`],
      ]),
    },
    robots: { index: false, follow: false },
  };
}
