'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircleQuestion, PenLine } from 'lucide-react';
import {
  communityLimits as limits,
  communityReplyPolicies,
  communityTopics,
  shopUpdateTemplates,
} from '@hogulink/contracts/discovery';
import type {
  CommunityOwnItem,
  CommunityReplyPolicy,
  CommunityTopic,
  CommunityWorkspace as Workspace,
  Locale,
  ShopUpdateTemplate,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { areaName, dateTime } from '@/lib/i18n';
import { cm } from '@/lib/community-i18n';
import {
  communityLanguage,
  draftProblems,
  errorText,
  expiryAt,
  expiryBounds,
  templateNeeds,
} from '@/lib/community-model';
import { CommunityOwnList } from './community-compose';

export function CommunityWorkspace({
  locale: l,
  role,
}: {
  locale: Locale;
  role: 'STAFF' | 'MERCHANT';
}) {
  const base = role === 'STAFF' ? 'staff/community' : 'merchant/community';
  const [data, setData] = useState<Workspace | null>(null),
    [loadError, setLoadError] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [topic, setTopic] = useState<CommunityTopic>('SERVICES'),
    [template, setTemplate] = useState<ShopUpdateTemplate>('NEW_MENU'),
    [offeringId, setOfferingId] = useState(''),
    [expiry, setExpiry] = useState(''),
    [images, setImages] = useState<string[]>([]),
    [now, setNow] = useState(() => Date.now()),
    epoch = useRef(0);
  const load = useCallback(async () => {
    const gen = ++epoch.current;
    setLoadError(false);
    try {
      const next = await api<Workspace>(base);
      if (gen === epoch.current) setData(next);
    } catch {
      if (gen === epoch.current) setLoadError(true);
    }
  }, [base]);
  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
    };
  }, [load]);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  async function act(fn: () => Promise<unknown>, success: string) {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(success);
      await load();
      return true;
    } catch (e) {
      setError(cm(l, errorText(e instanceof ClientError ? e.code : undefined)));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const needs = templateNeeds(template);
  const bounds = expiryBounds(now);
  const problems = draftProblems({ title, body });
  const incomplete =
    problems.length > 0 ||
    (role === 'MERCHANT' && ((needs.offering && !offeringId) || (needs.expiry && !expiry)));
  const withdraw = (item: CommunityOwnItem) =>
    void act(() => api(`community/posts/${item.id}/withdraw`, {}), cm(l, 'WITHDRAWN'));
  if (loadError)
    return (
      <p className="quality-error" role="alert">
        {cm(l, 'error')}
        <button className="quality-link" onClick={() => void load()}>
          {cm(l, 'retry')}
        </button>
      </p>
    );
  if (!data) return <p role="status">{cm(l, 'loading')}</p>;
  return (
    <div className="community-workspace">
      {/* The shop page heading already carries this line. */}
      {role === 'STAFF' && <p className="community-lead">{cm(l, 'workspaceHelp')}</p>}
      {(notice || error) && (
        <p
          className={error ? 'quality-error' : 'community-notice'}
          role={error ? 'alert' : 'status'}
        >
          {error || notice}
        </p>
      )}
      <section className="quality-card community-settings">
        {role === 'MERCHANT' ? (
          <label className="community-switch">
            <input
              type="checkbox"
              checked={!!data.staffPosting}
              disabled={busy}
              onChange={(e) =>
                void act(
                  () => api(`${base}/settings`, { staffPosting: e.target.checked }, 'PUT'),
                  cm(l, 'saved'),
                )
              }
            />
            <span>
              <strong>{cm(l, 'staffPosting')}</strong>
              <small>{cm(l, 'staffPostingHelp')}</small>
            </span>
          </label>
        ) : (
          <label>
            <span>{cm(l, 'replyPolicy')}</span>
            <select
              value={data.replyPolicy}
              disabled={busy}
              onChange={(e) =>
                void act(
                  () =>
                    api(
                      `${base}/settings`,
                      { replyPolicy: e.target.value as CommunityReplyPolicy },
                      'PUT',
                    ),
                  cm(l, 'saved'),
                )
              }
            >
              {communityReplyPolicies.map((p) => (
                <option key={p} value={p}>
                  {cm(l, p)}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      <section className="quality-card community-composer">
        <h2>
          <PenLine size={18} />
          {cm(l, role === 'STAFF' ? 'newNote' : 'newUpdate')}
        </h2>
        {!data.canPost ? (
          <p className="community-closed">
            {cm(l, role === 'STAFF' ? 'postingOff' : 'COMMUNITY_POSTING_OFF')}
          </p>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (incomplete) return;
              const common = {
                title: title.trim(),
                body: body.trim(),
                language: communityLanguage(l),
              };
              const ok = await act(
                () =>
                  role === 'STAFF'
                    ? api(`${base}/notes`, { ...common, topic, mediaIds: images })
                    : api(`${base}/updates`, {
                        ...common,
                        template,
                        imageIds: images,
                        ...(offeringId ? { offeringId } : {}),
                        ...(expiry ? { expiresAt: expiryAt(expiry) } : {}),
                      }),
                cm(l, 'submitted'),
              );
              if (ok) {
                setTitle('');
                setBody('');
                setImages([]);
                setExpiry('');
              }
            }}
          >
            <p className="community-quota">
              {cm(l, 'weeklyLeft')} {data.weeklyRemaining} {cm(l, 'posts')}
            </p>
            {role === 'MERCHANT' ? (
              <div className="community-form-row">
                <label>
                  <span>{cm(l, 'template')}</span>
                  <select
                    value={template}
                    onChange={(e) => setTemplate(e.target.value as ShopUpdateTemplate)}
                  >
                    {shopUpdateTemplates.map((t) => (
                      <option key={t} value={t}>
                        {cm(l, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{cm(l, 'offering')}</span>
                  <select
                    value={offeringId}
                    required={needs.offering}
                    onChange={(e) => setOfferingId(e.target.value)}
                  >
                    <option value="">{cm(l, 'noOffering')}</option>
                    {data.offerings?.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name[l]} · {o.durationMinutes} min
                      </option>
                    ))}
                  </select>
                  <small>{cm(l, 'offeringHelp')}</small>
                </label>
                <label>
                  <span>{cm(l, 'expiresAt')}</span>
                  <input
                    type="date"
                    value={expiry}
                    min={bounds.min}
                    max={bounds.max}
                    required={needs.expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                  />
                </label>
              </div>
            ) : (
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
            )}
            <label>
              <span>{cm(l, 'title')}</span>
              <input
                value={title}
                maxLength={limits.titleMax}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              <span>{cm(l, 'body')}</span>
              <textarea
                value={body}
                rows={5}
                maxLength={limits.bodyMax}
                onChange={(e) => setBody(e.target.value)}
              />
              <small className="community-counter">
                {body.trim().length} / {limits.bodyMax}
              </small>
            </label>
            <fieldset className="community-photos">
              <legend>
                {cm(l, 'photos')} · {cm(l, role === 'STAFF' ? 'photosHelpNote' : 'photosHelpShop')}
              </legend>
              {data.photos.length ? (
                data.photos.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={images.includes(p.id)}
                      disabled={!images.includes(p.id) && images.length >= limits.images}
                      onChange={(e) =>
                        setImages((old) =>
                          e.target.checked ? [...old, p.id] : old.filter((id) => id !== p.id),
                        )
                      }
                    />
                    <img src={p.url} alt="" />
                  </label>
                ))
              ) : (
                <small>{cm(l, 'noPhotos')}</small>
              )}
            </fieldset>
            {problems.includes('contact') && (
              <p className="community-warning" role="alert">
                {cm(l, 'contactWarning')}
              </p>
            )}
            <p className="community-rules">{cm(l, 'rules')}</p>
            <button className="button" disabled={busy || incomplete || data.weeklyRemaining < 1}>
              {cm(l, 'submit')}
            </button>
          </form>
        )}
      </section>
      <section className="quality-card">
        <h2>{cm(l, 'myPosts')}</h2>
        {data.posts.length ? (
          <CommunityOwnList l={l} items={data.posts} busy={busy} onWithdraw={withdraw} />
        ) : (
          <p className="community-empty">{cm(l, 'mineEmpty')}</p>
        )}
      </section>
      {role === 'MERCHANT' && (
        <section className="quality-card">
          <h2>{cm(l, 'staffPosts')}</h2>
          {data.staffPosts?.length ? (
            <CommunityOwnList
              l={l}
              items={data.staffPosts}
              busy={busy}
              onWithdraw={withdraw}
              withdrawLabel="takeDown"
            />
          ) : (
            <p className="community-empty">{cm(l, 'mineEmpty')}</p>
          )}
        </section>
      )}
      <section className="quality-card community-questions">
        <h2>
          <MessageCircleQuestion size={18} />
          {cm(l, 'questionsNearby')}
        </h2>
        <p className="community-lead">{cm(l, 'questionsHelp')}</p>
        {data.questions.length ? (
          <ul>
            {data.questions.map((q) => (
              <li key={q.id}>
                <span
                  className={`community-status ${q.answeredByBusiness ? 'is-published' : 'is-pending'}`}
                >
                  {cm(l, q.answeredByBusiness ? 'answeredByBusiness' : 'waiting')}
                </span>
                <strong>{q.title}</strong>
                <small>
                  {cm(l, q.topic)}
                  {q.area ? ` · ${areaName(l, q.area)}` : ''} · {q.answers} {cm(l, 'answers')} ·{' '}
                  {dateTime(l, q.publishedAt)}
                </small>
                <Link className="button secondary small" href={`/${l}/discover/${q.id}#replies`}>
                  {cm(l, 'answer')}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="community-empty">
            {role === 'STAFF' && !data.staffPosting ? cm(l, 'postingOff') : cm(l, 'noQuestions')}
          </p>
        )}
      </section>
    </div>
  );
}
