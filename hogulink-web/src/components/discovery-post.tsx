'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, Eye, Heart, UserRound } from 'lucide-react';
import type {
  DiscoveryDetail,
  DiscoveryPost,
  DiscoveryReaction,
  DiscoverySaved,
  DiscoveryStats,
  Locale,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { pt } from '@/lib/discovery-post-i18n';
import {
  authorHref,
  discoveryParams,
  postBookingHref,
  postHref,
  postImage,
  type DiscoveryQuery,
} from '@/lib/discovery-feed-model';
import { useSession } from './booking-form';
import { goCustomerAccess } from './customer-signin';
import { DiscoveryColumns, DiscoveryPhoto } from './h5-discovery-feed';
import { FavoriteKinds } from './engagement-ui';

function PostGallery({ post, l }: { post: DiscoveryPost; l: Locale }) {
  const track = useRef<HTMLDivElement>(null),
    [index, setIndex] = useState(0);
  const move = (next: number) => {
    const el = track.current;
    if (el)
      el.scrollTo({
        left: next * el.clientWidth,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
  };
  return (
    <section
      className={`discovery-gallery ${post.portrait ? 'is-portrait' : ''}`}
      aria-label={pt(l, 'image')}
    >
      <div
        className="discovery-gallery-track"
        ref={track}
        onScroll={(e) =>
          setIndex(
            Math.max(
              0,
              Math.min(
                post.images.length - 1,
                Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth),
              ),
            ),
          )
        }
      >
        {post.images.map((_, i) => (
          <div className="discovery-gallery-slide" key={i}>
            <DiscoveryPhoto
              post={post}
              index={i}
              alt={`${post.title[l]} · ${i + 1}`}
              eager={i === 0}
              fullWidth
            />
          </div>
        ))}
      </div>
      {post.images.length > 1 && (
        <div className="discovery-gallery-controls">
          <button
            aria-label={pt(l, 'previous')}
            disabled={index === 0}
            onClick={() => move(index - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span aria-live="polite">
            {index + 1} / {post.images.length}
          </span>
          <button
            aria-label={pt(l, 'next')}
            disabled={index === post.images.length - 1}
            onClick={() => move(index + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
      {(post.illustration || post.sample) && (
        <small className="discovery-image-note">
          {pt(l, post.illustration ? 'illustration' : 'sample')}
        </small>
      )}
    </section>
  );
}
export function DiscoveryUnavailable({
  locale: l,
  missing = false,
}: {
  locale: Locale;
  missing?: boolean;
}) {
  const router = useRouter();
  return (
    <main id="main" className="wrap consumer-page">
      <section className="quality-card">
        <h1>{pt(l, missing ? 'unavailable' : 'error')}</h1>
        {missing && <p>{pt(l, 'unavailableHelp')}</p>}
        <Link className="quality-primary" href={`/${l}/discover`}>
          {pt(l, 'back')}
        </Link>
        {!missing && (
          <button className="quality-button" onClick={() => router.refresh()}>
            {pt(l, 'retry')}
          </button>
        )}
      </section>
    </main>
  );
}
export function DiscoveryPostPage({
  locale: l,
  detail,
  q,
}: {
  locale: Locale;
  detail: DiscoveryDetail;
  q: DiscoveryQuery;
}) {
  const { actor, loading } = useSession(),
    post = detail.post,
    epoch = useRef(0);
  const [state, setState] = useState<DiscoveryReaction>({ liked: false, saved: false, version: 0 }),
    [stats, setStats] = useState(post.stats),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const signed = actor?.role === 'CUSTOMER';
  const load = useCallback(async () => {
    const gen = ++epoch.current;
    setReady(false);
    setError('');
    setBusy(false);
    if (!signed) return;
    const results = await Promise.allSettled([
      api<DiscoveryReaction>(`customer/discovery/${post.id}`),
      api<{ views: number }>(`customer/discovery/${post.id}/view`, {}),
    ]);
    if (gen !== epoch.current) return;
    if (results[0].status === 'fulfilled') {
      setState(results[0].value);
      setReady(true);
    } else setError(pt(l, 'error'));
    if (results[1].status === 'fulfilled') {
      const views = results[1].value.views;
      setStats((old) => ({ ...old, views }));
    }
  }, [actor?.id, signed, post.id, l]);
  useEffect(() => {
    setState({ liked: false, saved: false, version: 0 });
    setStats(post.stats);
    void load();
    return () => {
      epoch.current++;
    };
  }, [load, post.id]);
  const toggle = async (key: 'liked' | 'saved') => {
    if (!signed) {
      goCustomerAccess(l);
      return;
    }
    if (!ready || busy) return;
    const gen = epoch.current;
    setBusy(true);
    setError('');
    try {
      const next = await api<DiscoveryReaction & { stats: DiscoveryStats }>(
        `customer/discovery/${post.id}`,
        { ...state, [key]: !state[key] },
        'PUT',
      );
      if (gen === epoch.current) {
        setStats(next.stats);
        setState({ liked: next.liked, saved: next.saved, version: next.version });
      }
    } catch (e) {
      if (gen === epoch.current) {
        await load();
        setError(
          pt(
            l,
            e instanceof ClientError && e.code === 'CONTENT_UNAVAILABLE' ? 'unavailable' : 'error',
          ),
        );
      }
    } finally {
      if (gen === epoch.current) setBusy(false);
    }
  };
  const disabled = loading || (signed && (!ready || busy));
  return (
    <main id="main" className="discovery-post-page h5-surface">
      <header className="discovery-post-header">
        <Link
          className="discovery-back"
          href={`/${l}/discover?${discoveryParams(q)}`}
          aria-label={pt(l, 'back')}
        >
          <ChevronLeft size={23} />
        </Link>
        <Link
          className="discovery-post-author"
          href={authorHref(l, post, q)}
          aria-label={`${pt(l, post.author.kind === 'editor' ? 'related' : 'author')} · ${post.author.name[l]}`}
        >
          {post.author.photo ? <img src={postImage(post)} alt="" /> : <UserRound size={23} />}
          <span>
            <strong>{post.author.name[l]}</strong>
            <small>
              {pt(l, 'views')} {stats.views}
            </small>
          </span>
        </Link>
        <button
          className={`discovery-save ${state.saved ? 'is-active' : ''}`}
          aria-pressed={signed && ready && state.saved}
          disabled={disabled}
          onClick={() => void toggle('saved')}
        >
          <Bookmark size={18} />
          <span>{pt(l, state.saved ? 'savedAction' : 'save')}</span>
        </button>
      </header>
      <div className="discovery-post-layout">
        <article>
          <PostGallery key={post.id} post={post} l={l} />
          <div className="discovery-post-prose">
            <h1>{post.title[l]}</h1>
            {(post.kind === 'guide' || post.kind === 'safety') && (
              <p className="discovery-post-summary">{post.summary[l]}</p>
            )}
            {detail.sections.map((s, i) => (
              <section key={i}>
                <h2>{s.heading[l]}</h2>
                <p>{s.text[l]}</p>
              </section>
            ))}
          </div>
        </article>
        <aside>
          <section className="discovery-post-related" id="more-content">
            <h2>{pt(l, 'related')}</h2>
            <DiscoveryColumns items={detail.related} l={l} q={q} />
          </section>
        </aside>
      </div>
      {error && (
        <div className="discovery-interaction-error" role="alert">
          <span>{error}</span>
          <button className="quality-link" onClick={() => void load()}>
            {pt(l, 'retry')}
          </button>
        </div>
      )}
      <div className="discovery-post-dock">
        <span>
          <Eye size={16} />
          {stats.views}
        </span>
        <button
          className={state.liked ? 'is-active' : ''}
          disabled={disabled}
          aria-pressed={signed && ready && state.liked}
          onClick={() => void toggle('liked')}
        >
          <Heart size={18} fill={state.liked ? 'currentColor' : 'none'} />
          <span>
            {pt(l, state.liked ? 'liked' : 'like')} {stats.likes}
          </span>
        </button>
        <Link className="h5-primary" href={postBookingHref(l, post, q)}>
          {pt(l, 'book')}
        </Link>
      </div>
    </main>
  );
}
export function DiscoverySavedPage({ locale: l }: { locale: Locale }) {
  const { actor, loading } = useSession(),
    [items, setItems] = useState<DiscoverySaved[]>([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    epoch = useRef(0);
  const load = useCallback(async () => {
    const gen = ++epoch.current;
    setReady(false);
    setError('');
    setItems([]);
    if (actor?.role !== 'CUSTOMER') return;
    try {
      const data = await api<DiscoverySaved[]>('customer/discovery/saved');
      if (gen === epoch.current) {
        setItems(data);
        setReady(true);
      }
    } catch {
      if (gen === epoch.current) setError(pt(l, 'error'));
    }
  }, [actor?.id, actor?.role, l]);
  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
    };
  }, [load]);
  async function remove(row: DiscoverySaved) {
    if (busy) return;
    const gen = epoch.current;
    setBusy(true);
    setError('');
    try {
      await api(
        `customer/discovery/${row.id}`,
        { version: row.state.version, liked: row.post ? row.state.liked : false, saved: false },
        'PUT',
      );
      if (gen === epoch.current) setItems((old) => old.filter((r) => r.id !== row.id));
    } catch {
      if (gen === epoch.current) {
        await load();
        setError(pt(l, 'error'));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      id="main"
      className="wrap consumer-page discovery-saved-page"
      aria-busy={loading || (actor?.role === 'CUSTOMER' && !ready && !error)}
    >
      <h1>{pt(l, 'saved')}</h1>
      <FavoriteKinds locale={l} content />
      {!loading && actor?.role !== 'CUSTOMER' ? (
        <section className="quality-card">
          <p>{pt(l, 'signinHelp')}</p>
          <button className="quality-primary" onClick={() => goCustomerAccess(l)}>
            {pt(l, 'signin')}
          </button>
        </section>
      ) : (
        <>
          {error && (
            <p className="quality-error" role="alert">
              {error}
              <button className="quality-link" onClick={() => void load()}>
                {pt(l, 'retry')}
              </button>
            </p>
          )}
          {!ready && !error && <p role="status">{pt(l, 'loading')}</p>}
          {ready && !items.length && (
            <div className="quality-empty">
              <p>{pt(l, 'emptySaved')}</p>
              <Link className="quality-primary" href={`/${l}/discover`}>
                {pt(l, 'back')}
              </Link>
            </div>
          )}
          <div className="discovery-saved-list">
            {items.map((row) => (
              <article className="quality-card" key={row.id}>
                {row.post ? (
                  <Link href={postHref(l, row.post, { tab: 'recommended' })}>
                    <img src={postImage(row.post)} alt="" />
                    <span>
                      <strong>{row.post.title[l]}</strong>
                      <small>{row.post.author.name[l]}</small>
                    </span>
                  </Link>
                ) : (
                  <p>{pt(l, 'unavailable')}</p>
                )}
                <button className="quality-button" disabled={busy} onClick={() => void remove(row)}>
                  {pt(l, 'remove')}
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
