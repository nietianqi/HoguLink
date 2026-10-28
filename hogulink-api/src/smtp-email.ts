import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createTransport,
  type SendMailOptions,
  type SMTPTransportOptions,
  type SMTPSentMessageInfo,
} from 'nodemailer';
import { z } from 'zod';
import type { EmailSender } from './notifications.js';

type SmtpReceipt = Pick<SMTPSentMessageInfo, 'accepted' | 'rejected' | 'response' | 'messageId'>;
export type SmtpClient = {
  sendMail(mail: SendMailOptions): Promise<SmtpReceipt>;
  verify(): Promise<true>;
  close(): void;
};
type ClientFactory = (options: SMTPTransportOptions) => SmtpClient;
const mailbox = z.string().email().max(254);

export function smtpConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const user = env.SMTP_USER?.trim();
  if (!user || !mailbox.safeParse(user).success)
    throw new Error('SMTP_USER must be an email address');
  const host = (env.SMTP_HOST || 'smtp.gmail.com').trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..')) throw new Error('SMTP_HOST is invalid');
  const port = Number(env.SMTP_PORT || 465);
  if (![465, 587].includes(port)) throw new Error('SMTP_PORT must be 465 or 587');
  const rawPassword =
    env.SMTP_PASSWORD ||
    (env.SMTP_PASSWORD_FILE ? readFileSync(env.SMTP_PASSWORD_FILE, 'utf8').trimEnd() : '');
  if (!rawPassword.trim()) throw new Error('SMTP_PASSWORD or SMTP_PASSWORD_FILE is required');
  // Google displays app passwords in groups; spaces are not part of the credential.
  const password = host === 'smtp.gmail.com' ? rawPassword.replace(/\s+/g, '') : rawPassword;
  const from = env.EMAIL_FROM?.trim() || `HoguLink <${user}>`;
  if (/[\r\n]/.test(from)) throw new Error('EMAIL_FROM must be a single header');
  const options: SMTPTransportOptions = {
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass: password },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
  return { from, user, options };
}

/** Use bounded error codes; SMTP responses can contain addresses or private content. */
export function smtpFailure(error: unknown): Error {
  const code = (error as { code?: unknown })?.code;
  const allowed = ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'EENVELOPE', 'EMESSAGE'];
  return new Error(
    typeof code === 'string' && allowed.includes(code) ? `EMAIL_SMTP_${code}` : 'EMAIL_SMTP_FAILED',
  );
}

export function smtpSender(
  env: NodeJS.ProcessEnv = process.env,
  factory: ClientFactory = createTransport,
): EmailSender {
  const { options, from, user } = smtpConfiguration(env);
  const client = factory(options);
  return async (email, key) => {
    if (!mailbox.safeParse(email.to).success) throw new Error('EMAIL_SMTP_RECIPIENT_INVALID');
    const messageId = `<${createHash('sha256').update(key).digest('hex')}@${user.split('@')[1]}>`;
    let receipt: SmtpReceipt;
    try {
      receipt = await client.sendMail({
        from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        messageId,
      });
    } catch (error) {
      throw smtpFailure(error);
    }
    if (
      !/^2\d\d\b/.test(receipt.response) ||
      receipt.rejected.length ||
      !receipt.accepted.some((address) => address.toLowerCase() === email.to.toLowerCase())
    )
      throw new Error('EMAIL_SMTP_NOT_ACCEPTED');
    return messageId;
  };
}

/** Connect and authenticate only; this does not send a message or consume queued jobs. */
export async function verifySmtp(
  env: NodeJS.ProcessEnv = process.env,
  factory: ClientFactory = createTransport,
) {
  const client = factory(smtpConfiguration(env).options);
  try {
    await client.verify();
  } catch (error) {
    throw smtpFailure(error);
  } finally {
    client.close();
  }
}
