'use client';
import { useState } from 'react';
import {
  acceptanceScopeInput,
  type AcceptanceRule,
  type Listing,
  type Locale,
  type Offering,
  type Store,
} from '@hogulink/contracts';
import { ar } from '@/lib/acceptance-i18n';
import { areaName, dateTime, t } from '@/lib/i18n';
import { acceptanceHelp, acceptanceLabel } from '@/lib/visit-i18n';
import { st } from '@/lib/merchant-i18n';
import { xt } from '@/lib/exception-i18n';

export function AcceptanceSettings({
  store,
  offerings,
  listings,
  history,
  locale: l,
  busy,
  onSave,
}: {
  store: Omit<Store, 'pspAccount'>;
  offerings: Offering[];
  listings: Listing[];
  history: AcceptanceRule[];
  locale: Locale;
  busy: boolean;
  onSave: (input: unknown) => Promise<boolean>;
}) {
  const [mode, setMode] = useState(store.acceptanceMode);
  const [active, setActive] = useState(store.acceptanceRule?.active ?? false);
  const [error, setError] = useState('');
  const rule = store.acceptanceRule;
  const services = offerings.filter(
    (o) => o.approved && o.active !== false && o.regulatoryCategory === 'RELAXATION',
  );
  const team = listings.filter(
    (x) =>
      x.membershipActive &&
      x.portraitConsent &&
      x.identityVerified &&
      x.publicationStatus === 'PUBLISHED_INDEXABLE',
  );
  const scope = rule
    ? acceptanceScopeInput.parse(
        Object.fromEntries(
          Object.keys(acceptanceScopeInput.shape).map((key) => [
            key,
            rule[key as keyof AcceptanceRule],
          ]),
        ),
      )
    : undefined;
  return (
    <section className="merchant-panel acceptance-settings">
      <div className="merchant-panel-heading">
        <h2>{st(l, 'rules')}</h2>
        <span>v{store.ruleVersion}</span>
      </div>
      {store.acceptanceMode !== 'SOLO' && (
        <div className="acceptance-status">
          <strong>
            {ar(
              l,
              !rule
                ? 'missing'
                : store.acceptanceMode === 'AUTO_PREAUTHORIZED' && rule.active
                  ? 'enabled'
                  : 'paused',
            )}
          </strong>
          {rule?.active && store.acceptanceMode === 'AUTO_PREAUTHORIZED' && (
            <button
              type="button"
              className="button small secondary"
              disabled={busy}
              onClick={() =>
                onSave({
                  version: store.ruleVersion,
                  acceptanceMode: store.acceptanceMode,
                  emergencyContact: store.emergencyContact,
                  acceptanceRule: { ...scope, active: false },
                })
              }
            >
              {ar(l, 'pause')}
            </button>
          )}
        </div>
      )}
      <form
        className="merchant-settings-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          const values = new FormData(event.currentTarget);
          const draft =
            store.acceptanceMode === 'SOLO'
              ? undefined
              : {
                  active,
                  instantEnabled: values.get('instantEnabled') === 'on',
                  offeringIds: values.getAll('offeringIds'),
                  listingIds: values.getAll('listingIds'),
                  areas: values.getAll('areas'),
                  startHour: Number(values.get('startHour')),
                  endHour: Number(values.get('endHour')),
                  minTotal: Number(values.get('minTotal')),
                  maxTotal: Number(values.get('maxTotal')),
                  dailyLimit: Number(values.get('dailyLimit')),
                };
          const includeScope = mode === 'AUTO_PREAUTHORIZED' || !!rule;
          if (includeScope && !acceptanceScopeInput.safeParse(draft).success) {
            setError(ar(l, 'scopeError'));
            return;
          }
          await onSave({
            version: store.ruleVersion,
            acceptanceMode: mode,
            emergencyContact: values.get('emergencyContact'),
            ...(includeScope
              ? {
                  acceptanceRule: draft,
                  confirmAuthorization: values.get('authorization') === 'on',
                }
              : {}),
          });
        }}
      >
        <fieldset disabled={busy}>
          <label className="field">
            {st(l, 'rules')}
            <select
              name="acceptanceMode"
              value={mode}
              disabled={store.acceptanceMode === 'SOLO'}
              onChange={(e) => setMode(e.target.value as Store['acceptanceMode'])}
            >
              {(['MANUAL', 'AUTO_PREAUTHORIZED', 'SOLO'] as const)
                .filter((m) => (store.acceptanceMode === 'SOLO' ? m === 'SOLO' : m !== 'SOLO'))
                .map((m) => (
                  <option key={m} value={m}>
                    {acceptanceLabel(l, m)}
                  </option>
                ))}
            </select>
          </label>
          <p>{acceptanceHelp(l, mode)}</p>
          {store.acceptanceMode === 'SOLO' ? (
            <p>{st(l, 'soloHelp')}</p>
          ) : (
            <div className="acceptance-scope">
              <h3>{ar(l, 'title')}</h3>
              <p>{ar(l, 'meaning')}</p>
              <label className="acceptance-check">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                {ar(l, 'active')}
              </label>
              <label className="acceptance-check">
                <input
                  type="checkbox"
                  name="instantEnabled"
                  defaultChecked={rule?.instantEnabled ?? false}
                />
                {ar(l, 'instant')}
              </label>
              {(
                [
                  [
                    'offeringIds',
                    'services',
                    services.map((o) => ({
                      id: o.id,
                      label: `${o.name[l]} · ${o.durationMinutes} ${t(l, 'minutes')}`,
                    })),
                    rule?.offeringIds,
                  ],
                  [
                    'listingIds',
                    'team',
                    team.map((x) => ({ id: x.id, label: x.name[l] })),
                    rule?.listingIds,
                  ],
                  [
                    'areas',
                    'areas',
                    store.areas.map((id) => ({ id, label: areaName(l, id) })),
                    rule?.areas,
                  ],
                ] as const
              ).map(([name, key, items, selected]) => (
                <fieldset className="acceptance-choices" key={name}>
                  <legend>{ar(l, key)}</legend>
                  {items.map((item) => (
                    <label key={item.id} className="acceptance-check">
                      <input
                        type="checkbox"
                        name={name}
                        value={item.id}
                        defaultChecked={!selected || selected.includes(item.id)}
                      />
                      {item.label}
                    </label>
                  ))}
                </fieldset>
              ))}
              <div className="acceptance-fields">
                <label className="field">
                  {ar(l, 'start')}
                  <select name="startHour" defaultValue={rule?.startHour ?? 9}>
                    {Array.from({ length: 24 }, (_, n) => (
                      <option key={n} value={n}>
                        {String(n).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {ar(l, 'end')}
                  <select name="endHour" defaultValue={rule?.endHour ?? 22}>
                    {Array.from({ length: 24 }, (_, n) => n + 1).map((n) => (
                      <option key={n} value={n}>
                        {String(n).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p>{ar(l, 'timeHelp')}</p>
              <div className="acceptance-fields">
                <label className="field">
                  {ar(l, 'min')}
                  <input
                    type="number"
                    name="minTotal"
                    min={0}
                    max={500000}
                    required
                    step={1}
                    defaultValue={rule?.minTotal ?? 0}
                  />
                </label>
                <label className="field">
                  {ar(l, 'max')}
                  <input
                    type="number"
                    name="maxTotal"
                    min={0}
                    max={500000}
                    required
                    step={1}
                    defaultValue={rule?.maxTotal ?? 20000}
                  />
                </label>
              </div>
              <p>{ar(l, 'priceHelp')}</p>
              <label className="field">
                {ar(l, 'limit')}
                <input
                  type="number"
                  name="dailyLimit"
                  min={1}
                  max={1000}
                  required
                  step={1}
                  defaultValue={rule?.dailyLimit ?? 10}
                />
              </label>
              <p>{ar(l, 'limitHelp')}</p>
              {active && (
                <label className="acceptance-check acceptance-authorization">
                  <input
                    type="checkbox"
                    name="authorization"
                    required={mode === 'AUTO_PREAUTHORIZED'}
                  />
                  {ar(l, 'consent')}
                </label>
              )}
            </div>
          )}
          {store.acceptanceMode === 'SOLO' && <p>{xt(l, 'soloHelp')}</p>}
          <label className="field">
            {st(l, 'emergency')}
            <input
              name="emergencyContact"
              defaultValue={store.emergencyContact}
              required
              minLength={5}
              maxLength={120}
            />
          </label>
          <p>{st(l, 'rulesHelp')}</p>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <button className="button">{st(l, 'save')}</button>
        </fieldset>
      </form>
      {rule && (
        <p className="acceptance-last">
          {ar(l, 'updated')} · {dateTime(l, rule.authorizedAt)} JST · {rule.authorizedBy} · v
          {rule.version}
        </p>
      )}
      {history.length > 0 && (
        <details className="acceptance-history">
          <summary>{ar(l, 'history')}</summary>
          <ul>
            {history.map((r) => (
              <li key={r.version}>
                <strong>
                  v{r.version} · {ar(l, r.active ? 'enabled' : 'paused')}
                </strong>
                <span>
                  {dateTime(l, r.authorizedAt)} JST · {r.authorizedBy}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
