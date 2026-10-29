'use client';
import { CustomerSignIn } from './customer-signin';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart, ArrowUpRight, Star, ShieldCheck, RefreshCw } from 'lucide-react';
import {
  effectiveServicePrice,
  experienceDimensions,
  type Actor,
  type Booking,
  type CustomerExperience,
  type ExperienceScores,
  type ExperienceSummary,
  type FavoriteItem,
  type Locale,
  type PublicExperience,
  type PublicExperiencePage,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, money } from '@/lib/i18n';
import { qt, qualityError, qualityStatus } from '@/lib/quality-i18n';
import { useSession } from './booking-form';
import { FavoriteKinds } from './engagement-ui';
import { MobileSheet } from './mobile-ui';
import { WorkspaceNav } from './workspace-nav';
import { rebookingHref, type Rebooking } from '@/lib/account-model';

export function FeedbackSummary({
  locale: l,
  value,
}: {
  locale: Locale;
  value: ExperienceSummary;
}) {
  return (
    <div className="quality-summary">
      <div>
        <Star size={21} />
        <strong>{value.average?.toFixed(1) ?? '—'}</strong>
        <span>
          {value.count} {qt(l, 'count')}
        </span>
      </div>
      <small>{qt(l, 'summary')}</small>
      <div className="quality-dimensions">
        {experienceDimensions.map((k) => (
          <span key={k}>
            {qt(l, k)}
            <b>{value.dimensions[k]?.toFixed(1) ?? '—'}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
export function FeedbackCard({
  locale: l,
  item,
  children,
}: {
  locale: Locale;
  item: PublicExperience;
  children?: React.ReactNode;
}) {
  return (
    <article className="quality-card">
      <header>
        <span className="quality-eyebrow">
          <ShieldCheck size={15} />
          {qt(l, 'verified')}
        </span>
        <time>{dateTime(l, item.createdAt)}</time>
      </header>
      <h3>{item.serviceName[l]}</h3>
      <div className="quality-rating">
        <Star size={17} />
        <strong>{item.scores.overall} / 5</strong>
      </div>
      {item.text && <p className="quality-prose">{item.text}</p>}
      <div className="quality-dimensions compact">
        {experienceDimensions
          .filter((k) => k !== 'overall')
          .map((k) => (
            <span key={k}>
              {qt(l, k)}
              <b>{item.scores[k]} / 5</b>
            </span>
          ))}
      </div>
      {item.reply && (
        <div className="quality-reply">
          <strong>{qt(l, 'reply')}</strong>
          <p className="quality-prose">{item.reply.text}</p>
        </div>
      )}
      {children}
    </article>
  );
}
export function PublicReviews({
  locale: l,
  storeId,
  listingId,
}: {
  locale: Locale;
  storeId?: string;
  listingId?: string;
}) {
  const [data, setData] = useState<PublicExperiencePage>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async (cursor?: string) => {
      setBusy(true);
      setError('');
      try {
        const q = new URLSearchParams(storeId ? { storeId } : { listingId: listingId! });
        if (cursor) q.set('cursor', cursor);
        const v = await api<PublicExperiencePage>(`public/experiences?${q}`);
        setData((old) => ({ ...v, items: cursor ? [...(old?.items ?? []), ...v.items] : v.items }));
      } catch (e) {
        setError(qualityError(l, e));
      } finally {
        setBusy(false);
      }
    },
    [storeId, listingId, l],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="quality-section">
      <div className="quality-section-heading">
        <div>
          <h2>{qt(l, 'reviews')}</h2>
        </div>
        <ShieldCheck size={26} />
      </div>
      {error && (
        <p role="alert" className="quality-error">
          {error}
          <button onClick={() => void load()}>{qt(l, 'refresh')}</button>
        </p>
      )}
      {data && (
        <>
          <FeedbackSummary locale={l} value={data.summary} />
          {!data.items.length && <p className="quality-empty">{qt(l, 'emptyReviews')}</p>}
          <div className="quality-list">
            {data.items.map((item) => (
              <FeedbackCard key={item.id} locale={l} item={item} />
            ))}
          </div>
          {data.nextCursor && (
            <button
              className="quality-button"
              disabled={busy}
              onClick={() => void load(data.nextCursor!)}
            >
              {qt(l, 'more')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
export function FavoriteToggle({ locale: l, listingId }: { locale: Locale; listingId: string }) {
  const { actor, loading } = useSession(),
    [value, setValue] = useState({ active: false, version: 0 }),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    setReady(false);
    setError('');
    if (actor?.role === 'CUSTOMER') {
      try {
        setValue(await api(`customer/favorites/${listingId}`));
        setReady(true);
      } catch (e) {
        setError(qualityError(l, e));
      }
    }
  }, [actor, listingId, l]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!loading && actor?.role !== 'CUSTOMER')
    return (
      <Link className="quality-favorite" href={`/${l}/account/favorites`}>
        <Heart size={17} />
        {qt(l, 'favorite')}
      </Link>
    );
  return (
    <div>
      <button
        className={`quality-favorite ${value.active ? 'selected' : ''}`}
        aria-pressed={value.active}
        disabled={busy || !ready}
        onClick={async () => {
          setBusy(true);
          try {
            setValue(
              await api(
                `customer/favorites/${listingId}`,
                { version: value.version, active: !value.active },
                'PUT',
              ),
            );
          } catch (e) {
            await load();
            setError(qualityError(l, e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Heart size={17} fill={value.active ? 'currentColor' : 'none'} />
        {qt(l, value.active ? 'saved' : 'favorite')}
      </button>
      {error && (
        <small role="alert" className="quality-error">
          {error}
          <button onClick={() => void load()}>{qt(l, 'refresh')}</button>
        </small>
      )}
    </div>
  );
}
export function CustomerExperiencePanel({
  locale: l,
  booking: b,
}: {
  locale: Locale;
  booking: Booking;
}) {
  const router = useRouter(),
    [data, setData] = useState<CustomerExperience>(),
    [open, setOpen] = useState<'edit' | 'withdraw' | null>(null),
    [scores, setScores] = useState<ExperienceScores>({
      punctuality: 0,
      communication: 0,
      explanation: 0,
      cleanliness: 0,
      overall: 0,
    }),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const terminal = ['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status);
  const load = useCallback(async () => {
    try {
      setData(await api(`customer/bookings/${b.id}/experience`));
    } catch (e) {
      setError(qualityError(l, e));
    }
  }, [b.id, l]);
  useEffect(() => {
    if (terminal) void load();
  }, [terminal, load, b.version]);
  if (!terminal) return null;
  async function save(withdraw = false) {
    setBusy(true);
    setError('');
    try {
      if (withdraw)
        await api(`customer/reviews/${data!.review!.id}/withdraw`, {
          version: data!.review!.version,
        });
      else
        await api(
          `customer/bookings/${b.id}/review`,
          { version: data?.review?.version ?? 0, scores, text },
          'PUT',
        );
      await load();
      setOpen(null);
      setNotice(qt(l, 'updated'));
    } catch (e) {
      setError(qualityError(l, e));
      await load();
      if (e instanceof ClientError && e.code === 'VERSION_CONFLICT') setOpen(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="quality-order">
      <div className="quality-actions">
        <button
          className="quality-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const r = await api<Rebooking>(`customer/bookings/${b.id}/rebook`);
              router.push(rebookingHref(l, r));
            } catch (e) {
              setError(qualityError(l, e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {qt(l, 'rebook')}
          <ArrowUpRight size={15} />
        </button>
        {data?.canFavorite && data.listingId && (
          <FavoriteToggle locale={l} listingId={data.listingId} />
        )}{' '}
        {data?.eligible && (
          <button
            className="quality-button"
            onClick={() => {
              setError('');
              setText(data.review?.text ?? '');
              setScores(
                data.review?.scores ?? {
                  punctuality: 0,
                  communication: 0,
                  explanation: 0,
                  cleanliness: 0,
                  overall: 0,
                },
              );
              setOpen('edit');
            }}
          >
            {qt(l, data.review ? 'edit' : 'write')}
          </button>
        )}
        {data?.review && !['WITHDRAWN', 'REMOVED'].includes(data.review.status) && (
          <button
            className="quality-link"
            onClick={() => {
              setError('');
              setOpen('withdraw');
            }}
          >
            {qt(l, 'withdraw')}
          </button>
        )}
      </div>
      <small>{qt(l, 'rebookHelp')}</small>
      {data?.review && (
        <p className="quality-note">
          {qualityStatus(l, data.review.status)}
          {data.review.feedback && ` · ${data.review.feedback}`}
        </p>
      )}
      {data?.reply && (
        <div className="quality-reply">
          <strong>{qt(l, 'reply')}</strong>
          <p>{data.reply.text}</p>
        </div>
      )}
      {!open && error && (
        <p className="quality-error" role="alert">
          {error}
          <Link href={`/${l}/therapists`}>{qt(l, 'browse')}</Link>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <MobileSheet
        open={!!open}
        onClose={() => {
          if (!busy) setOpen(null);
        }}
        title={qt(l, open === 'withdraw' ? 'withdraw' : 'write')}
        locale={l}
        className="quality-dialog"
      >
        {open === 'edit' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <p>{qt(l, 'reviewHelp')}</p>
            <div className="quality-fields">
              {experienceDimensions.map((k) => (
                <label key={k}>
                  {qt(l, k)}
                  <select
                    required
                    aria-label={qt(l, k)}
                    value={scores[k]}
                    onChange={(e) => setScores({ ...scores, [k]: Number(e.target.value) })}
                  >
                    <option value={0} disabled>
                      {qt(l, 'choose')}
                    </option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} / 5
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label className="quality-field">
              {qt(l, 'text')}
              <textarea
                aria-label={qt(l, 'text')}
                maxLength={600}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="quality-error">
                {error}
              </p>
            )}
            <button
              className="quality-primary"
              disabled={busy || experienceDimensions.some((k) => !scores[k])}
            >
              {qt(l, 'submit')}
            </button>
          </form>
        ) : (
          <>
            <p>{qt(l, 'withdrawNote')}</p>
            {error && <p role="alert">{error}</p>}
            <button className="quality-primary" disabled={busy} onClick={() => void save(true)}>
              {qt(l, 'confirm')}
            </button>
          </>
        )}
      </MobileSheet>
    </section>
  );
}
export function FavoritesPage({ locale: l }: { locale: Locale }) {
  const { actor, setActor, loading } = useSession(),
    [data, setData] = useState<FavoriteItem[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [demo, setDemo] = useState(false),
    [signError, setSignError] = useState('');
  const load = useCallback(async () => {
    if (actor?.role === 'CUSTOMER') {
      try {
        setData(await api('customer/favorites'));
        setError('');
      } catch (e) {
        setError(qualityError(l, e));
      }
    }
  }, [actor, l]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<{ demo: boolean }>('public/staff-listings')
      .then((c) => setDemo(c.demo))
      .catch(() => {});
  }, []);
  return (
    <main id="main" className="workspace-shell quality-shell">
      <WorkspaceNav locale={l} role="CUSTOMER" active="favorites" actor={actor} />
      <div className="quality-content">
        <div className="quality-hero">
          <span className="quality-eyebrow">YOUR COLLECTION</span>
          <h1>{qt(l, 'favorites')}</h1>
          <FavoriteKinds locale={l} />
          <p>{qt(l, 'rebookHelp')}</p>
        </div>
        {!loading && actor?.role !== 'CUSTOMER' ? (
          <section className="quality-card">
            <h2>{qt(l, 'customerSignin')}</h2>
            <CustomerSignIn locale={l} className="quality-primary" />
            {signError && <p role="alert">{signError}</p>}
            <Link href={`/${l}/account/bookings`}>{qt(l, 'login')}</Link>
          </section>
        ) : (
          <>
            <button className="quality-button" onClick={() => void load()}>
              <RefreshCw size={15} />
              {qt(l, 'refresh')}
            </button>
            {error && (
              <p role="alert" className="quality-error">
                {error}
              </p>
            )}
            {!loading && !data.length && (
              <p className="quality-empty">
                {qt(l, 'empty')} · <Link href={`/${l}/therapists`}>{qt(l, 'browse')}</Link>
              </p>
            )}
            <div className="quality-favorites">
              {data.map((f) => (
                <article className="quality-card" key={f.listingId}>
                  {f.available && f.listing && f.store ? (
                    <>
                      <img src={f.listing.photo} alt="" width={96} height={112} />
                      <h2>{f.listing.name[l]}</h2>
                      <p>{f.store.name[l]}</p>
                      <small>
                        {f.offerings
                          .map(
                            (o) =>
                              `${o.name[l]} · ${money(l, effectiveServicePrice(o, Date.now()).price + o.transportFee)}`,
                          )
                          .join(' / ')}
                      </small>
                      <Link className="quality-button" href={`/${l}/therapists/${f.listing.slug}`}>
                        {qt(l, 'details')}
                        <ArrowUpRight size={16} />
                      </Link>
                    </>
                  ) : (
                    <>
                      <Heart size={30} />
                      <h2>{qt(l, 'unavailable')}</h2>
                    </>
                  )}
                  <button
                    className="quality-link"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(
                          `customer/favorites/${f.listingId}`,
                          { version: f.version, active: false },
                          'PUT',
                        );
                        await load();
                      } catch (e) {
                        setError(qualityError(l, e));
                        await load();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {qt(l, 'remove')}
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
