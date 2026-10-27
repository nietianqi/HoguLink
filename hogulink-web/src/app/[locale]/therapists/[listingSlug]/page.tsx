import { sv } from '@/lib/service-mode-i18n';
import { browseServiceChoices, choiceModePrices } from '@/lib/consumer-model';
import { ModePrices } from '@/components/service-mode';
import { VenueInfo } from '@/components/service-mode';
import { fulfillmentMode, travelFeeFor } from '@hogulink/contracts';
import { cache, Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowUpRight,
  BadgeCheck,
  Languages,
  MapPin,
  ShieldCheck,
  ArrowRight,
  Store,
} from 'lucide-react';
import { loadListingStats, type ListingStatsMap } from '@/lib/shop-stats';
import { ShopStatsNotice } from '@/components/shop-stats-notice';
import { serverApi, type Catalog } from '@/lib/api';
import {
  asLocale,
  t,
  areaName,
  languageNames,
  money,
  surchargeNote,
  areaTravelNote,
} from '@/lib/i18n';
import { vt, acceptanceLabel } from '@/lib/visit-i18n';
import { visitTotal, visitServices, visitPreferences } from '@/lib/visit-model';
import { seo } from '@/lib/seo';
import { BookingPreview } from '@/components/booking-form';
import { DetailBreadcrumb, VisitNotes } from '@/components/visit-shared';
import { TherapistCard } from '@/components/catalog';
import { FavoriteToggle, PublicReviews } from '@/components/experience-ui';
import { RememberProfile } from '@/components/consumer-journey';
import { H5Badges, H5Price } from '@/components/h5-business';
import { h5Portrait } from '@/lib/h5-media';
import { ht } from '@/lib/h5-i18n';
import { md } from '@/lib/media-i18n';
import { TherapistMedia } from '@/components/therapist-media';
const listingData = cache(async (slug: string) => {
  const catalog = await serverApi<Catalog>('public/staff-listings?fulfillmentMode=ALL');
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
    { catalog: allCatalog, listing, store: baseStore } = await listingData(p.listingSlug);
  const raw = await searchParams;
  const serviceMode = raw.fulfillmentMode === 'IN_STORE' ? 'IN_STORE' : 'HOME_VISIT';
  const catalog = allCatalog;
  const store = catalog.stores.find((s) => s.id === baseStore.id) ?? baseStore;
  const carry = visitPreferences(raw);
  const team = catalog.listings.filter((x) => x.storeId === store.id);
  const choices = browseServiceChoices(catalog, {
    ...carry,
    mode: 'SCHEDULED',
    fulfillmentMode: 'ALL',
  }).filter((c) => c.members.some((m) => m.id === listing.id));
  const offerings = choices.map((c) => c.offering);
  const priced = choices.map((c) => ({
    o: c.offering,
    total: c.total,
    compareTotal: c.compareTotal,
    promotionEndsAt: c.promotionEndsAt,
  }));
  const nominationFee =
    store.bookingRules?.nominationFee ?? catalog.bookingRules?.nominationFee ?? 500;
  const travel = (o: (typeof offerings)[number]) => travelFeeFor(o, store.bookingRules, carry.area);
  // Aggregated only from approved reviews, completed visits and active favorites.
  const stats = (await loadListingStats([listing.id], (path) => serverApi<ListingStatsMap>(path)))[
    listing.id
  ];
  const selectedOffering =
    choices.flatMap((c) => c.variants).find((c) => c.offering.id === raw.offering)?.offering ??
    offerings[0];
  const shopPreferences = {
    ...carry,
    ...(selectedOffering ? { offering: selectedOffering.id } : {}),
  };
  const shopHref = `/${l}/shops/${store.slug}?${new URLSearchParams(shopPreferences)}`;
  const instantNow =
    !!selectedOffering &&
    selectedOffering.fulfillmentMode !== 'IN_STORE' &&
    listing.onDuty &&
    store.acceptanceMode !== 'MANUAL'
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
  const portrait = h5Portrait(listing, catalog.demo);
  const modes = (['HOME_VISIT', 'IN_STORE'] as const).filter((mode) =>
    priced.some((x) => fulfillmentMode(x.o) === mode),
  );
  const fromTotal = priced.length ? Math.min(...priced.map((x) => x.total)) : undefined;
  return (
    <main id="main" className="wrap page-section detail-page therapist-detail-page">
      <RememberProfile id={listing.id} />
      <DetailBreadcrumb
        locale={l}
        name={listing.name[l]}
        store={store}
        preferences={shopPreferences}
      />
      <div className="detail-columns">
        <div className="detail-main">
          {/* Customer decision order: see the person, who they are, what it costs, book, then read more. */}
          <TherapistMedia
            locale={l}
            name={listing.name[l]}
            photo={portrait}
            sample={portrait !== listing.photo}
            media={listing.media}
          />
          <section className="therapist-basics detail-panel" id="about">
            <div className="therapist-identity">
              <h1>{listing.name[l]}</h1>
              <span className="detail-verified">
                <BadgeCheck size={17} />
                {t(l, 'verified')}
              </span>
            </div>
            <Link className="therapist-basics-shop" href={shopHref}>
              <Store size={15} aria-hidden="true" />
              <span>
                {store.name[l]}
                <small>{store.legalName}</small>
              </span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
            <dl className="therapist-basics-facts">
              <div>
                <dt>
                  <Languages size={15} />
                  {t(l, 'language')}
                </dt>
                <dd>{listing.languages.map((x) => languageNames[x]).join(' · ')}</dd>
              </div>
              {modes.length > 0 && (
                <div>
                  <dt>
                    <MapPin size={15} />
                    {sv(l, 'mode')}
                  </dt>
                  <dd>{modes.map((mode) => sv(l, mode)).join(' · ')}</dd>
                </div>
              )}
              <div>
                <dt>
                  <ShieldCheck size={15} />
                  {md(l, 'checks')}
                </dt>
                <dd>{md(l, 'verifiedFacts')}</dd>
              </div>
            </dl>
            <H5Badges
              locale={l}
              promotion={priced.some((x) => x.promotionEndsAt)}
              instantNow={instantNow}
              freeTravel={offerings.some((o) => travel(o) === 0)}
            />
            <dl className="h5-detail-stats" aria-label={ht(l, 'realStats')}>
              <div>
                <dt>{ht(l, 'statRating')}</dt>
                <dd>{stats?.rating == null ? '—' : stats.rating.toFixed(1)}</dd>
              </div>
              <div>
                <dt>{ht(l, 'statReviews')}</dt>
                <dd>{stats?.reviewCount ?? '—'}</dd>
              </div>
              <div>
                <dt>{ht(l, 'statCompleted')}</dt>
                <dd>{stats?.completed90d ?? '—'}</dd>
              </div>
              <div>
                <dt>{ht(l, 'statFavorites')}</dt>
                <dd>{stats?.favorites ?? '—'}</dd>
              </div>
            </dl>
            {!stats && <ShopStatsNotice locale={l} message={ht(l, 'statsUnavailable')} />}
            <div className="therapist-basics-secondary">
              <FavoriteToggle locale={l} listingId={listing.id} />
            </div>
          </section>
          <nav className="detail-anchor-nav" aria-label={t(l, 'profile')}>
            <a href="#services">{md(l, 'serviceTitle')}</a>
            <a href="#reserve">{t(l, 'book')}</a>
            <a href="#reviews">{ht(l, 'statReviews')}</a>
            <a href="#profile">{vt(l, 'about')}</a>
            <a href="#shop-info">{vt(l, 'business')}</a>
          </nav>
          <section className="detail-section" id="services">
            <span className="eyebrow small">THE SERVICE MENU</span>
            <h2>{md(l, 'serviceTitle')}</h2>
            <p className="detail-muted">{vt(l, 'totalNote')}</p>
            {!!store.bookingRules?.timeSurcharges?.length && (
              <p className="detail-muted">{surchargeNote(l, store.bookingRules.timeSurcharges)}</p>
            )}
            {!!store.bookingRules?.areaTransportFees && (
              <p className="detail-muted">
                {areaTravelNote(l, store.bookingRules.areaTransportFees, store.areas)}
              </p>
            )}
            <div className="detail-service-menu">
              {offerings.map((o) => (
                <Link key={o.id} href={bookHref(o.id)}>
                  <span className="menu-duration">
                    {o.durationMinutes}
                    <small>{t(l, 'minutes')}</small>
                  </span>
                  <div>
                    <h3>{o.name[l]}</h3>
                    <p>{sv(l, 'modeBookingIntro')}</p>
                  </div>
                  <ModePrices
                    locale={l}
                    prices={choiceModePrices(
                      choices.find((c) => c.offering.id === o.id)!.variants,
                      listing.id,
                    )}
                  />
                  <ArrowRight size={17} />
                </Link>
              ))}
            </div>
          </section>
          <div className="therapist-reviews" id="reviews">
            <PublicReviews locale={l} listingId={listing.id} />
          </div>
          <section className="detail-section therapist-profile" id="profile">
            <span className="eyebrow small">ABOUT</span>
            <h2>{md(l, 'profileTitle')}</h2>
            <p className="profile-description">{listing.description[l]}</p>
            <dl className="detail-facts">
              <div>
                <dt>
                  <MapPin size={16} />
                  {t(l, 'addressType')}
                </dt>
                <dd>{vt(l, listing.hotelOnly ? 'hotelHelp' : 'homeHelp')}</dd>
              </div>
            </dl>
          </section>
          <section className="detail-section therapist-shop" id="shop-info">
            <span className="eyebrow small">THE SHOP</span>
            <h2>{md(l, 'shopTitle')}</h2>
            <Link className="affiliated-shop detail-panel" href={shopHref}>
              <span className="affiliated-monogram">{store.name.en.slice(0, 1)}</span>
              <div>
                <small>{vt(l, 'business')}</small>
                <h3>{store.name[l]}</h3>
                <p>{store.legalName}</p>
              </div>
              <ArrowUpRight size={20} />
            </Link>
            {store.venue?.status === 'APPROVED' && store.venue.enabled && (
              <VenueInfo locale={l} venue={store.venue} />
            )}
            <VisitNotes
              inStore={serviceMode === 'IN_STORE'}
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
          </section>
        </div>
        <aside className="detail-booking-sidebar">
          <Suspense fallback={<div className="booking-preview">{t(l, 'waiting')}</div>}>
            <BookingPreview
              key={serviceMode}
              locale={l}
              listing={listing}
              store={baseStore}
              offerings={allCatalog.offerings}
              team={allCatalog.listings.filter((x) => x.storeId === store.id)}
              rules={catalog.bookingRules}
            />
          </Suspense>
          <Link className="sidebar-shop-link" href={shopHref}>
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
            <Link href={shopHref}>
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
                  area={carry.area}
                  language={carry.language}
                  mode={carry.mode}
                  nominationFee={catalog.bookingRules?.nominationFee}
                />
              ))}
          </div>
        </section>
      )}
      {/* Phones: one clear way to book; the booking panel handles mode, time and fee. */}
      <div className="therapist-reserve-bar">
        {fromTotal !== undefined && (
          <span>
            <small>{md(l, 'fromPrice')}</small>
            <strong>
              {money(l, fromTotal)}
              {l === 'ja' ? '〜' : l === 'en' ? '+' : ' 起'}
            </strong>
          </span>
        )}
        <a className="button" href="#reserve">
          {md(l, 'bookThis')}
        </a>
      </div>
    </main>
  );
}
