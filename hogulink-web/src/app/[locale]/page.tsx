import Link from 'next/link';
import Image from 'next/image';
import {
  Clock3,
  CalendarDays,
  Search,
  MapPin,
  Languages,
  ArrowUpRight,
  ShieldCheck,
  ReceiptText,
  Store as StoreIcon,
  MoveRight,
  LayoutGrid,
  List,
} from 'lucide-react';
import { loadShopStats, type ShopStatsMap } from '@/lib/shop-stats';
import { shopCards, shopCardHref } from '@/lib/shop-model';
import { H5ShopSection } from '@/components/h5-shops';
import { serverApi, nominationFeeFor, type Catalog } from '@/lib/api';
import { asLocale, t, areas, areaName } from '@/lib/i18n';
import { seo } from '@/lib/seo';
import { TherapistCard } from '@/components/catalog';
import { MobileConsumerEntries } from '@/components/consumer-journey';
import { H5Home } from '@/components/h5-consumer';
import { DesktopHomeServices } from '@/components/desktop-home-services';
import { ht } from '@/lib/h5-i18n';
import { DiscoveryFilters } from '@/components/discovery-filters';
import { dt } from '@/lib/desktop-i18n';
import { japanDay, matchingOffering, nominatedTotal } from '@/lib/desktop-model';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const l = asLocale(locale);
  return seo(l, '', t(l, 'explore'), t(l, 'heroText'));
}
export default async function Home({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const l = asLocale((await params).locale);
  const raw = await searchParams;
  const q = Object.fromEntries(
    Object.entries(raw).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
  );
  const duration = [60, 90, 120].includes(Number(q.duration)) ? Number(q.duration) : 60;
  const maxTotal = [10000, 15000, 20000].includes(Number(q.maxTotal)) ? Number(q.maxTotal) : 0;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date ?? '') ? q.date : '';
  const href = (changes: Record<string, string>) =>
    `/${l}?${new URLSearchParams({ ...q, ...changes })}#discover`;
  const mode = q.mode === 'INSTANT' ? 'INSTANT' : 'SCHEDULED';
  const catalog = await serverApi<Catalog>(
    `public/staff-listings?${new URLSearchParams({ ...(q.area ? { area: q.area } : {}), ...(q.language ? { language: q.language } : {}), mode })}`,
  );
  const shopFilters = { area: q.area, language: q.language, mode, locale: l };
  const featuredShops = shopCards(catalog, shopFilters).slice(0, 3);
  const shopStatsPromise = loadShopStats(
    featuredShops.map((card) => card.store.id),
    (path) => serverApi<ShopStatsMap>(path),
  );
  const candidates = catalog.listings.flatMap((listing) => {
    const offering = matchingOffering(listing, catalog.offerings, duration);
    const store = catalog.stores.find((s) => s.id === listing.storeId)!;
    if (
      !offering ||
      (maxTotal &&
        nominatedTotal(offering, nominationFeeFor(store, catalog.bookingRules)) > maxTotal)
    )
      return [];
    if (q.acceptance === 'manual' && store.acceptanceMode !== 'MANUAL') return [];
    if (q.acceptance === 'auto' && store.acceptanceMode === 'MANUAL') return [];
    return [{ listing, offering, store }];
  });
  const availablePromise = Promise.all(
    candidates.map(async (item) => {
      let slots: number[] | undefined;
      if (mode === 'SCHEDULED') {
        try {
          slots = (
            await serverApi<{ slots: number[] }>(
              `public/staff-listings/${item.listing.id}/availability?${new URLSearchParams({ offeringId: item.offering.id, area: q.area ?? '', language: q.language ?? '' })}`,
            )
          ).slots;
        } catch {
          slots = undefined;
        }
      }
      return {
        ...item,
        slots: date && slots ? slots.filter((slot) => japanDay(slot) === date) : slots,
      };
    }),
  );
  const [available, shopStats] = await Promise.all([availablePromise, shopStatsPromise]);
  const cards = available.filter(
    (item) => mode === 'INSTANT' || !date || (item.slots?.length ?? 0) > 0,
  );
  if (q.sort === 'price')
    cards.sort(
      (a, b) =>
        nominatedTotal(a.offering, nominationFeeFor(a.store, catalog.bookingRules)) -
        nominatedTotal(b.offering, nominationFeeFor(b.store, catalog.bookingRules)),
    );
  if (q.sort === 'earliest')
    cards.sort((a, b) => (a.slots?.[0] ?? Infinity) - (b.slots?.[0] ?? Infinity));
  return (
    <main id="main" className="market-page">
      <H5Home locale={l} catalog={catalog} q={q} shopStats={shopStats} />
      <section className="hero wrap">
        <div className="hero-copy">
          <span className="eyebrow">
            <span /> {t(l, 'eyebrow')}
          </span>
          <h1>
            {ht(l, 'homeHeadline')}
            <br />
            <em>{ht(l, 'homeSubline')}</em>
          </h1>
          <p>{t(l, 'heroText')}</p>
          <a className="hero-discover" href="#discover">
            {dt(l, 'discovery')}
            <ArrowUpRight size={18} />
          </a>
          <span className="hero-location">
            <MapPin size={14} /> TOKYO, JAPAN <span>{dt(l, 'homeHotel')}</span>
          </span>
        </div>
        <div className="hero-art">
          <Image
            src="/images/h5-home-banner.png"
            alt=""
            width={2068}
            height={760}
            sizes="(max-width: 760px) 100vw, 660px"
            loading="eager"
            fetchPriority="high"
          />
          <span className="hero-image-caption">
            THE ART OF SLOWING DOWN<span>HoguLink / Tokyo</span>
          </span>
        </div>
      </section>
      <div className="search-position wrap">
        <form className="search-panel" action={`/${l}#discover`}>
          <div className="mode-tabs">
            <button className={mode === 'SCHEDULED' ? 'active' : ''} name="mode" value="SCHEDULED">
              <CalendarDays size={16} />
              {t(l, 'scheduled')}
            </button>
            <button className={mode === 'INSTANT' ? 'active' : ''} name="mode" value="INSTANT">
              <Clock3 size={16} />
              {t(l, 'instant')}
            </button>
          </div>
          <input type="hidden" name="duration" value={duration} />
          {['date', 'maxTotal', 'acceptance', 'sort', 'view'].map((key) => (
            <input type="hidden" key={key} name={key} value={q[key] ?? ''} />
          ))}
          <div className="search-fields">
            <label>
              <MapPin size={20} />
              <div>
                <span>{t(l, 'area')}</span>
                <select name="area" defaultValue={q.area ?? ''} aria-label={t(l, 'area')}>
                  <option value="">
                    {l === 'ja'
                      ? '東京都心 · 全エリア'
                      : l === 'en'
                        ? 'Central Tokyo · All areas'
                        : '东京都心 · 全部地区'}
                  </option>
                  {Object.keys(areas).map((area) => (
                    <option key={area} value={area}>
                      {areaName(l, area)}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label>
              <Languages size={20} />
              <div>
                <span>{t(l, 'language')}</span>
                <select
                  name="language"
                  defaultValue={q.language ?? ''}
                  aria-label={t(l, 'language')}
                >
                  <option value="">{t(l, 'allLanguages')}</option>
                  <option value="ja">日本語</option>
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                </select>
              </div>
            </label>
            <button className="button" name="mode" value={mode}>
              <Search size={17} />
              {t(l, 'search')}
            </button>
          </div>
        </form>
      </div>
      <MobileConsumerEntries locale={l} catalog={catalog} q={q} />
      <H5ShopSection
        locale={l}
        cards={shopCards(catalog, shopFilters, shopStats).slice(0, 3)}
        demo={catalog.demo}
        id="desktop-shops-title"
        className="desktop-home-shops wrap"
        href={(_, card) => shopCardHref(l, card, q)}
        allHref={`/${l}/discover?${new URLSearchParams({ tab: 'shops', ...Object.fromEntries(['area', 'language', 'mode'].flatMap((key) => (q[key] ? [[key, q[key]]] : []))) })}`}
      />
      <DesktopHomeServices locale={l} catalog={catalog} q={q} />
      <section className="wrap discovery" id="discover">
        <div className="section-heading">
          <div>
            <span className="eyebrow small">{dt(l, 'collection')}</span>
            <h2>{dt(l, 'curated')}</h2>
            <p>{t(l, 'subtitle')}</p>
          </div>
          <span className="result-count">
            {cards.length}
            <span>{t(l, 'results')}</span>
          </span>
        </div>
        <div className="discovery-layout">
          <DiscoveryFilters locale={l} q={q} mode={mode} duration={duration} />
          <div className="discovery-results">
            {mode === 'SCHEDULED' && available.some((item) => item.slots === undefined) && (
              <p className="notice" role="status">
                {dt(l, 'unavailable')}
              </p>
            )}
            <div className="filter-row">
              <div className="filter-pills">
                <Link className={!q.language ? 'selected' : ''} href={href({ language: '' })}>
                  {t(l, 'all')}
                </Link>
                {[
                  ['ja', '日本語'],
                  ['en', 'English'],
                  ['zh', '中文'],
                ].map(([value, label]) => (
                  <Link
                    key={value}
                    className={q.language === value ? 'selected' : ''}
                    href={href({ language: value })}
                  >
                    {label}
                  </Link>
                ))}
              </div>
              <div className="view-toggle">
                <Link
                  href={href({ view: 'grid' })}
                  aria-label={dt(l, 'grid')}
                  aria-current={q.view !== 'list' ? 'true' : undefined}
                >
                  <LayoutGrid size={18} />
                </Link>
                <Link
                  href={href({ view: 'list' })}
                  aria-label={dt(l, 'list')}
                  aria-current={q.view === 'list' ? 'true' : undefined}
                >
                  <List size={19} />
                </Link>
              </div>
            </div>
            <div className={`therapist-grid ${q.view === 'list' ? 'therapist-list' : ''}`}>
              {cards.map(({ listing, store, offering, slots }) => (
                <TherapistCard
                  key={listing.id}
                  demo={catalog.demo}
                  listing={listing}
                  store={store}
                  offering={offering}
                  slots={slots}
                  area={q.area}
                  language={q.language}
                  offerings={catalog.offerings}
                  locale={l}
                  nominationFee={catalog.bookingRules?.nominationFee}
                  mode={mode}
                />
              ))}
            </div>
            {!cards.length && (
              <div className="empty-state">
                <Search size={30} />
                <p>{t(l, 'noResults')}</p>
                <Link className="button secondary" href={`/${l}`}>
                  {t(l, 'all')}
                </Link>
              </div>
            )}
            <p className="availability-footnote">
              <Clock3 size={14} />
              {dt(l, 'availabilityNote')}
            </p>
          </div>
        </div>
      </section>
      <section className="wrap trust-section" id="safety">
        {(
          [
            [ReceiptText, 'transparent', 'transparentText'],
            [StoreIcon, 'trusted', 'trustedText'],
            [ShieldCheck, 'safeTitle', 'safeText'],
          ] as const
        ).map(([Icon, title, text], i) => (
          <div key={title}>
            <span className="trust-icon">
              <Icon size={23} />
            </span>
            <span className="tiny-number">0{i + 1}</span>
            <h3>{t(l, title)}</h3>
            <p>{t(l, text)}</p>
          </div>
        ))}
      </section>
      <section className="how-section" id="how">
        <div className="wrap">
          <div className="section-heading">
            <div>
              <span className="eyebrow small">HOW HOGULINK WORKS</span>
              <h2>{t(l, 'howTitle')}</h2>
            </div>
            <Link href={`/${l}/guides/booking-and-safety`}>
              {t(l, 'how')} <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="steps">
            {(
              [
                ['step1', 'step1Text'],
                ['step2', 'step2Text'],
                ['step3', 'step3Text'],
              ] as const
            ).map(([title, text], i) => (
              <div key={title}>
                <span>0{i + 1}</span>
                <h3>{t(l, title)}</h3>
                <p>{t(l, text)}</p>
                {i < 2 && <MoveRight size={28} />}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
