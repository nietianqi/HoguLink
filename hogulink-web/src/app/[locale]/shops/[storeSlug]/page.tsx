import { travelFeeFor } from '@hogulink/contracts';
import { cache, Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  MapPin,
  UsersRound,
  Clock3,
  ShieldCheck,
  ReceiptText,
} from 'lucide-react';
import { loadShopStats, type ShopStatsMap } from '@/lib/shop-stats';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale, t, areaName, money, surchargeNote, areaTravelNote } from '@/lib/i18n';
import { vt, acceptanceLabel, acceptanceHelp } from '@/lib/visit-i18n';
import { visitTotal } from '@/lib/visit-model';
import { seo } from '@/lib/seo';
import { DetailBreadcrumb, VisitNotes } from '@/components/visit-shared';
import { PublicReviews } from '@/components/experience-ui';
import { StoreFavoriteToggle } from '@/components/engagement-ui';
import { BookingPreview } from '@/components/booking-form';
import { ShopTeam } from '@/components/shop-team';
import { shopVisitContext } from '@/lib/discovery-model';
import { H5Badges, H5Price } from '@/components/h5-business';
import { H5ShopCover, ShopFacts } from '@/components/h5-shops';
import { shopCards, shopMonogram, shopTone } from '@/lib/shop-model';
import { ht } from '@/lib/h5-i18n';
const shopData = cache(async (slug: string) => {
  const catalog = await serverApi<Catalog>('public/staff-listings');
  const store = catalog.stores.find((x) => x.slug === slug);
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
  return seo(l, `/shops/${p.storeSlug}`, store.name[l], store.legalName);
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; storeSlug: string }>;
  searchParams: Promise<{ area?: string; language?: string; mode?: string }>;
}) {
  const p = await params,
    l = asLocale(p.locale),
    { catalog, store: s } = await shopData(p.storeSlug);
  const team = catalog.listings.filter((x) => x.storeId === s.id);
  const q = await searchParams;
  const context = shopVisitContext(catalog, s.id, {
    area: typeof q.area === 'string' ? q.area : undefined,
    language: typeof q.language === 'string' ? q.language : undefined,
    mode: q.mode === 'INSTANT' || q.mode === 'SCHEDULED' ? q.mode : undefined,
  });
  const offerings = context.services.map((s) => s.offering);
  // Shop-level facts from approved reviews, completed visits and shop saves only.
  const stats = (await loadShopStats([s.id], (path) => serverApi<ShopStatsMap>(path)))[s.id];
  const shop = shopCards(catalog, { ...context.carry, locale: l }).find(
    (card) => card.store.id === s.id,
  );
  const travel = (o: (typeof offerings)[number]) =>
    travelFeeFor(o, s.bookingRules, context.carry.area);
  const priced = offerings.map((o) => ({
    o,
    ...visitTotal(o, 'FREE', 0, Date.now(), 0, travel(o)),
  }));
  return (
    <main id="main" className="wrap page-section detail-page shop-detail-page">
      <DetailBreadcrumb locale={l} name={s.name[l]} preferences={context.carry} />
      <section className="shop-detail-hero">
        <H5ShopCover store={s} className="shop-hero-cover" />
        <div className="shop-hero-copy">
          <span className="eyebrow small">{ht(l, 'shopHomeVisit')}</span>
          <span className={`shop-monogram tone-${shopTone(s.id)}`}>{shopMonogram(s)}</span>
          <h1>{s.name[l]}</h1>
          <p>{s.legalName}</p>
          <p className="shop-hero-description">
            {s.description?.[l] || shop?.serviceNames.slice(0, 2).join(' · ')}
          </p>
          <div className="shop-hero-meta">
            <span>
              <UsersRound size={15} />
              {ht(l, team.length === 1 ? 'shopTeamOne' : 'shopTeam').replace(
                '{n}',
                String(team.length),
              )}
            </span>
            <span>
              <MapPin size={15} />
              {ht(l, s.areas.length === 1 ? 'shopAreaOne' : 'shopAreas').replace(
                '{n}',
                String(s.areas.length),
              )}
            </span>
            <span>
              <Clock3 size={15} />
              {acceptanceLabel(l, s.acceptanceMode)}
            </span>
          </div>
          <H5Badges
            locale={l}
            verified={ht(l, 'shopReviewed')}
            promotion={priced.some((x) => x.promotionEndsAt)}
            freeTravel={offerings.some((o) => travel(o) === 0)}
          />
          <ShopFacts locale={l} stats={stats} />
          {shop && (
            <div className="shop-hero-price">
              <small>{ht(l, 'shopArranged')}</small>
              <H5Price
                locale={l}
                total={shop.fromTotal}
                durationMinutes={shop.fromDuration}
                compareTotal={shop.fromCompare}
              />
              <p>{ht(l, 'shopFees')}</p>
            </div>
          )}
          <div className="shop-hero-actions">
            <a
              className="button shop-primary-action"
              href={context.members[0] ? '#reserve' : '#services'}
            >
              {vt(l, context.members[0] ? 'preview' : 'serviceMenu')}
              <ArrowRight size={17} />
            </a>
            <StoreFavoriteToggle locale={l} storeId={s.id} />
          </div>
        </div>
      </section>
      <nav className="detail-anchor-nav" aria-label={vt(l, 'shopAbout')}>
        <a href="#services">{vt(l, 'serviceMenu')}</a>
        <a href="#team">{vt(l, 'team')}</a>
        <a href="#visit-info">{vt(l, 'visitInfo')}</a>
        <a href="#business-info">{t(l, 'legal')}</a>
      </nav>
      <div className="detail-columns">
        <div className="detail-main">
          <section className="shop-overview detail-panel">
            <span className="eyebrow small">YOUR LOCAL PROVIDER</span>
            <h2>{vt(l, 'shopAbout')}</h2>
            <p>{acceptanceHelp(l, s.acceptanceMode)}</p>
            <div className="shop-commitments">
              <span>
                <ReceiptText size={17} />
                {vt(l, 'freeTotalNote')}
              </span>
              <span>
                <ShieldCheck size={17} />
                {acceptanceLabel(l, s.acceptanceMode)}
              </span>
            </div>
            <p className="detail-muted">{s.areas.map((a) => areaName(l, a)).join(' · ')}</p>
          </section>
          <section className="detail-section" id="services">
            <span className="eyebrow small">THE SERVICE MENU</span>
            <h2>{vt(l, 'serviceMenu')}</h2>
            <p className="detail-muted">{vt(l, 'freeHelp')}</p>
            {!!s.bookingRules?.timeSurcharges?.length && (
              <p className="detail-muted">{surchargeNote(l, s.bookingRules.timeSurcharges)}</p>
            )}
            {!!s.bookingRules?.areaTransportFees && (
              <p className="detail-muted">
                {areaTravelNote(l, s.bookingRules.areaTransportFees, s.areas)}
              </p>
            )}
            <div className="detail-service-menu">
              {!offerings.length && (
                <p className="notice">
                  {vt(l, 'noService')} ·{' '}
                  <Link href={`/${l}/shops/${s.slug}`}>
                    {l === 'zh-cn' ? '清除筛选' : l === 'ja' ? '条件を解除' : 'Clear filters'}
                  </Link>
                </p>
              )}
              {priced.map(({ o, total, compareTotal, promotionEndsAt }) => {
                const representative = context.members.find((x) => x.offeringIds.includes(o.id))!;
                return (
                  <Link
                    key={o.id}
                    href={`/${l}/book/${representative.slug}?${new URLSearchParams({ ...context.carry, nomination: 'FREE', offering: o.id })}`}
                  >
                    <span className="menu-duration">
                      {o.durationMinutes}
                      <small>{t(l, 'minutes')}</small>
                    </span>
                    <div>
                      <h3>{o.name[l]}</h3>
                      <p>
                        {t(l, 'serviceFee')} {money(l, visitTotal(o, 'FREE', 0).serviceFee)} ·{' '}
                        {t(l, 'transportFee')} {money(l, travel(o))} · {t(l, 'nominationFee')}{' '}
                        {money(l, 0)}
                      </p>
                    </div>
                    <H5Price
                      locale={l}
                      total={total}
                      compareTotal={compareTotal}
                      promotionEndsAt={promotionEndsAt}
                    />
                    <ArrowRight size={17} />
                  </Link>
                );
              })}
            </div>
          </section>
          <section className="detail-section" id="team">
            <span className="eyebrow small">PEOPLE BEHIND YOUR VISIT</span>
            <h2>{vt(l, 'team')}</h2>
            <ShopTeam
              demo={catalog.demo}
              locale={l}
              store={s}
              listings={team}
              offerings={catalog.offerings}
              nominationFee={catalog.bookingRules?.nominationFee}
              initialLanguage={context.carry.language}
              area={context.carry.area}
              mode={context.carry.mode}
            />
          </section>
          <PublicReviews locale={l} storeId={s.id} />
          <VisitNotes locale={l} store={s} rules={catalog.bookingRules} />
          <section className="detail-section" id="business-info">
            <span className="eyebrow small">BUSINESS INFORMATION</span>
            <h2>{t(l, 'legal')}</h2>
            <div className="business-summary">
              <ShieldCheck size={20} />
              <div>
                <strong>{s.legalName}</strong>
                <p>{vt(l, 'shopLocationNote')}</p>
              </div>
            </div>
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
                  <dd>{s.contact} · DEMO</dd>
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
                    <Link href={`/${l}/guides/terms`}>{vt(l, 'policyLink')} ↗</Link>
                  </dd>
                </div>
              </dl>
              <p className="detail-muted">{vt(l, 'demoLegal')}</p>
            </details>
          </section>
          <p className="detail-nonmedical">
            <ShieldCheck size={17} />
            {t(l, 'nonMedical')}
          </p>
          <p className="h5-footnote">{ht(l, 'shopStatsNote')}</p>
        </div>
        <aside className="detail-booking-sidebar">
          {context.members[0] && (
            <Suspense fallback={<div className="booking-preview">{t(l, 'waiting')}</div>}>
              <BookingPreview
                locale={l}
                listing={context.members[0]}
                store={s}
                offerings={offerings}
                team={context.members}
                rules={catalog.bookingRules}
                defaultNomination="FREE"
              />
            </Suspense>
          )}
          <Link className="sidebar-shop-link" href={`/${l}/guides/booking-and-safety`}>
            {t(l, 'safety')}
            <span>{vt(l, 'policyLink')}</span>
            <ArrowUpRight size={15} />
          </Link>
        </aside>
      </div>
    </main>
  );
}
