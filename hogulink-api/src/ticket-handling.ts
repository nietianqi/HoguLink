import { randomUUID } from 'node:crypto';
import {
  ticketHandlingInput,
  type Actor,
  type Audit,
  type SupportTicket,
  type TicketHandling,
  type TicketHandlingDetail,
  type TicketHandlingLog,
  type AdminMember,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { ensure } from './errors.js';
import {
  adminCaseVisible,
  adminDirectory,
  currentAdmin,
  defaultTicketTeam,
  inAdminTeam,
  requireAdmin,
} from './admin-access.js';
import { canAdmin } from '@hogulink/contracts';

const active = (t: SupportTicket) => !['RESOLVED', 'CLOSED'].includes(t.status);
export function initialHandling(ticket: SupportTicket): TicketHandling {
  return {
    id: ticket.id,
    version: 0,
    team: defaultTicketTeam(ticket),
    ownerId: null,
    state: active(ticket) ? 'TRIAGE' : 'DONE',
    followUpAt: ticket.dueAt,
    updatedAt: ticket.updatedAt,
  };
}
export async function recordTicketHandling(
  tx: Records,
  h: TicketHandling,
  actor: Actor,
  kind: TicketHandlingLog['kind'],
  note?: string,
) {
  h.version++;
  await tx.put('ticketHandling', h);
  const log: TicketHandlingLog = {
    ...h,
    id: `handling_${randomUUID()}`,
    ticketId: h.id,
    actorId: actor.id,
    kind,
    ...(note ? { note } : {}),
  };
  await tx.put('ticketHandlingLog', log);
  // Only a reference reaches the shared audit. Private notes never enter the outbox.
  await tx.put<Audit>('audit', {
    id: `audit_${randomUUID()}`,
    actorId: actor.id,
    action: `SUPPORT_HANDLING_${kind}`,
    detail: log.id,
    at: h.updatedAt,
  });
}
export async function syncTicketHandling(
  tx: Records,
  ticket: SupportTicket,
  actor: Actor,
  kind: 'MESSAGE' | 'RESOLVE' | 'CLOSE' | 'REOPEN' | 'ESCALATE',
  now: number,
) {
  const h = await tx.get<TicketHandling>('ticketHandling', ticket.id);
  if (!h) return;
  // A finished case may be reopened after its former owner has left the team.
  if (active(ticket) && h.ownerId) {
    const owner = await tx.get<AdminMember>('adminMembers', h.ownerId);
    if (
      (owner &&
        (owner.status !== 'ACTIVE' ||
          !canAdmin(
            { id: owner.id, role: 'ADMIN', verificationLevel: 3, adminRole: owner.adminRole },
            'cases.write',
          ) ||
          !owner.teams.includes(h.team))) ||
      (!owner && h.ownerId.startsWith('member_'))
    )
      h.ownerId = null;
  }
  let change: TicketHandlingLog['kind'] | undefined;
  if (!active(ticket) && h.state !== 'DONE') {
    h.state = 'DONE';
    change = 'RESOLVED';
  } else if (kind === 'REOPEN') {
    h.state = h.ownerId ? 'ACTIVE' : 'TRIAGE';
    h.followUpAt = ticket.dueAt;
    change = 'REOPENED';
  } else if (kind === 'ESCALATE' && active(ticket)) {
    h.state = h.ownerId ? 'ACTIVE' : 'TRIAGE';
    h.followUpAt = now;
    change = 'ESCALATED';
  } else if (
    kind === 'MESSAGE' &&
    ((actor.role === ticket.reporterRole &&
      actor.id === ticket.reporterId &&
      h.state === 'WAITING_CUSTOMER') ||
      (actor.role === 'MERCHANT' && h.state === 'WAITING_MERCHANT'))
  ) {
    h.state = h.ownerId ? 'ACTIVE' : 'TRIAGE';
    h.followUpAt = now;
    change = 'REPLY_RECEIVED';
  }
  if (change) {
    h.updatedAt = now;
    await recordTicketHandling(tx, h, actor, change);
  }
}
export class TicketHandlingService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private role(actor: Actor) {
    ensure(actor.role === 'ADMIN', 'FORBIDDEN', 'Administrator account required.', 403);
  }
  private async ticket(tx: Records, id: string, actor: Actor) {
    const t = await tx.get<SupportTicket>('supportTickets', id);
    ensure(
      t && (await adminCaseVisible(tx, actor, t)),
      'NOT_FOUND',
      'Support case not found.',
      404,
    );
    return t;
  }
  private async view(tx: Records, ticket: SupportTicket): Promise<TicketHandlingDetail> {
    const handling =
        (await tx.get<TicketHandling>('ticketHandling', ticket.id)) ?? initialHandling(ticket),
      history = (await tx.list<TicketHandlingLog>('ticketHandlingLog'))
        .filter((x) => x.ticketId === ticket.id)
        .sort((a, b) => b.version - a.version);
    const ids = new Set([handling.ownerId, ...history.flatMap((h) => [h.ownerId, h.actorId])]);
    return {
      handling,
      history,
      people: (await tx.list<AdminMember>('adminMembers'))
        .filter((m) => ids.has(m.id))
        .map((m) => ({ id: m.id, name: m.name })),
    };
  }
  async detail(actor: Actor, id: string) {
    this.role(actor);
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'cases.read');
      const detail = await this.view(tx, await this.ticket(tx, id, actor));
      return {
        ...detail,
        assignees: (await adminDirectory(tx, this.now())).filter(
          (m) =>
            (actor.adminRole ?? 'OWNER') === 'OWNER' ||
            m.teams.some((team) => inAdminTeam(actor, team)),
        ),
      };
    });
  }
  async update(actor: Actor, id: string, input: unknown) {
    this.role(actor);
    const d = ticketHandlingInput.parse(input);
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'cases.write');
      const ticket = await this.ticket(tx, id, actor),
        h = (await this.view(tx, ticket)).handling;
      ensure(
        ticket.version === d.ticketVersion && h.version === d.version,
        'VERSION_CONFLICT',
        'This case changed. Refresh before continuing.',
        409,
      );
      ensure(
        active(ticket),
        'INVALID_STATE',
        'Reopen a finished case before updating its handling.',
        409,
      );
      ensure(
        d.followUpAt > this.now() && d.followUpAt <= this.now() + 7 * 86400000,
        'INVALID_FOLLOW_UP',
        'Choose a follow-up within the next seven days.',
        409,
      );
      ensure(
        d.state !== 'WAITING_MERCHANT' || ticket.visibility === 'SHOP_AND_CUSTOMER',
        'PRIVATE_CASE',
        'A private report cannot be routed to the shop.',
        409,
      );
      ensure(
        inAdminTeam(actor, d.team) &&
          (defaultTicketTeam(ticket) !== 'TRUST_SAFETY' || d.team === 'TRUST_SAFETY'),
        'INVALID_TEAM',
        'Choose an authorized handling group.',
        403,
      );
      const privileged = canAdmin(actor, 'cases.assign');
      ensure(
        privileged || !h.ownerId || h.ownerId === actor.id,
        'FORBIDDEN',
        'Only a dispatcher can change another employee’s work.',
        403,
      );
      ensure(
        d.ownership !== 'ASSIGN' || (privileged && !!d.assigneeId),
        'FORBIDDEN',
        'Dispatcher permission and a recipient are required.',
        403,
      );
      ensure(
        d.ownership === 'ASSIGN' || !d.assigneeId,
        'INVALID_ASSIGNEE',
        'A recipient is only valid for explicit assignment.',
        422,
      );
      ensure(
        d.ownership !== 'CLAIM' || !h.ownerId || h.ownerId === actor.id,
        'ALREADY_ASSIGNED',
        'Release the current owner explicitly before claiming this case.',
        409,
      );
      const directory = await adminDirectory(tx, this.now());
      const recipient =
        d.ownership === 'ASSIGN' ? d.assigneeId : d.ownership === 'CLAIM' ? actor.id : undefined;
      if (recipient)
        ensure(
          directory.some((m) => m.id === recipient && m.teams.includes(d.team)) ||
            (!actor.adminRole && recipient === actor.id),
          'INVALID_ASSIGNEE',
          'Choose an active employee in this group with case permissions.',
          409,
        );
      h.ownerId =
        d.ownership === 'ASSIGN'
          ? d.assigneeId!
          : d.ownership === 'CLAIM'
            ? actor.id
            : d.ownership === 'RELEASE' || d.team !== h.team
              ? null
              : h.ownerId;
      ensure(
        d.state === 'TRIAGE' || h.ownerId,
        'OWNER_REQUIRED',
        'Claim this case before starting or waiting for a reply.',
        409,
      );
      h.team = d.team;
      h.state = d.state;
      h.followUpAt = d.followUpAt;
      h.updatedAt = this.now();
      await recordTicketHandling(tx, h, actor, 'UPDATED', d.note);
      return {
        ...(await this.view(tx, ticket)),
        assignees: directory.filter(
          (m) =>
            (actor.adminRole ?? 'OWNER') === 'OWNER' ||
            m.teams.some((team) => inAdminTeam(actor, team)),
        ),
      };
    });
  }
}
