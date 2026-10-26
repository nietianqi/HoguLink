import { ModePrices } from './service-mode';
import { choiceModePrices, type browseServiceChoices } from '@/lib/consumer-model';
import Link from 'next/link';
import { ChevronRight, Languages } from 'lucide-react';
import type { ListingStats, Locale } from '@hogulink/contracts';
import type { featuredTherapists } from '@/lib/consumer-model';
import { h5Portrait } from '@/lib/h5-media';
import { languageNames, t } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { H5PortraitThumbnail } from './h5-overlays';
import { H5Price, H5Stats } from './h5-business';
import { TherapistFacts } from './therapist-facts';
import { ShopStatsNotice } from './shop-stats-notice';

export function DesktopTherapistPick({
  locale: l,
  listing,
  choice,
  demo,
  stats,
  href,
  point,
  locating,
  onLocate,
}: {
  listing: import('@hogulink/contracts').Listing;
  choice: ReturnType<typeof browseServiceChoices>[number];
} & {
  locale: Locale;
  demo: boolean;
  stats?: ListingStats;
  href: string;
  point: { lat: number; lng: number } | null;
  locating: boolean;
  onLocate: () => void;
}) {
  return (
    <article className="h5-home-therapist">
      <Link className="h5-home-therapist-image" href={href} aria-label={listing.name[l]}>
        <H5PortraitThumbnail photo={h5Portrait(listing, demo)} size={384} />
      </Link>
      <div className="h5-home-therapist-info">
        <h3>
          <Link href={href}>{listing.name[l]}</Link>
        </h3>
        <p className="h5-home-therapist-shop">{choice.store.name[l]}</p>
        <p className="h5-home-languages">
          <Languages size={14} aria-hidden="true" />
          <span className="h5-home-language-list">
            {listing.languages.map((lang, index) => (
              <span key={lang}>
                {index > 0 ? '· ' : ''}
                {languageNames[lang]}
              </span>
            ))}
          </span>
        </p>
        {stats ? (
          <H5Stats locale={l} stats={stats} compact showReviews={false} />
        ) : (
          <ShopStatsNotice locale={l} message={ht(l, 'statsUnavailable')} />
        )}
        <TherapistFacts
          locale={l}
          name={listing.name[l]}
          stats={stats}
          areas={choice.store.areas}
          point={point}
          locating={locating}
          onLocate={onLocate}
        />
        <div className="h5-home-therapist-bottom">
          <div className="h5-home-therapist-price">
            <ModePrices locale={l} prices={choiceModePrices(choice.variants, listing.id)} />
          </div>
          <Link className="h5-home-times" href={href}>
            {ht(l, 'chooseTime')}
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
