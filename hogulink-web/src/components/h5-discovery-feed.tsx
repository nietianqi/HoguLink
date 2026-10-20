'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronRight,
  Eye,
  ShieldCheck,
  Store,
  UserRound,
  SlidersHorizontal,
} from 'lucide-react';
import { type DiscoveryFeed, type DiscoveryPost, type Locale } from '@hogulink/contracts';
import { discoveryTabs } from '@hogulink/contracts/discovery';
import { api, ClientError } from '@/lib/api';
import { areaName, areas, languageNames, t } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { xt } from '@/lib/discovery-i18n';
import { cui } from '@/lib/customer-ui-i18n';
import { pt } from '@/lib/discovery-post-i18n';
import {
  discoveryParams,
  discoveryBrowserParams,
  postHref,
  postImage,
  type DiscoveryQuery,
} from '@/lib/discovery-feed-model';

export function DiscoveryPhoto({
  post,
  index = 0,
  alt = '',
  eager = false,
  fullWidth = false,
}: {
  post: DiscoveryPost;
  index?: number;
  alt?: string;
  eager?: boolean;
  fullWidth?: boolean;
}) {
  const photo = postImage(post, index);
  return photo.startsWith('/images/') ? (
    <Image
      src={photo}
      fill
      sizes={
        fullWidth
          ? '(max-width:760px) 100vw, 800px'
          : '(max-width:760px) 48vw, (max-width:1100px) 30vw, 300px'
      }
      loading={eager ? 'eager' : 'lazy'}
      alt={alt}
    />
  ) : (
    <img src={photo} alt={alt} />
  );
}
export function DiscoveryCard({
  post,
  l,
  q,
  eager = false,
}: {
  post: DiscoveryPost;
  l: Locale;
  q: DiscoveryQuery;
  eager?: boolean;
}) {
  const Icon =
    post.kind === 'therapist'
      ? UserRound
      : post.kind === 'shop'
        ? Store
        : post.kind === 'safety'
          ? ShieldCheck
          : BookOpen;
  return (
    <Link className={`h5-feed-card h5-feed-${post.kind}`} href={postHref(l, post, q)}>
      <div className={`h5-feed-image ${post.portrait ? 'is-portrait' : ''}`}>
        <DiscoveryPhoto post={post} eager={eager} />
        {(post.sample || post.illustration) && (
          <small>{pt(l, post.illustration ? 'illustration' : 'sample')}</small>
        )}
      </div>
      <h2>{post.title[l]}</h2>
      <div className="h5-feed-author">
        <Icon size={13} />
        <span>{post.author.name[l]}</span>
        {post.onDuty && <b>{t(l, 'available')}</b>}
        <small>
          <Eye size={11} />
          {post.stats.views}
        </small>
      </div>
    </Link>
  );
}
export function DiscoveryColumns({
  items,
  l,
  q,
}: {
  items: DiscoveryPost[];
  l: Locale;
  q: DiscoveryQuery;
}) {
  const columns: DiscoveryPost[][] = [[], []],
    heights = [0, 0];
  for (const p of items) {
    const col = heights[0] <= heights[1] ? 0 : 1;
    columns[col].push(p);
    heights[col] += p.portrait ? 318 : 208;
  }
  return (
    <div className="h5-feed-columns">
      {columns.map((column, index) => (
        <div key={index}>
          {column.map((post, cardIndex) => (
            <DiscoveryCard key={post.id} post={post} l={l} q={q} eager={cardIndex < 3} />
          ))}
        </div>
      ))}
    </div>
  );
}
export function H5DiscoveryFeed({
  locale: l,
  initial,
  q,
  lead,
}: {
  locale: Locale;
  initial: DiscoveryFeed | null;
  q: DiscoveryQuery;
  /** Server-rendered content shown above the posts, e.g. the real shop list. */
  lead?: React.ReactNode;
}) {
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(!initial),
    [filters, setFilters] = useState(false);
  const generation = useRef(0),
    inFlight = useRef(false);
  const queryKey = discoveryParams(q).toString();
  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    setData(initial);
    setError(!initial);
    setBusy(false);
    setFilters(false);
    return () => {
      generation.current++;
    };
  }, [initial, queryKey]);
  async function load(more: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    const gen = generation.current;
    try {
      const params = discoveryParams(q);
      if (more && data?.nextCursor) params.set('cursor', data.nextCursor);
      const next = await api<DiscoveryFeed>(`public/discovery?${params}`);
      if (gen === generation.current)
        setData((old) =>
          more && old
            ? {
                ...next,
                items: [
                  ...old.items,
                  ...next.items.filter((p) => !old.items.some((o) => o.id === p.id)),
                ],
              }
            : next,
        );
    } catch (e) {
      if (gen === generation.current) {
        if (e instanceof ClientError && e.code === 'INVALID_CURSOR') setData(null);
        setError(true);
      }
    } finally {
      if (gen === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="h5-discovery-feed" aria-label={xt(l, 'discover')}>
      <nav className="h5-feed-tabs" aria-label={xt(l, 'discover')}>
        {discoveryTabs.map((tab) => (
          <Link
            key={tab}
            href={`/${l}/discover?${discoveryBrowserParams({ ...q, tab })}`}
            aria-current={q.tab === tab ? 'page' : undefined}
          >
            {tab === 'shops'
              ? cui(l, 'shopStories')
              : tab === 'therapists'
                ? ht(l, 'therapists')
                : xt(l, tab)}
          </Link>
        ))}
      </nav>
      <div className="h5-feed-controls">
        <button
          aria-expanded={filters}
          aria-controls="discovery-filters"
          onClick={() => setFilters(!filters)}
        >
          <SlidersHorizontal size={15} />
          {pt(l, 'filters')}
          {(q.area || q.language || q.search) && (
            <span> · {q.area ? areaName(l, q.area) : q.search || languageNames[q.language!]}</span>
          )}
        </button>
        <Link href={`/${l}/account/favorites?type=content`}>
          {pt(l, 'saved')}
          <ChevronRight size={13} />
        </Link>
      </div>
      <form
        id="discovery-filters"
        hidden={!filters}
        className="h5-feed-filter-form"
        action={`/${l}/discover`}
      >
        <input type="hidden" name="tab" value={q.tab === 'shops' ? 'stories' : q.tab} />
        <label>
          <span>{pt(l, 'search')}</span>
          <input name="search" defaultValue={q.search ?? ''} maxLength={80} />
        </label>
        <label>
          <span>{ht(l, 'chooseArea')}</span>
          <select name="area" defaultValue={q.area ?? ''}>
            <option value="">{ht(l, 'allAreas')}</option>
            {Object.keys(areas).map((a) => (
              <option value={a} key={a}>
                {areaName(l, a)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{pt(l, 'language')}</span>
          <select name="language" defaultValue={q.language ?? ''}>
            <option value="">{pt(l, 'anyLanguage')}</option>
            {['ja', 'en', 'zh'].map((a) => (
              <option key={a} value={a}>
                {languageNames[a]}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button className="h5-primary">{pt(l, 'apply')}</button>
          <Link href={`/${l}/discover?${discoveryBrowserParams({ tab: q.tab })}`}>
            {pt(l, 'reset')}
          </Link>
        </div>
      </form>
      {lead}
      {data && <DiscoveryColumns items={data.items} l={l} q={q} />}
      {error && (
        <div className="h5-feed-feedback" role="alert">
          <p>{pt(l, 'error')}</p>
          <button className="quality-button" disabled={busy} onClick={() => void load(!!data)}>
            {pt(l, 'retry')}
          </button>
        </div>
      )}
      {data?.items.length === 0 && !error && (
        <div className="h5-empty">
          <p>{pt(l, 'empty')}</p>
          <Link href={`/${l}/discover?${discoveryBrowserParams({ tab: q.tab })}`}>
            {pt(l, 'reset')}
          </Link>
        </div>
      )}
      {data?.nextCursor && !error && (
        <button
          className="quality-button h5-load-more"
          disabled={busy}
          onClick={() => void load(true)}
        >
          {busy ? ht(l, 'loading') : pt(l, 'more')}
        </button>
      )}
      {data && data.items.length > 0 && !data.nextCursor && !error && (
        <p className="h5-footnote">{pt(l, 'end')}</p>
      )}
    </section>
  );
}
