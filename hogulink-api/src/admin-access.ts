import {
  canAdmin,
  ticketTeams,
  type Actor,
  type AdminPermission,
  type SupportTicket,
  type TicketHandling,
  type TicketTeam,
  type AdminMember,
  type AdminAssignee,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { ensure } from './errors.js';
export function requireAdmin(actor: Actor, permission: AdminPermission) {
  ensure(canAdmin(actor, permission), 'FORBIDDEN', 'This role cannot perform this action.', 403);
}
export const defaultTicketTeam = (ticket: SupportTicket): TicketTeam =>
  ['SAFETY', 'PRIVACY', 'QUALIFICATION', 'APPEAL'].includes(ticket.category)
    ? 'TRUST_SAFETY'
    : ticket.category === 'MERCHANT_UNREACHABLE'
      ? 'MERCHANT_OPERATIONS'
      : 'CUSTOMER_SUPPORT';
export const inAdminTeam = (actor: Actor, team: TicketTeam) =>
  actor.role === 'ADMIN' &&
  ((actor.adminRole ?? 'OWNER') === 'OWNER' || !!actor.adminTeams?.includes(team));
export async function adminCaseVisible(tx: Records, actor: Actor, ticket: SupportTicket) {
  if (!canAdmin(actor, 'cases.read')) return false;
  const work = await tx.get<TicketHandling>('ticketHandling', ticket.id);
  return (
    inAdminTeam(actor, work?.team ?? defaultTicketTeam(ticket)) &&
    (defaultTicketTeam(ticket) !== 'TRUST_SAFETY' || inAdminTeam(actor, 'TRUST_SAFETY'))
  );
}
export const bootstrapMember = (now: number): AdminMember => ({
  id: 'demo-admin',
  name: 'Demo Owner',
  email: 'owner@hogulink.example',
  adminRole: 'OWNER',
  teams: [...ticketTeams],
  status: 'ACTIVE',
  version: 1,
  sessionVersion: 1,
  createdAt: now,
  updatedAt: now,
  bootstrap: true,
});
export async function adminDirectory(tx: Records, now: number): Promise<AdminAssignee[]> {
  const members = await tx.list<AdminMember>('adminMembers');
  if (!members.some((m) => m.id === 'demo-admin')) members.push(bootstrapMember(now));
  const tickets = await tx.list<SupportTicket>('supportTickets'),
    work = await tx.list<TicketHandling>('ticketHandling');
  return members
    .filter(
      (m) =>
        m.status === 'ACTIVE' &&
        canAdmin(
          { id: m.id, role: 'ADMIN', verificationLevel: 3, adminRole: m.adminRole },
          'cases.write',
        ),
    )
    .map((m) => ({
      id: m.id,
      name: m.name,
      adminRole: m.adminRole,
      teams: m.teams,
      openCases: work.filter(
        (h) =>
          h.ownerId === m.id &&
          tickets.some((t) => t.id === h.id && !['RESOLVED', 'CLOSED'].includes(t.status)),
      ).length,
    }));
}
export async function currentAdmin(tx: Records, actor: Actor): Promise<Actor> {
  if (!actor.adminRole || actor.id === 'system') return actor;
  const member = await tx.get<AdminMember>('adminMembers', actor.id);
  ensure(
    member?.status === 'ACTIVE' && member.sessionVersion === actor.adminSessionVersion,
    'UNAUTHENTICATED',
    'This staff session is no longer valid.',
    401,
  );
  return {
    ...actor,
    adminRole: member.adminRole,
    adminTeams: member.teams,
    displayName: member.name,
  };
}
// Defense for legacy broad endpoints: their old aggregate views are owner-only.
export function authorizeAdminRoute(actor: Actor, path: string, method: string) {
  if (actor.role !== 'ADMIN') return;
  if (path === 'admin/workspace') return;
  if (path === 'admin/reports' || path.startsWith('admin/reports/')) {
    requireAdmin(actor, path === 'admin/reports' ? 'finance.read' : 'finance.export');
    return;
  }
  if (
    path === 'admin/finance' ||
    path.startsWith('admin/finance/') ||
    path === 'admin/invoicing' ||
    path.startsWith('admin/invoicing/') ||
    path.startsWith('billing/invoice-requests/') ||
    path === 'admin/subscriptions' ||
    path.startsWith('admin/subscriptions/')
  ) {
    requireAdmin(actor, method === 'GET' ? 'finance.read' : 'finance.write');
    return;
  }
  if (path.startsWith('finance/settlements/')) {
    requireAdmin(actor, method === 'GET' ? 'finance.read' : 'finance.write');
    return;
  }
  if (path.startsWith('billing/plan-invoices/')) {
    requireAdmin(actor, method === 'GET' ? 'finance.read' : 'finance.write');
    return;
  }
  if (path === 'admin/order-monitor' || path.startsWith('admin/order-alerts/')) {
    requireAdmin(actor, 'orders.read');
    if (method !== 'GET') requireAdmin(actor, 'cases.write');
    return;
  }
  let permission: AdminPermission | undefined;
  if (path.startsWith('admin/experience')) permission = 'supply.write';
  else if (path.startsWith('fulfillment/')) permission = 'safety.write';
  else if (path.startsWith('onboarding/')) permission = 'supply.write';
  else if (path.startsWith('admin/members')) permission = 'members.manage';
  else if (path.startsWith('admin/support-tickets'))
    permission = method === 'GET' ? 'cases.read' : 'cases.write';
  else if (path.startsWith('support-tickets'))
    permission = method === 'GET' ? 'cases.read' : 'cases.write';
  else if (path === 'admin/reviews' || path === 'admin/enforcement-actions')
    permission = 'supply.write';
  else if (
    path.startsWith('admin/customer-restrictions') ||
    path.startsWith('admin/safety-events') ||
    path === 'safety-events'
  )
    permission = 'safety.write';
  else if (
    path === 'bookings' ||
    /^bookings\/[^/]+$/.test(path) ||
    (method === 'GET' && /^bookings\/[^/]+\/completion$/.test(path))
  )
    permission = 'orders.read';
  else if (path === 'auth/employee/password') return;
  else
    ensure(
      (actor.adminRole ?? 'OWNER') === 'OWNER',
      'FORBIDDEN',
      'This legacy endpoint is limited to platform owners.',
      403,
    );
  if (permission) requireAdmin(actor, permission);
}
