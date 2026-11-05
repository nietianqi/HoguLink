import Image from 'next/image';
import { ChevronDown } from 'lucide-react';
import type { Locale } from '@hogulink/contracts';
import { areas, areaName, t } from '@/lib/i18n';
import { pc } from '@/lib/pc-consumer-i18n';
import { sv } from '@/lib/service-mode-i18n';

/** A desktop entry into the existing directory; a blank mode never selects one for the customer. */
export function DesktopHomeHero({ locale: l, q }: { locale: Locale; q: Record<string, string> }) {
  const duration = [60, 90, 120].includes(Number(q.duration)) ? Number(q.duration) : 60;
  return (
    <div className="pc-home-intro">
      <section className="pc-home-hero" aria-labelledby="pc-home-title">
        <Image
          className="pc-home-hero-photo"
          src="/images/quiet-interior-v1.png"
          alt=""
          fill
          sizes="(min-width: 1101px) 100vw, 1px"
          loading="eager"
          fetchPriority="high"
        />
        <div className="pc-home-hero-shade" />
        <div className="wrap pc-home-hero-copy">
          <p className="pc-home-kicker">{pc(l, 'homeSubtitle')}</p>
          <h1 id="pc-home-title">
            {pc(l, 'heroLineOne')}
            <br />
            {pc(l, 'heroLineTwo')}
          </h1>
          <p className="pc-home-description">{pc(l, 'heroDescription')}</p>
        </div>
      </section>
      <div className="wrap pc-home-search-position">
        <form className="pc-home-search" action={`/${l}/therapists`} aria-label={pc(l, 'browse')}>
          <input type="hidden" name="mode" value="SCHEDULED" />
          {q.language && <input type="hidden" name="language" value={q.language} />}
          <label className="pc-home-search-field">
            <span>{sv(l, 'mode')}</span>
            <span className="pc-home-select">
              <select name="fulfillmentMode" defaultValue={q.fulfillmentMode ?? ''}>
                <option value="">{pc(l, 'chooseModeOptional')}</option>
                <option value="HOME_VISIT">{sv(l, 'HOME_VISIT')}</option>
                <option value="IN_STORE">{sv(l, 'IN_STORE')}</option>
              </select>
              <ChevronDown size={18} aria-hidden="true" />
            </span>
          </label>
          <label className="pc-home-search-field">
            <span>{pc(l, 'searchArea')}</span>
            <span className="pc-home-select">
              <select name="area" defaultValue={q.area ?? ''}>
                <option value="">{pc(l, 'centralTokyo')}</option>
                {Object.keys(areas).map((area) => (
                  <option key={area} value={area}>
                    {areaName(l, area)}
                  </option>
                ))}
              </select>
              <ChevronDown size={18} aria-hidden="true" />
            </span>
          </label>
          <label className="pc-home-search-field">
            <span>{pc(l, 'searchDate')}</span>
            <input type="date" name="date" defaultValue={q.date ?? ''} />
          </label>
          <label className="pc-home-search-field">
            <span>{pc(l, 'searchDuration')}</span>
            <span className="pc-home-select">
              <select name="duration" defaultValue={duration}>
                {[60, 90, 120].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} {t(l, 'minutes')}
                  </option>
                ))}
              </select>
              <ChevronDown size={18} aria-hidden="true" />
            </span>
          </label>
          <button className="pc-home-search-submit" type="submit">
            {pc(l, 'findTimes')}
          </button>
        </form>
      </div>
    </div>
  );
}
