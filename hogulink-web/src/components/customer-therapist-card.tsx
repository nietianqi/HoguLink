import Link from 'next/link';
import type { Locale, MobileTherapist } from '@hogulink/contracts';
import { Badge, Price, Rating } from './ui';
import { h5Portrait } from '@/lib/h5-media';
import { ht } from '@/lib/h5-i18n';
import { t } from '@/lib/i18n';
import { cui } from '@/lib/customer-ui-i18n';
import { directoryTime, therapistSelection } from '@/lib/therapist-directory-model';

export function CustomerTherapistCard({
  locale: l,
  item,
  q,
  demo,
  checkedAt,
}: {
  locale: Locale;
  item: MobileTherapist;
  q: Record<string, string>;
  demo: boolean;
  checkedAt: number;
}) {
  const { listing, offering, earliestAt } = item;
  return (
    <Link
      className="ui-therapist-card ui-card"
      href={`/${l}/${earliestAt ? 'book' : 'therapists'}/${listing.slug}?${therapistSelection(q, item)}`}
    >
      <img src={h5Portrait(listing, demo)} alt="" width={64} height={80} loading="lazy" />
      <div className="ui-therapist-copy">
        <div className="ui-card-identity">
          <h3>{listing.name[l]}</h3>
          <Badge>{demo ? ht(l, 'sample') : t(l, 'verified')}</Badge>
          {item.promotionEndsAt ? (
            <Badge offer>{ht(l, 'promoTag')}</Badge>
          ) : (
            item.badges.instantNow && <Badge>{ht(l, 'instantNow')}</Badge>
          )}
        </div>
        <div className="ui-card-facts">
          <Rating locale={l} stats={item.stats} />
          <span>{item.store.name[l]}</span>
        </div>
        <div className="ui-card-decision">
          <div>
            <Price
              locale={l}
              total={item.total}
              compareTotal={item.compareTotal}
              promotionEndsAt={item.promotionEndsAt}
              durationMinutes={offering.durationMinutes}
            />
            <small>
              {earliestAt
                ? `${ht(l, 'earliestShort')} ${directoryTime(l, earliestAt, checkedAt, ht(l, 'today'))}`
                : ht(l, 'noSlots')}
            </small>
          </div>
          <span className="ui-card-cta">{ht(l, earliestAt ? 'reserve' : 'chooseTime')}</span>
        </div>
        <span className="sr-only">{cui(l, 'fees')}</span>
      </div>
    </Link>
  );
}
