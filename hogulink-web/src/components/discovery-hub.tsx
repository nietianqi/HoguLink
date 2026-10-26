import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, BookOpen, MapPin, Store, UsersRound } from 'lucide-react';
import type { Locale } from '@hogulink/contracts';
import type { DiscoveryFeed } from '@hogulink/contracts';
import { discoveryCarry, discoveryParams, discoveryQuery } from '@/lib/discovery-feed-model';
import type { Catalog } from '@/lib/api';
import { areaName, areas, languageNames, money } from '@/lib/i18n';
import { xt } from '@/lib/discovery-i18n';
import { discoveryArticles } from '@/lib/discovery-content';
import { shopChoices } from '@/lib/discovery-model';
import { acceptanceLabel } from '@/lib/visit-i18n';
import { H5DiscoveryFeed } from './h5-discovery-feed';
import { H5ShopList } from './h5-shops';
import { shopCards, shopPage, shopCardHref } from '@/lib/shop-model';
import type { ShopStatsMap } from '@/lib/shop-stats';
import { ModePrices } from './service-mode';
import { choiceModePrices } from '@/lib/consumer-model';
import { sv } from '@/lib/service-mode-i18n';

export function DiscoveryHub({
  locale: l,
  catalog,
  q,
  feed,
  shopStats = {},
}: {
  locale: Locale;
  catalog: Catalog;
  q: Record<string, string>;
  feed: DiscoveryFeed | null;
  shopStats?: ShopStatsMap;
}) {
  const tabs = ['recommended', 'shops', 'guides', 'safety'] as const;
  const tab = tabs.find((t) => t === q.tab) ?? 'recommended';
  const shops = shopChoices(catalog, q);
  const page = shopPage(shopCards(catalog, { ...q, locale: l }, shopStats), q.shopPage);
  const pageHref = (number: number) =>
    `/${l}/discover?${new URLSearchParams({ ...q, tab: 'shops', shopPage: String(number) })}`;
  const shopHref = (slug: string) => `/${l}/shops/${slug}?${discoveryCarry(discoveryQuery(q))}`;
  const articles = discoveryArticles.filter((a) => tab !== 'safety' || a.category === 'safety');
  const storiesContent = tab !== 'shops' && (
    <section className="discovery-stories">
      <div className="consumer-section-head">
        <h2>
          <BookOpen size={20} />
          {xt(l, tab === 'safety' ? 'safety' : 'guides')}
        </h2>
      </div>
      <div className="discovery-story-grid">
        {articles.map((a, i) => (
          <Link
            className={`discovery-story story-${i}`}
            href={`/${l}/discover/guide-${a.slug}?${new URLSearchParams(Object.fromEntries(['area', 'language', 'mode', 'fulfillmentMode', 'tab'].flatMap((k) => (q[k] ? [[k, q[k]]] : []))))}`}
            key={a.slug}
          >
            <div className="discovery-story-art">
              {i === 0 ? (
                <Image
                  src="/images/quiet-interior-v1.png"
                  width={1536}
                  height={1024}
                  alt=""
                  sizes="(max-width:760px) 100vw, 420px"
                  loading="eager"
                />
              ) : (
                <span>
                  {a.category === 'safety' ? '安心' : '余白'}
                  <small>HOGULINK / FIELD NOTES</small>
                </span>
              )}
            </div>
            <div>
              <small>{xt(l, a.category === 'safety' ? 'safety' : 'guides')}</small>
              <h3>{a.title[l]}</h3>
              <p>{a.summary[l]}</p>
              <span className="discovery-read">
                {xt(l, 'readGuide')}
                <ArrowUpRight size={16} />
              </span>
            </div>
          </Link>
        ))}
      </div>
      <p className="discovery-note">{xt(l, 'editorial')}</p>
    </section>
  );
  return (
    <main id="main" className="wrap discovery-page h5-surface" data-tab={tab}>
      <H5DiscoveryFeed
        locale={l}
        initial={feed}
        q={discoveryQuery(q)}
        lead={
          tab === 'shops' ? (
            <H5ShopList
              locale={l}
              cards={page.items}
              pagination={{
                page: page.page,
                pages: page.pages,
                previous: pageHref(page.page - 1),
                next: pageHref(page.page + 1),
              }}
              demo={catalog.demo}
              href={(_, card) => shopCardHref(l, card, q)}
            />
          ) : undefined
        }
      />
      <header className="discovery-intro">
        <span className="quality-eyebrow">HOGULINK / DISCOVER</span>
        <h1>{xt(l, 'title')}</h1>
        <p>{xt(l, 'intro')}</p>
      </header>
      <nav className="discovery-tabs" aria-label={xt(l, 'discover')}>
        {tabs.map((t) => (
          <Link
            key={t}
            aria-current={tab === t ? 'page' : undefined}
            href={`/${l}/discover?${new URLSearchParams({ ...q, tab: t })}`}
          >
            {xt(l, t)}
          </Link>
        ))}
      </nav>
      {tab === 'recommended' && storiesContent}
      {(tab === 'recommended' || tab === 'shops') && (
        <section className="discovery-shops">
          <div className="consumer-section-head">
            <h2>
              <Store size={20} />
              {xt(l, 'shops')}
            </h2>
            <small>Tokyo · {shops.length}</small>
            {tab === 'recommended' && (
              <Link
                href={`/${l}/discover?${discoveryParams({ ...discoveryQuery(q), tab: 'shops' })}`}
              >
                {xt(l, 'searchAction')}
                <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
          {tab === 'shops' && (
            <form className="discovery-search" action={`/${l}/discover`}>
              <input type="hidden" name="tab" value={tab} />
              <label>
                <span>{sv(l, 'mode')}</span>
                <select name="fulfillmentMode" defaultValue={q.fulfillmentMode ?? ''}>
                  <option value="">{l === 'zh-cn' ? '全部' : l === 'ja' ? 'すべて' : 'All'}</option>
                  <option value="HOME_VISIT">{sv(l, 'HOME_VISIT')}</option>
                  <option value="IN_STORE">{sv(l, 'IN_STORE')}</option>
                </select>
              </label>
              {discoveryQuery(q).mode && (
                <input type="hidden" name="mode" value={discoveryQuery(q).mode} />
              )}
              <label>
                <span>{xt(l, 'search')}</span>
                <input
                  name="search"
                  defaultValue={q.search ?? ''}
                  maxLength={100}
                  placeholder={xt(l, 'search')}
                />
              </label>
              <label>
                <span>{xt(l, 'allAreas')}</span>
                <select name="area" defaultValue={q.area ?? ''}>
                  <option value="">{xt(l, 'allAreas')}</option>
                  {Object.keys(areas).map((a) => (
                    <option key={a} value={a}>
                      {areaName(l, a)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>
                  {l === 'zh-cn' ? '服务语言' : l === 'ja' ? '対応言語' : 'Service language'}
                </span>
                <select name="language" defaultValue={q.language ?? ''}>
                  <option value="">
                    {l === 'zh-cn' ? '不限语言' : l === 'ja' ? '言語指定なし' : 'Any language'}
                  </option>
                  {['ja', 'en', 'zh'].map((a) => (
                    <option key={a} value={a}>
                      {languageNames[a]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="quality-primary">{xt(l, 'searchAction')}</button>
            </form>
          )}
          {shops.length === 0 && (
            <div className="quality-empty">
              <p>{xt(l, 'empty')}</p>
              <Link href={`/${l}/discover?tab=shops`}>{xt(l, 'reset')}</Link>
            </div>
          )}
          <div className="discovery-shop-grid">
            {shops.map(({ store, services, total, members }) => (
              <article className="discovery-shop" key={store.id}>
                <Link className="discovery-shop-art" href={shopHref(store.slug)}>
                  <span>{store.name.en.charAt(0)}</span>
                  <small>LOCAL CARE / TOKYO</small>
                </Link>
                <div className="discovery-shop-copy">
                  <span className="quality-eyebrow">
                    {acceptanceLabel(l, store.acceptanceMode)}
                  </span>
                  <h3>
                    <Link href={shopHref(store.slug)}>{store.name[l]}</Link>
                  </h3>
                  <p>
                    <MapPin size={14} />
                    {store.areas.map((a) => areaName(l, a)).join(' · ')}
                  </p>
                  <p>
                    <UsersRound size={14} />
                    {members} ·{' '}
                    {services
                      .map((s) => `${s.offering.durationMinutes}min`)
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .join(' / ')}
                  </p>
                  <div className="discovery-shop-price">
                    <span>
                      <ModePrices
                        locale={l}
                        prices={choiceModePrices(
                          services.flatMap((c) => c.variants),
                          undefined,
                          true,
                        )}
                      />
                    </span>
                    <Link className="quality-button" href={shopHref(store.slug)}>
                      {xt(l, 'viewShop')}
                      <ArrowUpRight size={16} />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <p className="discovery-note">{xt(l, 'priceHelp')}</p>
        </section>
      )}
      {tab !== 'recommended' && storiesContent}
    </main>
  );
}
