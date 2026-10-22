import Link from 'next/link';
import { ArrowLeft, Check, ShieldCheck, ReceiptText, MapPin } from 'lucide-react';
import type { Locale } from '@hogulink/contracts';
import type { PublicStore, BookingRules } from '@/lib/api';
import { t, areaName } from '@/lib/i18n';
import { vt, acceptanceHelp, policyText } from '@/lib/visit-i18n';
import { visitPreferences } from '@/lib/visit-model';
export function VisitSteps({ locale: l, step }: { locale: Locale; step: 1 | 2 | 3 }) {
  return (
    <ol className="visit-steps" aria-label={t(l, 'timeline')}>
      {(['step1', 'step2', 'step3'] as const).map((key, i) => (
        <li
          key={key}
          className={i + 1 === step ? 'current' : i + 1 < step ? 'done' : ''}
          aria-current={i + 1 === step ? 'step' : undefined}
        >
          <span>{i + 1 < step ? <Check size={14} /> : String(i + 1).padStart(2, '0')}</span>
          {vt(l, key)}
        </li>
      ))}
    </ol>
  );
}
export function DetailBreadcrumb({
  locale: l,
  name,
  store,
  preferences = {},
}: {
  locale: Locale;
  name: string;
  store?: PublicStore;
  preferences?: Record<string, string>;
}) {
  const browse = new URLSearchParams(visitPreferences(preferences)).toString();
  const shop = new URLSearchParams({
    ...visitPreferences(preferences),
    ...(preferences.offering ? { offering: preferences.offering } : {}),
  }).toString();
  return (
    <nav
      className="detail-breadcrumb"
      aria-label={l === 'en' ? 'Breadcrumb' : l === 'ja' ? 'パンくず' : '面包屑导航'}
    >
      <Link href={`/${l}${browse ? `?${browse}` : ''}#discover`}>
        <ArrowLeft size={14} />
        {t(l, 'explore')}
      </Link>
      <span>/</span>
      {store && (
        <>
          <Link href={`/${l}/shops/${store.slug}${shop ? `?${shop}` : ''}`}>{store.name[l]}</Link>
          <span>/</span>
        </>
      )}
      <span aria-current="page">{name}</span>
    </nav>
  );
}
export function VisitNotes({
  locale: l,
  store,
  hotelOnly = false,
  rules,
}: {
  locale: Locale;
  store: PublicStore;
  hotelOnly?: boolean;
  rules?: BookingRules;
}) {
  return (
    <section className="detail-section visit-notes" id="visit-info">
      <span className="eyebrow small">BEFORE YOUR VISIT</span>
      <h2>{vt(l, 'visitInfo')}</h2>
      <div className="visit-note-grid">
        <div>
          <MapPin size={21} />
          <h3>{t(l, 'coverage')}</h3>
          <p>{store.areas.map((x) => areaName(l, x)).join(' · ')}</p>
          <p>{vt(l, hotelOnly ? 'hotelHelp' : 'homeHelp')}</p>
        </div>
        <div>
          <ShieldCheck size={21} />
          <h3>{vt(l, 'business')}</h3>
          <p>{store.name[l]}</p>
          <p>{acceptanceHelp(l, store.acceptanceMode)}</p>
        </div>
        <div>
          <ReceiptText size={21} />
          <h3>{t(l, 'policy')}</h3>
          <p>
            {(store.bookingRules ?? rules)
              ? policyText(l, (store.bookingRules ?? rules)!.cancellationPolicy)
              : t(l, 'policyText')}
          </p>
          <Link href={`/${l}/guides/booking-and-safety`}>{vt(l, 'policyLink')} ↗</Link>
        </div>
      </div>
    </section>
  );
}
