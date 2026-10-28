import { verifySmtp } from './smtp-email.js';
try {
  await verifySmtp();
  console.log(JSON.stringify({ smtp: 'authenticated', emailSent: false }));
} catch (error) {
  console.error(
    JSON.stringify({ smtp: 'failed', code: (error as Error).message, emailSent: false }),
  );
  process.exitCode = 1;
}
