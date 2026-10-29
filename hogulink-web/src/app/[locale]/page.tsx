import { sv } from '@/lib/service-mode-i18n';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { Clock3, CalendarDays, Search, MapPin, Languages } from 'lucide-react';
import {
  loadShopStats,
  loadListingStats,
  type ListingStatsMap,
  type ShopStatsMap,
} from '@/lib/shop-stats';
import { shopCards } from '@/lib/shop-model';
import { featuredTherapists, serviceChoices } from '@/lib/consumer-model';
import { serverApi, type Catalog } from '@/lib/api';
import { asLocale, t, areas, areaName } from '@/lib/i18n';
import { seo } from '@/lib/seo';
import { MobileConsumerEntries } from '@/components/consumer-journey';
import { H5Home } from '@/components/h5-consumer';
import { DesktopHomeServices } from '@/components/desktop-home-services';
import { ht } from '@/lib/h5-i18n';
import { visitPreferences } from '@/lib/visit-model';
import { pc } from '@/lib/pc-consumer-i18n';
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
  if (
    q.date ||
    q.maxTotal ||
    q.acceptance ||
    q.view ||
    q.sort === 'earliest' ||
    q.filters === 'advanced'
  )
    redirect(`/${l}/therapists?${new URLSearchParams({ ...q, filters: 'advanced' })}`);
  const duration = [60, 90, 120].includes(Number(q.duration)) ? Number(q.duration) : 60;
  const mode =
    q.fulfillmentMode === 'IN_STORE' ? 'SCHEDULED' : q.mode === 'INSTANT' ? 'INSTANT' : 'SCHEDULED';
  const serviceMode =
    q.fulfillmentMode === 'IN_STORE'
      ? 'IN_STORE'
      : q.fulfillmentMode === 'HOME_VISIT'
        ? 'HOME_VISIT'
        : 'ALL';
  q.mode = mode;
  const areaLabel =
    serviceMode === 'IN_STORE'
      ? pc(l, 'venueArea')
      : serviceMode === 'HOME_VISIT'
        ? t(l, 'area')
        : pc(l, 'searchArea');
  const catalog = await serverApi<Catalog>(
    `public/staff-listings?${new URLSearchParams({ ...(q.area ? { area: q.area } : {}), ...(q.language ? { language: q.language } : {}), mode, fulfillmentMode: serviceMode })}`,
  );
  const shopFilters = {
    area: q.area,
    language: q.language,
    mode,
    locale: l,
    fulfillmentMode: serviceMode,
  };
  const featuredShops = shopCards(catalog, shopFilters).slice(0, 4);
  const listingStatsPromise = loadListingStats(
    featuredTherapists(serviceChoices(catalog, shopFilters)).map(({ listing }) => listing.id),
    (path) => serverApi<ListingStatsMap>(path),
  );
  const shopStatsPromise = loadShopStats(
    featuredShops.map((card) => card.store.id),
    (path) => serverApi<ShopStatsMap>(path),
  );
  const [shopStats, listingStats] = await Promise.all([shopStatsPromise, listingStatsPromise]);
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
            <em>{serviceMode === 'IN_STORE' ? sv(l, 'IN_STORE') : pc(l, 'homeSubtitle')}</em>
          </h1>
          <p>{serviceMode === 'IN_STORE' ? sv(l, 'inStoreHelp') : pc(l, 'homeHelp')}</p>
          <span className="hero-location">
            <MapPin size={14} /> TOKYO, JAPAN <span>{pc(l, 'shopService')}</span>
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
        <form className="search-panel" action={`/${l}/therapists`}>
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
          {['fulfillmentMode'].map((key) => (
            <input type="hidden" key={key} name={key} value={q[key] ?? ''} />
          ))}
          <div className="search-fields">
            <label>
              <MapPin size={20} />
              <div>
                <span>{areaLabel}</span>
                <select name="area" defaultValue={q.area ?? ''} aria-label={areaLabel}>
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
      <DesktopHomeServices
        locale={l}
        catalog={catalog}
        q={q}
        shopStats={shopStats}
        listingStats={listingStats}
      />
      <div className="consumer-directory-link wrap" id="discover">
        <a
          className="quality-link"
          href={`/${l}/therapists?${new URLSearchParams({ ...visitPreferences(q), filters: 'advanced' })}`}
        >
          {ht(l, 'homeAdvanced')}
        </a>
      </div>
    </main>
  );
}
