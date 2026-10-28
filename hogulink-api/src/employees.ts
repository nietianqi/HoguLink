import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  adminRoles,
  adminRolePermissions,
  ticketTeams,
  canAdmin,
  type Actor,
  type AdminMember,
  type TicketHandling,
  type SupportTicket,
} from '@hogulink/contracts';
import type { Records, Repository } from './repository.js';
import { ensure } from './errors.js';
import { bootstrapMember, currentAdmin, requireAdmin } from './admin-access.js';
import { recordTicketHandling } from './ticket-handling.js';
import { enqueueEmail, invitationEmail } from './notifications.js';
import { generateTotpSecret, totpStep, totpUri } from './totp.js';

type Credentials = {
  id: string;
  salt?: string;
  hash?: string;
  inviteHash?: string;
  inviteExpiresAt?: number;
  /** Authenticator secret once enrolled; required at every password sign-in. */
  totpSecret?: string;
  /** Secret shown during enrolment, confirmed by the first valid code. */
  pendingTotp?: string;
  /** Last accepted time step, so a code cannot be used twice. */
  lastTotpStep?: number;
};
const codeInput = z
  .string()
  .trim()
  .regex(/^\d{6}$/);
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const passwordInput = z.string().min(12).max(128);
const emailInput = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const fields = {
  name: z.string().trim().min(2).max(80),
  adminRole: z.enum(adminRoles),
  teams: z.array(z.enum(ticketTeams)).max(3),
};
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 64, (e, key) => (e ? reject(e) : resolve(key))),
  );
export async function bootstrapAdmin(repo: Repository, now = Date.now()) {
  await repo.transaction(async (tx) => {
    if (!(await tx.get('adminMembers', 'demo-admin')))
      await tx.put('adminMembers', bootstrapMember(now));
  });
}
export class EmployeeService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private async owner(tx: Records, actor: Actor) {
    const effective = await currentAdmin(tx, actor);
    requireAdmin(effective, 'members.manage');
  }
  private teams(d: { adminRole: AdminMember['adminRole']; teams: AdminMember['teams'] }) {
    const teams = [...new Set(d.teams)];
    ensure(teams.length === d.teams.length, 'INVALID_TEAM', 'Choose each team once.', 422);
    if (d.adminRole === 'OWNER') return [...ticketTeams];
    const handles = adminRolePermissions[d.adminRole].includes('cases.write');
    ensure(
      handles ? teams.length > 0 : teams.length === 0,
      'INVALID_TEAM',
      'Handling roles need a team; finance and auditors do not handle cases.',
      422,
    );
    ensure(
      d.adminRole !== 'SUPPORT' || !teams.includes('TRUST_SAFETY'),
      'INVALID_TEAM',
      'Support staff cannot join the protected safety group.',
      422,
    );
    ensure(
      d.adminRole !== 'TRUST_SAFETY' || teams.every((t) => t === 'TRUST_SAFETY'),
      'INVALID_TEAM',
      'Safety reviewers belong to the safety group.',
      422,
    );
    return teams;
  }
  private async activity(
    tx: Records,
    actor: Actor,
    member: AdminMember,
    action: string,
    reason = '',
  ) {
    const event = {
      id: `member_event_${randomUUID()}`,
      memberId: member.id,
      actorId: actor.id,
      action,
      reason,
      at: this.now(),
      version: member.version,
    };
    await tx.put('adminMemberActivity', event);
    await tx.put('audit', {
      id: `audit_${randomUUID()}`,
      actorId: actor.id,
      action: `MEMBER_${action}`,
      actorRole: 'ADMIN',
      detail: event.id,
      at: this.now(),
    });
  }
  private async invite(tx: Records, member: AdminMember) {
    const token = randomBytes(32).toString('hex'),
      expiresAt = this.now() + 72 * 3600000;
    const credentials = (await tx.get<Credentials>('adminCredentials', member.id)) ?? {
      id: member.id,
    };
    credentials.inviteHash = hashToken(token);
    credentials.inviteExpiresAt = expiresAt;
    member.inviteExpiresAt = expiresAt;
    await tx.put('adminCredentials', credentials);
    await tx.put('adminMembers', member);
    await enqueueEmail(
      tx,
      invitationEmail(member.email, token, 'employee'),
      'EMPLOYEE_INVITATION',
      this.now(),
    );
    return { member, token, expiresAt, delivery: 'MANUAL_LOCAL_ONLY' };
  }
  private async releaseWork(tx: Records, member: AdminMember, actor: Actor) {
    const tickets = await tx.list<SupportTicket>('supportTickets');
    let released = 0;
    for (const h of await tx.list<TicketHandling>('ticketHandling')) {
      if (
        h.ownerId !== member.id ||
        !tickets.some((t) => t.id === h.id && !['RESOLVED', 'CLOSED'].includes(t.status))
      )
        continue;
      if (
        member.status === 'ACTIVE' &&
        adminRolePermissions[member.adminRole].includes('cases.write') &&
        member.teams.includes(h.team)
      )
        continue;
      h.ownerId = null;
      h.state = 'TRIAGE';
      h.followUpAt = this.now();
      h.updatedAt = this.now();
      await recordTicketHandling(tx, h, actor, 'OWNER_UNAVAILABLE');
      released++;
    }
    return released;
  }
  async list(actor: Actor) {
    return this.run(async (tx) => {
      await this.owner(tx, actor);
      const members = await tx.list<AdminMember>('adminMembers');
      if (!members.some((m) => m.id === 'demo-admin')) members.unshift(bootstrapMember(this.now()));
      return {
        members,
        roles: adminRolePermissions,
        activity: (await tx.list<{ at: number }>('adminMemberActivity'))
          .sort((a, b) => b.at - a.at)
          .slice(0, 100),
      };
    });
  }
  async create(actor: Actor, input: unknown) {
    const d = z
      .object({ ...fields, email: emailInput })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      await this.owner(tx, actor);
      const teams = this.teams(d);
      ensure(
        !(await tx.list<AdminMember>('adminMembers')).some(
          (m) => m.email.toLowerCase() === d.email,
        ) && d.email !== 'owner@hogulink.example',
        'EMAIL_EXISTS',
        'This email already has an employee account.',
        409,
      );
      const m: AdminMember = {
        id: `member_${randomUUID()}`,
        name: d.name,
        email: d.email,
        adminRole: d.adminRole,
        teams,
        status: 'INVITED',
        version: 1,
        sessionVersion: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      const invitation = await this.invite(tx, m);
      await this.activity(tx, actor, m, 'INVITED');
      return invitation;
    });
  }
  async update(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({
        ...fields,
        version: z.number().int().positive(),
        enabled: z.boolean(),
        reason: z.string().trim().min(10).max(1000),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      await this.owner(tx, actor);
      const m = await tx.get<AdminMember>('adminMembers', id);
      ensure(m, 'NOT_FOUND', 'Employee not found.', 404);
      ensure(
        m.version === d.version,
        'VERSION_CONFLICT',
        'This employee changed. Refresh first.',
        409,
      );
      ensure(
        !m.bootstrap && actor.id !== id,
        'SELF_MANAGEMENT',
        'Use another owner to change this account.',
        409,
      );
      if (
        m.status === 'ACTIVE' &&
        m.adminRole === 'OWNER' &&
        (!d.enabled || d.adminRole !== 'OWNER')
      )
        ensure(
          (await tx.list<AdminMember>('adminMembers')).some(
            (x) => x.id !== id && x.status === 'ACTIVE' && x.adminRole === 'OWNER',
          ),
          'LAST_OWNER',
          'An active platform owner must remain.',
          409,
        );
      const credentials = await tx.get<Credentials>('adminCredentials', id);
      if (!d.enabled && credentials) {
        delete credentials.hash;
        delete credentials.salt;
        delete credentials.inviteHash;
        delete credentials.inviteExpiresAt;
        await tx.put('adminCredentials', credentials);
        delete m.inviteExpiresAt;
      }
      m.name = d.name;
      m.adminRole = d.adminRole;
      m.teams = this.teams(d);
      m.status = d.enabled ? (credentials?.hash ? 'ACTIVE' : 'INVITED') : 'DISABLED';
      m.version++;
      m.sessionVersion++;
      m.updatedAt = this.now();
      await tx.put('adminMembers', m);
      const released = await this.releaseWork(tx, m, actor);
      await this.activity(tx, actor, m, m.status === 'DISABLED' ? 'DISABLED' : 'UPDATED', d.reason);
      return { member: m, released };
    });
  }
  async reissue(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({ version: z.number().int().positive(), reason: z.string().trim().min(10).max(1000) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      await this.owner(tx, actor);
      const m = await tx.get<AdminMember>('adminMembers', id);
      ensure(m, 'NOT_FOUND', 'Employee not found.', 404);
      ensure(m.version === d.version, 'VERSION_CONFLICT', 'This employee changed.', 409);
      ensure(
        !m.bootstrap && actor.id !== id && m.status !== 'DISABLED',
        'SELF_MANAGEMENT',
        'Enable the account before issuing a new link.',
        409,
      );
      m.status = 'INVITED';
      const oldCredentials = await tx.get<Credentials>('adminCredentials', id);
      if (oldCredentials) {
        delete oldCredentials.hash;
        delete oldCredentials.salt;
        // A new link also resets the authenticator, e.g. after a lost phone.
        delete oldCredentials.totpSecret;
        delete oldCredentials.pendingTotp;
        delete oldCredentials.lastTotpStep;
        await tx.put('adminCredentials', oldCredentials);
      }
      m.version++;
      m.sessionVersion++;
      m.updatedAt = this.now();
      const invitation = await this.invite(tx, m);
      const released = await this.releaseWork(tx, m, actor);
      await this.activity(tx, actor, m, 'INVITATION_REISSUED', d.reason);
      return { ...invitation, released };
    });
  }
  private async invitation(tx: Records, token: string) {
    const credentials = (await tx.list<Credentials>('adminCredentials')).find(
      (c) => c.inviteHash === hashToken(token),
    );
    const m = credentials && (await tx.get<AdminMember>('adminMembers', credentials.id));
    ensure(
      credentials && m?.status === 'INVITED' && (credentials.inviteExpiresAt ?? 0) > this.now(),
      'INVITE_INVALID',
      'This invitation is invalid, used or expired.',
      410,
    );
    return { credentials, member: m };
  }
  async inspect(input: unknown) {
    const d = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const { credentials, member } = await this.invitation(tx, d.token);
      credentials.pendingTotp ??= generateTotpSecret();
      await tx.put('adminCredentials', credentials);
      return {
        name: member.name,
        email: member.email,
        expiresAt: member.inviteExpiresAt,
        totp: {
          secret: credentials.pendingTotp,
          uri: totpUri(credentials.pendingTotp, member.email),
        },
      };
    });
  }
  /** Active staff without an authenticator confirm their password to start enrolling. */
  async enrollment(input: unknown) {
    const d = z
      .object({ email: emailInput, password: z.string().min(1).max(128) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const { credentials, member } = await this.verifyPassword(tx, d.email, d.password);
      ensure(!credentials.totpSecret, 'MFA_ALREADY_ENROLLED', 'Sign in with your code.', 409);
      credentials.pendingTotp ??= generateTotpSecret();
      await tx.put('adminCredentials', credentials);
      return {
        secret: credentials.pendingTotp,
        uri: totpUri(credentials.pendingTotp, member.email),
      };
    });
  }
  private async verifyPassword(tx: Records, email: string, password: string) {
    const m = (await tx.list<AdminMember>('adminMembers')).find((m) => m.email === email),
      credentials = m && (await tx.get<Credentials>('adminCredentials', m.id));
    const actual = await derive(password, credentials?.salt ?? 'hogulink-dummy-login-salt');
    ensure(
      m?.status === 'ACTIVE' &&
        credentials?.hash &&
        timingSafeEqual(actual, Buffer.from(credentials.hash, 'hex')),
      'INVALID_CREDENTIALS',
      'Email or password is incorrect.',
      401,
    );
    return { credentials, member: m };
  }
  /** Accepts a fresh code for the enrolled or pending secret, never the same step twice. */
  private acceptCode(credentials: Credentials, code: string | undefined, secret?: string) {
    const step = secret && code ? totpStep(secret, code, this.now()) : undefined;
    ensure(
      step !== undefined && step > (credentials.lastTotpStep ?? -1),
      'INVALID_CREDENTIALS',
      'Email, password or authenticator code is incorrect.',
      401,
    );
    credentials.lastTotpStep = step;
  }
  async activate(input: unknown) {
    const d = z
        .object({
          token: z.string().regex(/^[a-f0-9]{64}$/),
          password: passwordInput,
          code: codeInput,
        })
        .strict()
        .parse(input),
      salt = randomBytes(16).toString('hex'),
      hash = (await derive(d.password, salt)).toString('hex');
    return this.run(async (tx) => {
      const { credentials, member: m } = await this.invitation(tx, d.token);
      ensure(
        credentials.pendingTotp,
        'MFA_REQUIRED',
        'Open the invitation to set up your code.',
        409,
      );
      this.acceptCode(credentials, d.code, credentials.pendingTotp);
      credentials.totpSecret = credentials.pendingTotp;
      delete credentials.pendingTotp;
      credentials.salt = salt;
      credentials.hash = hash;
      delete credentials.inviteHash;
      delete credentials.inviteExpiresAt;
      delete m.inviteExpiresAt;
      m.status = 'ACTIVE';
      m.version++;
      m.sessionVersion++;
      m.updatedAt = this.now();
      await tx.put('adminCredentials', credentials);
      await tx.put('adminMembers', m);
      await this.activity(tx, { id: m.id, role: 'ADMIN', verificationLevel: 3 }, m, 'ACTIVATED');
      return { ok: true };
    });
  }
  async login(input: unknown): Promise<Actor> {
    const d = z
      .object({
        email: emailInput,
        password: z.string().min(1).max(128),
        code: codeInput.optional(),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const { credentials, member: m } = await this.verifyPassword(tx, d.email, d.password);
      // Platform staff can read finance and case data, so a password alone never signs in.
      ensure(
        credentials.totpSecret || credentials.pendingTotp,
        'MFA_ENROLLMENT_REQUIRED',
        'Set up an authenticator app to continue.',
        403,
      );
      this.acceptCode(credentials, d.code, credentials.totpSecret ?? credentials.pendingTotp);
      if (!credentials.totpSecret) {
        credentials.totpSecret = credentials.pendingTotp;
        delete credentials.pendingTotp;
      }
      await tx.put('adminCredentials', credentials);
      m.lastLoginAt = this.now();
      await tx.put('adminMembers', m);
      return {
        id: m.id,
        role: 'ADMIN',
        verificationLevel: 3,
        adminRole: m.adminRole,
        adminTeams: m.teams,
        adminSessionVersion: m.sessionVersion,
        displayName: m.name,
      };
    });
  }
}
