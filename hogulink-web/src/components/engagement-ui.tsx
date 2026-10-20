'use client';
import { CustomerSignIn } from './customer-signin';
import { H5MessageCategories } from './h5-consumer';
import { ht } from '@/lib/h5-i18n';
import { pt } from '@/lib/discovery-post-i18n';
import { H5EmptyArt, H5PageHeading } from './h5-overlays';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowUpRight,
  CheckCheck,
  Heart,
  Mail,
  MessageCircle,
  RefreshCw,
  Settings,
  Store,
} from 'lucide-react';
import type {
  Actor,
  CustomerInbox,
  InboxFilter,
  InboxItem,
  Locale,
  StoreFavoriteItem,
} from '@hogulink/contracts';
import { api } from '@/lib/api';
import { dateTime, statusText } from '@/lib/i18n';
import { caseStatus } from '@/lib/care-i18n';
import { xt } from '@/lib/discovery-i18n';
import { qt, qualityError } from '@/lib/quality-i18n';
import { useSession } from './booking-form';

export function CustomerAccess({
  locale: l,
  actor,
  setActor,
}: {
  locale: Locale;
  actor: Actor | null;
  setActor: (actor: Actor) => void;
}) {
  const [demo, setDemo] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api<{ demo: boolean }>('public/staff-listings')
      .then((c) => {
        if (live) setDemo(c.demo);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="quality-card engagement-signin">
      <h2>{qt(l, 'customerSignin')}</h2>
      {actor && <p>{qt(l, 'forbidden')}</p>}
      <CustomerSignIn locale={l} className="quality-primary" />
      {error && (
        <p className="quality-error" role="alert">
          {error}
        </p>
      )}
      <Link href={`/${l}/account`}>{qt(l, 'back')}</Link>
    </section>
  );
}
export function FavoriteKinds({
  locale: l,
  shops = false,
  content = false,
}: {
  locale: Locale;
  shops?: boolean;
  content?: boolean;
}) {
  return (
    <nav className="discovery-tabs" aria-label={qt(l, 'favorites')}>
      <Link href={`/${l}/account/favorites`} aria-current={!shops && !content ? 'page' : undefined}>
        {xt(l, 'therapistFavorites')}
      </Link>
      <Link href={`/${l}/account/favorites?type=shops`} aria-current={shops ? 'page' : undefined}>
        {xt(l, 'shopFavorites')}
      </Link>
      <Link
        href={`/${l}/account/favorites?type=content`}
        aria-current={content ? 'page' : undefined}
      >
        {pt(l, 'saved')}
      </Link>
    </nav>
  );
}
export function StoreFavoriteToggle({ locale: l, storeId }: { locale: Locale; storeId: string }) {
  const { actor, loading } = useSession();
  const [state, setState] = useState({ active: false, version: 0 }),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const gen = ++generation.current;
    setReady(false);
    if (actor?.role !== 'CUSTOMER') return;
    try {
      const next = await api<typeof state>(`customer/store-favorites/${storeId}`);
      if (gen === generation.current) {
        setState(next);
        setReady(true);
      }
    } catch (e) {
      if (gen === generation.current) setError(qualityError(l, e));
    }
  }, [actor, storeId, l]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  if (!loading && actor?.role !== 'CUSTOMER')
    return (
      <Link className="quality-favorite" href={`/${l}/account/favorites?type=shops`}>
        <Heart size={17} />
        {xt(l, 'shopFavorite')}
      </Link>
    );
  return (
    <div>
      <button
        className={`quality-favorite ${state.active ? 'selected' : ''}`}
        aria-pressed={ready && state.active}
        disabled={!ready || busy}
        onClick={async () => {
          const gen = generation.current;
          setBusy(true);
          setError('');
          try {
            const next = await api<typeof state>(
              `customer/store-favorites/${storeId}`,
              { version: state.version, active: !state.active },
              'PUT',
            );
            if (gen === generation.current) setState(next);
          } catch (e) {
            await load();
            setError(qualityError(l, e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Heart size={17} fill={ready && state.active ? 'currentColor' : 'none'} />
        {xt(l, ready && state.active ? 'shopSaved' : 'shopFavorite')}
      </button>
      {error && (
        <small className="quality-error" role="alert">
          {error}
          <button className="quality-link" onClick={() => void load()}>
            {xt(l, 'refresh')}
          </button>
        </small>
      )}
    </div>
  );
}
export function StoreFavoritesPage({ locale: l }: { locale: Locale }) {
  const { actor, setActor, loading } = useSession();
  const [items, setItems] = useState<StoreFavoriteItem[]>([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const gen = ++generation.current;
    if (actor?.role !== 'CUSTOMER') {
      setItems([]);
      setReady(false);
      return;
    }
    try {
      const next = await api<StoreFavoriteItem[]>('customer/store-favorites');
      if (gen === generation.current) {
        setItems(next);
        setError('');
        setReady(true);
      }
    } catch (e) {
      if (gen === generation.current) setError(qualityError(l, e));
    }
  }, [actor, l]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  return (
    <main id="main" className="wrap engagement-page">
      <header className="discovery-intro">
        <span className="quality-eyebrow">HOGULINK / COLLECTION</span>
        <h1>{xt(l, 'shopFavorites')}</h1>
        <p>{xt(l, 'favoriteIntro')}</p>
      </header>
      <FavoriteKinds locale={l} shops />
      {!loading && actor?.role !== 'CUSTOMER' ? (
        <CustomerAccess locale={l} actor={actor} setActor={setActor} />
      ) : (
        <>
          <button className="quality-button" disabled={busy || loading} onClick={() => void load()}>
            <RefreshCw size={16} />
            {xt(l, 'refresh')}
          </button>
          {error && (
            <p className="quality-error" role="alert">
              {error}
            </p>
          )}
          {!ready && !error && <p role="status">{xt(l, 'loading')}</p>}
          {ready && items.length === 0 && (
            <p className="quality-empty">
              {qt(l, 'empty')} · <Link href={`/${l}/discover?tab=shops`}>{xt(l, 'shops')}</Link>
            </p>
          )}
          <div className="saved-shop-grid">
            {actor?.role === 'CUSTOMER' &&
              items.map((f) => (
                <article className="saved-shop quality-card" key={f.storeId}>
                  <Store size={24} />
                  <h2>{f.available && f.store ? f.store.name[l] : xt(l, 'unavailable')}</h2>
                  {f.available && f.store && (
                    <Link className="quality-button" href={`/${l}/shops/${f.store.slug}`}>
                      {xt(l, 'viewShop')}
                      <ArrowUpRight size={16} />
                    </Link>
                  )}
                  <button
                    className="quality-link"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(
                          `customer/store-favorites/${f.storeId}`,
                          { version: f.version, active: false },
                          'PUT',
                        );
                        await load();
                      } catch (e) {
                        await load();
                        setError(qualityError(l, e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {xt(l, 'remove')}
                  </button>
                </article>
              ))}
          </div>
        </>
      )}
    </main>
  );
}
export function CustomerInboxPage({
  locale: l,
  filter,
  channel,
}: {
  locale: Locale;
  filter: InboxFilter;
  channel?: 'orders';
}) {
  const { actor, setActor, loading } = useSession(),
    router = useRouter();
  const [data, setData] = useState<CustomerInbox>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false);
  const generation = useRef(0),
    signed = actor?.role === 'CUSTOMER';
  const load = useCallback(
    async (cursor?: string) => {
      const gen = ++generation.current;
      if (actor?.role !== 'CUSTOMER') {
        setData(undefined);
        return;
      }
      setPending(true);
      setError('');
      try {
        const next = await api<CustomerInbox>(
          `customer/inbox?${new URLSearchParams({ filter, ...(cursor ? { cursor } : {}) })}`,
        );
        if (gen === generation.current) {
          setData((old) =>
            cursor && old
              ? {
                  ...next,
                  items: [
                    ...old.items,
                    ...next.items.filter((n) => !old.items.some((o) => o.id === n.id)),
                  ],
                }
              : next,
          );
          window.dispatchEvent(new Event('hogulink-inbox-updated'));
        }
      } catch (e) {
        if (gen === generation.current) setError(qualityError(l, e));
      } finally {
        if (gen === generation.current) setPending(false);
      }
    },
    [actor, filter, l],
  );
  useEffect(() => {
    setData(undefined);
    void load();
    const visible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const show = () => void load();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pageshow', show);
    return () => {
      generation.current++;
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pageshow', show);
    };
  }, [load]);
  async function read(items: InboxItem[], open?: InboxItem) {
    const gen = generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const stale: string[] = [];
      for (let offset = 0; offset < items.length; offset += 100) {
        const result = await api<{ marked: string[]; stale: string[] }>('customer/inbox/read', {
          items: items.slice(offset, offset + 100).map(({ id, token }) => ({ id, token })),
        });
        stale.push(...result.stale);
        if (gen !== generation.current) return;
      }
      if (gen !== generation.current) return;
      if (stale.length) setNotice(xt(l, 'stale'));
      window.dispatchEvent(new Event('hogulink-inbox-updated'));
      if (open)
        router.push(
          open.kind === 'BOOKING'
            ? `/${l}/account/bookings/${open.targetId}`
            : `/${l}/account/support?ticket=${open.targetId}#case-detail`,
          { scroll: open.kind === 'BOOKING' },
        );
      else await load();
    } catch (e) {
      if (gen === generation.current) setError(qualityError(l, e));
    } finally {
      setBusy(false);
    }
  }
  const unreadItems = data?.items.filter((i) => i.unread) ?? [];
  return (
    <main
      id="main"
      className="wrap engagement-page inbox-page h5-surface"
      aria-busy={loading || (signed && !data && !error)}
    >
      {!channel && (
        <div className="h5-message-landing">
          <h1 className="sr-only">{xt(l, 'inbox')}</h1>
          <H5MessageCategories locale={l} />
          <div className="h5-message-idle">
            <H5EmptyArt label={ht(l, 'emptyMessagesHelp')} />
          </div>
          <nav className="h5-message-tools" aria-label={ht(l, 'settings')}>
            <Link
              href={`/${l}/account/messages?channel=orders&filter=all`}
              aria-label={ht(l, 'allUpdates')}
            >
              <CheckCheck size={22} />
            </Link>
            <Link href={`/${l}/account/settings`} aria-label={ht(l, 'settings')}>
              <Settings size={22} aria-hidden="true" />
            </Link>
          </nav>
          {error && (
            <p className="quality-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {channel && (
        <div className="h5-message-channel-heading">
          <H5PageHeading
            locale={l}
            title={filter === 'support' ? ht(l, 'onlineSupport') : ht(l, 'orderServices')}
            back="account/messages"
          />
        </div>
      )}
      <div className={`h5-inbox-content ${channel ? 'is-channel' : 'is-landing'}`}>
        <header className="discovery-intro">
          <span className="quality-eyebrow">HOGULINK / MESSAGES</span>
          <h1>{xt(l, 'inboxTitle')}</h1>
          <p>{xt(l, 'inboxHelp')}</p>
        </header>
        <p className="inbox-delivery-note">
          <Mail size={17} />
          {xt(l, 'localOnly')}
        </p>
        {!loading && !signed ? (
          <CustomerAccess locale={l} actor={actor} setActor={setActor} />
        ) : (
          <>
            <div className="inbox-toolbar">
              <nav className="discovery-tabs" aria-label={xt(l, 'inbox')}>
                {(['all', 'unread', 'bookings', 'support'] as const).map((f) => (
                  <Link
                    key={f}
                    href={`/${l}/account/messages?filter=${f}`}
                    aria-current={filter === f ? 'page' : undefined}
                  >
                    {xt(l, f)}
                    {f === 'unread' && data && <span>{data.unreadCount}</span>}
                  </Link>
                ))}
              </nav>
              <div>
                <button
                  className="quality-button"
                  disabled={busy || pending || !signed}
                  onClick={() => void load()}
                >
                  <RefreshCw size={16} />
                  {xt(l, 'refresh')}
                </button>
                <button
                  className="quality-button"
                  disabled={busy || pending || !unreadItems.length || !signed}
                  onClick={() => void read(unreadItems)}
                >
                  <CheckCheck size={16} />
                  {xt(l, 'markVisible')}
                </button>
              </div>
            </div>
            {error && (
              <p className="quality-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {(loading || (pending && !data)) && <p role="status">{xt(l, 'loading')}</p>}
            {signed && data && data.items.length === 0 && !pending && (
              <div className="quality-empty h5-message-empty">
                <H5EmptyArt />
                <h2>{ht(l, 'emptyMessages')}</h2>
                <p>{ht(l, 'emptyMessagesHelp')}</p>
              </div>
            )}
            <div className="inbox-list">
              {signed &&
                data?.items.map((i) => (
                  <article className={`inbox-item ${i.unread ? 'is-unread' : ''}`} key={i.id}>
                    <div className="inbox-icon">
                      {i.kind === 'BOOKING' ? <Mail size={21} /> : <MessageCircle size={21} />}
                    </div>
                    <div className="inbox-item-copy">
                      <div>
                        <small>
                          {xt(l, i.kind === 'BOOKING' ? 'bookings' : 'support')} · #
                          {i.targetId.slice(-8).toUpperCase()}
                        </small>
                        <span className="inbox-read-state">
                          {xt(l, i.unread ? 'unread' : 'read')}
                        </span>
                      </div>
                      <h2>{i.title[l]}</h2>
                      <p>
                        {i.kind === 'BOOKING'
                          ? statusText(l, i.status as Parameters<typeof statusText>[1])
                          : caseStatus(l, i.status as Parameters<typeof caseStatus>[1])}
                      </p>
                      <small>
                        <time dateTime={new Date(i.updatedAt).toISOString()}>
                          {dateTime(l, i.updatedAt)}
                        </time>
                        {i.replies > 0 && ` · ${i.replies} ${xt(l, 'replies')}`}
                      </small>
                    </div>
                    <div className="inbox-actions">
                      <button
                        className="quality-button"
                        disabled={busy || pending}
                        onClick={() => void read([i], i)}
                      >
                        {xt(l, i.kind === 'BOOKING' ? 'openBooking' : 'openSupport')}
                        <ArrowUpRight size={16} />
                      </button>
                      {i.unread && (
                        <button
                          className="quality-link"
                          disabled={busy || pending}
                          onClick={() => void read([i])}
                        >
                          {xt(l, 'markRead')}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
            </div>
            {data?.nextCursor && (
              <button
                className="quality-button inbox-more"
                disabled={busy || pending}
                onClick={() => void load(data.nextCursor!)}
              >
                {pending ? xt(l, 'loading') : xt(l, 'more')}
              </button>
            )}
            <p className="discovery-note">{xt(l, 'refreshHint')}</p>
          </>
        )}
      </div>
    </main>
  );
}
