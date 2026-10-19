import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let localKey: Buffer | undefined;
function key() {
  const configured = process.env.DATA_ENCRYPTION_KEY;
  if (configured) {
    const value = Buffer.from(configured, 'base64');
    if (value.length !== 32 || value.toString('base64') !== configured)
      throw new Error('DATA_ENCRYPTION_KEY must be 32 random bytes encoded as base64');
    return value;
  }
  if (process.env.NODE_ENV === 'production' || process.env.APP_MODE === 'staging')
    throw new Error('DATA_ENCRYPTION_KEY is required');
  if (!localKey) {
    const file = resolve(process.env.LOCAL_KEY_PATH || 'data/.local-encryption-key');
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`;
    writeFileSync(temporary, randomBytes(32), { flag: 'wx', mode: 0o600 });
    try {
      linkSync(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally {
      unlinkSync(temporary);
    }
    localKey = readFileSync(file);
    if (localKey.length !== 32) throw new Error('Invalid local encryption key');
  }
  return localKey;
}
export function seal(value: Buffer | string, context: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function unseal(value: string, context: string) {
  const bytes = Buffer.from(value, 'base64');
  if (bytes[0] !== 1 || bytes.length < 29) throw new Error('Invalid encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(1, 13));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(bytes.subarray(13, 29));
  return Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]);
}
