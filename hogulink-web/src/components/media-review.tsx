'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ListingMediaReviewItem, Locale } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { clock, isMediaKey, md, mediaStatus } from '@/lib/media-i18n';

/** Platform queue for therapist photos and videos: new items and reported published ones. */
export function MediaReview({ locale: l }: { locale: Locale }) {
  const [items, setItems] = useState<ListingMediaReviewItem[]>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [checked, setChecked] = useState<Record<string, boolean>>({}),
    [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      setItems(await api<ListingMediaReviewItem[]>('admin/listing-media'));
      setError('');
    } catch {
      setError(md(l, 'failed'));
    }
  }, [l]);
  useEffect(() => {
    void load();
  }, [load]);
  async function decide(m: ListingMediaReviewItem, approved: boolean) {
    setBusy(m.id);
    setError('');
    try {
      await api(`admin/listing-media/${m.id}/review`, {
        version: m.version,
        approved,
        ...(notes[m.id]?.trim() ? { note: notes[m.id].trim() } : {}),
      });
      await load();
    } catch (e) {
      setError(e instanceof ClientError && isMediaKey(e.code) ? md(l, e.code) : md(l, 'failed'));
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="admin-panel media-review" id="media-review">
      <div className="admin-panel-head">
        <h2>
          {md(l, 'reviewTitle')}
          <span className="admin-count">{items?.length ?? 0}</span>
        </h2>
        <p>{md(l, 'reviewHelp')}</p>
      </div>
      {error && (
        <p className="quality-error" role="alert">
          {error}
        </p>
      )}
      {items && !items.length && <p className="muted">{md(l, 'reviewEmpty')}</p>}
      <ul className="media-review-list">
        {items?.map((m) => {
          const reported = m.status === 'APPROVED';
          const note = notes[m.id]?.trim() ?? '';
          return (
            <li key={m.id} className="media-review-item">
              <div className="media-review-preview">
                {m.kind === 'VIDEO' ? (
                  <video src={m.url} poster={m.posterUrl} controls preload="none" playsInline />
                ) : (
                  <a href={m.url} target="_blank" rel="noreferrer">
                    <img src={m.url} alt="" />
                  </a>
                )}
              </div>
              <div className="media-review-body">
                <strong>
                  {m.listingName[l]} · {m.storeName[l]}
                </strong>
                <small>
                  {md(l, m.kind === 'VIDEO' ? 'video' : 'photo')}
                  {m.kind === 'VIDEO' ? ` · ${clock(m.durationSeconds)}` : ''} ·{' '}
                  {md(l, m.uploadedBy === 'MERCHANT' ? 'uploadedByShop' : 'uploadedByStaff')} ·{' '}
                  {mediaStatus(l, m.status, m.note)}
                </small>
                {!!m.reportReasons?.length && (
                  <p className="media-review-reports">
                    {m.reportReasons.length} {md(l, 'reports')}：
                    {[...new Set(m.reportReasons)].map((r) => md(l, r)).join('、')}
                  </p>
                )}
                <label className="media-review-check">
                  <input
                    type="checkbox"
                    checked={!!checked[m.id]}
                    onChange={(e) => setChecked({ ...checked, [m.id]: e.target.checked })}
                  />
                  {md(l, 'reviewChecks')}
                </label>
                <label className="media-review-note">
                  {md(l, 'reason')}
                  <textarea
                    rows={2}
                    maxLength={300}
                    value={notes[m.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [m.id]: e.target.value })}
                    placeholder={md(l, 'reasonHelp')}
                  />
                </label>
                <div className="media-review-actions">
                  <button
                    type="button"
                    className="quality-button"
                    disabled={busy === m.id || !checked[m.id]}
                    onClick={() => void decide(m, true)}
                  >
                    {md(l, reported ? 'keep' : 'approve')}
                  </button>
                  <button
                    type="button"
                    className="quality-button danger"
                    disabled={busy === m.id || note.length < 4}
                    onClick={() => void decide(m, false)}
                  >
                    {md(l, reported ? 'takeDown' : 'reject')}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
