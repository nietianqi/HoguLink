import { randomUUID } from 'node:crypto';
import type { Actor, Booking, SupportTicket } from '@hogulink/contracts';
import type { Records } from './repository.js';
import { syncTicketHandling } from './ticket-handling.js';

export const completionWindowMs = 24 * 60 * 60_000;
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
    existing.dueAt = now + completionWindowMs;
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
    dueAt: now + completionWindowMs,
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
