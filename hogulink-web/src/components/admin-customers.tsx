'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Actor, AdminCustomerProfile, AdminCustomerSearch, Locale } from '@hogulink/contracts';
import { canAdmin } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, errorText, money, statusText } from '@/lib/i18n';
import { ot } from '@/lib/admin-operations-i18n';
import { at } from '@/lib/admin-i18n';
import { caseStatus } from '@/lib/care-i18n';
import { sv } from '@/lib/service-mode-i18n';
import { MobileSheet } from './mobile-ui';

export function AdminCustomers({ locale: l, actor }: { locale: Locale; actor: Actor | null }) {
  const router = useRouter(),
    params = useSearchParams();
  const [query, setQuery] = useState(params.get('search') ?? '');
  const [result, setResult] = useState<AdminCustomerSearch>();
  const [profile, setProfile] = useState<AdminCustomerProfile>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false),
    [reason, setReason] = useState(''),
    [hours, setHours] = useState(24),
    [confirmed, setConfirmed] = useState(false);
  const sequence = useRef(0);
  const searchSequence = useRef(0);
  const customerId = params.get('customer');
  const loadProfile = useCallback(async () => {
    const version = ++sequence.current;
    setProfile(undefined);
    setError('');
    if (!customerId || !canAdmin(actor, 'cases.read')) return;
    try {
      const value = await api<AdminCustomerProfile>(
        `admin/customers/${encodeURIComponent(customerId)}`,
      );
      if (version === sequence.current) setProfile(value);
    } catch (e) {
      if (version === sequence.current)
        setError(errorText(l, e instanceof ClientError ? e.code : undefined));
    }
  }, [customerId, actor, l]);
  useEffect(() => {
    setEditing(false);
    void loadProfile();
    return () => {
      sequence.current++;
    };
  }, [loadProfile]);
  async function search(page = 1) {
    if (query.trim().length < 2) return;
    const version = ++searchSequence.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await api<AdminCustomerSearch>(
        `admin/customers?${new URLSearchParams({ q: query.trim(), page: String(page) })}`,
      );
      if (version === searchSequence.current) setResult(value);
    } catch (e) {
      if (version === searchSequence.current)
        setError(errorText(l, e instanceof ClientError ? e.code : undefined));
    } finally {
      if (version === searchSequence.current) setBusy(false);
    }
  }
  const restricted =
    !!profile?.restriction &&
    profile.restriction.active &&
    profile.restriction.expiresAt > Date.now();
  return (
    <>
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>{ot(l, 'customers')}</h2>
            <p>{ot(l, 'customerHelp')}</p>
          </div>
        </div>
        <form
          className="admin-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <label className="admin-search">
            <span className="sr-only">{ot(l, 'customerSearch')}</span>
            <input
              required
              minLength={2}
              maxLength={254}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={ot(l, 'customerSearch')}
            />
          </label>
          <button className="button" disabled={busy || query.trim().length < 2}>
            {ot(l, 'search')}
          </button>
        </form>
        {!result ? (
          <p>{ot(l, 'searchHelp')}</p>
        ) : (
          <>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{ot(l, 'name')}</th>
                    <th>{ot(l, 'email')}</th>
                    <th>{ot(l, 'orders')}</th>
                    <th>{at(l, 'status')}</th>
                    <th>{ot(l, 'details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.email ?? '—'}</td>
                      <td>{c.orders}</td>
                      <td>
                        {ot(
                          l,
                          c.status === 'DEMO'
                            ? 'demoCustomer'
                            : c.status === 'DISABLED'
                              ? 'disabledCustomer'
                              : 'activeCustomer',
                        )}
                      </td>
                      <td>
                        <Link
                          className="button secondary small"
                          scroll={false}
                          href={`/${l}/admin?${new URLSearchParams({ tab: 'customers', search: query, customer: c.id })}`}
                        >
                          {ot(l, 'details')}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!result.items.length && <p>{ot(l, 'empty')}</p>}
            <div className="admin-pagination">
              <span>
                {result.total} {at(l, 'records')}
              </span>
              <button
                className="button secondary small"
                disabled={busy || result.page <= 1}
                onClick={() => void search(result.page - 1)}
              >
                {at(l, 'prev')}
              </button>
              <span>{result.page}</span>
              <button
                className="button secondary small"
                disabled={busy || result.page * result.pageSize >= result.total}
                onClick={() => void search(result.page + 1)}
              >
                {at(l, 'nextPage')}
              </button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
      </section>
      {customerId && (
        <section className="admin-panel admin-customer-profile" aria-busy={!profile}>
          {!profile ? (
            <p>{error ? ot(l, 'empty') : at(l, 'loading')}</p>
          ) : (
            <>
              <div className="admin-panel-heading">
                <div>
                  <h2>{profile.customer.name}</h2>
                  <p>
                    {profile.customer.email ?? ot(l, 'demoCustomer')} ·{' '}
                    {profile.customer.email
                      ? ot(l, profile.customer.verified ? 'verified' : 'unverified')
                      : ''}
                  </p>
                </div>
                {canAdmin(actor, 'safety.write') && (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setReason('');
                      setConfirmed(false);
                      setEditing(true);
                    }}
                  >
                    {ot(l, restricted ? 'release' : 'restrict')}
                  </button>
                )}
              </div>
              <p>
                {ot(l, restricted ? 'restricted' : 'unrestricted')}
                {restricted && ` · ${dateTime(l, profile.restriction!.expiresAt)} JST`}
              </p>
              <p className="admin-privacy">{ot(l, 'customerPrivacy')}</p>
              <h3>
                {ot(l, 'orders')} · {profile.bookings.length}
              </h3>
              <div className="admin-customer-records">
                {profile.bookings.map((b) => (
                  <Link key={b.id} href={`/${l}/admin?tab=orders&booking=${b.id}`}>
                    <strong>
                      {b.id.slice(-8).toUpperCase()} ·{' '}
                      {sv(l, b.quote.fulfillmentMode ?? 'HOME_VISIT')}
                    </strong>
                    <span>
                      {dateTime(l, b.quote.startAt)} JST · {statusText(l, b.status)} ·{' '}
                      {money(l, b.quote.total)}
                    </span>
                  </Link>
                ))}
              </div>
              <h3>
                {ot(l, 'cases')} · {profile.cases.length}
              </h3>
              <div className="admin-customer-records">
                {profile.cases.map((c) => (
                  <Link key={c.id} href={`/${l}/admin/support?case=${c.id}`}>
                    <strong>{c.subject}</strong>
                    <span>
                      {caseStatus(l, c.status)} · {dateTime(l, c.createdAt)}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      )}
      <MobileSheet
        open={editing && !!profile}
        onClose={() => !busy && setEditing(false)}
        title={ot(l, restricted ? 'release' : 'restrict')}
        locale={l}
        className="admin-dialog"
      >
        {profile && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api('admin/customer-restrictions', {
                  customerId: profile.customer.id,
                  active: !restricted,
                  reason,
                  expiresAt: Date.now() + hours * 3600000,
                  version: profile.restriction?.version ?? 0,
                });
                setEditing(false);
                await loadProfile();
                setNotice(ot(l, 'saved'));
              } catch (e) {
                setError(errorText(l, e instanceof ClientError ? e.code : undefined));
                if (e instanceof ClientError && e.code === 'VERSION_CONFLICT') {
                  setEditing(false);
                  await loadProfile();
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              <strong>{profile.customer.name}</strong> ·{' '}
              {profile.customer.email ?? profile.customer.id}
            </p>
            <label className="field">
              {ot(l, 'reason')}
              <textarea
                minLength={10}
                maxLength={1000}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {!restricted && (
              <label className="field">
                {ot(l, 'hours')}
                <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                  {[1, 24, 72, 168, 720].map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="admin-ack">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {ot(l, 'confirmRestriction')}
            </label>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <button className="button" disabled={busy || !confirmed || reason.trim().length < 10}>
              {at(l, 'confirm')}
            </button>
          </form>
        )}
      </MobileSheet>
    </>
  );
}
