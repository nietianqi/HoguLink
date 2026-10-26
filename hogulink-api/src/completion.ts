import { randomUUID } from 'node:crypto';
import type { Actor, Booking, SupportTicket } from '@hogulink/contracts';
import type { Records } from './repository.js';
import { syncTicketHandling } from './ticket-handling.js';

/** Customers confirm or dispute within this window after the visit; silence counts as acceptance. */
export const completionWindowMs = 72 * 60 * 60_000;
export async function autoAcceptanceAllowed(tx: Records, b: Booking) {
  if (
    b.quote.completionPolicy?.version !== 'silence-72h-v1' ||
    !b.completion ||
    b.completion.confirmBy < b.completion.endedAt + completionWindowMs
  )
    return false;
  if (
    (await tx.find<SupportTicket>('supportTickets', { bookingId: b.id })).some(
      (t) => !['CLOSED', 'RESOLVED'].includes(t.status),
    )
  )
    return false;
  return !(await tx.find<{ id: string }>('safety', { bookingId: b.id, status: 'OPEN' })).length;
}
/** Follow-up due time for a completion review case. */
const completionCaseDueMs = 24 * 60 * 60_000;
// Duration is the purchased snapshot, never the current service catalogue or a client timer.
export const serviceEligibleAt = (b: Booking) =>
  b.startedAt === undefined ? undefined : b.startedAt + b.quote.endAt - b.quote.startAt;

export async function completionCase(tx: Records, b: Booking, now: number, note: string) {
  const c = b.completion!;
  const existing = c.ticketId && (await tx.get<SupportTicket>('supportTickets', c.ticketId));
  if (existing) {
    existing.status = 'PLATFORM_ESCALATED';
    existing.version++;
    existing.updatedAt = now;
    existing.dueAt = now + completionCaseDueMs;
    existing.resolution = undefined;
    existing.resolvedAt = undefined;
    existing.resolvedBy = undefined;
    await tx.put('supportTickets', existing);
    await tx.put('ticketMessages', {
      id: `message_${randomUUID()}`,
      ticketId: existing.id,
      actorId: 'system',
      role: 'ADMIN',
      text: note,
      kind: 'ESCALATION',
      createdAt: now,
    });
    await syncTicketHandling(
      tx,
      existing,
      { id: 'system', role: 'ADMIN', verificationLevel: 3 },
      'ESCALATE',
      now,
    );
    return;
  }
  // A system-generated service issue must remain possible even when a user has reached their case quota.
  const ticket: SupportTicket = {
    id: `case_${randomUUID()}`,
    bookingId: b.id,
    storeId: b.storeId,
    customerId: b.customerId,
    reporterId: b.customerId,
    reporterRole: 'CUSTOMER',
    category: 'SERVICE_QUALITY',
    subject: '服务完成确认异常 / Service completion review',
    description: note,
    visibility: 'SHOP_AND_CUSTOMER',
    priority: 'HIGH',
    status: 'PLATFORM_ESCALATED',
    version: 1,
    createdAt: now,
    updatedAt: now,
    dueAt: now + completionCaseDueMs,
  };
  await tx.put('supportTickets', ticket);
  c.ticketId = ticket.id;
  await syncTicketHandling(
    tx,
    ticket,
    { id: 'system', role: 'ADMIN', verificationLevel: 3 },
    'ESCALATE',
    now,
  );
}

export async function completionReceipt(
  tx: Records,
  b: Booking,
  actor: Actor,
  now: number,
  text: string,
) {
  if (!b.completion?.ticketId) return;
  await tx.put('ticketMessages', {
    id: `message_${randomUUID()}`,
    ticketId: b.completion.ticketId,
    actorId: actor.id,
    role: actor.role,
    text,
    kind: 'MESSAGE',
    createdAt: now,
  });
  // The case stays open for verification; finishing the booking does not silently close an arbitration.
}
