'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import type { Locale } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { et, memberError } from '@/lib/member-i18n';
export function AdminAccessForm({
  locale: l,
  token: initialToken,
  activated,
  invitation = false,
}: {
  locale: Locale;
  token?: string;
  activated?: boolean;
  invitation?: boolean;
}) {
  const router = useRouter(),
    [token, setToken] = useState(initialToken),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(activated ? et(l, 'activated') : '');
  const activating = invitation || !!token;
  useEffect(() => {
    const readLink = () => {
      const value = new URLSearchParams(location.hash.slice(1)).get('token');
      if (value) {
        setToken(value);
        history.replaceState(null, '', location.pathname + location.search);
      } else if (invitation && !initialToken) setError(et(l, 'INVITE_INVALID'));
    };
    readLink();
    window.addEventListener('hashchange', readLink);
    return () => window.removeEventListener('hashchange', readLink);
  }, [invitation, initialToken, l]);
  useEffect(() => {
    if (!token) return;
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError(et(l, 'INVITE_INVALID'));
      return;
    }
    let canceled = false;
    api<{ name: string; email: string }>('auth/employee/invitation', { token })
      .then((d) => {
        if (!canceled) {
          setName(d.name);
          setEmail(d.email);
        }
      })
      .catch((e) => {
        if (!canceled) setError(memberError(l, e instanceof ClientError ? e.code : ''));
      });
    return () => {
      canceled = true;
    };
  }, [token, l]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (activating && !token) {
      setError(et(l, 'INVITE_INVALID'));
      return;
    }
    if (token && password !== confirm) {
      setError(et(l, 'mismatch'));
      return;
    }
    setBusy(true);
    try {
      if (token) {
        await api('auth/employee/activate', { token, password });
        setPassword('');
        setConfirm('');
        setNotice(et(l, 'activated'));
        router.replace(`/${l}/admin/login?activated=1`);
      } else {
        await api('auth/employee/login', { email, password });
        router.replace(`/${l}/admin`);
        router.refresh();
      }
    } catch (e) {
      setError(memberError(l, e instanceof ClientError ? e.code : ''));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="wrap admin-access-page">
      <section className="admin-access-story">
        <span className="eyebrow">HOGULINK / PEOPLE & ACCESS</span>
        <ShieldCheck size={42} />
        <h1>{et(l, activating ? 'activate' : 'login')}</h1>
        <p>{et(l, activating ? 'activateHelp' : 'rolesHelp')}</p>
        <small>{et(l, 'local')}</small>
      </section>
      <section className="admin-access-card">
        <KeyRound size={25} />
        <h2>{name || et(l, 'login')}</h2>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <form onSubmit={submit}>
          <fieldset disabled={busy || (activating && !name)}>
            <label className="field">
              {et(l, 'email')}
              <input
                aria-label={et(l, 'email')}
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                value={email}
                readOnly={activating}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              {et(l, 'password')}
              <input
                aria-label={et(l, 'password')}
                type="password"
                autoComplete={activating ? 'new-password' : 'current-password'}
                required
                minLength={activating ? 12 : 1}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {activating && (
              <>
                <p className="muted">{et(l, 'passwordHelp')}</p>
                <label className="field">
                  {et(l, 'confirm')}
                  <input
                    aria-label={et(l, 'confirm')}
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </label>
              </>
            )}
            <button className="button full" disabled={busy}>
              {et(l, activating ? 'setPassword' : 'signIn')}
              <ArrowRight size={16} />
            </button>
          </fieldset>
        </form>
        <Link href={`/${l}/admin`}>{et(l, 'back')}</Link>
      </section>
    </main>
  );
}
