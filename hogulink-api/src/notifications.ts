import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Actor, Booking, Locale } from '@hogulink/contracts';
import { Repository, type Records } from './repository.js';
import { seal, unseal } from './secrets.js';
import { ensure } from './errors.js';
import { requireAdmin } from './admin-access.js';
import { activeStaffMembership } from './staff-access.js';

export type Email = { to: string; subject: string; text: string };
export type Outbox = {
  id: string;
  type: string;
  status: string;
  createdAt: number;
  bookingId?: string;
  payloadSealed?: string;
  attempts?: number;
  nextAttemptAt?: number;
  leaseUntil?: number;
  leaseId?: string;
  delivery?: string;
  lastError?: string;
  acceptedAt?: number;
  receipts?: Record<string, string>;
  storeId?: string;
  target?: string;
  ticketId?: string;
  expiresAt?: number;
};
export const siteOrigin = () =>
  (process.env.PUBLIC_WEB_URL || process.env.WEB_ORIGIN || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
export async function enqueueEmail(tx: Records, email: Email, type: string, now: number) {
  const id = `outbox_${randomUUID()}`;
  await tx.put<Outbox>('outbox', {
    id,
    type,
    status: 'PENDING',
    createdAt: now,
    attempts: 0,
    payloadSealed: seal(JSON.stringify(email), id),
    ...(/CUSTOMER_(VERIFY|RESET)/.test(type)
      ? { expiresAt: now + (type === 'CUSTOMER_VERIFY' ? 30 : 15) * 60000 }
      : {}),
  });
}
const titles = {
  ja: {
    verify: 'メールアドレスの確認',
    reset: 'パスワードの再設定',
    update: 'ご予約に更新があります',
    safety: '安全確認が必要です',
    body: 'HoguLink で内容をご確認ください。リンクはご本人のみ使用できます。',
  },
  en: {
    verify: 'Verify your email address',
    reset: 'Reset your password',
    update: 'Your booking has an update',
    safety: 'A safety check needs attention',
    body: 'Open HoguLink to review the details. This link is for the account holder only.',
  },
  'zh-cn': {
    verify: '验证您的邮箱',
    reset: '重设密码',
    update: '您的预约有新进展',
    safety: '有安全事项需要处理',
    body: '请打开 HoguLink 查看详情。此链接仅供账号本人使用。',
  },
};
export function accountEmail(
  to: string,
  locale: Locale,
  action: 'verify' | 'reset',
  token: string,
): Email {
  const t = titles[locale],
    url = new URL(`/${locale}/account/access`, siteOrigin());
  // A fragment keeps the secret out of access logs, referrers and initial SSR requests.
  url.hash = new URLSearchParams({ action, token }).toString();
  return {
    to,
    subject: `HoguLink · ${t[action]}`,
    text: `${t.body}\n\n${url}\n\n${action === 'verify' ? '30' : '15'} min`,
  };
}
export function invitationEmail(to: string, token: string, kind: 'staff' | 'employee'): Email {
  const url = new URL(
    kind === 'staff' ? '/ja/onboarding?role=STAFF' : '/ja/admin/activate',
    siteOrigin(),
  );
  url.hash = new URLSearchParams({ [kind === 'staff' ? 'invite' : 'token']: token }).toString();
  return {
    to,
    subject: 'HoguLink · ご招待 / Invitation / 账号邀请',
    text: `HoguLink の招待をご確認ください。\nReview your invitation.\n请查看您的账号邀请。\n\n${url}\n\n72h`,
  };
}
export type EmailSender = (email: Email, key: string) => Promise<string>;
export function configuredSender(): EmailSender | undefined {
  const provider = process.env.EMAIL_PROVIDER || 'disabled';
  if (provider === 'disabled') return undefined;
  if (provider === 'resend') {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
      throw new Error('RESEND_API_KEY and EMAIL_FROM are required');
    return async (email, key) => {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [email.to],
          subject: email.subject,
          text: email.text,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { id?: string };
      if (!response.ok || !data.id) throw new Error(`EMAIL_HTTP_${response.status}`);
      return data.id;
    };
  }
  if (provider === 'webhook') {
    const url = new URL(process.env.NOTIFICATION_WEBHOOK_URL || '');
    if (
      url.protocol !== 'https:' &&
      !(
        process.env.NODE_ENV !== 'production' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      )
    )
      throw new Error('Notification webhook must use HTTPS');
    const secret = process.env.NOTIFICATION_WEBHOOK_SECRET;
    if (!secret || secret.length < 32)
      throw new Error('NOTIFICATION_WEBHOOK_SECRET must contain at least 32 characters');
    return async (email, key) => {
      const timestamp = String(Date.now()),
        body = JSON.stringify({ id: key, email });
      const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
          'X-Hogu-Timestamp': timestamp,
          'X-Hogu-Signature': signature,
        },
        body,
      });
      const data = (await response.json().catch(() => ({}))) as { messageId?: string };
      if (!response.ok || typeof data.messageId !== 'string' || !data.messageId)
        throw new Error(`EMAIL_HTTP_${response.status}`);
      return data.messageId;
    };
  }
  throw new Error('Unsupported EMAIL_PROVIDER');
}
export class NotificationWorker {
  constructor(
    private repo: Repository,
    private send?: EmailSender,
    private now = () => Date.now(),
  ) {}
  private async emails(job: Outbox) {
    if (job.payloadSealed)
      return [JSON.parse(unseal(job.payloadSealed, job.id).toString()) as Email];
    return this.repo.read(async (tx) => {
      const b = job.bookingId ? await tx.get<Booking>('bookings', job.bookingId) : undefined;
      const ticket = job.ticketId
        ? await tx.get<{ visibility: string }>('supportTickets', job.ticketId)
        : undefined;
      const platformOnly = ticket?.visibility === 'PLATFORM_ONLY';
      const sensitive = platformOnly || /SAFETY|SOS|CONTENT|RESTRICTION|EMERGENCY/.test(job.type);
      const recipients = new Map<string, { locale: Locale; path: string }>();
      const addCustomer = async (id: string, path: string) => {
        const account = await tx.get<{ email: string; locale: Locale; verifiedAt?: number }>(
          'customerAccounts',
          id,
        );
        if (account?.verifiedAt !== undefined)
          recipients.set(account.email, { locale: account.locale, path });
      };
      if (b && !sensitive) await addCustomer(b.customerId, `account/bookings/${b.id}`);
      let storeId = b?.storeId || job.storeId;
      if (job.target) {
        const application = await tx.get<{ ownerId: string; storeId: string }>(
          'partnerApplications',
          job.target,
        );
        if (application) {
          storeId = application.storeId;
          const owner = await tx.get<{ email: string }>('partnerAccounts', application.ownerId);
          if (owner) recipients.set(owner.email, { locale: 'ja', path: 'onboarding' });
        }
      }
      if (storeId && !platformOnly)
        for (const account of await tx.find<{
          id: string;
          email: string;
          role: string;
          staffId?: string;
        }>('partnerAccounts', { storeId }))
          if (
            account.role === 'MERCHANT' ||
            (account.role === 'STAFF' &&
              !!b?.assignedStaffId &&
              account.staffId === b.assignedStaffId &&
              (await activeStaffMembership(tx, {
                id: account.id,
                role: 'STAFF',
                staffId: account.staffId,
                storeId,
                verificationLevel: 1,
              })))
          )
            recipients.set(account.email, {
              locale: 'ja',
              path: account.role === 'STAFF' ? 'staff?tab=tasks' : 'merchant?tab=bookings',
            });
      if ((sensitive || /OVERDUE|BREACH/.test(job.type)) && process.env.OPS_NOTIFICATION_EMAIL)
        recipients.set(process.env.OPS_NOTIFICATION_EMAIL, { locale: 'ja', path: 'admin' });
      return [...recipients].map(([to, { locale, path }]) => ({
        to,
        subject: `HoguLink · ${titles[locale][sensitive ? 'safety' : 'update']}`,
        text: `${titles[locale].body}${job.type === 'IN_STORE_APPOINTMENT_REMINDER' && b?.quote.venue ? `\n\n${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(b.quote.startAt)} JST\n${b.quote.venue.address}\n${b.quote.venue.contact}` : ''}\n\n${siteOrigin()}/${locale}/${path}`,
      }));
    });
  }
  async tick(batchSize = 4) {
    batchSize = Math.max(1, Math.min(4, batchSize));
    if (!this.send) return { processed: 0, configured: false };
    const jobs = await this.repo.transaction(async (tx) => {
      const pending = await tx.find<Outbox>(
        'outbox',
        { status: 'PENDING' },
        { limit: batchSize, orderBy: 'createdAt' },
      );
      const retries = await tx.find<Outbox>(
        'outbox',
        { status: 'RETRY', nextAttemptAt: { lte: this.now() } },
        { limit: batchSize },
      );
      const abandoned = await tx.find<Outbox>(
        'outbox',
        { status: 'PROCESSING', leaseUntil: { lte: this.now() } },
        { limit: batchSize },
      );
      const accountMail = await tx.find<Outbox>(
        'outbox',
        {
          status: 'PENDING',
          type: ['CUSTOMER_VERIFY', 'CUSTOMER_RESET', 'STAFF_INVITATION', 'EMPLOYEE_INVITATION'],
        },
        { limit: 2, orderBy: 'createdAt' },
      );
      const selected = [
        ...new Map(
          [...accountMail, ...abandoned, ...retries, ...pending].map((j) => [j.id, j]),
        ).values(),
      ].slice(0, batchSize);
      for (const j of selected) {
        j.status = 'PROCESSING';
        j.leaseId = randomUUID();
        j.leaseUntil = this.now() + 120000;
        j.attempts = (j.attempts ?? 0) + 1;
        await tx.put('outbox', j);
      }
      return selected;
    });
    await Promise.all(
      jobs.map(async (job) => {
        let status = 'SENT',
          error: string | undefined;
        const receipts = { ...job.receipts };
        try {
          if (job.expiresAt !== undefined && job.expiresAt <= this.now()) {
            status = 'EXPIRED';
          } else {
            const emails = await this.emails(job);
            if (!emails.length) {
              status = 'BLOCKED';
              error = 'RECIPIENT_NOT_CONFIGURED';
            }
            for (const email of emails) {
              const recipientKey = createHash('sha256')
                .update(email.to.toLowerCase())
                .digest('hex');
              if (!receipts[recipientKey])
                receipts[recipientKey] = await this.send!(
                  email,
                  `${job.id}-${recipientKey.slice(0, 16)}`,
                );
            }
          }
        } catch (e) {
          status = job.attempts! >= 5 ? 'FAILED' : 'RETRY';
          error = /^EMAIL_HTTP_\d+$/.test((e as Error).message)
            ? (e as Error).message
            : 'DELIVERY_FAILED';
        }
        await this.repo.transaction(async (tx) => {
          const current = await tx.get<Outbox>('outbox', job.id);
          if (!current || current.leaseId !== job.leaseId) return;
          await tx.put('outbox', {
            ...current,
            status,
            receipts,
            lastError: error,
            leaseUntil: 0,
            leaseId: undefined,
            acceptedAt: status === 'SENT' ? this.now() : undefined,
            delivery: status === 'SENT' ? 'PROVIDER_ACCEPTED' : undefined,
            nextAttemptAt: this.now() + Math.min(3600000, 30000 * 2 ** (job.attempts! - 1)),
          });
        });
      }),
    );
    return { processed: jobs.length, configured: true };
  }
  async snapshot(actor: Actor) {
    requireAdmin(actor, 'system.read');
    return this.repo.read(async (tx) => {
      const counts = await tx.counts('outbox', 'status');
      const all = await tx.find<Outbox>(
        'outbox',
        {},
        { limit: 100, orderBy: 'createdAt', descending: true },
      );
      return {
        configured: !!this.send,
        counts,
        jobs: all.map(
          ({ payloadSealed: _payload, receipts: _receipts, leaseId: _lease, ...job }) => job,
        ),
      };
    });
  }
  async retry(actor: Actor, id: string) {
    requireAdmin(actor, 'members.manage');
    return this.repo.transaction(async (tx) => {
      const job = await tx.get<Outbox>('outbox', id);
      ensure(
        job && ['FAILED', 'BLOCKED', 'RETRY'].includes(job.status),
        'INVALID_STATE',
        'This notification cannot be retried.',
        409,
      );
      await tx.put('outbox', {
        ...job,
        status: 'PENDING',
        attempts: 0,
        lastError: undefined,
        nextAttemptAt: 0,
      });
      await tx.put('audit', {
        id: `audit_${randomUUID()}`,
        actorId: actor.id,
        action: 'NOTIFICATION_RETRY_REQUESTED',
        detail: id,
        at: this.now(),
      });
      return { ok: true };
    });
  }
}
