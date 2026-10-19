import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Actor, Locale } from '@hogulink/contracts';
import { Repository, type Records } from './repository.js';
import { ensure } from './errors.js';
import { accountEmail, enqueueEmail } from './notifications.js';
import { RateLimiter } from './rate-limit.js';

type Account = {
  id: string;
  email: string;
  name: string;
  locale: Locale;
  salt: string;
  passwordHash: string;
  createdAt: number;
  verifiedAt?: number;
  status: 'ACTIVE' | 'DISABLED';
  sessionVersion: number;
  verifyGeneration: number;
  resetGeneration: number;
  termsVersion: string;
  termsAcceptedAt: number;
};
type Challenge = {
  id: string;
  accountId: string;
  purpose: 'verify' | 'reset';
  generation: number;
  expiresAt: number;
  usedAt?: number;
};
const email = z.string().trim().toLowerCase().email().max(254),
  password = z.string().min(12).max(128);
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))),
  );
const accepted = { accepted: true };
export class CustomerAuth {
  private limits: RateLimiter;
  constructor(
    private repo: Repository,
    private now = () => Date.now(),
  ) {
    this.limits = new RateLimiter(repo, now);
  }
  private async account(tx: Records, address: string) {
    const identity = await tx.get<{ id: string; accountId: string }>(
      'customerEmails',
      hash(address),
    );
    return identity ? tx.get<Account>('customerAccounts', identity.accountId) : undefined;
  }
  private async challenge(tx: Records, account: Account, purpose: 'verify' | 'reset') {
    const token = randomBytes(32).toString('hex'),
      generation = purpose === 'verify' ? ++account.verifyGeneration : ++account.resetGeneration;
    await tx.put('customerAccounts', account);
    await tx.put<Challenge>('customerChallenges', {
      id: hash(token),
      accountId: account.id,
      purpose,
      generation,
      expiresAt: this.now() + (purpose === 'verify' ? 30 : 15) * 60000,
    });
    await enqueueEmail(
      tx,
      accountEmail(account.email, account.locale, purpose, token),
      `CUSTOMER_${purpose.toUpperCase()}`,
      this.now(),
    );
  }
  async register(input: unknown) {
    const d = z
      .object({
        email,
        password,
        name: z.string().trim().min(1).max(80),
        locale: z.enum(['ja', 'en', 'zh-cn']),
        termsAccepted: z.literal(true),
      })
      .strict()
      .parse(input);
    await this.limits.check('customer-register', d.email, 3, 3600000);
    const salt = randomBytes(16).toString('hex'),
      passwordHash = (await derive(d.password, salt)).toString('hex');
    await this.repo.transaction(async (tx) => {
      const existing = await this.account(tx, d.email);
      if (existing) return; // Never replace another person's password or reveal registration status.
      const account: Account = {
        id: `customer_${randomUUID()}`,
        email: d.email,
        name: d.name,
        locale: d.locale,
        salt,
        passwordHash,
        createdAt: this.now(),
        status: 'ACTIVE',
        sessionVersion: 1,
        verifyGeneration: 0,
        resetGeneration: 0,
        termsVersion: 'customer-2026-10-v1',
        termsAcceptedAt: this.now(),
      };
      await tx.put('customerEmails', { id: hash(d.email), accountId: account.id });
      await this.challenge(tx, account, 'verify');
    });
    return accepted;
  }
  async login(input: unknown): Promise<Actor> {
    const d = z
      .object({ email, password: z.string().min(1).max(128) })
      .strict()
      .parse(input);
    await this.limits.check('customer-login', d.email, 10, 15 * 60000);
    const account = await this.repo.read((tx) => this.account(tx, d.email));
    const key = await derive(d.password, account?.salt ?? 'hogulink-customer-dummy-salt');
    ensure(
      account && timingSafeEqual(key, Buffer.from(account.passwordHash, 'hex')),
      'INVALID_CREDENTIALS',
      'Email or password is incorrect.',
      401,
    );
    return this.repo.read(async (tx) => {
      const latest = await tx.get<Account>('customerAccounts', account.id);
      ensure(
        latest?.passwordHash === account.passwordHash && latest.status === 'ACTIVE',
        'INVALID_CREDENTIALS',
        'Email or password is incorrect.',
        401,
      );
      ensure(
        latest.verifiedAt !== undefined,
        'EMAIL_NOT_VERIFIED',
        'Verify your email before signing in.',
        403,
      );
      return this.actor(latest);
    });
  }
  private actor(a: Account): Actor {
    return {
      id: a.id,
      role: 'CUSTOMER',
      verificationLevel: 1,
      displayName: a.name,
      customerAccountId: a.id,
      customerSessionVersion: a.sessionVersion,
    };
  }
  async resolve(actor: Actor) {
    return this.repo.read(async (tx) => {
      const account = await tx.get<Account>('customerAccounts', actor.customerAccountId!);
      ensure(
        account?.status === 'ACTIVE' &&
          account.verifiedAt !== undefined &&
          account.sessionVersion === actor.customerSessionVersion,
        'UNAUTHENTICATED',
        'Your session expired. Please sign in.',
        401,
      );
      return this.actor(account);
    });
  }
  async request(input: unknown, purpose: 'verify' | 'reset') {
    const d = z
      .object({ email, locale: z.enum(['ja', 'en', 'zh-cn']).optional() })
      .strict()
      .parse(input);
    await this.limits.check(`customer-${purpose}`, d.email, 3, 3600000);
    await this.repo.transaction(async (tx) => {
      const account = await this.account(tx, d.email);
      if (
        !account ||
        account.status !== 'ACTIVE' ||
        (purpose === 'verify' && account.verifiedAt !== undefined) ||
        (purpose === 'reset' && account.verifiedAt === undefined)
      )
        return;
      if (d.locale) account.locale = d.locale;
      await this.challenge(tx, account, purpose);
    });
    return accepted;
  }
  async confirm(input: unknown, purpose: 'verify' | 'reset') {
    const d = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        ...(purpose === 'reset' ? { password } : {}),
      })
      .strict()
      .parse(input) as { token: string; password?: string };
    const salt = randomBytes(16).toString('hex'),
      passwordHash = d.password ? (await derive(d.password, salt)).toString('hex') : undefined;
    return this.repo.transaction(async (tx) => {
      const challenge = await tx.get<Challenge>('customerChallenges', hash(d.token));
      const account = challenge && (await tx.get<Account>('customerAccounts', challenge.accountId));
      ensure(
        challenge &&
          account?.status === 'ACTIVE' &&
          challenge.purpose === purpose &&
          challenge.usedAt === undefined &&
          challenge.expiresAt > this.now() &&
          challenge.generation ===
            (purpose === 'verify' ? account.verifyGeneration : account.resetGeneration),
        'TOKEN_INVALID',
        'This link has expired or has already been used.',
        400,
      );
      challenge.usedAt = this.now();
      if (purpose === 'verify') account.verifiedAt = this.now();
      else {
        account.passwordHash = passwordHash!;
        account.salt = salt;
        account.sessionVersion++;
      }
      await tx.put('customerChallenges', challenge);
      await tx.put('customerAccounts', account);
      await tx.put('audit', {
        id: `audit_${randomUUID()}`,
        actorId: account.id,
        action: purpose === 'verify' ? 'CUSTOMER_EMAIL_VERIFIED' : 'CUSTOMER_PASSWORD_RESET',
        at: this.now(),
      });
      return { ok: true };
    });
  }
}
