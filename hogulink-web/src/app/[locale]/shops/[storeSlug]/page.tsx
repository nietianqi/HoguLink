import { cache, Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  MapPin,
  Languages,
  ShieldCheck,
  Clock3,
  ReceiptText,
} from 'lucide-react';
import { DEFAULT_BUSINESS_HOURS } from '@hogulink/contracts';
import { loadShopStats, type ShopStatsMap } from '@/lib/shop-stats';
import { serverApi, type Catalog } from '@/lib/api';
import {
  asLocale,
  t,
  areaName,
  money,
  languageNames,
  surchargeNote,
  areaTravelNote,
} from '@/lib/i18n';
import { vt, policyText } from '@/lib/visit-i18n';
import { sv } from '@/lib/service-mode-i18n';
import { sf } from '@/lib/storefront-i18n';
import { visitPreferences } from '@/lib/visit-model';
import { storefrontOrder, storefrontHours } from '@/lib/storefront-model';
import { choiceModePrices } from '@/lib/consumer-model';
import { seo } from '@/lib/seo';
import { DetailBreadcrumb, VisitNotes } from '@/components/visit-shared';
import { PublicReviews } from '@/components/experience-ui';
import { StoreFavoriteToggle } from '@/components/engagement-ui';
import { BookingPreview } from '@/components/booking-form';
import { ShopTeam } from '@/components/shop-team';
import { shopVisitContext } from '@/lib/discovery-model';
import { shopCards } from '@/lib/shop-model';
import { ht } from '@/lib/h5-i18n';
import { ModePrices, VenueInfo } from '@/components/service-mode';
import { ShopArtwork, ShopGallery, ShopShare, ShopBookingDock } from '@/components/shop-brand';
const shopData = cache(async (slug: string) => {
  const catalog = await serverApi<Catalog>('public/staff-listings?fulfillmentMode=ALL');
  const store = catalog.stores.find((s) => s.slug === slug);
  if (!store) notFound();
  return { catalog, store };
});
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; storeSlug: string }>;
}) {
  const p = await params,
    l = asLocale(p.locale),
    { store } = await shopData(p.storeSlug);
  return seo(
    l,
    '/shops/' + p.storeSlug,
    store.name[l],
    store.storefront?.tagline[l] || store.description?.[l] || store.legalName,
  );
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; storeSlug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = await params,
    l = asLocale(p.locale),
    { catalog, store: s } = await shopData(p.storeSlug),
    q = await searchParams;
  const profile = s.storefront,
    team = storefrontOrder(
      catalog.listings.filter((x) => x.storeId === s.id),
      profile?.teamListingIds,
    );
  const context = shopVisitContext(catalog, s.id, {
    fulfillmentMode: 'ALL',
    area: q.area,
    language: q.language,
    mode: 'SCHEDULED',
  });
  context.carry = { ...context.carry, ...visitPreferences(q) };
  const selectedOrder = profile?.featuredOfferingIds ?? [];
  const rank = (ids: string[]) =>
    Math.min(
      selectedOrder.length,
      ...ids.map((id) => {
        const i = selectedOrder.indexOf(id);
        return i < 0 ? selectedOrder.length : i;
      }),
    );
  const services = [...context.services].sort(
    (a, b) =>
      rank(a.variants.map((v) => v.offering.id)) - rank(b.variants.map((v) => v.offering.id)),
  );
  const stats = (await loadShopStats([s.id], (path) => serverApi<ShopStatsMap>(path)))[s.id];
  const shop = shopCards(catalog, { ...context.carry, mode: 'SCHEDULED', locale: l }).find(
    (c) => c.store.id === s.id,
  );
  const languages = [...new Set(team.flatMap((x) => x.languages))],
    hours = s.bookingRules?.businessHours ?? DEFAULT_BUSINESS_HOURS;

  const home = s.homeVisitsEnabled !== false,
    venue = s.venue,
    booking = context.members[0];
  const policy = s.bookingRules?.cancellationPolicy ?? catalog.bookingRules?.cancellationPolicy;
  return (
    <main id="main" className="wrap page-section detail-page shop-detail-page storefront-page">
      <DetailBreadcrumb locale={l} name={s.name[l]} preferences={context.carry} />
      <section className="storefront-hero">
        <ShopArtwork locale={l} name={s.name[l]} profile={profile} demo={catalog.demo} />
        <div className="storefront-identity">
          <div className="storefront-title">
            <h1>{s.name[l]}</h1>
            <span className="storefront-reviewed">
              <ShieldCheck size={14} />
              {ht(l, 'shopReviewed')}
            </span>
          </div>
          <p className="storefront-tagline">
            {profile?.tagline[l] ||
              s.description?.[l] ||
              shop?.serviceNames.slice(0, 2).join(' · ')}
          </p>
          <div className="storefront-meta">
            {home && <span>{sv(l, 'HOME_VISIT')}</span>}
            {venue && <span>{sv(l, 'IN_STORE')}</span>}
            <span>
              <MapPin size={14} />
              {venue ? venue.address : s.areas.map((a) => areaName(l, a)).join(' · ')}
            </span>
            {languages.length > 0 && (
              <span>
                <Languages size={14} />
                {languages.map((x) => languageNames[x] ?? x).join(' · ')}
              </span>
            )}
          </div>
          {stats ? (
            <dl className="storefront-facts">
              <div>
                <dt>{sf(l, 'reviews')}</dt>
                <dd>
                  {stats.rating === null
                    ? sf(l, 'noReviews')
                    : `${stats.rating.toFixed(1)} · ${stats.reviewCount}`}
                </dd>
              </div>
              <div>
                <dt>{sf(l, 'completed')}</dt>
                <dd>{stats.completed90d}</dd>
              </div>
              <div>
                <dt>{sf(l, 'favorites')}</dt>
                <dd>{stats.favorites}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">
              {l === 'zh-cn'
                ? '店铺数据暂时无法读取'
                : l === 'ja'
                  ? '店舗データを取得できませんでした'
                  : 'Shop statistics unavailable'}
            </p>
          )}
          <div className="storefront-hero-bottom">
            <div className="storefront-start-price">
              <small>{sf(l, 'arranged')}</small>
              <ModePrices locale={l} prices={shop?.modePrices ?? []} />
              <small>{ht(l, 'shopFees')}</small>
            </div>
            <div className="storefront-actions">
              <a className="button" href={booking ? '#reserve' : '#services'}>
                {sf(l, 'book')}
                <ArrowRight size={16} />
              </a>
              <StoreFavoriteToggle locale={l} storeId={s.id} />
              <ShopShare locale={l} name={s.name[l]} />
            </div>
          </div>
        </div>
      </section>
      <div className="storefront-keyfacts">
        {(home || venue) && (
          <div>
            <Clock3 size={18} />
            <span>
              {home && (
                <>
                  <small>{sf(l, 'reception')} · JST</small>
                  <strong>{storefrontHours(hours, l)}</strong>
                </>
              )}
              {venue && (
                <>
                  <small>{sf(l, 'venueHours')} · JST</small>
                  <strong>{storefrontHours(venue.businessHours, l)}</strong>
                </>
              )}
            </span>
          </div>
        )}
        <div>
          <ShieldCheck size={18} />
          <span>
            <small>{sf(l, 'confirmation')}</small>
            <strong>
              {sf(l, s.acceptanceMode === 'AUTO_PREAUTHORIZED' ? 'automatic' : 'manual')}
            </strong>
          </span>
        </div>
        <div>
          <ReceiptText size={18} />
          <span>
            <small>{sf(l, 'nomination')}</small>
            <strong>{sf(l, 'free')}</strong>
            {home && (
              <small>
                {sv(l, 'HOME_VISIT')} ·{' '}
                {money(
                  l,
                  s.bookingRules?.nominationFee ?? catalog.bookingRules?.nominationFee ?? 500,
                )}
              </small>
            )}
            {venue && (
              <small>
                {sv(l, 'IN_STORE')} · {money(l, venue.nominationFee)}
              </small>
            )}
          </span>
        </div>
        <a href="#visit-info">
          <ArrowUpRight size={18} />
          <span>
            <small>{sf(l, 'policy')}</small>
            <strong>{sf(l, 'readPolicy')}</strong>
          </span>
        </a>
      </div>
      <nav className="detail-anchor-nav storefront-nav" aria-label={sf(l, 'title')}>
        <a href="#services">{vt(l, 'serviceMenu')}</a>
        <a href="#team">{sf(l, 'team')}</a>
        {booking && <a href="#reserve">{t(l, 'book')}</a>}
        <a href="#reviews">{sf(l, 'reviews')}</a>
        <a href="#about">{sf(l, 'about')}</a>
        <a href="#visit-info">{vt(l, 'visitInfo')}</a>
      </nav>
      <div className="storefront-layout">
        <section id="services" className="storefront-section">
          <h2>{vt(l, 'serviceMenu')}</h2>
          <p className="storefront-section-help">{sf(l, 'priceHelp')}</p>
          <div className="storefront-menu">
            {!services.length && (
              <p className="notice">
                {vt(l, 'noService')}{' '}
                <Link href={'/' + l + '/shops/' + s.slug}>
                  {l === 'zh-cn' ? '清除筛选' : l === 'ja' ? '条件を解除' : 'Clear filters'}
                </Link>
              </p>
            )}
            {services.map((c) => {
              const o = c.offering,
                representative = c.members[0];
              if (!representative) return null;
              return (
                <Link
                  key={o.id}
                  className="storefront-menu-item"
                  href={
                    '/' +
                    l +
                    '/book/' +
                    representative.slug +
                    '?' +
                    new URLSearchParams({ ...context.carry, nomination: 'FREE', offering: o.id })
                  }
                >
                  <span className="storefront-duration">
                    <strong>{o.durationMinutes}</strong>
                    <small>{t(l, 'minutes')}</small>
                  </span>
                  <div className="storefront-menu-copy">
                    <h3>{o.name[l]}</h3>
                    <ModePrices locale={l} prices={choiceModePrices(c.variants, undefined, true)} />
                  </div>
                  <ArrowRight size={18} />
                </Link>
              );
            })}
          </div>
        </section>
        <section id="team" className="storefront-section">
          <h2>{sf(l, 'team')}</h2>
          <p className="storefront-section-help">{sf(l, 'teamHelp')}</p>
          <ShopTeam
            demo={catalog.demo}
            locale={l}
            store={s}
            listings={team}
            offerings={catalog.offerings}
            nominationFee={catalog.bookingRules?.nominationFee}
            initialLanguage={context.carry.language}
            area={context.carry.area}
            mode="SCHEDULED"
          />
          {booking && (
            <a className="storefront-arranged" href="#reserve">
              {sf(l, 'arranged')}
              <ArrowRight size={16} />
            </a>
          )}
        </section>
        <aside className="storefront-reserve">
          {booking ? (
            <Suspense fallback={<p>{t(l, 'waiting')}</p>}>
              <BookingPreview
                demo={catalog.demo}
                locale={l}
                listing={booking}
                store={s}
                offerings={catalog.offerings.filter((o) => o.storeId === s.id)}
                team={catalog.listings.filter((x) => x.storeId === s.id)}
                rules={catalog.bookingRules}
                defaultNomination="FREE"
                dock={false}
              />
            </Suspense>
          ) : (
            <p className="notice">{vt(l, 'noService')}</p>
          )}
          <Link className="sidebar-shop-link" href={'/' + l + '/guides/booking-and-safety'}>
            {t(l, 'safety')}
            <ArrowUpRight size={15} />
          </Link>
        </aside>
        <section id="reviews" className="storefront-section">
          <PublicReviews locale={l} storeId={s.id} />
        </section>
        <section id="about" className="storefront-section">
          <h2>{sf(l, 'about')}</h2>
          <p className="storefront-prose">
            {profile?.about[l] || s.description?.[l] || sf(l, 'noAbout')}
          </p>
          {!venue && home && (
            <p className="storefront-location-note">
              <MapPin size={16} />
              {sf(l, 'brandOnly')}
            </p>
          )}
          <ShopGallery locale={l} name={s.name[l]} photos={profile?.photos ?? []} />
        </section>
        <div className="storefront-section storefront-guidance">
          <VisitNotes locale={l} store={s} rules={catalog.bookingRules} />
          {venue && <VenueInfo locale={l} venue={venue} />}
          <details className="storefront-policy">
            <summary>{sf(l, 'policy')}</summary>
            {home && (
              <>
                <h3>{sv(l, 'HOME_VISIT')}</h3>
                {policy && <p>{policyText(l, policy)}</p>}
                {!!s.bookingRules?.timeSurcharges?.length && (
                  <p>{surchargeNote(l, s.bookingRules.timeSurcharges)}</p>
                )}
                {s.bookingRules?.areaTransportFees && (
                  <p>{areaTravelNote(l, s.bookingRules.areaTransportFees, s.areas)}</p>
                )}
              </>
            )}
            {venue && (
              <>
                <h3>{sv(l, 'IN_STORE')}</h3>
                {(venue.cancellationPolicy ?? policy) && (
                  <p>
                    {policyText(
                      l,
                      { ...(venue.cancellationPolicy ?? policy)!, noShow: undefined },
                      'SCHEDULED',
                    )}
                  </p>
                )}
              </>
            )}
          </details>
        </div>
        <section id="business-info" className="storefront-section">
          <details className="business-disclosure">
            <summary>
              {t(l, 'legal')} · 特定商取引法に基づく表記 <ArrowUpRight size={15} />
            </summary>
            <dl>
              <div>
                <dt>{t(l, 'shopProvider')}</dt>
                <dd>{s.legalName}</dd>
              </div>
              <div>
                <dt>{t(l, 'address')}</dt>
                <dd>{s.legalAddress}</dd>
              </div>
              <div>
                <dt>{t(l, 'support')}</dt>
                <dd>{s.contact}</dd>
              </div>
              <div>
                <dt>{t(l, 'coverage')}</dt>
                <dd>{s.areas.map((a) => areaName(l, a)).join(' / ')}</dd>
              </div>
              <div>
                <dt>{t(l, 'payment')}</dt>
                <dd>{t(l, 'payExplain')}</dd>
              </div>
              <div>
                <dt>{t(l, 'policy')}</dt>
                <dd>
                  <Link href={'/' + l + '/guides/terms'}>{vt(l, 'policyLink')} ↗</Link>
                </dd>
              </div>
            </dl>
            {catalog.demo && <p className="detail-muted">{vt(l, 'demoLegal')}</p>}
          </details>
          <p className="detail-nonmedical">
            <ShieldCheck size={17} />
            {t(l, 'nonMedical')}
          </p>
          <p className="h5-footnote">{ht(l, 'shopStatsNote')}</p>
        </section>
      </div>
      {booking && <ShopBookingDock locale={l} name={s.name[l]} />}
    </main>
  );
}
