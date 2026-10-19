import { readFileSync } from 'node:fs';
for (const name of [
  'DATABASE_URL',
  'DATA_ENCRYPTION_KEY',
  'RESEND_API_KEY',
  'NOTIFICATION_WEBHOOK_SECRET',
  'ADMIN_BOOTSTRAP_PASSWORD',
]) {
  const file = process.env[`${name}_FILE`];
  if (!file) continue;
  if (process.env[name]) throw new Error(`Configure ${name} or ${name}_FILE, not both`);
  process.env[name] = readFileSync(file, 'utf8').trim();
}
const mode = process.argv[2] || 'main';
process.argv.splice(2, 1);
if (!['main', 'worker', 'backup-worker', 'maintenance'].includes(mode))
  throw new Error('Invalid process mode');
await import(`./${mode}.js`);
