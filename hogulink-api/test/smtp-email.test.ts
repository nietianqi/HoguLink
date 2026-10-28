import test from 'node:test';
import assert from 'node:assert/strict';
import type { SendMailOptions } from 'nodemailer';
import {
  smtpConfiguration,
  smtpFailure,
  smtpSender,
  verifySmtp,
  type SmtpClient,
} from '../src/smtp-email.js';
import { NotificationWorker, enqueueEmail, type Outbox } from '../src/notifications.js';
import { Repository } from '../src/repository.js';

const env = {
  SMTP_USER: 'sender@example.com',
  SMTP_PASSWORD: 'test-only-secret',
  SMTP_HOST: 'smtp.example.com',
};
const email = {
  to: 'recipient@example.com',
  subject: 'HoguLink verification',
  text: 'Private verification link',
};
function client(overrides: Partial<SmtpClient> = {}): SmtpClient {
  return {
    sendMail: async (mail) => ({
      accepted: [String(mail.to)],
      rejected: [],
      response: '250 queued',
      messageId: String(mail.messageId),
    }),
    verify: async () => true,
    close: () => {},
    ...overrides,
  };
}

test('SMTP enforces TLS, bounded connection time and no protocol logs; grouped Gmail app passwords are normalized', () => {
  const tls = smtpConfiguration({
    ...env,
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PASSWORD: 'test only pass word',
  });
  assert.equal(
    tls.options.auth && 'pass' in tls.options.auth && tls.options.auth.pass,
    'testonlypassword',
  );
  assert.equal(tls.options.secure, true);
  assert.equal(tls.options.port, 465);
  assert.equal(tls.options.tls?.rejectUnauthorized, true);
  assert.equal(tls.options.logger, false);
  assert.equal(tls.options.debug, false);
  assert.equal(tls.options.disableFileAccess, true);
  assert.equal(tls.options.disableUrlAccess, true);
  assert.equal(tls.from, 'HoguLink <sender@example.com>');
  const startTls = smtpConfiguration({ ...env, SMTP_PORT: '587' });
  assert.equal(startTls.options.secure, false);
  assert.equal(startTls.options.requireTLS, true);
  assert.equal(startTls.options.socketTimeout, 20000);
  const generic = smtpConfiguration({ ...env, SMTP_PASSWORD: 'password with spaces' });
  assert.equal(
    generic.options.auth && 'pass' in generic.options.auth && generic.options.auth.pass,
    'password with spaces',
  );
});

test('SMTP rejects missing credentials, unsafe ports and header injection before making a connection', () => {
  for (const value of [
    { ...env, SMTP_USER: '' },
    { ...env, SMTP_PASSWORD: '' },
    { ...env, SMTP_PORT: '25' },
    { ...env, SMTP_PORT: 'invalid' },
    { ...env, SMTP_HOST: 'smtp://example.com' },
    { ...env, EMAIL_FROM: 'sender@example.com\r\nBcc: other@example.com' },
  ])
    assert.throws(() => smtpConfiguration(value));
});

test('SMTP preserves private email content, assigns a stable message id, and requires server acceptance', async () => {
  const sent: SendMailOptions[] = [];
  const send = smtpSender(env, () =>
    client({
      sendMail: async (mail) => {
        sent.push(mail);
        return {
          accepted: [email.to],
          rejected: [],
          response: '250 2.0.0 Accepted',
          messageId: String(mail.messageId),
        };
      },
    }),
  );
  const first = await send(email, 'stable-queue-key');
  assert.equal(await send(email, 'stable-queue-key'), first);
  assert.notEqual(await send(email, 'different-queue-key'), first);
  assert.equal(sent[0].text, email.text);
  assert.equal(sent[0].subject, email.subject);
  assert.equal(sent[0].from, 'HoguLink <sender@example.com>');
  assert(!first.includes('stable-queue-key'));
  assert(!first.includes('test-only-secret'));
  assert.equal(first, sent[0].messageId);
  for (const receipt of [
    { accepted: [], rejected: [email.to], response: '550 rejected', messageId: first },
    { accepted: [], rejected: [], response: '250 queued', messageId: first },
    { accepted: [email.to], rejected: [], response: '451 retry later', messageId: first },
  ])
    await assert.rejects(
      smtpSender(env, () => client({ sendMail: async () => receipt }))(email, 'key'),
      /EMAIL_SMTP_NOT_ACCEPTED/,
    );
  await assert.rejects(
    send({ ...email, to: 'recipient@example.com,another@example.com' }, 'key'),
    /EMAIL_SMTP_RECIPIENT_INVALID/,
  );
});

test('SMTP authentication check never sends email and always closes the connection without exposing credentials', async () => {
  let sent = 0,
    verified = 0,
    closed = 0;
  const factory = () =>
    client({
      sendMail: async () => {
        sent++;
        throw Error('must not send');
      },
      verify: async () => {
        verified++;
        return true;
      },
      close: () => {
        closed++;
      },
    });
  await verifySmtp(env, factory);
  assert.deepEqual({ sent, verified, closed }, { sent: 0, verified: 1, closed: 1 });
  await assert.rejects(
    verifySmtp(env, () =>
      client({
        verify: async () => {
          throw Object.assign(new Error('secret password or token'), { code: 'EAUTH' });
        },
        close: () => {
          closed++;
        },
      }),
    ),
    /EMAIL_SMTP_EAUTH/,
  );
  assert.equal(closed, 2);
  assert.equal(smtpFailure(new Error('secret password or token')).message, 'EMAIL_SMTP_FAILED');
});

test('customer-auth scope sends only verification/reset mail and leaves old order/invitation queues untouched in all retry phases', async () => {
  const repo = new Repository('', ':memory:');
  await repo.init();
  const now = Date.now();
  const oldIds: string[] = [],
    authIds: string[] = [],
    sent: string[] = [];
  try {
    await repo.transaction(async (tx) => {
      for (const [status, type] of [
        ['PENDING', 'BOOKING_CREATED'],
        ['RETRY', 'STAFF_INVITATION'],
        ['PROCESSING', 'EMPLOYEE_INVITATION'],
        ['PENDING', 'CUSTOMER_VERIFY'],
        ['RETRY', 'CUSTOMER_RESET'],
        ['PROCESSING', 'CUSTOMER_VERIFY'],
      ]) {
        await enqueueEmail(
          tx,
          { to: 'test@example.com', subject: type, text: 'Test body' },
          type,
          now,
        );
        const job = (await tx.list<Outbox>('outbox')).find(
          (j) => j.type === type && !oldIds.includes(j.id) && !authIds.includes(j.id),
        )!;
        await tx.put('outbox', { ...job, status, leaseUntil: now - 1, nextAttemptAt: now - 1 });
        (type.startsWith('CUSTOMER_') ? authIds : oldIds).push(job.id);
      }
    });
    const before = await repo.read((tx) =>
      Promise.all(oldIds.map((id) => tx.get<Outbox>('outbox', id))),
    );
    const worker = new NotificationWorker(
      repo,
      async (mail) => {
        sent.push(mail.subject);
        return `accepted-${sent.length}`;
      },
      () => now,
      'customer-auth',
    );
    for (let i = 0; i < 3; i++) await worker.tick(4);
    assert.equal(sent.length, 3);
    assert(sent.every((type) => ['CUSTOMER_VERIFY', 'CUSTOMER_RESET'].includes(type)));
    assert.deepEqual(
      await repo.read((tx) => Promise.all(oldIds.map((id) => tx.get<Outbox>('outbox', id)))),
      before,
    );
    const own = await repo.read((tx) =>
      Promise.all(authIds.map((id) => tx.get<Outbox>('outbox', id))),
    );
    assert(own.every((job) => job?.status === 'SENT' && job.delivery === 'PROVIDER_ACCEPTED'));
  } finally {
    await repo.close();
  }
});
