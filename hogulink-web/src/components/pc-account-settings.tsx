'use client';
import Link from 'next/link';
import type { Locale } from '@hogulink/contracts';
import { ArrowRight, Globe2, LockKeyhole, MapPin, ShieldCheck } from 'lucide-react';
import { H5Language } from './h5-consumer';
import { H5AccountSession } from './h5-overlays';
import { usePcLayout } from '@/lib/use-pc-layout';
import { ht } from '@/lib/h5-i18n';
import { pa } from '@/lib/pc-account-i18n';
import { useSession } from './booking-form';
import { CustomerSignIn } from './customer-signin';

const sections = ['language', 'account', 'addresses', 'privacy'] as const;
export function PcAccountSettings({ locale: l, section }: { locale: Locale; section?: string }) {
  const isPc = usePcLayout();
  const { actor, loading } = useSession();
  if (!isPc) return null;
  const selected = sections.find((x) => x === section) ?? 'language';
  const labels = {
    language: ht(l, 'language'),
    account: ht(l, 'accountAccess'),
    addresses: ht(l, 'addresses'),
    privacy: pa(l, 'privacy'),
  };
  const icons = { language: Globe2, account: LockKeyhole, addresses: MapPin, privacy: ShieldCheck };
  const Icon = icons[selected];
  return (
    <div className="pc-account-settings">
      <header className="pc-settings-heading">
        <h1>{ht(l, 'settings')}</h1>
        <p>{pa(l, 'center')}</p>
      </header>
      <div className="pc-settings-grid">
        <nav aria-label={ht(l, 'settings')}>
          {sections.map((key) => {
            const ItemIcon = icons[key];
            return (
              <Link
                key={key}
                href={`/${l}/account/settings?section=${key}`}
                aria-current={selected === key ? 'page' : undefined}
              >
                <ItemIcon size={18} />
                {labels[key]}
              </Link>
            );
          })}
        </nav>
        <section className="pc-account-card" aria-labelledby="pc-setting-title">
          <Icon size={28} className="pc-setting-icon" />
          <h2 id="pc-setting-title">{labels[selected]}</h2>
          <p>
            {pa(
              l,
              selected === 'language'
                ? 'languageHelp'
                : selected === 'account'
                  ? 'accountHelp'
                  : selected === 'addresses'
                    ? 'addressHelp'
                    : 'privacyHelp',
            )}
          </p>
          {selected === 'language' ? (
            <H5Language locale={l} />
          ) : selected === 'account' ? (
            <>
              {loading ? (
                <p role="status">{ht(l, 'loading')}</p>
              ) : actor?.role === 'CUSTOMER' ? (
                <>
                  <p>{actor.displayName || ht(l, 'member')}</p>
                  <Link className="quality-button" href={`/${l}/account/access`}>
                    {ht(l, 'accountAccess')}
                    <ArrowRight size={16} />
                  </Link>
                </>
              ) : (
                <CustomerSignIn locale={l} />
              )}
            </>
          ) : selected === 'addresses' ? (
            <Link className="quality-button" href={`/${l}/account/addresses`}>
              {pa(l, 'manage')}
              <ArrowRight size={16} />
            </Link>
          ) : (
            <div className="pc-legal-links">
              <Link href={`/${l}/legal/privacy`}>
                {ht(l, 'privacy')}
                <ArrowRight size={16} />
              </Link>
              <Link href={`/${l}/legal/terms`}>
                {ht(l, 'terms')}
                <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </section>
      </div>
      <H5AccountSession locale={l} />
    </div>
  );
}
