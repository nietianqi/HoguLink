'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Actor, Locale } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { ca, safeAccountReturn } from '@/lib/customer-auth-i18n';
import { useSession } from './booking-form';
import {
  customerAuthInput,
  validateCustomerAuth,
  authFieldError,
  authRequestError,
  type AuthField,
  type AuthFieldErrors,
  type CustomerAuthMode,
} from '@/lib/customer-auth-model';
type Mode = CustomerAuthMode;
export function CustomerAuthForm({ locale: l }: { locale: Locale }) {
  const query = useSearchParams(),
    router = useRouter(),
    { actor, loading, setActor } = useSession();
  const [mode, setMode] = useState<Mode>('login'),
    [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({}),
    [verificationRequested, setVerificationRequested] = useState(false),
    [demoAccess, setDemoAccess] = useState(false),
    [delivery, setDelivery] = useState<boolean>();
  const returnTo = safeAccountReturn(l, query.get('returnTo'));
  const formRef = useRef<HTMLFormElement>(null);
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
    setFieldErrors({});
    setVerificationRequested(false);
  }
  function focusError(errors: AuthFieldErrors) {
    const first = (['name', 'email', 'password', 'terms'] as const).find((field) => errors[field]);
    requestAnimationFrame(() => {
      const input = first && formRef.current?.elements.namedItem(first);
      if (input instanceof HTMLElement) input.focus();
    });
  }
  function edit(field: AuthField) {
    setFieldErrors((previous) => ({ ...previous, [field]: undefined }));
    setError('');
    setNotice('');
  }
  function failure(e: unknown, requestMode: Mode = mode) {
    const code = e instanceof ClientError ? e.code : '';
    if (e instanceof ClientError && code === 'VALIDATION_ERROR') {
      const errors: AuthFieldErrors = {};
      for (const field of e.fields) {
        const issue = authFieldError(field);
        if (issue) errors[issue.field] = issue.message;
      }
      if (Object.values(errors).some(Boolean)) {
        setFieldErrors(errors);
        setError(ca(l, 'checkFields'));
        focusError(errors);
        return;
      }
    }
    if (code === 'EMAIL_NOT_VERIFIED') setVerificationRequested(true);
    const network = e instanceof TypeError && /fetch|network|load failed/i.test(e.message);
    setError(ca(l, network ? 'networkError' : authRequestError(requestMode, code)));
  }
  async function request(kind: 'resend-verification' | 'forgot-password') {
    if (!formRef.current) return;
    const input = customerAuthInput(new FormData(formRef.current));
    const emailError = validateCustomerAuth('forgot', input).email;
    if (emailError) {
      setFieldErrors({ email: emailError });
      setError(ca(l, 'checkFields'));
      focusError({ email: emailError });
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`auth/customer/${kind}`, { email: input.email, locale: l });
      setNotice(ca(l, kind === 'forgot-password' ? 'resetSent' : 'verificationSent'));
      if (kind === 'resend-verification') setVerificationRequested(true);
    } catch (e) {
      failure(e, 'forgot');
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = customerAuthInput(data);
    const errors = validateCustomerAuth(mode, input);
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) {
      setError(ca(l, 'checkFields'));
      focusError(errors);
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'login') {
        setActor(
          await api<Actor>('auth/customer/login', { email: input.email, password: input.password }),
        );
        router.replace(returnTo);
      } else if (mode === 'register') {
        await api('auth/customer/register', {
          email: input.email,
          password: input.password,
          name: input.name,
          locale: l,
          termsAccepted: input.termsAccepted,
        });
        setNotice(ca(l, 'registered'));
        setVerificationRequested(true);
        setMode('login');
      } else if (mode === 'forgot') {
        await api('auth/customer/forgot-password', { email: input.email, locale: l });
        setNotice(ca(l, 'resetSent'));
      } else {
        await api(`auth/customer/${mode === 'verify' ? 'verify-email' : 'reset-password'}`, {
          token,
          ...(mode === 'reset' ? { password: input.password } : {}),
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
            {error && (
              <p className="customer-auth-error" role="alert">
                {error}
              </p>
            )}
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
            {notice && (
              <p className="customer-auth-notice" role="status">
                {notice}
              </p>
            )}
            <form ref={formRef} noValidate onSubmit={submit} className="customer-auth-fields">
              {error && (
                <p className="customer-auth-error" role="alert">
                  {error}
                </p>
              )}
              {mode === 'register' && (
                <label htmlFor="customer-name">
                  {ca(l, 'name')}
                  <input
                    id="customer-name"
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={80}
                    onChange={() => edit('name')}
                    aria-invalid={!!fieldErrors.name}
                    aria-describedby={fieldErrors.name ? 'customer-name-error' : undefined}
                  />
                  {fieldErrors.name && (
                    <small id="customer-name-error" className="customer-auth-field-error">
                      {ca(l, fieldErrors.name)}
                    </small>
                  )}
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
                    // Uncontrolled: a browser can fill it before the page is interactive,
                    // and re-rendering must never wipe what it filled.
                    onChange={() => edit('email')}
                    aria-invalid={!!fieldErrors.email}
                    aria-describedby={fieldErrors.email ? 'customer-email-error' : undefined}
                  />
                  {fieldErrors.email && (
                    <small id="customer-email-error" className="customer-auth-field-error">
                      {ca(l, fieldErrors.email)}
                    </small>
                  )}
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
                    onChange={() => edit('password')}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby={
                      fieldErrors.password
                        ? 'customer-password-error'
                        : mode === 'login'
                          ? undefined
                          : 'password-guidance'
                    }
                  />
                  {mode !== 'login' && !fieldErrors.password && (
                    <small id="password-guidance">{ca(l, 'passwordHelp')}</small>
                  )}
                  {fieldErrors.password && (
                    <small id="customer-password-error" className="customer-auth-field-error">
                      {ca(l, fieldErrors.password)}
                    </small>
                  )}
                </label>
              )}
              {mode === 'register' && (
                <>
                  <label className="customer-auth-consent">
                    <input
                      type="checkbox"
                      name="terms"
                      required
                      onChange={() => edit('terms')}
                      aria-invalid={!!fieldErrors.terms}
                      aria-describedby={fieldErrors.terms ? 'customer-terms-error' : undefined}
                    />
                    {ca(l, 'terms')}
                  </label>
                  {fieldErrors.terms && (
                    <small id="customer-terms-error" className="customer-auth-field-error">
                      {ca(l, fieldErrors.terms)}
                    </small>
                  )}
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
                {mode === 'login' && (
                  <button type="button" disabled={busy} onClick={() => change('forgot')}>
                    {ca(l, 'forgot')}
                  </button>
                )}
                {verificationRequested && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => request('resend-verification')}
                  >
                    {ca(l, 'resend')}
                  </button>
                )}
              </div>
            )}
          </>
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
      </section>
    </main>
  );
}
