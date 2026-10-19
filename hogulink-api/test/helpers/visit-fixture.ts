import { randomUUID } from 'node:crypto';
import type { Actor, Booking } from '@hogulink/contracts';
import type { Engine } from '../../src/engine.js';
const clocks = new WeakMap<Engine, (at: number) => void>();
export function registerClock(e: Engine, set: (at: number) => void) {
  clocks.set(e, set);
}
export function advanceClock(e: Engine, at: number) {
  const set = clocks.get(e);
  if (!set) throw new Error('Register the injected test clock before advancing service time.');
  set(Math.max(e.now(), at));
}
export async function finishVisit(e: Engine, b: Booking, staff: Actor, customer: Actor) {
  advanceClock(e, b.quote.startAt);
  for (const event of ['EN_ROUTE', 'ARRIVED', 'START'])
    if (
      ({ CONFIRMED: 'EN_ROUTE', EN_ROUTE: 'ARRIVED', ARRIVED: 'START' } as Record<string, string>)[
        b.status
      ] === event
    )
      b = await e.event(staff, b.id, b.version, event);
  advanceClock(e, b.startedAt! + b.quote.endAt - b.quote.startAt);
  if (b.status === 'IN_SERVICE') b = await e.event(staff, b.id, b.version, 'COMPLETE');
  b = await e.booking(customer, b.id);
  if (b.completion?.status === 'PAYMENT_REVIEW')
    b = await e.completionAction(
      customer,
      b.id,
      { version: b.version, action: 'REAUTHORIZE', expectedAmount: b.quote.total },
      randomUUID(),
    );
  return e.completionAction(
    customer,
    b.id,
    { version: b.version, action: 'CONFIRM', expectedAmount: b.quote.total },
    randomUUID(),
  );
}
