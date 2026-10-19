import type { Locale, ReportExport, ReportMetrics, ReportQuery } from '@hogulink/contracts';
import { csvCell } from './desktop-model';
import { reportLabel } from './reporting-i18n';
export const japanDate = (at = Date.now()) => new Date(at + 9 * 3600000).toISOString().slice(0, 10);
export function reportPreset(days: number, now = Date.now()): ReportQuery {
  const to = japanDate(now);
  return {
    from:
      days === 0
        ? to.slice(0, 7) + '-01'
        : japanDate(Date.parse(to + 'T00:00:00+09:00') - (days - 1) * 86400000),
    to,
    groupBy: 'day',
  };
}
export function reportDelta(current: number, previous: number) {
  return previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100;
}
export const reportRate = (v: number | null) => (v === null ? '—' : `${(v / 100).toFixed(1)}%`);
export function metricValue(l: Locale, key: keyof ReportMetrics, value: number | null) {
  if (value === null) return '—';
  if (key === 'completionBps') return reportRate(value);
  return [
    'captured',
    'refunded',
    'platformFee',
    'salesNet',
    'merchantNet',
    'knownProcessorFee',
    'merchantNetAfterFees',
    'averageCapture',
    'annualPaid',
    'settlementRecorded',
    'invoiceIssued',
    'invoiceCredits',
    'invoiceNet',
  ].includes(key)
    ? new Intl.NumberFormat(l === 'zh-cn' ? 'zh-CN' : l, {
        style: 'currency',
        currency: 'JPY',
        maximumFractionDigits: 0,
      }).format(value)
    : new Intl.NumberFormat(l === 'zh-cn' ? 'zh-CN' : l).format(value);
}
export function reportCsv(d: ReportExport, l: Locale) {
  const metadata = [
      'report_id',
      'generated_at_jst',
      'period_from',
      'period_to',
      'previous_from',
      'previous_to',
      'currency',
      'time_zone',
      'group_by',
      'store_scope',
      'mode',
      'snapshot_token',
      'definition_version',
    ],
    values = [
      d.id,
      new Date(d.at + 9 * 3600000).toISOString().replace('Z', '+09:00'),
      d.from,
      d.to,
      d.previousPeriod.from,
      d.previousPeriod.to,
      d.currency,
      d.timeZone,
      d.groupBy,
      d.storeIds.join(' | '),
      d.mode,
      d.token,
      d.definitionVersion,
    ];
  return (
    '\ufeff' +
    [
      [
        ...metadata,
        ...d.columns.map((k) => reportLabel(l, k) + (k === 'completionBps' ? ' (bps)' : '')),
      ],
      ...d.rows.map((row) => [
        ...values,
        ...row.map((value, i) =>
          typeof value === 'string' && d.columns[i] === 'metric'
            ? value.startsWith('balance.')
              ? reportLabel(l, 'balances') + ' / ' + reportLabel(l, value.slice(8))
              : value.startsWith('quality.')
                ? reportLabel(l, 'quality') + ' / ' + reportLabel(l, value.slice(8))
                : reportLabel(l, value)
            : value === null
              ? 'UNASSESSED'
              : value,
        ),
      ]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')
  );
}
