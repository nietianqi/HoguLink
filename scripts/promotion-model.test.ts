import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokyoPromotionInput,
  parseTokyoPromotionInput,
  promotionFormWindow,
} from '../hogulink-web/src/lib/promotion-model.js';

test('promotion wall-time input round trips across Tokyo midnight', () => {
  const at = Date.UTC(2026, 9, 19, 15, 30);
  assert.equal(tokyoPromotionInput(at), '2026-10-20T00:30');
  assert.equal(parseTokyoPromotionInput('2026-10-20T00:30'), at);
});

test('one-hour form keeps minute precision even when submitted midway through a minute', () => {
  const now = Date.UTC(2026, 9, 19, 0, 0, 35, 456);
  const window = promotionFormWindow('2026-10-19T09:00', '2026-10-19T10:00', now);
  assert.equal(window.endsAt - window.startsAt, 3600000);
  assert.ok(now - window.startsAt < 60000);
  const future = promotionFormWindow('2026-10-20T09:00', '2026-10-20T10:00', now);
  assert.equal(future.endsAt - future.startsAt, 3600000);
});
