'use client';
import { useState } from 'react';
import { adminPeriodMetrics, type AdminWorkspace } from '@/lib/admin-model';
import { ot } from '@/lib/admin-operations-i18n';
import { money } from '@/lib/i18n';
import { sv } from '@/lib/service-mode-i18n';
import type { Locale } from '@hogulink/contracts';
export function AdminMetrics({
  locale: l,
  data,
  canFinance,
}: {
  locale: Locale;
  data: AdminWorkspace;
  canFinance: boolean;
}) {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const metrics = adminPeriodMetrics(data.bookings, data.feeEntries, period, data.generatedAt);
  const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);
  return (
    <section className="admin-panel admin-period-metrics">
      <div className="admin-panel-heading">
        <div>
          <h2>{ot(l, 'metrics')}</h2>
          <p>{ot(l, 'metricsHelp')}</p>
        </div>
        <select
          aria-label={ot(l, 'metrics')}
          value={period}
          onChange={(e) => setPeriod(e.target.value as typeof period)}
        >
          {(['today', 'week', 'month'] as const).map((p) => (
            <option key={p} value={p}>
              {ot(l, p)}
            </option>
          ))}
        </select>
      </div>
      <div className="admin-stat-grid">
        {(
          [
            ['requests', metrics.count],
            ['bookingValue', money(l, metrics.value)],
            ['completed', metrics.completed],
            ['completionRate', percent(metrics.completionRate)],
            ['cancelRate', percent(metrics.cancelRate)],
            ...(canFinance ? [['fees', money(l, metrics.fees)]] : []),
          ] as const
        ).map(([key, value]) => (
          <div key={key}>
            <span>{ot(l, key as 'requests')}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="admin-mode-metrics">
        {(['HOME_VISIT', 'IN_STORE'] as const).map((mode) => (
          <span key={mode}>
            {sv(l, mode)}{' '}
            <strong>
              {
                data.bookings.filter(
                  (b) =>
                    (b.quote.fulfillmentMode ?? 'HOME_VISIT') === mode &&
                    b.createdAt >= metrics.start &&
                    b.createdAt <= data.generatedAt,
                ).length
              }
            </strong>
          </span>
        ))}
      </div>
    </section>
  );
}
