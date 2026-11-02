'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Award, CalendarClock, Flag, MapPin, MessageCircle, ThumbsUp } from 'lucide-react';
import { communityReportReasons, communityLimits as limits } from '@hogulink/contracts/discovery';
import type {
  CommunityOwnItem,
  CommunityReply,
  CommunityReportReason,
  CommunityThread,
  CommunityViewer,
  DiscoveryPost,
  Locale,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { areaName, dateTime, languageNames } from '@/lib/i18n';
import { cm } from '@/lib/community-i18n';
import {
  blockText,
  communityHref,
  communityLanguage,
  draftProblems,
  errorText,
} from '@/lib/community-model';
import { useSession } from './booking-form';
import { goCustomerAccess } from './customer-signin';

function ReportButton({ l, path, disabled }: { l: Locale; path: string; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  if (state === 'sent') return <small className="community-reported">{cm(l, 'reportSent')}</small>;
  return (
    <details className="community-report">
      <summary aria-label={cm(l, 'report')}>
        <Flag size={13} />
        {cm(l, 'report')}
      </summary>
      <div role="group" aria-label={cm(l, 'reportTitle')}>
        <strong>{cm(l, 'reportTitle')}</strong>
        {communityReportReasons.map((reason: CommunityReportReason) => (
          <button
            key={reason}
            type="button"
            disabled={disabled || state === 'busy'}
            onClick={async () => {
              setState('busy');
              try {
                await api(path, { reason });
                setState('sent');
              } catch {
                setState('error');
              }
            }}
          >
            {cm(l, reason)}
          </button>
        ))}
        {state === 'error' && <p role="alert">{cm(l, 'failed')}</p>}
      </div>
    </details>
  );
}
function OwnStatus({ l, item }: { l: Locale; item: CommunityOwnItem }) {
  return (
    <div className={`community-own is-${item.status.toLowerCase()}`}>
      <span className="community-status">{cm(l, item.status)}</span>
      <p>{item.body}</p>
      {item.reason && (
        <small>
          {cm(l, 'reason')}：{item.reason === 'REPORTED' ? cm(l, 'REPORTED') : item.reason}
        </small>
      )}
    </div>
  );
}
export function CommunityThreadView({
  locale: l,
  post,
  thread,
  carry,
}: {
  locale: Locale;
  post: DiscoveryPost;
  thread: CommunityThread;
  carry: URLSearchParams;
}) {
  const router = useRouter();
  const { actor, loading } = useSession();
  const meta = post.community!;
  const [viewer, setViewer] = useState<CommunityViewer | null>(null),
    [viewerError, setViewerError] = useState(false),
    [draft, setDraft] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [helpful, setHelpful] = useState<Record<string, number>>({}),
    epoch = useRef(0);
  const load = useCallback(async () => {
    const gen = ++epoch.current;
    setViewerError(false);
    if (!actor) {
      setViewer(null);
      return;
    }
    try {
      const next = await api<CommunityViewer>(`community/posts/${post.id}/viewer`);
      if (gen === epoch.current) setViewer(next);
    } catch {
      if (gen === epoch.current) setViewerError(true);
    }
  }, [actor?.id, post.id]);
  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
    };
  }, [load]);
  const problems = draftProblems({ body: draft }, 'reply');
  async function act(fn: () => Promise<unknown>, success = '') {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (success) setNotice(success);
      await load();
      router.refresh();
      return true;
    } catch (e) {
      setError(cm(l, errorText(e instanceof ClientError ? e.code : undefined)));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const customer = actor?.role === 'CUSTOMER';
  const link = communityHref(l, post, carry);
  const reply = (r: CommunityReply) => (
    <article className={`community-reply ${r.accepted ? 'is-accepted' : ''}`} key={r.id}>
      <div className="community-reply-head">
        <span className={`community-badge is-${r.author.kind}`}>{cm(l, r.author.kind)}</span>
        {r.author.slug ? (
          <Link
            href={`/${l}/${r.author.kind === 'shop' ? 'shops' : 'therapists'}/${r.author.slug}?${carry}`}
          >
            {r.author.name[l]}
          </Link>
        ) : (
          <strong>{r.author.name[l]}</strong>
        )}
        {r.author.asker && <small className="community-asker">{cm(l, 'asker')}</small>}
        {r.accepted && (
          <small className="community-accepted">
            <Award size={13} />
            {cm(l, 'accepted')}
          </small>
        )}
        <time>{dateTime(l, r.publishedAt)}</time>
      </div>
      <p lang={r.language === 'zh' ? 'zh-CN' : r.language}>{r.body}</p>
      <div className="community-reply-actions">
        <button
          type="button"
          className={viewer?.helpful.includes(r.id) ? 'is-active' : ''}
          aria-pressed={!!viewer?.helpful.includes(r.id)}
          disabled={busy || (!!actor && !customer)}
          onClick={() => {
            if (!customer) return goCustomerAccess(l);
            const on = !viewer?.helpful.includes(r.id);
            void act(async () => {
              const next = await api<{ count: number }>(
                `community/replies/${r.id}/helpful`,
                { helpful: on },
                'PUT',
              );
              setHelpful((old) => ({ ...old, [r.id]: next.count }));
            });
          }}
        >
          <ThumbsUp size={14} />
          {cm(l, 'helpful')} {helpful[r.id] ?? r.helpful}
        </button>
        {viewer?.author && meta.type === 'QUESTION' && !r.author.asker && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(() =>
                api(`community/posts/${post.id}/accept`, { replyId: r.accepted ? null : r.id }),
              )
            }
          >
            <Award size={14} />
            {cm(l, r.accepted ? 'unaccept' : 'accept')}
          </button>
        )}
        {actor && <ReportButton l={l} path={`community/replies/${r.id}/report`} disabled={busy} />}
      </div>
    </article>
  );
  return (
    <div className="community-thread">
      <div className="community-meta">
        <span>{cm(l, meta.topic)}</span>
        {meta.template && <span>{cm(l, meta.template)}</span>}
        {meta.area && (
          <span>
            <MapPin size={12} />
            {areaName(l, meta.area)}
          </span>
        )}
        {meta.type !== 'EDITORIAL' && communityLanguage(l) !== meta.language && (
          <span>
            {cm(l, 'original')}：{languageNames[meta.language] ?? meta.language}
          </span>
        )}
        <time>{dateTime(l, meta.publishedAt)}</time>
        {meta.expiresAt && (
          <span className="community-ends">
            <CalendarClock size={12} />
            {cm(l, 'endsAt')} {dateTime(l, meta.expiresAt)}
          </span>
        )}
      </div>
      <div
        className="community-body"
        lang={
          meta.type === 'EDITORIAL' ? undefined : meta.language === 'zh' ? 'zh-CN' : meta.language
        }
      >
        {thread.body[l]}
      </div>
      {meta.offering && (
        <Link className="community-offering" href={link.href}>
          <span>{cm(l, 'viewOffering')}</span>
          <strong>
            {meta.offering.name[l]} · {meta.offering.durationMinutes} min
          </strong>
        </Link>
      )}
      <div className="community-post-actions">
        {viewer?.author && (
          <button
            type="button"
            className="quality-link"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await api(`community/posts/${post.id}/withdraw`, {});
                router.push(`/${l}/discover/mine`);
              })
            }
          >
            {cm(l, 'withdraw')}
          </button>
        )}
        {actor && !viewer?.author && (
          <ReportButton l={l} path={`community/posts/${post.id}/report`} disabled={busy} />
        )}
      </div>
      <section className="community-replies" id="replies" aria-label={cm(l, 'replies')}>
        <h2>
          <MessageCircle size={18} />
          {cm(l, 'replies')} · {thread.replies.length}
        </h2>
        {thread.replies.length ? (
          thread.replies.map(reply)
        ) : (
          <p className="community-empty">{cm(l, 'noReplies')}</p>
        )}
        {viewer?.pending.map((item) => (
          <OwnStatus key={item.id} l={l} item={item} />
        ))}
        {notice && (
          <p className="community-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="quality-error" role="alert">
            {error}
          </p>
        )}
        {thread.closed ? (
          <p className="community-closed">{cm(l, 'closed')}</p>
        ) : loading ? null : !actor ? (
          <div className="community-signin">
            <p>{cm(l, 'signInHelp')}</p>
            <button className="quality-primary" onClick={() => goCustomerAccess(l)}>
              {cm(l, 'signIn')}
            </button>
          </div>
        ) : viewerError ? (
          <p className="quality-error" role="alert">
            {cm(l, 'error')}
            <button className="quality-link" onClick={() => void load()}>
              {cm(l, 'retry')}
            </button>
          </p>
        ) : viewer && !viewer.canReply ? (
          <p className="community-closed">{cm(l, blockText(viewer.block))}</p>
        ) : viewer ? (
          <form
            className="community-reply-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (problems.length) return;
              const ok = await act(
                () =>
                  api(`community/posts/${post.id}/replies`, {
                    body: draft.trim(),
                    language: communityLanguage(l),
                  }),
                cm(l, 'replySent'),
              );
              if (ok) setDraft('');
            }}
          >
            <label>
              <span>{cm(l, 'replyLabel')}</span>
              <textarea
                value={draft}
                maxLength={limits.replyMax}
                rows={4}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <small className="community-counter">
              {draft.trim().length} / {limits.replyMax}
            </small>
            {problems.includes('contact') && (
              <p className="community-warning" role="alert">
                {cm(l, 'contactWarning')}
              </p>
            )}
            <p className="community-rules">{cm(l, 'rules')}</p>
            <button className="h5-primary" disabled={busy || problems.length > 0}>
              {cm(l, 'sendReply')}
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
