const integer = (name: string, fallback: number, min = 0, max = 1_000_000) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid configuration: ${name}`);
  return value;
};
export const config = {
  holdTtlSeconds: integer('CHECKOUT_HOLD_TTL_SECONDS', 600, 30, 3600),
  quoteTtlSeconds: 900,
  bufferMinutes: 30,
  maxActiveHolds: 2,
  maxHoldsPerHour: 10,
  nominationFee: integer('NOMINATION_FEE_JPY', 500),
  standardFeeBps: integer('STANDARD_FEE_BPS', 1000, 0, 10000),
  annualFeeBps: integer('ANNUAL_FEE_BPS', 500, 0, 10000),
  annualPlanPrice: integer('ANNUAL_PLAN_PRICE_JPY', 100000, 1, 1000000),
  trialDays: integer('MERCHANT_TRIAL_DAYS', 90, 1, 365),
  planGraceDays: integer('PLAN_GRACE_DAYS', 7, 1, 30),
  cancellation: {
    version: 'demo-policy-v3',
    freeBeforeMinutes: 120,
    lateFeeBps: 3000,
    instantDelayGraceMinutes: 15,
    instantTravelOnly: true,
    noShow: { feeBps: 3000, waitMinutes: 15, minContacts: 2, contactGapMinutes: 2 },
  },
  windows: {
    instantMinutes: 5,
    sameDayMinutes: 30,
    advanceMinutes: 240,
    replacementSameDayMinutes: 15,
  },
  authorizationDays: 7,
  /** Far-future bookings keep a saved method and are authorized this many hours before the visit. */
  preAuthorizeHours: 48,
  /** After a failed pre-visit authorization the customer has this long to renew it. */
  paymentUpdateHours: 12,
};
export function assertDemoRuntime() {
  if (process.env.APP_MODE === 'staging') {
    const required = ['DATABASE_URL', 'WEB_ORIGIN', 'PUBLIC_WEB_URL', 'DATA_ENCRYPTION_KEY'];
    for (const name of required)
      if (!process.env[name]) throw new Error(`Staging configuration missing: ${name}`);
    if (
      process.env.DEMO_ACCESS_ENABLED !== '0' ||
      !process.env.PUBLIC_WEB_URL!.startsWith('https://') ||
      process.env.PAYMENT_PROVIDER !== 'demo'
    )
      throw new Error(
        'Staging requires HTTPS, disabled demo access, and explicitly simulated payments',
      );
    if (
      process.env.WEB_ORIGIN !== new URL(process.env.PUBLIC_WEB_URL!).origin ||
      process.env.PUBLIC_WEB_URL !== process.env.WEB_ORIGIN
    )
      throw new Error('WEB_ORIGIN and PUBLIC_WEB_URL must be the same HTTPS origin');
    const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY!, 'base64');
    if (key.length !== 32 || key.toString('base64') !== process.env.DATA_ENCRYPTION_KEY)
      throw new Error('Invalid DATA_ENCRYPTION_KEY');
    if ((process.env.EMAIL_PROVIDER || 'disabled') === 'disabled')
      throw new Error('Staging requires a configured email provider');
    return;
  }
  if (
    (process.env.APP_MODE ?? 'demo') !== 'demo' ||
    (process.env.PAYMENT_PROVIDER ?? 'demo') !== 'demo' ||
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'Production disabled: real identity, PSP and notification adapters must be implemented and reviewed before live use.',
    );
  }
}
