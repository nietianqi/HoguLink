'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { communityLimits as limits, communityTopics } from '@hogulink/contracts/discovery';
import type { CommunityOwnItem, CommunityTopic, Locale } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { areaName, areas, dateTime } from '@/lib/i18n';
import { cm } from '@/lib/community-i18n';
import { communityLanguage, draftProblems, errorText } from '@/lib/community-model';
import { useSession } from './booking-form';
import { goCustomerAccess } from './customer-signin';

function CommunityShell({
  l,
  title,
  children,
}: {
  l: Locale;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="wrap consumer-page community-page h5-surface">
      <div className="community-page-head">
        <Link
          className="discovery-back"
          href={`/${l}/discover?tab=questions`}
          aria-label={cm(l, 'community')}
        >
          <ChevronLeft size={23} />
        </Link>
        <h1>{title}</h1>
      </div>
      {children}
    </main>
  );
}
function SignIn({ l }: { l: Locale }) {
  return (
    <section className="quality-card community-signin">
      <p>{cm(l, 'signInHelp')}</p>
      <button className="quality-primary" onClick={() => goCustomerAccess(l)}>
        {cm(l, 'signIn')}
      </button>
    </section>
  );
}
export function CommunityAsk({ locale: l }: { locale: Locale }) {
  const { actor, loading } = useSession();
  const [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [topic, setTopic] = useState<CommunityTopic>('FIRST_TIME'),
    [area, setArea] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [sent, setSent] = useState(false);
  const problems = draftProblems({ title, body });
  if (loading)
    return (
      <CommunityShell l={l} title={cm(l, 'askTitle')}>
        {null}
      </CommunityShell>
    );
  if (actor?.role !== 'CUSTOMER')
    return (
      <CommunityShell l={l} title={cm(l, 'askTitle')}>
        <SignIn l={l} />
      </CommunityShell>
    );
  if (sent)
    return (
      <CommunityShell l={l} title={cm(l, 'askTitle')}>
        <section className="quality-card community-sent" role="status">
          <p>{cm(l, 'submitted')}</p>
          <Link className="quality-primary" href={`/${l}/discover/mine`}>
            {cm(l, 'mine')}
          </Link>
          <Link className="quality-button" href={`/${l}/discover?tab=questions`}>
            {cm(l, 'questions')}
          </Link>
        </section>
      </CommunityShell>
    );
  return (
    <CommunityShell l={l} title={cm(l, 'askTitle')}>
      <p className="community-lead">{cm(l, 'askHelp')}</p>
      <form
        className="quality-card community-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (problems.length || busy) return;
          setBusy(true);
          setError('');
          try {
            await api('community/questions', {
              title: title.trim(),
              body: body.trim(),
              topic,
              language: communityLanguage(l),
              ...(area ? { area } : {}),
            });
            setSent(true);
          } catch (e) {
            setError(cm(l, errorText(e instanceof ClientError ? e.code : undefined)));
          } finally {
            setBusy(false);
          }
        }}
      >
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
        <label>
          <span>{cm(l, 'area')}</span>
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">{cm(l, 'anyArea')}</option>
            {Object.keys(areas).map((a) => (
              <option key={a} value={a}>
                {areaName(l, a)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{cm(l, 'title')}</span>
          <input
            value={title}
            maxLength={limits.titleMax}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={!!title && problems.includes('title')}
          />
          <small className="community-counter">
            {title.trim().length} / {limits.titleMax}
          </small>
        </label>
        <label>
          <span>{cm(l, 'body')}</span>
          <textarea
            value={body}
            rows={6}
            maxLength={limits.bodyMax}
            onChange={(e) => setBody(e.target.value)}
            aria-invalid={!!body && problems.includes('body')}
          />
          <small className="community-counter">
            {body.trim().length} / {limits.bodyMax}
          </small>
        </label>
        {problems.includes('contact') && (
          <p className="community-warning" role="alert">
            {cm(l, 'contactWarning')}
          </p>
        )}
        <p className="community-rules">{cm(l, 'rules')}</p>
        {error && (
          <p className="quality-error" role="alert">
            {error}
          </p>
        )}
        <button className="h5-primary" disabled={busy || problems.length > 0}>
          {cm(l, 'submit')}
        </button>
      </form>
    </CommunityShell>
  );
}
export function CommunityOwnList({
  l,
  items,
  busy,
  onWithdraw,
  withdrawLabel = 'withdraw',
}: {
  l: Locale;
  items: CommunityOwnItem[];
  busy: boolean;
  onWithdraw?: (item: CommunityOwnItem) => void;
  withdrawLabel?: 'withdraw' | 'takeDown';
}) {
  return (
    <ul className="community-own-list">
      {items.map((item) => (
        <li key={item.id} className={`is-${item.status.toLowerCase()}`}>
          <div>
            <span className="community-status">{cm(l, item.status)}</span>
            <small>
              {cm(l, item.kind === 'POST' ? item.type : 'REPLY')}
              {item.author ? ` · ${item.author[l]}` : ''} · {dateTime(l, item.createdAt)}
            </small>
          </div>
          <strong>{item.title || item.body.slice(0, 60)}</strong>
          {item.kind === 'REPLY' && <p>{item.body}</p>}
          {item.reason && (
            <p className="community-reason">
              {cm(l, 'reason')}：{item.reason === 'REPORTED' ? cm(l, 'REPORTED') : item.reason}
            </p>
          )}
          <div className="community-own-actions">
            {item.replies !== undefined && (
              <small>
                {item.replies} {cm(l, 'answers')}
              </small>
            )}
            {item.status === 'PUBLISHED' && (
              <Link className="quality-link" href={`/${l}/discover/${item.postId}`}>
                {cm(l, 'view')}
              </Link>
            )}
            {onWithdraw && ['PENDING', 'PUBLISHED'].includes(item.status) && (
              <button
                type="button"
                className="quality-link"
                disabled={busy}
                onClick={() => onWithdraw(item)}
              >
                {cm(l, withdrawLabel)}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
export function CommunityMine({ locale: l }: { locale: Locale }) {
  const { actor, loading } = useSession();
  const [items, setItems] = useState<CommunityOwnItem[] | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    epoch = useRef(0);
  const load = useCallback(async () => {
    const gen = ++epoch.current;
    setError('');
    if (!actor) return;
    try {
      const next = await api<CommunityOwnItem[]>('community/mine');
      if (gen === epoch.current) setItems(next);
    } catch {
      if (gen === epoch.current) setError(cm(l, 'error'));
    }
  }, [actor?.id, l]);
  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
    };
  }, [load]);
  return (
    <CommunityShell l={l} title={cm(l, 'mine')}>
      {!loading && !actor ? (
        <SignIn l={l} />
      ) : error ? (
        <p className="quality-error" role="alert">
          {error}
          <button className="quality-link" onClick={() => void load()}>
            {cm(l, 'retry')}
          </button>
        </p>
      ) : !items ? (
        <p role="status">{cm(l, 'loading')}</p>
      ) : !items.length ? (
        <section className="quality-empty">
          <p>{cm(l, 'mineEmpty')}</p>
          {actor?.role === 'CUSTOMER' && (
            <Link className="quality-primary" href={`/${l}/discover/ask`}>
              {cm(l, 'ask')}
            </Link>
          )}
        </section>
      ) : (
        <CommunityOwnList
          l={l}
          items={items}
          busy={busy}
          onWithdraw={async (item) => {
            setBusy(true);
            try {
              await api(
                `community/${item.kind === 'POST' ? 'posts' : 'replies'}/${item.id}/withdraw`,
                {},
              );
              await load();
            } catch (e) {
              setError(cm(l, errorText(e instanceof ClientError ? e.code : undefined)));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </CommunityShell>
  );
}
