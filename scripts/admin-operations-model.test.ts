import test from 'node:test';
import assert from 'node:assert/strict';
import type { AdminBooking } from '@hogulink/contracts';
import { adminPeriodMetrics, filterAdminOrders } from '../hogulink-web/src/lib/admin-model';
import { auditLabel } from '../hogulink-web/src/lib/admin-i18n';
const now = Date.UTC(2026, 9, 28, 1);
const order = (
  id: string,
  mode: 'HOME_VISIT' | 'IN_STORE' | undefined,
  startAt: number,
  createdAt = startAt,
  status = 'CONFIRMED',
  total = 8700,
): AdminBooking =>
  ({
    id,
    storeId: 'shop',
    status,
    createdAt,
    quote: { fulfillmentMode: mode, startAt, endAt: startAt + 3600000, total },
  }) as AdminBooking;
const filter = (rows: AdminBooking[], extra = {}) =>
  filterAdminOrders(rows, {
    search: '',
    storeId: '',
    status: 'all',
    period: 'all',
    describe: () => '',
    ...extra,
  });
test('admin orders distinguish legacy home visits and in-store appointments', () => {
  const rows = [
    order('legacy', undefined, now),
    order('store', 'IN_STORE', now),
    order('home', 'HOME_VISIT', now),
  ];
  assert.deepEqual(
    filter(rows, { fulfillmentMode: 'HOME_VISIT' }).map((b) => b.id),
    ['legacy', 'home'],
  );
  assert.deepEqual(
    filter(rows, { fulfillmentMode: 'IN_STORE' }).map((b) => b.id),
    ['store'],
  );
});
test('admin custom appointment dates include both JST day boundaries and sorting preserves source data', () => {
  const rows = [
    order('start', 'HOME_VISIT', Date.UTC(2026, 9, 27, 15)),
    order('end', 'IN_STORE', Date.UTC(2026, 9, 28, 14, 59, 59), now, 'CONFIRMED', 10000),
    order('next', 'HOME_VISIT', Date.UTC(2026, 9, 28, 15)),
  ];
  assert.deepEqual(
    filter(rows, { period: 'custom', from: '2026-10-28', to: '2026-10-28', sort: 'amount' }).map(
      (b) => b.id,
    ),
    ['end', 'start'],
  );
  assert.deepEqual(
    rows.map((b) => b.id),
    ['start', 'end', 'next'],
  );
});
test('period metrics use JST booking cohorts and net posted fees without counting future records', () => {
  const rows = [
    order('today', 'HOME_VISIT', now, Date.UTC(2026, 9, 27, 15), 'COMPLETED', 10000),
    order('before', 'HOME_VISIT', now, Date.UTC(2026, 9, 27, 14, 59), 'CANCELLED'),
    order('cancel', 'IN_STORE', now, now, 'CANCELLED', 5000),
    order('future', 'IN_STORE', now, now + 60000),
  ];
  const fees = [
    { id: 'f', storeId: 's', bookingId: 'today', type: 'CAPTURE', amount: 1000, createdAt: now },
    { id: 'r', storeId: 's', bookingId: 'today', type: 'REFUND', amount: -200, createdAt: now },
    {
      id: 'old',
      storeId: 's',
      bookingId: 'today',
      type: 'CAPTURE',
      amount: 400,
      createdAt: now - 86400000,
    },
  ];
  const actual = adminPeriodMetrics(rows, fees, 'today', now);
  assert.equal(actual.count, 2);
  assert.equal(actual.value, 15000);
  assert.equal(actual.completed, 1);
  assert.equal(actual.completionRate, 0.5);
  assert.equal(actual.cancelRate, 0.5);
  assert.equal(actual.fees, 800);
  assert.equal(adminPeriodMetrics(rows, fees, 'week', now).count, 3);
  assert.equal(adminPeriodMetrics([], [], 'month', now).completionRate, null);
});
test('audit actions have useful localized labels in all three languages', () => {
  for (const l of ['ja', 'en', 'zh-cn'] as const) {
    for (const action of [
      'ORDER_ALERT_OPENED',
      'ORDER_ALERT_RECOVERED',
      'ORDER_ALERT_FOLLOW_UP',
      'MEMBER_INVITED',
      'MEMBER_ACTIVATED',
      'SAFETY_HANDOVER',
      'CUSTOMER_PROFILE_VIEWED',
    ])
      assert.notEqual(auditLabel(l, action), action);
  }
  assert.equal(auditLabel('zh-cn', 'MEMBER_ACTIVATED'), '平台员工已激活');
  assert.equal(auditLabel('zh-cn', 'ORDER_ALERT_OPENED'), '发现订单预警');
});
