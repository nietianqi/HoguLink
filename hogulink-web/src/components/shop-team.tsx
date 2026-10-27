'use client';
import { useState } from 'react';
import type { Listing, Locale, Offering } from '@hogulink/contracts';
import type { PublicStore } from '@/lib/api';
import { t, languageNames } from '@/lib/i18n';
import { vt } from '@/lib/visit-i18n';
import { TherapistCard } from './catalog';
export function ShopTeam({
  locale: l,
  store,
  listings,
  offerings,
  nominationFee,
  initialLanguage = '',
  area,
  mode,
  demo = false,
}: {
  locale: Locale;
  store: PublicStore;
  listings: Listing[];
  offerings: Offering[];
  nominationFee?: number;
  initialLanguage?: string;
  area?: string;
  mode?: string;
  demo?: boolean;
}) {
  const [language, setLanguage] = useState(initialLanguage);
  const languages = [...new Set(listings.flatMap((x) => x.languages))];
  const filtered = listings.filter((x) => !language || x.languages.includes(language));
  return (
    <>
      <div className="team-filter">
        <label>
          {t(l, 'language')}
          <select
            aria-label={t(l, 'language')}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="">{t(l, 'allLanguages')}</option>
            {languages.map((lang) => (
              <option value={lang} key={lang}>
                {languageNames[lang] ?? lang}
              </option>
            ))}
          </select>
        </label>
        <span aria-live="polite">
          {filtered.length} / {listings.length}
        </span>
      </div>
      <div className="shop-team-grid">
        {filtered.map((listing) => (
          <TherapistCard
            inShop
            key={listing.id}
            demo={demo}
            locale={l}
            listing={listing}
            store={store}
            offerings={offerings}
            language={language}
            area={area}
            mode={mode}
            nominationFee={nominationFee}
          />
        ))}
      </div>
      {!filtered.length && <p className="notice">{vt(l, 'noTeam')}</p>}
    </>
  );
}
