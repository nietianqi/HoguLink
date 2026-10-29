import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.SMOKE_API_ORIGIN,
  token = process.env.SMOKE_CLOCK_TOKEN;
if (!base || !token || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error(
    'Run these write checks through smoke:isolated with the disposable clock harness.',
  );
const realNow = Date.now.bind(Date);
let offset = 0;
async function clock(at) {
  const res = await fetch(`${base}/__qa/clock`, {
    method: at === undefined ? 'GET' : 'POST',
    headers: {
      'x-qa-token': token,
      ...(at === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: at === undefined ? undefined : JSON.stringify({ at }),
  });
  assert.equal(res.status, 200, 'Disposable test clock is available');
  const value = await res.json();
  assert.equal(value.disposable, true);
  offset = value.offset;
  return value.now;
}
await clock();
// Only this test child process uses the fixture's clock. Application clocks are unchanged.
Date.now = () => realNow() + offset;
export async function advanceVisit(b, event) {
  if (
    ['EN_ROUTE', 'ARRIVED'].includes(event) &&
    b.quote.bookingMode === 'SCHEDULED' &&
    b.quote.fulfillmentMode !== 'IN_STORE'
  )
    await clock(Math.max(Date.now(), b.quote.startAt - 90 * 60000));
  if (event === 'START') await clock(Math.max(Date.now(), b.quote.startAt));
  if (event === 'COMPLETE')
    await clock(Math.max(Date.now(), b.startedAt + b.quote.endAt - b.quote.startAt));
}
export const advanceTo = clock;
/**
 * Moves a scheduled start into the default 09:00-22:00 JST business hours, never earlier.
 * Starts stay at or before 18:00 so a script's "+3 hours" variant is still bookable.
 */
export function bookable(at) {
  const minute = Math.floor((at + 9 * 3600000) / 60000) % 1440;
  if (minute >= 9 * 60 && minute <= 18 * 60) return at;
  const ten = Math.floor((at + 9 * 3600000) / 86400000) * 86400000 + 3600000;
  return ten > at ? ten : ten + 86400000;
}
export async function fixtureCall(cookie, path, body, expected = 200, key = randomUUID()) {
  const response = await fetch(`${base}/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000',
      Cookie: cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
  return value;
}
export async function confirmVisit(customer, b) {
  assert.equal(b.status, 'AWAITING_COMPLETION');
  assert.equal(b.capturedAmount, 0, 'Therapist cannot capture');
  b = await fixtureCall(customer, `bookings/${b.id}`);
  if (b.completion?.status === 'PAYMENT_REVIEW')
    b = await fixtureCall(customer, `bookings/${b.id}/completion`, {
      version: b.version,
      action: 'REAUTHORIZE',
      expectedAmount: b.quote.total,
    });
  return fixtureCall(customer, `bookings/${b.id}/completion`, {
    version: b.version,
    action: 'CONFIRM',
    expectedAmount: b.quote.total,
  });
}
