'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Play, Star, Video } from 'lucide-react';
import {
  LISTING_PHOTO_LIMIT,
  PENDING_MEDIA,
  type ListingMedia,
  type Locale,
  type Localized,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { compressImage, fileBase64 } from '@/lib/image-upload';
import { uploadVideo } from '@/lib/video-upload';
import { clock, isMediaKey, md, mediaStatus } from '@/lib/media-i18n';

type Snapshot = {
  items: ListingMedia[];
  listings: { id: string; name: Localized; photo: string; hasMainPhoto: boolean }[];
};
type Role = 'STAFF' | 'MERCHANT';
const live = (m: ListingMedia) => m.status === 'APPROVED' || PENDING_MEDIA.includes(m.status);
const errorText = (l: Locale, e: unknown) =>
  e instanceof ClientError && isMediaKey(e.code) ? md(l, e.code) : md(l, 'failed');

/**
 * Photo and introduction-video management. Therapists upload and authorize their own items;
 * shops confirm, upload for a therapist (who then authorizes) and take items down.
 */
export function MediaManager({
  locale: l,
  role,
  listingId,
}: {
  locale: Locale;
  role: Role;
  listingId?: string;
}) {
  const [data, setData] = useState<Snapshot>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<number | null>(null),
    [consent, setConsent] = useState(false),
    [reasonFor, setReasonFor] = useState<{ id: string; action: 'confirm' | 'remove' } | null>(null),
    [reason, setReason] = useState('');
  const photoInput = useRef<HTMLInputElement>(null),
    videoInput = useRef<HTMLInputElement>(null);
  const query = listingId ? `?${new URLSearchParams({ listingId })}` : '';
  const load = useCallback(async () => {
    try {
      setData(await api<Snapshot>(`media${query}`));
      setError('');
    } catch (e) {
      setError(errorText(l, e));
    }
  }, [l, query]);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(task: () => Promise<unknown>, done = md(l, 'saved')) {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await task();
      setNotice(done);
      await load();
    } catch (e) {
      setError(errorText(l, e));
      await load();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  const items = data?.items ?? [];
  const listing = data?.listings[0];
  const approved = items.filter((m) => m.status === 'APPROVED');
  const photoCount = items.filter((m) => m.kind === 'PHOTO' && live(m)).length;
  const videoPending = items.some((m) => m.kind === 'VIDEO' && PENDING_MEDIA.includes(m.status));
  const hasVideo = items.some((m) => m.kind === 'VIDEO' && m.status === 'APPROVED');
  const needConsent = role === 'STAFF' && !consent;
  const owner = { ...(listingId ? { listingId } : {}), ...(role === 'STAFF' ? { consent } : {}) };
  const move = (id: string, step: number) => {
    const ids = approved.map((m) => m.id);
    const at = ids.indexOf(id);
    const target = at + step;
    if (target < 0 || target >= ids.length) return;
    [ids[at], ids[target]] = [ids[target], ids[at]];
    void act(() => api(`media/order${query}`, { ids }, 'PUT'));
  };
  return (
    <section className="media-manager" aria-labelledby="media-manager-title">
      <div className="media-manager-head">
        <h2 id="media-manager-title">
          {md(l, role === 'STAFF' ? 'manageTitle' : 'shopManageTitle')}
          {role === 'MERCHANT' && listing && <small> · {listing.name[l]}</small>}
        </h2>
        <p>{md(l, role === 'STAFF' ? 'manageHelp' : 'shopManageHelp')}</p>
      </div>
      {listing && !listing.hasMainPhoto ? (
        <p className="media-manager-warning" role="status">
          {md(l, 'missingMain')}
        </p>
      ) : (
        <p className="media-manager-hint">{md(l, 'mainPhotoRule')}</p>
      )}
      <details className="media-manager-rules">
        <summary>{md(l, 'rulesTitle')}</summary>
        <p>{md(l, 'rules')}</p>
      </details>
      <div className="media-manager-upload">
        {role === 'STAFF' && (
          <label className="media-manager-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {md(l, 'consentLabel')}
          </label>
        )}
        <div className="media-manager-buttons">
          <button
            type="button"
            className="quality-button"
            disabled={busy || needConsent || photoCount >= LISTING_PHOTO_LIMIT}
            onClick={() => photoInput.current?.click()}
          >
            <ImagePlus size={16} />
            {md(l, 'addPhoto')}
            <small>
              {photoCount}/{LISTING_PHOTO_LIMIT}
            </small>
          </button>
          <button
            type="button"
            className="quality-button"
            disabled={busy || needConsent || videoPending}
            onClick={() => videoInput.current?.click()}
          >
            <Video size={16} />
            {md(l, hasVideo ? 'replaceVideo' : 'addVideo')}
          </button>
        </div>
        <small className="media-manager-limits">
          {md(l, 'photoLimit')} · {md(l, 'videoLimit')}
        </small>
        <input
          ref={photoInput}
          type="file"
          accept="image/jpeg,image/png"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            void act(
              async () => {
                const small = await compressImage(file);
                await api('media/photos', {
                  ...owner,
                  mime: small.type === 'image/png' ? 'image/png' : 'image/jpeg',
                  data: await fileBase64(small),
                });
              },
              md(l, 'uploaded'),
            );
          }}
        />
        <input
          ref={videoInput}
          type="file"
          accept="video/mp4"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setProgress(0);
            void act(() => uploadVideo(file, owner, setProgress), md(l, 'uploaded'));
          }}
        />
        {progress !== null && (
          <div className="media-manager-progress" role="status">
            <span>{md(l, 'uploading')}</span>
            <progress max={1} value={progress} />
          </div>
        )}
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
      {data && !items.length && <p className="media-manager-empty">{md(l, 'empty')}</p>}
      <ul className="media-manager-list">
        {items.map((m) => {
          const order = approved.findIndex((x) => x.id === m.id);
          return (
            <li key={m.id} className={`media-item is-${m.status.toLowerCase()}`}>
              <a className="media-item-preview" href={m.url} target="_blank" rel="noreferrer">
                <img src={m.kind === 'VIDEO' ? m.posterUrl : m.url} alt="" loading="lazy" />
                {m.kind === 'VIDEO' && (
                  <span>
                    <Play size={11} fill="currentColor" aria-hidden="true" />
                    {clock(m.durationSeconds)}
                  </span>
                )}
                {m.cover && (
                  <b>
                    <Star size={11} fill="currentColor" aria-hidden="true" />
                    {md(l, 'cover')}
                  </b>
                )}
              </a>
              <div className="media-item-body">
                <strong>
                  {md(l, m.kind === 'VIDEO' ? 'video' : 'photo')}
                  <span className={`media-status is-${m.status.toLowerCase()}`}>
                    {mediaStatus(l, m.status, m.note)}
                  </span>
                </strong>
                <small>
                  {md(l, m.uploadedBy === 'MERCHANT' ? 'uploadedByShop' : 'uploadedByStaff')}
                  {m.reports ? ` · ${m.reports} ${md(l, 'reports')}` : ''}
                </small>
                {m.note && m.note !== 'REPLACED' && (
                  <p className="media-item-note">
                    {md(l, 'reason')}：{m.note}
                  </p>
                )}
                <div className="media-item-actions">
                  {role === 'STAFF' && m.status === 'PENDING_CONSENT' && (
                    <button
                      type="button"
                      className="quality-button"
                      disabled={busy}
                      onClick={() =>
                        void act(() => api(`media/${m.id}/authorize`, { version: m.version }))
                      }
                    >
                      {md(l, 'authorize')}
                    </button>
                  )}
                  {role === 'MERCHANT' && m.status === 'PENDING_SHOP' && (
                    <>
                      <button
                        type="button"
                        className="quality-button"
                        disabled={busy}
                        onClick={() =>
                          void act(() =>
                            api(`media/${m.id}/confirm`, { version: m.version, approved: true }),
                          )
                        }
                      >
                        {md(l, 'confirm')}
                      </button>
                      <button
                        type="button"
                        className="quality-link"
                        disabled={busy}
                        onClick={() => {
                          setReasonFor({ id: m.id, action: 'confirm' });
                          setReason('');
                        }}
                      >
                        {md(l, 'returnItem')}
                      </button>
                    </>
                  )}
                  {m.kind === 'PHOTO' && m.status === 'APPROVED' && !m.cover && (
                    <button
                      type="button"
                      className="quality-link"
                      disabled={busy}
                      onClick={() =>
                        void act(() => api(`media/${m.id}/cover`, { version: m.version }))
                      }
                    >
                      {md(l, 'setCover')}
                    </button>
                  )}
                  {m.status === 'APPROVED' && approved.length > 1 && (
                    <>
                      <button
                        type="button"
                        className="quality-link"
                        disabled={busy || order === 0}
                        aria-label={md(l, 'moveUp')}
                        onClick={() => move(m.id, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="quality-link"
                        disabled={busy || order === approved.length - 1}
                        aria-label={md(l, 'moveDown')}
                        onClick={() => move(m.id, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                    </>
                  )}
                  {role === 'STAFF' && live(m) && (
                    <button
                      type="button"
                      className="quality-link danger"
                      disabled={busy}
                      onClick={() =>
                        void act(() => api(`media/${m.id}/withdraw`, { version: m.version }))
                      }
                    >
                      {md(l, 'withdraw')}
                    </button>
                  )}
                  {role === 'MERCHANT' && live(m) && m.status !== 'PENDING_SHOP' && (
                    <button
                      type="button"
                      className="quality-link danger"
                      disabled={busy}
                      onClick={() => {
                        setReasonFor({ id: m.id, action: 'remove' });
                        setReason('');
                      }}
                    >
                      {md(l, 'remove')}
                    </button>
                  )}
                </div>
                {reasonFor?.id === m.id && (
                  <form
                    className="media-item-reason"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (reason.trim().length < 4) return;
                      const { action } = reasonFor;
                      setReasonFor(null);
                      void act(() =>
                        action === 'confirm'
                          ? api(`media/${m.id}/confirm`, {
                              version: m.version,
                              approved: false,
                              note: reason.trim(),
                            })
                          : api(`media/${m.id}/remove`, {
                              version: m.version,
                              note: reason.trim(),
                            }),
                      );
                    }}
                  >
                    <label>
                      {md(l, 'reason')}
                      <input
                        value={reason}
                        maxLength={300}
                        onChange={(e) => setReason(e.target.value)}
                        aria-describedby={`reason-help-${m.id}`}
                        autoFocus
                      />
                    </label>
                    <small id={`reason-help-${m.id}`}>{md(l, 'reasonHelp')}</small>
                    <div>
                      <button className="quality-button" disabled={reason.trim().length < 4}>
                        {md(l, reasonFor.action === 'confirm' ? 'returnItem' : 'remove')}
                      </button>
                      <button
                        type="button"
                        className="quality-link"
                        onClick={() => setReasonFor(null)}
                      >
                        {md(l, 'close')}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Loads the manager only when a shop opens a therapist's photo section. */
export function MediaDisclosure({ locale: l, listingId }: { locale: Locale; listingId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="merchant-media" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{md(l, 'gallery')}</summary>
      {open && <MediaManager locale={l} role="MERCHANT" listingId={listingId} />}
    </details>
  );
}

/** Tells the shop how many therapist uploads wait for its confirmation. */
export function MediaPendingNotice({ locale: l }: { locale: Locale }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    api<Snapshot>('media')
      .then((d) => setCount(d.items.filter((m) => m.status === 'PENDING_SHOP').length))
      .catch(() => setCount(0));
  }, []);
  if (!count) return null;
  return (
    <p className="notice merchant-media-pending" role="status">
      {md(l, 'shopPending').replace('{n}', String(count))}
    </p>
  );
}
