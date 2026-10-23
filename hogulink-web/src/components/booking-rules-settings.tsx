'use client';
import { useState } from 'react';
import {
  TIME_SURCHARGE_RULES,
  makeCancellationPolicy,
  storeBookingRulesInput,
  type BookingRulesHistory,
  type Locale,
  type StoreBookingRules,
} from '@hogulink/contracts';
import { br } from '@/lib/booking-rules-i18n';
import { areaName, dateTime, money, surchargeBands } from '@/lib/i18n';
import { policyText } from '@/lib/visit-i18n';
import { st } from '@/lib/merchant-i18n';

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** "HH:MM" from a time input to minutes after 00:00 JST; invalid input fails validation. */
const minutes = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
};

const travelText = (l: Locale, fees: Record<string, number> = {}, order: string[] = []) => {
  const rank = (area: string) => (order.includes(area) ? order.indexOf(area) : order.length);
  return Object.entries(fees)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([area, fee]) => `${areaName(l, area)} ${money(l, fee)}`)
    .join(' · ');
};

export function BookingRulesSettings({
  rules,
  areas = [],
  history,
  locale: l,
  busy,
  onSave,
}: {
  rules: StoreBookingRules;
  /** The shop's service areas; travel fees can be set only for these. */
  areas?: string[];
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
  const [bands, setBands] = useState(() =>
    (rules.timeSurcharges ?? []).map((b) => ({
      start: clock(b.startMinute),
      end: clock(b.endMinute),
      amount: String(b.amount),
    })),
  );
  const [travel, setTravel] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(rules.areaTransportFees ?? {}).map(([area, fee]) => [area, String(fee)]),
    ),
  );
  const [error, setError] = useState('');
  const input = {
    version: rules.version,
    nominationFee: Number(fee),
    templateId: template,
    timeSurcharges: bands.map((b) => ({
      startMinute: minutes(b.start),
      endMinute: minutes(b.end),
      amount: Number(b.amount),
    })),
    // Blank areas fall back to each menu's travel fee.
    areaTransportFees: Object.fromEntries(
      areas.flatMap((area) =>
        travel[area]?.trim() ? [[area, Number(travel[area])] as const] : [],
      ),
    ),
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
          {areas.length > 0 && (
            <fieldset className="booking-surcharge-fields booking-travel-fields">
              <legend>{br(l, 'travelTitle')}</legend>
              <div className="booking-travel-grid">
                {areas.map((area) => (
                  <label className="field" key={area}>
                    {areaName(l, area)}
                    <input
                      name={`travel-${area}`}
                      type="number"
                      min={0}
                      max={20000}
                      step={1}
                      placeholder={br(l, 'travelBlank')}
                      value={travel[area] ?? ''}
                      onChange={(e) => setTravel((all) => ({ ...all, [area]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <p>{br(l, 'travelHelp')}</p>
            </fieldset>
          )}
          <fieldset className="booking-surcharge-fields">
            <legend>{br(l, 'surchargeTitle')}</legend>
            {bands.map((band, i) => (
              <div className="booking-surcharge-row" key={i}>
                <label className="field">
                  {br(l, 'surchargeStart')}
                  <input
                    name={`surchargeStart${i}`}
                    type="time"
                    step={TIME_SURCHARGE_RULES.stepMinutes * 60}
                    required
                    value={band.start}
                    onChange={(e) =>
                      setBands((all) =>
                        all.map((b, j) => (j === i ? { ...b, start: e.target.value } : b)),
                      )
                    }
                  />
                </label>
                <label className="field">
                  {br(l, 'surchargeEnd')}
                  <input
                    name={`surchargeEnd${i}`}
                    type="time"
                    step={TIME_SURCHARGE_RULES.stepMinutes * 60}
                    required
                    value={band.end}
                    onChange={(e) =>
                      setBands((all) =>
                        all.map((b, j) => (j === i ? { ...b, end: e.target.value } : b)),
                      )
                    }
                  />
                </label>
                <label className="field">
                  {br(l, 'surchargeAmount')}
                  <input
                    name={`surchargeAmount${i}`}
                    type="number"
                    min={TIME_SURCHARGE_RULES.minAmount}
                    max={TIME_SURCHARGE_RULES.maxAmount}
                    step={1}
                    required
                    value={band.amount}
                    onChange={(e) =>
                      setBands((all) =>
                        all.map((b, j) => (j === i ? { ...b, amount: e.target.value } : b)),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => setBands((all) => all.filter((_, j) => j !== i))}
                >
                  {br(l, 'surchargeRemove')}
                </button>
              </div>
            ))}
            {bands.length < TIME_SURCHARGE_RULES.maxBands && (
              <button
                type="button"
                className="button secondary small"
                onClick={() =>
                  setBands((all) => [...all, { start: '22:00', end: '06:00', amount: '1000' }])
                }
              >
                {br(l, 'surchargeAdd')}
              </button>
            )}
            <p>{br(l, 'surchargeHelp')}</p>
            <p>{br(l, 'surchargeHours')}</p>
          </fieldset>
          <div className="booking-policy-preview" aria-live="polite">
            <h3>{br(l, 'preview')}</h3>
            <strong>
              {br(l, 'fee')} ·{' '}
              {money(l, parsed.success ? parsed.data.nominationFee : rules.nominationFee)}
            </strong>
            <p>{preview ? policyText(l, preview) : br(l, 'error')}</p>
            <p>
              {br(l, 'surchargeTitle')} ·{' '}
              {parsed.success && parsed.data.timeSurcharges?.length
                ? surchargeBands(l, parsed.data.timeSurcharges)
                : br(l, 'surchargeNone')}
            </p>
            <p>
              {br(l, 'travelTitle')} ·{' '}
              {travelText(l, parsed.success ? parsed.data.areaTransportFees : undefined, areas) ||
                br(l, 'travelNone')}
            </p>
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
        <p>
          {br(l, 'surchargeTitle')} ·{' '}
          {rules.timeSurcharges?.length
            ? surchargeBands(l, rules.timeSurcharges)
            : br(l, 'surchargeNone')}
        </p>
        <p>
          {br(l, 'travelTitle')} ·{' '}
          {travelText(l, rules.areaTransportFees, areas) || br(l, 'travelNone')}
        </p>
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
                  {h.timeSurcharges?.length ? ` · ${surchargeBands(l, h.timeSurcharges)}` : ''}
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
