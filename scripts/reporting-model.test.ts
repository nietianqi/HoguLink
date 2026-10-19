import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReportExport } from '@hogulink/contracts';
import {
  japanDate,
  reportPreset,
  reportDelta,
  reportRate,
  reportCsv,
  metricValue,
} from '../hogulink-web/src/lib/reporting-model';
test('Japan dates and presets cross calendar boundaries with inclusive length', () => {
  const at = Date.UTC(2026, 9, 17, 15);
  assert.equal(japanDate(at), '2026-10-18');
  assert.deepEqual(reportPreset(7, at), { from: '2026-10-12', to: '2026-10-18', groupBy: 'day' });
  assert.equal(reportPreset(0, at).from, '2026-10-01');
  assert.equal(reportPreset(30, Date.UTC(2026, 0, 1)).from, '2025-12-03');
});
test('comparison avoids invented growth percentages at zero and handles negative prior net', () => {
  assert.equal(reportDelta(100, 0), null);
  assert.equal(reportDelta(0, 0), null);
  assert.equal(reportDelta(-50, -100), 50);
  assert.equal(reportDelta(90, 100), -10);
  assert.equal(reportRate(null), '—');
  assert.equal(reportRate(10000), '100.0%');
});
test('metric formatting preserves unknown amounts rather than displaying zero', () => {
  assert.equal(metricValue('en', 'merchantNetAfterFees', null), '—');
  assert.equal(metricValue('en', 'completionBps', 5000), '50.0%');
  assert.match(metricValue('en', 'refunded', 1000), /1,000/);
});
const d: ReportExport = {
  definitionVersion: 'reporting-demo-v1',
  id: 'report_qa',
  at: Date.UTC(2026, 9, 17, 15),
  from: '2026-10-01',
  to: '2026-10-18',
  previousPeriod: { from: '2026-09-13', to: '2026-09-30' },
  groupBy: 'day',
  storeIds: ['store-nagi'],
  type: 'summary',
  rowCount: 2,
  token: 'a'.repeat(64),
  mode: 'DEMO',
  currency: 'JPY',
  timeZone: 'Asia/Tokyo',
  columns: ['metric', 'current', 'previous'],
  rows: [
    ['merchantNetAfterFees', null, 0],
    ['=HYPERLINK("bad")', 100, 0],
  ],
};
test('CSV includes scope, time, source token, definitions and formula-safe cells', () => {
  const csv = reportCsv(d, 'zh-cn');
  assert(csv.startsWith('\ufeff'));
  for (const v of [
    'report_id',
    'Asia/Tokyo',
    '2026-10-18T00:00:00.000+09:00',
    'store-nagi',
    d.token,
    'UNASSESSED',
    'DEMO',
    '全量渠道费核对后净额',
  ])
    assert(csv.includes(v), v);
  assert(csv.includes("'=HYPERLINK"));
  assert.equal(csv.split('\r\n').length, 3);
});
test('negative financial numbers stay numeric while formula-like strings remain escaped', () => {
  const csv = reportCsv(
    {
      ...d,
      columns: ['platformFee', 'refunded', 'metric'],
      rows: [[-88, 1000, '-HYPERLINK("bad")']],
    },
    'en',
  );
  assert(csv.includes('"-88","1000"'));
  assert(!csv.includes("'-88"));
  assert(csv.includes("'-HYPERLINK"));
});
