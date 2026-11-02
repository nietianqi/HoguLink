'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { communityTopics } from '@hogulink/contracts/discovery';
import type {
  CommunityEditorial,
  CommunityMute,
  CommunityQueueItem,
  CommunityTopic,
  Locale,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime } from '@/lib/i18n';
import { cm, cmHas } from '@/lib/community-i18n';
import { errorText } from '@/lib/community-model';

type Decision = 'APPROVE' | 'REJECT' | 'HIDE' | 'RESTORE';
const roleBadge = {
  CUSTOMER: 'customer',
  STAFF: 'therapist',
  MERCHANT: 'shop',
  ADMIN: 'editor',
} as const;
const blankEditorial = {
  titleJa: '',
  titleEn: '',
  titleZh: '',
  bodyJa: '',
  bodyEn: '',
  bodyZh: '',
};

export function CommunityReview({ locale: l }: { locale: Locale }) {
  const [queue, setQueue] = useState<CommunityQueueItem[] | null>(null),
    [editorials, setEditorials] = useState<CommunityEditorial[]>([]),
    [mutes, setMutes] = useState<CommunityMute[]>([]),
    [unmuteReasons, setUnmuteReasons] = useState<Record<string, string>>({}),
    [loadError, setLoadError] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reasons, setReasons] = useState<Record<string, string>>({}),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [muteDays, setMuteDays] = useState<Record<string, string>>({}),
    [draft, setDraft] = useState(blankEditorial),
    [topic, setTopic] = useState<CommunityTopic>('FIRST_TIME'),
    [pinned, setPinned] = useState(false),
    epoch = useRef(0);
  const load = useCallback(async () => {
    const gen = ++epoch.current;
    setLoadError(false);
    try {
      const [items, list, restrictions] = await Promise.all([
        api<CommunityQueueItem[]>('admin/community'),
        api<CommunityEditorial[]>('admin/community/editorials'),
        api<CommunityMute[]>('admin/community/mutes'),
      ]);
      if (gen === epoch.current) {
        setQueue(items);
        setEditorials(list);
        setMutes(restrictions);
      }
    } catch {
      if (gen === epoch.current) setLoadError(true);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
    };
  }, [load]);
  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(cm(l, errorText(e instanceof ClientError ? e.code : undefined)));
    } finally {
      setBusy(false);
      await load();
    }
  }
  const decide = (item: CommunityQueueItem, decision: Decision) =>
    act(() =>
      api(`admin/community/${item.kind === 'POST' ? 'posts' : 'replies'}/${item.id}/review`, {
        version: item.version,
        decision,
        ...(reasons[item.id]?.trim() ? { reason: reasons[item.id].trim() } : {}),
        ...(notes[item.id]?.trim() ? { note: notes[item.id].trim() } : {}),
      }),
    );
  const needsReason = (item: CommunityQueueItem) => (reasons[item.id]?.trim().length ?? 0) < 4;
  const editorialReady = Object.entries(draft).every(
    ([k, v]) => v.trim().length >= (k.startsWith('title') ? 6 : 10),
  );
  if (loadError)
    return (
      <p className="quality-error" role="alert">
        {cm(l, 'error')}
        <button className="quality-link" onClick={() => void load()}>
          {cm(l, 'retry')}
        </button>
      </p>
    );
  if (!queue) return <p role="status">{cm(l, 'loading')}</p>;
  return (
    <div className="community-review">
      <div className="community-review-head">
        <h2>{cm(l, 'reviewTitle')}</h2>
        <p>{cm(l, 'reviewHelp')}</p>
        <a className="quality-link" href="#community-mutes">
          {cm(l, 'muteManagement')} · {mutes.length}
        </a>
      </div>
      {error && (
        <p className="quality-error" role="alert">
          {error}
        </p>
      )}
      {!queue.length && <p className="community-empty">{cm(l, 'queueEmpty')}</p>}
      {queue.map((item) => (
        <article key={item.id} className={`community-review-item is-${item.status.toLowerCase()}`}>
          <div className="community-review-item-head">
            <span className="community-status">{cm(l, item.status)}</span>
            <strong>
              {cm(l, item.type)} · {cm(l, item.kind)}
            </strong>
            <span className={`community-badge is-${roleBadge[item.author.role]}`}>
              {cm(l, roleBadge[item.author.role])}
            </span>
            <span>
              {item.author.label[l]}
              {item.author.storeName && item.author.role === 'STAFF'
                ? ` · ${item.author.storeName[l]}`
                : ''}
            </span>
            <time>{dateTime(l, item.createdAt)}</time>
          </div>
          {(item.flags.length > 0 || item.reports.length > 0 || item.author.mutedUntil) && (
            <div className="community-review-tags">
              {item.flags.map((f) => (
                <span key={f} className="community-flag">
                  {cmHas(`flag_${f}`) ? cm(l, `flag_${f}` as 'flag_medical') : f}
                </span>
              ))}
              {item.reports.map((r) => (
                <span key={r.reason} className="community-flag is-report">
                  {cm(l, 'reports')} · {cm(l, r.reason)} × {r.count}
                </span>
              ))}
              {item.author.mutedUntil && (
                <span className="community-flag">
                  {cm(l, 'mutedUntil')} {dateTime(l, item.author.mutedUntil)}
                </span>
              )}
            </div>
          )}
          {item.kind === 'REPLY' && item.postId && (
            <p className="community-review-context">
              {cm(l, 'inThread')}：
              <Link href={`/${l}/discover/${item.postId}`} target="_blank">
                {item.postTitle}
              </Link>
            </p>
          )}
          {item.title && <h3>{item.title}</h3>}
          <p className="community-review-body">{item.body}</p>
          {(item.template || item.offering || item.expiresAt) && (
            <p className="community-review-context">
              {item.template && cm(l, item.template)}
              {item.offering && ` · ${item.offering[l]}`}
              {item.expiresAt && ` · ${cm(l, 'endsAt')} ${dateTime(l, item.expiresAt)}`}
            </p>
          )}
          {item.images.length > 0 && (
            <div className="community-review-images">
              {item.images.map((src) => (
                <img key={src} src={src} alt="" />
              ))}
            </div>
          )}
          <div className="community-review-fields">
            <label>
              <span>{cm(l, 'authorReason')}</span>
              <input
                value={reasons[item.id] ?? ''}
                maxLength={200}
                onChange={(e) => setReasons((old) => ({ ...old, [item.id]: e.target.value }))}
              />
            </label>
            <label>
              <span>{cm(l, 'note')}</span>
              <input
                value={notes[item.id] ?? ''}
                maxLength={1000}
                onChange={(e) => setNotes((old) => ({ ...old, [item.id]: e.target.value }))}
              />
            </label>
          </div>
          <div className="community-review-actions">
            {item.status === 'PENDING' && (
              <>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => void decide(item, 'APPROVE')}
                >
                  {cm(l, 'approve')}
                </button>
                <button
                  className="button secondary small"
                  disabled={busy || needsReason(item)}
                  onClick={() => void decide(item, 'REJECT')}
                >
                  {cm(l, 'reject')}
                </button>
              </>
            )}
            {item.status === 'PUBLISHED' && (
              <>
                <button
                  className="button secondary small"
                  disabled={busy || needsReason(item)}
                  onClick={() => void decide(item, 'HIDE')}
                >
                  {cm(l, 'hide')}
                </button>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      api(
                        `admin/community/${item.kind === 'POST' ? 'posts' : 'replies'}/${item.id}/dismiss`,
                        {},
                      ),
                    )
                  }
                >
                  {cm(l, 'dismiss')}
                </button>
              </>
            )}
            {item.status === 'HIDDEN' && (
              <>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => void decide(item, 'RESTORE')}
                >
                  {cm(l, 'restore')}
                </button>
                <button
                  className="button secondary small"
                  disabled={busy || needsReason(item)}
                  onClick={() => void decide(item, 'HIDE')}
                >
                  {cm(l, 'hide')}
                </button>
              </>
            )}
            <span className="community-mute">
              <input
                type="number"
                min={0}
                max={90}
                aria-label={cm(l, 'muteDays')}
                placeholder={cm(l, 'muteDays')}
                value={muteDays[item.id] ?? ''}
                onChange={(e) => setMuteDays((old) => ({ ...old, [item.id]: e.target.value }))}
              />
              <button
                className="quality-link"
                disabled={
                  busy ||
                  muteDays[item.id] === undefined ||
                  muteDays[item.id] === '' ||
                  needsReason(item)
                }
                onClick={() =>
                  void act(() =>
                    api('admin/community/mutes', {
                      ownerId: item.author.ownerId,
                      days: Math.max(0, Math.min(90, Number(muteDays[item.id]))),
                      reason: reasons[item.id].trim(),
                    }),
                  )
                }
              >
                {cm(l, 'mute')}
              </button>
            </span>
          </div>
        </article>
      ))}
      <section id="community-mutes" className="quality-card community-editorials">
        <h2>{cm(l, 'muteManagement')}</h2>
        <p>{cm(l, 'muteHelp')}</p>
        {!mutes.length && <p className="community-empty">{cm(l, 'mutesEmpty')}</p>}
        {mutes.map((mute) => (
          <article key={mute.ownerId} className="community-review-item">
            <div className="community-review-item-head">
              <span className={`community-badge is-${roleBadge[mute.author.role]}`}>
                {cm(l, roleBadge[mute.author.role])}
              </span>
              <strong>{mute.author.label[l]}</strong>
              {mute.author.role === 'STAFF' && mute.author.storeName && (
                <span>{mute.author.storeName[l]}</span>
              )}
              <span>
                {cm(l, 'mutedUntil')} {dateTime(l, mute.until)}
              </span>
            </div>
            <p className="community-review-body">{mute.reason}</p>
            <div className="community-review-fields">
              <label>
                <span>{cm(l, 'unmuteReason')}</span>
                <input
                  value={unmuteReasons[mute.ownerId] ?? ''}
                  minLength={4}
                  maxLength={200}
                  onChange={(event) =>
                    setUnmuteReasons((old) => ({ ...old, [mute.ownerId]: event.target.value }))
                  }
                />
              </label>
            </div>
            <button
              className="button secondary small"
              disabled={busy || (unmuteReasons[mute.ownerId]?.trim().length ?? 0) < 4}
              onClick={() =>
                void act(async () => {
                  await api('admin/community/mutes', {
                    ownerId: mute.ownerId,
                    days: 0,
                    expectedUntil: mute.until,
                    reason: unmuteReasons[mute.ownerId].trim(),
                  });
                  setUnmuteReasons((old) => ({ ...old, [mute.ownerId]: '' }));
                })
              }
            >
              {cm(l, 'unmute')}
            </button>
          </article>
        ))}
      </section>
      <section className="quality-card community-editorials">
        <h2>{cm(l, 'editorials')}</h2>
        <ul>
          {editorials.map((e) => (
            <li key={e.id}>
              <span className="community-status">{cm(l, e.status)}</span>
              <Link href={`/${l}/discover/${e.id}`} target="_blank">
                {e.title[l]}
              </Link>
              <small>
                {cm(l, e.topic)}
                {e.publishedAt ? ` · ${dateTime(l, e.publishedAt)}` : ''}
              </small>
              <button
                className="quality-link"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    api(`admin/community/editorials/${e.id}`, { pinned: !e.pinned }, 'PUT'),
                  )
                }
              >
                {cm(l, e.pinned ? 'unpin' : 'pin')}
              </button>
            </li>
          ))}
        </ul>
        <form
          className="community-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editorialReady) return;
            void act(async () => {
              await api('admin/community/editorials', {
                title: {
                  ja: draft.titleJa.trim(),
                  en: draft.titleEn.trim(),
                  'zh-cn': draft.titleZh.trim(),
                },
                body: {
                  ja: draft.bodyJa.trim(),
                  en: draft.bodyEn.trim(),
                  'zh-cn': draft.bodyZh.trim(),
                },
                topic,
                pinned,
              });
              setDraft(blankEditorial);
              setPinned(false);
            });
          }}
        >
          <h3>{cm(l, 'newEditorial')}</h3>
          <p className="community-lead">{cm(l, 'editorialHelp')}</p>
          <label>
            <span>{cm(l, 'topic')}</span>
            <select value={topic} onChange={(e) => setTopic(e.target.value as CommunityTopic)}>
              {communityTopics.map((t) => (
                <option key={t} value={t}>
                  {cm(l, t)}
                </option>
              ))}
            </select>
          </label>
          {(['titleJa', 'titleEn', 'titleZh'] as const).map((key) => (
            <label key={key}>
              <span>{cm(l, key)}</span>
              <input
                value={draft[key]}
                maxLength={60}
                onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.value }))}
              />
            </label>
          ))}
          {(['bodyJa', 'bodyEn', 'bodyZh'] as const).map((key) => (
            <label key={key}>
              <span>{cm(l, key)}</span>
              <textarea
                rows={4}
                value={draft[key]}
                maxLength={3000}
                onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.value }))}
              />
            </label>
          ))}
          <label className="community-switch">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            <span>{cm(l, 'pin')}</span>
          </label>
          <button className="button" disabled={busy || !editorialReady}>
            {cm(l, 'publish')}
          </button>
        </form>
      </section>
    </div>
  );
}
