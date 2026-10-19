import { randomUUID } from 'node:crypto';
import type { Actor } from '@hogulink/contracts';
import type { Engine } from '../../src/engine.js';
export const billingNote =
  'Reviewed the example plan, annual charge, coverage and renewal conditions.';
export async function purchaseAnnual(e: Engine, actor: Actor) {
  let w = await e.subscriptions.workspace(actor);
  await e.subscriptions.change(
    actor,
    w.storeId,
    { version: w.subscription.version, action: 'REQUEST_ANNUAL', note: billingNote },
    randomUUID(),
  );
  w = await e.subscriptions.workspace(actor);
  const i = w.invoices.find((i) => i.status === 'OPEN')!;
  await e.subscriptions.invoiceAction(
    actor,
    i.id,
    {
      version: i.version,
      subscriptionVersion: w.subscription.version,
      action: 'PAY_SUCCEEDED',
      reference: `plan_${randomUUID()}`,
      note: billingNote,
    },
    randomUUID(),
  );
  return e.subscriptions.workspace(actor);
}
