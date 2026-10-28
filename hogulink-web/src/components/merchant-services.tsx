'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  venueAvailable,
  listingSupports,
  type Listing,
  type Locale,
  type ServiceProposal,
  type ServiceProposalReview,
  type Store,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, errorText, money, t } from '@/lib/i18n';
import { sv } from '@/lib/service-mode-i18n';
import { mo } from '@/lib/merchant-operations-i18n';
import { MobileSheet } from './mobile-ui';

const proposalError = (l: Locale, e: unknown) =>
  e instanceof ClientError && e.code === 'INVALID_SERVICE_TEAM'
    ? mo(l, 'invalidTeam')
    : e instanceof ClientError && e.code === 'SERVICE_QUEUE_FULL'
      ? mo(l, 'queueFull')
      : errorText(l, e instanceof ClientError ? e.code : undefined);
export function MerchantServiceProposals({
  locale: l,
  store,
  listings,
  onChanged,
}: {
  locale: Locale;
  store: Omit<Store, 'pspAccount'>;
  listings: Listing[];
  onChanged: () => Promise<unknown>;
}) {
  const [items, setItems] = useState<ServiceProposal[]>([]),
    [open, setOpen] = useState(false),
    [mode, setMode] = useState<'HOME_VISIT' | 'IN_STORE'>('HOME_VISIT'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = useRef('');
  const [copy, setCopy] = useState<ServiceProposal>();
  const load = useCallback(async () => {
    try {
      setItems(await api('merchant/service-proposals'));
      setError('');
    } catch (e) {
      setError(proposalError(l, e));
    }
  }, [l, store.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const pool = listings.filter(
    (x) =>
      x.membershipActive &&
      x.identityVerified &&
      x.portraitConsent &&
      x.publicationStatus === 'PUBLISHED_INDEXABLE' &&
      listingSupports(x, mode),
  );
  return (
    <section className="merchant-panel merchant-project-proposals">
      <div className="merchant-panel-heading">
        <h2>{mo(l, 'proposals')}</h2>
        <button
          className="button small"
          onClick={() => {
            key.current = crypto.randomUUID();
            setError('');
            setMode('HOME_VISIT');
            setCopy(undefined);
            setOpen(true);
          }}
        >
          {mo(l, 'create')}
        </button>
      </div>
      <p className="merchant-panel-copy">{mo(l, 'proposalHelp')}</p>
      {items.map((p) => (
        <article className="merchant-proposal-row" key={p.id}>
          <strong>{p.name[l]}</strong>
          <span>
            {sv(l, p.fulfillmentMode)} · {p.durationMinutes}
            {t(l, 'minutes')} · {money(l, p.price)}
          </span>
          <span className="merchant-pill">
            {mo(
              l,
              p.status === 'PENDING'
                ? 'pending'
                : p.status === 'APPROVED'
                  ? 'approved'
                  : 'rejected',
            )}
          </span>
          {p.feedback && <p>{p.feedback}</p>}
          {p.status === 'REJECTED' && (
            <button
              className="text-button"
              onClick={() => {
                key.current = crypto.randomUUID();
                setMode(p.fulfillmentMode);
                setCopy(p);
                setOpen(true);
              }}
            >
              {mo(l, 'create')}
            </button>
          )}
        </article>
      ))}
      {!open && error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <MobileSheet
        locale={l}
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={mo(l, 'create')}
        className="merchant-dialog"
      >
        <form
          key={copy?.id ?? 'new'}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (!f.getAll('listings').length) {
              setError(mo(l, 'invalidTeam'));
              return;
            }
            setBusy(true);
            setError('');
            try {
              await api(
                'merchant/service-proposals',
                {
                  name: {
                    ja: String(f.get('ja')),
                    en: String(f.get('en')),
                    'zh-cn': String(f.get('zh-cn')),
                  },
                  fulfillmentMode: mode,
                  durationMinutes: Number(f.get('duration')),
                  price: Number(f.get('price')),
                  transportFee: mode === 'IN_STORE' ? 0 : Number(f.get('travel')),
                  listingIds: f.getAll('listings'),
                },
                'POST',
                key.current,
              );
              await load();
              await onChanged();
              setOpen(false);
            } catch (e) {
              setError(proposalError(l, e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>{mo(l, 'proposalHelp')}</p>
          <fieldset disabled={busy}>
            {(['ja', 'en', 'zh-cn'] as const).map((x) => (
              <label className="field" key={x}>
                {mo(l, 'serviceName')} ·{' '}
                {x === 'ja' ? '日本語' : x === 'en' ? 'English' : '简体中文'}
                <input
                  name={x}
                  required
                  minLength={2}
                  maxLength={80}
                  defaultValue={copy?.name[x]}
                />
              </label>
            ))}
            <label className="field">
              {mo(l, 'mode')}
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="HOME_VISIT">{sv(l, 'HOME_VISIT')}</option>
                {venueAvailable(store as Store) && (
                  <option value="IN_STORE">{sv(l, 'IN_STORE')}</option>
                )}
              </select>
            </label>
            <label className="field">
              {mo(l, 'duration')}
              <input
                name="duration"
                type="number"
                min={30}
                max={240}
                step={15}
                required
                defaultValue={copy?.durationMinutes ?? 60}
              />
            </label>
            <label className="field">
              {mo(l, 'price')}
              <input
                name="price"
                type="number"
                min={1000}
                max={200000}
                required
                defaultValue={copy?.price}
              />
            </label>
            {mode === 'HOME_VISIT' && (
              <label className="field">
                {mo(l, 'travel')}
                <input
                  name="travel"
                  type="number"
                  min={0}
                  max={20000}
                  defaultValue={copy?.transportFee ?? 0}
                  required
                />
              </label>
            )}
            <fieldset className="merchant-checklist" key={mode}>
              <legend>{mo(l, 'team')}</legend>
              {pool.map((x) => (
                <label className="checkbox" key={x.id}>
                  <input
                    name="listings"
                    type="checkbox"
                    value={x.id}
                    defaultChecked={copy?.listingIds.includes(x.id)}
                  />
                  {x.name[l]}
                </label>
              ))}
              {!pool.length && <p>{mo(l, 'invalidTeam')}</p>}
            </fieldset>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <button className="button full" disabled={!pool.length}>
              {mo(l, 'submit')}
            </button>
          </fieldset>
        </form>
      </MobileSheet>
    </section>
  );
}

export function ServiceProposalReviews({
  locale: l,
  onChanged,
}: {
  locale: Locale;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<ServiceProposalReview[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setItems(await api('admin/service-proposals'));
      setError('');
    } catch (e) {
      setError(proposalError(l, e));
    }
  }, [l]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <h2>
          {mo(l, 'reviews')} · {items.length}
        </h2>
        <button className="button secondary small" disabled={busy} onClick={() => void load()}>
          {t(l, 'refresh')}
        </button>
      </div>
      {!items.length && <p>{mo(l, 'noProposals')}</p>}
      {items.map((p) => (
        <form
          key={p.id}
          className="merchant-review-project"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const approve =
              (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'approve';
            setBusy(true);
            setError('');
            try {
              await api(`admin/service-proposals/${p.id}/review`, {
                version: p.version,
                approve,
                feedback: String(f.get('feedback')),
              });
              await load();
              onChanged();
            } catch (e) {
              setError(proposalError(l, e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>
            {p.storeName[l]} · {p.name[l]}
          </h3>
          <p>
            {sv(l, p.fulfillmentMode)} · {p.durationMinutes}
            {t(l, 'minutes')} · {money(l, p.price)} + {mo(l, 'travel')} {money(l, p.transportFee)}
          </p>
          <p>
            {p.staffNames.map((n) => n[l]).join(' · ')} · {dateTime(l, p.createdAt)}
          </p>
          <dl>
            {(['ja', 'en', 'zh-cn'] as const).map((k) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{p.name[k]}</dd>
              </div>
            ))}
          </dl>
          <label className="field">
            {mo(l, 'feedback')}
            <textarea name="feedback" required minLength={3} maxLength={1000} />
          </label>
          <div className="button-row">
            <button
              name="decision"
              value="reject"
              className="button secondary small"
              disabled={busy}
            >
              {mo(l, 'reject')}
            </button>
            <button name="decision" value="approve" className="button small" disabled={busy}>
              {mo(l, 'approve')}
            </button>
          </div>
        </form>
      ))}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
