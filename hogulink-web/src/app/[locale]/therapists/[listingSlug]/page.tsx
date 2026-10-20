import { cache, Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowUpRight,
  BadgeCheck,
  Languages,
  MapPin,
  Clock3,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import type { ListingStats } from '@hogulink/contracts';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale, t, areaName, languageNames, money } from '@/lib/i18n';
import { vt, acceptanceLabel } from '@/lib/visit-i18n';
import { visitTotal, visitServices } from '@/lib/visit-model';
import { seo } from '@/lib/seo';
import { BookingPreview } from '@/components/booking-form';
import { DetailBreadcrumb, VisitNotes } from '@/components/visit-shared';
import { TherapistCard } from '@/components/catalog';
import { FavoriteToggle, PublicReviews } from '@/components/experience-ui';
import { RememberProfile } from '@/components/consumer-journey';
import { H5Badges, H5Price } from '@/components/h5-business';
import { h5Portrait } from '@/lib/h5-media';
import { ht } from '@/lib/h5-i18n';
const listingData = cache(async (slug: string) => {
  const catalog = await serverApi<Catalog>('public/staff-listings');
  const listing = catalog.listings.find((x) => x.slug === slug);
  if (!listing) notFound();
  return { catalog, listing, store: catalog.stores.find((s) => s.id === listing.storeId)! };
});
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; listingSlug: string }>;
}) {
  const p = await params,
    l = asLocale(p.locale),
    { listing } = await listingData(p.listingSlug);
  return seo(l, `/therapists/${p.listingSlug}`, listing.name[l], listing.description[l]);
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; listingSlug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = await params,
    l = asLocale(p.locale),
    { catalog, listing, store } = await listingData(p.listingSlug);
  const raw = await searchParams;
  const carry = Object.fromEntries(
    ['area', 'language', 'mode'].flatMap((key) =>
      typeof raw[key] === 'string' ? [[key, raw[key]!]] : [],
    ),
  );
  const team = catalog.listings.filter((x) => x.storeId === store.id);
  const offerings = visitServices(catalog.offerings, listing, team, 'NOMINATED');
  const nominationFee =
    store.bookingRules?.nominationFee ?? catalog.bookingRules?.nominationFee ?? 500;
  const priced = offerings.map((o) => ({ o, ...visitTotal(o, 'NOMINATED', nominationFee) }));
  const priceOf = (id: string) => {
    const { total, compareTotal, promotionEndsAt } = priced.find((x) => x.o.id === id)!;
    return { total, compareTotal, promotionEndsAt };
  };
  // Aggregated only from approved reviews, completed visits and active favorites.
  const stats: ListingStats = await serverApi<Record<string, ListingStats>>(
    `public/listing-stats?ids=${encodeURIComponent(listing.id)}`,
  )
    .then((all) => all[listing.id])
    .catch(() => undefined)
    .then((x) => x ?? { rating: null, reviewCount: 0, completed90d: 0, favorites: 0 });
  const selectedOffering = offerings.find((o) => o.id === raw.offering) ?? offerings[0];
  const instantNow =
    !!selectedOffering && listing.onDuty && store.acceptanceMode !== 'MANUAL'
      ? await serverApi<{ slots: number[] }>(
          `public/staff-listings/${encodeURIComponent(listing.id)}/availability?${new URLSearchParams(
            {
              offeringId: selectedOffering.id,
              mode: 'INSTANT',
              area: carry.area ?? '',
              language: carry.language ?? '',
            },
          )}`,
        )
          .then((x) => x.slots.length > 0)
          .catch(() => false)
      : false;
  const bookHref = (offering?: string) =>
    `/${l}/book/${listing.slug}?${new URLSearchParams({ ...carry, ...(offering ? { offering } : {}) })}`;
  return (
    <main id="main" className="wrap page-section detail-page therapist-detail-page">
      <RememberProfile id={listing.id} />
      <DetailBreadcrumb locale={l} name={listing.name[l]} store={store} />
      <div className="detail-columns">
        <div className="detail-main">
          <section className="therapist-intro detail-panel" id="about">
            <div className="detail-portrait">
              <picture>
                <source media="(max-width: 760px)" srcSet={h5Portrait(listing, catalog.demo)} />
                <img
                  src={h5Portrait(listing, catalog.demo)}
                  alt={listing.name[l]}
                  width="600"
                  height="440"
                />
              </picture>
              {h5Portrait(listing, catalog.demo) !== listing.photo && (
                <span>{ht(l, 'samplePhoto')}</span>
              )}
            </div>
            <div className="therapist-about">
              <div className="therapist-identity">
                <span className="eyebrow small">THERAPIST / TOKYO</span>
                <h1>{listing.name[l]}</h1>
                <div className="profile-identity-actions">
                  <span className="detail-verified">
                    <BadgeCheck size={17} />
                    {t(l, 'verified')}
                  </span>
                  <FavoriteToggle locale={l} listingId={listing.id} />
                </div>
              </div>
              <H5Badges
                locale={l}
                promotion={priced.some((x) => x.promotionEndsAt)}
                instantNow={instantNow}
                freeTravel={offerings.some((o) => o.transportFee === 0)}
              />
              <dl className="h5-detail-stats" aria-label={ht(l, 'realStats')}>
                <div>
                  <dt>{ht(l, 'statRating')}</dt>
                  <dd>{stats.rating === null ? '—' : stats.rating.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>{ht(l, 'statReviews')}</dt>
                  <dd>{stats.reviewCount}</dd>
                </div>
                <div>
                  <dt>{ht(l, 'statCompleted')}</dt>
                  <dd>{stats.completed90d}</dd>
                </div>
                <div>
                  <dt>{ht(l, 'statFavorites')}</dt>
                  <dd>{stats.favorites}</dd>
                </div>
              </dl>
              <p className="profile-description">{listing.description[l]}</p>
              <dl className="detail-facts">
                <div>
                  <dt>
                    <Languages size={16} />
                    {t(l, 'language')}
                  </dt>
                  <dd>{listing.languages.map((x) => languageNames[x]).join(' · ')}</dd>
                </div>
                <div>
                  <dt>
                    <MapPin size={16} />
                    {t(l, 'addressType')}
                  </dt>
                  <dd>{vt(l, listing.hotelOnly ? 'hotelHelp' : 'homeHelp')}</dd>
                </div>
                <div>
                  <dt>
                    <Clock3 size={16} />
                    {t(l, 'mode')}
                  </dt>
                  <dd>{t(l, instantNow ? 'available' : 'byAppointment')}</dd>
                </div>
              </dl>
            </div>
          </section>
          <nav className="detail-anchor-nav" aria-label={t(l, 'profile')}>
            <a href="#about">{vt(l, 'about')}</a>
            <a href="#services">{vt(l, 'serviceMenu')}</a>
            <a href="#visit-info">{vt(l, 'visitInfo')}</a>
            <a href="#reserve">
              {t(l, 'book')}
              <ArrowUpRight size={14} />
            </a>
          </nav>
          <Link className="affiliated-shop detail-panel" href={`/${l}/shops/${store.slug}`}>
            <span className="affiliated-monogram">{store.name.en.slice(0, 1)}</span>
            <div>
              <small>{vt(l, 'business')}</small>
              <h3>{store.name[l]}</h3>
              <p>{store.legalName}</p>
            </div>
            <ArrowUpRight size={20} />
          </Link>
          <section className="detail-section" id="services">
            <span className="eyebrow small">THE SERVICE MENU</span>
            <h2>{vt(l, 'serviceMenu')}</h2>
            <p className="detail-muted">{vt(l, 'totalNote')}</p>
            <div className="detail-service-menu">
              {offerings.map((o) => (
                <Link key={o.id} href={bookHref(o.id)}>
                  <span className="menu-duration">
                    {o.durationMinutes}
                    <small>{t(l, 'minutes')}</small>
                  </span>
                  <div>
                    <h3>{o.name[l]}</h3>
                    <p>
                      {t(l, 'serviceFee')} {money(l, visitTotal(o, 'FREE', 0).serviceFee)} ·{' '}
                      {t(l, 'nominationFee')} {money(l, nominationFee)} · {t(l, 'transportFee')}{' '}
                      {money(l, o.transportFee)}
                    </p>
                  </div>
                  <H5Price locale={l} {...priceOf(o.id)} />
                  <ArrowRight size={17} />
                </Link>
              ))}
            </div>
          </section>
          <PublicReviews locale={l} listingId={listing.id} />
          <VisitNotes
            locale={l}
            store={store}
            hotelOnly={listing.hotelOnly}
            rules={catalog.bookingRules}
          />
          <p className="detail-nonmedical">
            <ShieldCheck size={17} />
            {t(l, 'nonMedical')}
          </p>
          <p className="h5-footnote h5-detail-footnote">{ht(l, 'realStats')}</p>
        </div>
        <aside className="detail-booking-sidebar">
          <Suspense fallback={<div className="booking-preview">{t(l, 'waiting')}</div>}>
            <BookingPreview
              locale={l}
              listing={listing}
              store={store}
              offerings={catalog.offerings}
              team={team}
              rules={catalog.bookingRules}
            />
          </Suspense>
          <Link className="sidebar-shop-link" href={`/${l}/shops/${store.slug}`}>
            {store.name[l]}
            <span>{acceptanceLabel(l, store.acceptanceMode)}</span>
            <ArrowUpRight size={15} />
          </Link>
        </aside>
      </div>
      {team.length > 1 && (
        <section className="detail-section related-team">
          <div className="section-heading">
            <div>
              <span className="eyebrow small">FROM THE SAME SHOP</span>
              <h2>{vt(l, 'team')}</h2>
            </div>
            <Link href={`/${l}/shops/${store.slug}`}>
              {store.name[l]}
              <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="therapist-grid">
            {team
              .filter((x) => x.id !== listing.id)
              .map((member) => (
                <TherapistCard
                  key={member.id}
                  demo={catalog.demo}
                  listing={member}
                  store={store}
                  offerings={catalog.offerings}
                  locale={l}
                  nominationFee={catalog.bookingRules?.nominationFee}
                />
              ))}
          </div>
        </section>
      )}
    </main>
  );
}
