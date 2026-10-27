import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { asLocale, localeMap } from '@/lib/i18n';
import './globals.css';
import './desktop.css';
import './visit.css';
import './mobile.css';
import './merchant.css';
import './staff.css';
import './admin.css';
import './onboarding.css';
import './quality.css';
import './consumer.css';
import './discovery.css';
import './customer-flow.css';
import './coordination.css';
import './governance.css';
import './finance.css';
import './subscription.css';
import './invoicing.css';
import './reporting.css';
import './workday.css';
import './completion.css';
import './refinement.css';
import './customer-auth.css';
import './directory.css';
import './business.css';
import './shops.css';
import './h5-home.css';
import './service-mode.css';
import './therapist-media.css';
import './storefront.css';
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: '#0c1f1a',
};
export const metadata: Metadata = {
  title: { default: 'HoguLink | Your moment of calm', template: '%s | HoguLink' },
  description: 'Book a relaxation visit in Tokyo, with a trusted local shop.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const locale = asLocale(h.get('x-hogu-locale') || 'ja');
  return (
    <html lang={localeMap[locale].code} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
