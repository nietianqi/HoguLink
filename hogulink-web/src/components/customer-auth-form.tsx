'use client';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Actor, Locale } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { ca, safeAccountReturn } from '@/lib/customer-auth-i18n';
import { useSession } from './booking-form';
type Mode = 'login' | 'register' | 'forgot' | 'verify' | 'reset';
export function CustomerAuthForm({ locale: l }: { locale: Locale }) {
  const query = useSearchParams(),
    router = useRouter(),
    { actor, loading, setActor } = useSession();
  const [mode, setMode] = useState<Mode>('login'),
    [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [email, setEmail] = useState(''),
    [demoAccess, setDemoAccess] = useState(false),
    [delivery, setDelivery] = useState<boolean>();
  const returnTo = safeAccountReturn(l, query.get('returnTo'));
  useEffect(() => {
    const readLink = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const action = fragment.get('action'),
        secret = fragment.get('token');
      if ((action === 'verify' || action === 'reset') && secret) {
        setMode(action);
        setToken(secret);
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };
    readLink();
    window.addEventListener('hashchange', readLink);
    api<{ notificationConfigured: boolean; demoAccessEnabled: boolean }>('health')
      .then((h) => {
        setDelivery(h.notificationConfigured);
        setDemoAccess(h.demoAccessEnabled === true);
      })
      .catch(() => {});
    return () => window.removeEventListener('hashchange', readLink);
  }, []);
  function change(next: Mode) {
    setMode(next);
    setNotice('');
    setError('');
  }
  function failure(e: unknown) {
    const code = e instanceof ClientError ? e.code : '';
    setError(
      ca(
        l,
        code === 'INVALID_CREDENTIALS'
          ? 'credentials'
          : code === 'EMAIL_NOT_VERIFIED'
            ? 'unverified'
            : code === 'TOKEN_INVALID'
              ? 'invalid'
              : code === 'RATE_LIMITED'
                ? 'limited'
                : 'error',
      ),
    );
  }
  async function request(kind: 'resend-verification' | 'forgot-password') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`auth/customer/${kind}`, { email, locale: l });
      setNotice(ca(l, 'sent'));
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'login') {
        setActor(
          await api<Actor>('auth/customer/login', { email, password: data.get('password') }),
        );
        router.replace(returnTo);
      } else if (mode === 'register') {
        await api('auth/customer/register', {
          email,
          password: data.get('password'),
          name: data.get('name'),
          locale: l,
          termsAccepted: data.get('terms') === 'on',
        });
        setNotice(ca(l, 'registered'));
        setMode('login');
      } else if (mode === 'forgot') {
        await api('auth/customer/forgot-password', { email, locale: l });
        setNotice(ca(l, 'sent'));
      } else {
        await api(`auth/customer/${mode === 'verify' ? 'verify-email' : 'reset-password'}`, {
          token,
          ...(mode === 'reset' ? { password: data.get('password') } : {}),
        });
        setToken('');
        setNotice(ca(l, mode === 'verify' ? 'verified' : 'changed'));
        setMode('login');
      }
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="workspace-shell">
      <section className="customer-auth-card quality-card">
        <span className="eyebrow small">HOGULINK</span>
        <h1>{ca(l, 'title')}</h1>
        <p>{ca(l, 'help')}</p>
        {delivery === false && (
          <p className="auth-delivery-note" role="status">
            {ca(l, 'unavailable')}
          </p>
        )}
        {actor?.role === 'CUSTOMER' && !token ? (
          <div className="customer-auth-signed">
            <p>
              {ca(l, 'signed')} · <strong>{actor.displayName || actor.id}</strong>
            </p>
            <Link className="button" href={returnTo}>
              {ca(l, 'continue')}
            </Link>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('auth/logout', {});
                  setActor(null);
                } catch (e) {
                  failure(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {ca(l, 'logout')}
            </button>
          </div>
        ) : (
          <>
            {!token && (
              <div className="customer-auth-tabs" aria-label={ca(l, 'title')}>
                {(['login', 'register'] as const).map((m) => (
                  <button
                    type="button"
                    key={m}
                    aria-pressed={mode === m}
                    disabled={busy}
                    onClick={() => change(m)}
                  >
                    {ca(l, m)}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={submit} className="customer-auth-fields">
              {mode === 'register' && (
                <label htmlFor="customer-name">
                  {ca(l, 'name')}
                  <input
                    id="customer-name"
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={80}
                  />
                </label>
              )}
              {!token && (
                <label htmlFor="customer-email">
                  {ca(l, 'email')}
                  <input
                    id="customer-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              )}
              {['login', 'register', 'reset'].includes(mode) && (
                <label htmlFor="customer-password">
                  {ca(l, 'password')}
                  <input
                    key={mode}
                    id="customer-password"
                    name="password"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    minLength={mode === 'login' ? 1 : 12}
                    maxLength={128}
                    aria-describedby={mode === 'login' ? undefined : 'password-guidance'}
                  />
                  {mode !== 'login' && (
                    <small id="password-guidance">{ca(l, 'passwordHelp')}</small>
                  )}
                </label>
              )}
              {mode === 'register' && (
                <>
                  <label className="customer-auth-consent">
                    <input type="checkbox" name="terms" required />
                    {ca(l, 'terms')}
                  </label>
                  <div className="customer-auth-links">
                    <Link href={`/${l}/legal/terms`} target="_blank" rel="noreferrer">
                      {ca(l, 'termsLink')}
                    </Link>
                    <Link href={`/${l}/legal/privacy`} target="_blank" rel="noreferrer">
                      {ca(l, 'privacyLink')}
                    </Link>
                  </div>
                </>
              )}
              <button className="button" disabled={busy || loading} type="submit">
                {busy ? ca(l, 'working') : ca(l, mode === 'forgot' ? 'send' : mode)}
              </button>
            </form>
            {!token && (
              <div className="customer-auth-links">
                <button type="button" disabled={busy} onClick={() => change('forgot')}>
                  {ca(l, 'forgot')}
                </button>
                <button
                  type="button"
                  disabled={busy || !email}
                  onClick={() => request('resend-verification')}
                >
                  {ca(l, 'resend')}
                </button>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {demoAccess && !token && actor?.role !== 'CUSTOMER' && (
          <details className="customer-auth-demo">
            <summary>{ca(l, 'demoLogin')}</summary>
            <p>{ca(l, 'demoHelp')}</p>
            <button
              className="button secondary"
              type="button"
              disabled={busy || loading}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  setActor(await api<Actor>('auth/demo', { role: 'CUSTOMER' }));
                  router.replace(returnTo);
                } catch (e) {
                  failure(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {ca(l, 'demoLogin')}
            </button>
          </details>
        )}
        {notice && (
          <p className="success notice" role="status">
            {notice}
          </p>
        )}
      </section>
    </main>
  );
}
