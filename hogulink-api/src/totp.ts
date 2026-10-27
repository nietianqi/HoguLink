import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 time-based one-time codes (SHA-1, 6 digits, 30-second steps), as authenticator apps use.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const period = 30_000;

function base32Encode(bytes: Buffer) {
  let bits = 0,
    value = 0,
    out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(text: string) {
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export const generateTotpSecret = () => base32Encode(randomBytes(20));
export const totpUri = (secret: string, account: string) =>
  `otpauth://totp/HoguLink:${encodeURIComponent(account)}?secret=${secret}&issuer=HoguLink&digits=6&period=30`;
export function totpCode(secret: string, at: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / period)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
/** The matching time step for a code, allowing one step of clock drift either way. */
export function totpStep(secret: string, code: string, at: number) {
  if (!/^\d{6}$/.test(code)) return undefined;
  for (const drift of [0, -1, 1]) {
    const when = at + drift * period;
    if (timingSafeEqual(Buffer.from(totpCode(secret, when)), Buffer.from(code)))
      return Math.floor(when / period);
  }
  return undefined;
}
