import type { Locale } from '@hogulink/contracts';
import { areaName, areas, languageNames, t } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { cui } from '@/lib/customer-ui-i18n';
import { browseTab, type BrowseView } from '@/lib/booking-browse-model';
import { Button, FilterChip } from './ui';

export function BrowseNavigation({ locale: l, q }: { locale: Locale; q: Record<string, string> }) {
  return (
    <>
      <div className="ui-page-heading">
        <h1>{cui(l, 'browse')}</h1>
      </div>
      <nav className="ui-browse-tabs" aria-label={cui(l, 'browse')}>
        {(['therapists', 'shops', 'services'] as BrowseView[]).map((view) => (
          <FilterChip key={view} href={browseTab(l, q, view)} active={q.view === view}>
            {cui(l, view)}
          </FilterChip>
        ))}
      </nav>
      <form className="ui-browse-filter ui-card" action={`/${l}/therapists`}>
        <input type="hidden" name="view" value={q.view} />
        {q.view === 'therapists' && q.near && <input type="hidden" name="near" value={q.near} />}
        <label>
          {t(l, 'area')}
          <select name="area" defaultValue={q.area ?? ''}>
            <option value="">{t(l, 'all')}</option>
            {Object.keys(areas).map((a) => (
              <option key={a} value={a}>
                {areaName(l, a)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {ht(l, 'directoryDuration')}
          <select name="duration" defaultValue={q.duration ?? ''}>
            {q.view !== 'therapists' && <option value="">{t(l, 'all')}</option>}
            {[60, 90, 120].map((n) => (
              <option key={n} value={n}>
                {n} {t(l, 'minutes')}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t(l, 'language')}
          <select name="language" defaultValue={q.language ?? ''}>
            <option value="">{t(l, 'all')}</option>
            {['ja', 'en', 'zh'].map((lang) => (
              <option key={lang} value={lang}>
                {languageNames[lang]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t(l, 'mode')}
          <select name="mode" defaultValue={q.mode}>
            <option value="SCHEDULED">{t(l, 'scheduled')}</option>
            <option value="INSTANT">{t(l, 'instant')}</option>
          </select>
        </label>
        <details>
          <summary>{cui(l, 'moreFilters')}</summary>
          <div className="ui-more-fields">
            <label>
              {ht(l, 'search')}
              <input name="search" maxLength={80} defaultValue={q.search ?? ''} />
            </label>
            <label>
              {ht(l, 'directorySort')}
              <select name="sort" defaultValue={q.sort}>
                {(
                  [
                    'recommended',
                    'price',
                    ...(q.view === 'therapists'
                      ? ['earliest', 'rating', ...(q.near ? ['distance'] : [])]
                      : []),
                  ] as const
                ).map((sort) => (
                  <option key={sort} value={sort}>
                    {ht(
                      l,
                      sort === 'distance'
                        ? 'sortDistance'
                        : sort === 'rating'
                          ? 'sortRating'
                          : (sort as 'recommended' | 'price' | 'earliest'),
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {ht(l, 'travelFilter')}
              <select name="travel" defaultValue={q.travel ?? ''}>
                <option value="">{ht(l, 'anyTravel')}</option>
                <option value="free">{ht(l, 'freeTravel')}</option>
              </select>
            </label>
            {q.view === 'services' && (
              <label className="ui-checkbox">
                <input type="checkbox" name="promo" value="1" defaultChecked={q.promo === '1'} />
                {ht(l, 'promotions')}
              </label>
            )}
          </div>
        </details>
        <Button>{cui(l, 'apply')}</Button>
      </form>
    </>
  );
}
