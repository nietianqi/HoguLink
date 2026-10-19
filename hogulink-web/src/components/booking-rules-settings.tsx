'use client';
import { useState } from 'react';
import {
  makeCancellationPolicy,
  storeBookingRulesInput,
  type BookingRulesHistory,
  type Locale,
  type StoreBookingRules,
} from '@hogulink/contracts';
import { br } from '@/lib/booking-rules-i18n';
import { dateTime, money } from '@/lib/i18n';
import { policyText } from '@/lib/visit-i18n';
import { st } from '@/lib/merchant-i18n';

export function BookingRulesSettings({
  rules,
  history,
  locale: l,
  busy,
  onSave,
}: {
  rules: StoreBookingRules;
  history: BookingRulesHistory[];
  locale: Locale;
  busy: boolean;
  onSave: (input: unknown) => Promise<boolean>;
}) {
  const p = rules.cancellationPolicy;
  const [fee, setFee] = useState(String(rules.nominationFee));
  const [template, setTemplate] = useState<'FLEXIBLE_2H' | 'STANDARD_24H' | 'CUSTOM'>(
    rules.templateId === 'LEGACY' ? 'FLEXIBLE_2H' : rules.templateId,
  );
  const [custom, setCustom] = useState({
    free: String(p.freeBeforeMinutes / 60),
    late: String(p.lateFeeBps / 100),
    near: String(
      p.scheduledTiers && p.scheduledTiers.length > 1 ? p.scheduledTiers[0].withinMinutes / 60 : 0,
    ),
    nearFee: String(
      p.scheduledTiers?.[0]?.feeBps ? p.scheduledTiers[0].feeBps / 100 : p.lateFeeBps / 100,
    ),
    noShow: String((p.noShow?.feeBps ?? p.lateFeeBps) / 100),
  });
  const [error, setError] = useState('');
  const input = {
    version: rules.version,
    nominationFee: Number(fee),
    templateId: template,
    ...(template === 'CUSTOM'
      ? {
          customPolicy: {
            freeBeforeMinutes: Math.round(Number(custom.free) * 60),
            lateFeeBps: Math.round(Number(custom.late) * 100),
            nearBeforeMinutes: Math.round(Number(custom.near) * 60),
            nearFeeBps: Math.round(Number(custom.nearFee) * 100),
            noShowFeeBps: Math.round(Number(custom.noShow) * 100),
          },
        }
      : {}),
  };
  const parsed = storeBookingRulesInput.safeParse(input);
  const preview = parsed.success
    ? makeCancellationPolicy(template, 'preview', parsed.data.customPolicy)
    : null;
  return (
    <section className="merchant-panel booking-rules-settings" id="booking-prices-policy">
      <div className="merchant-panel-heading">
        <h2>{br(l, 'title')}</h2>
        <span>v{rules.version}</span>
      </div>
      <form
        className="merchant-settings-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          if (!parsed.success) {
            setError(br(l, 'error'));
            return;
          }
          if (!(await onSave(parsed.data))) setError(br(l, 'failed'));
        }}
      >
        <fieldset disabled={busy}>
          <label className="field">
            {br(l, 'fee')}
            <input
              name="nominationFee"
              type="number"
              min={0}
              max={200000}
              step={1}
              required
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </label>
          <p>{br(l, 'feeHelp')}</p>
          <label className="field">
            {br(l, 'template')}
            <select
              name="policyTemplate"
              value={template}
              onChange={(e) => setTemplate(e.target.value as typeof template)}
            >
              {(['FLEXIBLE_2H', 'STANDARD_24H', 'CUSTOM'] as const).map((id) => (
                <option key={id} value={id}>
                  {br(l, id)}
                </option>
              ))}
            </select>
          </label>
          {template === 'CUSTOM' && (
            <div className="booking-policy-fields">
              {(
                [
                  ['free', 'free', 0.5, 168, 0.5],
                  ['late', 'late', 0, 99, 0.01],
                  ['near', 'near', 0, 168, 0.5],
                  ['nearFee', 'nearFee', 0, 99, 0.01],
                  ['noShow', 'noShow', 0, 99, 0.01],
                ] as const
              ).map(([name, key, min, max, step]) => (
                <label className="field" key={name}>
                  {br(l, key)}
                  <input
                    name={name}
                    type="number"
                    required
                    min={min}
                    max={max}
                    step={step}
                    value={custom[name]}
                    onChange={(e) =>
                      setCustom((previous) => ({ ...previous, [name]: e.target.value }))
                    }
                  />
                </label>
              ))}
              <p>{br(l, 'nearHelp')}</p>
              <p>{br(l, 'rateHelp')}</p>
            </div>
          )}
          <div className="booking-policy-preview" aria-live="polite">
            <h3>{br(l, 'preview')}</h3>
            <strong>
              {br(l, 'fee')} ·{' '}
              {money(l, parsed.success ? parsed.data.nominationFee : rules.nominationFee)}
            </strong>
            <p>{preview ? policyText(l, preview) : br(l, 'error')}</p>
          </div>
          <p>{br(l, 'applies')}</p>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <button className="button">{st(l, 'save')}</button>
        </fieldset>
      </form>
      <details className="booking-policy-current">
        <summary>
          {br(l, 'effective')} · {br(l, rules.templateId)} · v{rules.version}
        </summary>
        <p>
          {br(l, 'fee')} · {money(l, rules.nominationFee)}
        </p>
        <p>{policyText(l, rules.cancellationPolicy)}</p>
        <small>{rules.cancellationPolicy.version}</small>
      </details>
      {history.length > 0 && (
        <details className="booking-policy-current">
          <summary>{br(l, 'history')}</summary>
          <ul>
            {history.map((h) => (
              <li key={h.version}>
                <strong>
                  v{h.version} · {br(l, h.templateId)} · {money(l, h.nominationFee)}
                </strong>
                <span>
                  {dateTime(l, h.changedAt)} JST · {h.changedBy}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="booking-policy-note">{br(l, 'boundary')}</p>
    </section>
  );
}
