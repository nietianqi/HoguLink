import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, CalendarDays, Heart, History, ShieldCheck } from 'lucide-react';
import type { Locale } from '@hogulink/contracts';
import type { Catalog } from '@/lib/api';
import { serviceChoices } from '@/lib/consumer-model';
import { ht } from '@/lib/h5-i18n';
import { ut } from '@/lib/consumer-i18n';
import { t } from '@/lib/i18n';
import { H5Badges, H5Price } from './h5-business';

/** Desktop uses the same public menus, photos and totals as the mobile home. */
export function DesktopHomeServices({
  locale: l,
  catalog,
  q,
}: {
  locale: Locale;
  catalog: Catalog;
  q: Record<string, string>;
}) {
  const carry = Object.fromEntries(
    ['area', 'language', 'mode'].flatMap((k) => (q[k] ? [[k, q[k]]] : [])),
  );
  const choices = serviceChoices(catalog, carry);
  const featured = [60, 90, 120].flatMap(
    (duration) => choices.find((x) => x.offering.durationMinutes === duration) ?? [],
  );
  const offer = serviceChoices(catalog, { ...carry, promotions: true })[0];
  if (offer && !featured.some((x) => x.offering.id === offer.offering.id)) featured.push(offer);
  return (
    <section className="customer-home-services wrap">
      <nav className="customer-shortcuts" aria-label={ut(l, 'utilities')}>
        {(
          [
            [CalendarDays, 'bookings', 'account/bookings'],
            [Heart, 'favorites', 'account/favorites'],
            [History, 'history', 'account/history'],
            [ShieldCheck, 'support', 'account/support'],
          ] as const
        ).map(([Icon, label, path]) => (
          <Link href={`/${l}/${path}`} key={path}>
            <Icon size={22} />
            <span>{ut(l, label)}</span>
            <ArrowUpRight size={16} />
          </Link>
        ))}
      </nav>
      <div className="section-heading">
        <div>
          <h2>{ht(l, 'projects')}</h2>
          <p>{ut(l, 'allIn')}</p>
        </div>
        <Link href={`/${l}/services?${new URLSearchParams(carry)}`}>
          {ut(l, 'allServices')}
          <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="customer-service-picks">
        {featured.map((choice) => (
          <Link
            key={choice.offering.id}
            className="customer-service-pick"
            href={`/${l}/services?${new URLSearchParams({ ...carry, offering: choice.offering.id, duration: String(choice.offering.durationMinutes) })}`}
          >
            <div className="customer-service-photo">
              <Image
                src={
                  choice.offering.durationMinutes === 120
                    ? '/images/h5-service-120.png'
                    : choice.offering.durationMinutes === 90
                      ? '/images/h5-service-90.png'
                      : '/images/h5-relaxation.png'
                }
                alt={ht(l, 'serviceIllustration')}
                fill
                sizes="(min-width:1101px) 280px, 45vw"
              />
            </div>
            <div className="customer-service-copy">
              <small>
                {choice.store.name[l]} · {choice.offering.durationMinutes} {t(l, 'minutes')}
              </small>
              <h3>{choice.offering.name[l]}</h3>
              <H5Badges
                locale={l}
                promotion={!!choice.promotionEndsAt}
                freeTravel={choice.offering.transportFee === 0}
              />
              <div>
                <H5Price
                  locale={l}
                  total={choice.total}
                  compareTotal={choice.compareTotal}
                  promotionEndsAt={choice.promotionEndsAt}
                />
                <span className="customer-pick-arrow">
                  <ArrowUpRight size={18} />
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {!featured.length && (
        <div className="customer-service-empty">
          <h3>{ht(l, 'homeNoMatches')}</h3>
          <p>{ht(l, 'homeNoMatchesHelp')}</p>
          <div>
            <Link
              className="quality-primary"
              href={`/${l}?${new URLSearchParams({ ...carry, mode: 'SCHEDULED' })}`}
            >
              {ht(l, 'scheduled')}
            </Link>
            <Link className="quality-button" href={`/${l}/therapists`}>
              {ht(l, 'allTherapists')}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
