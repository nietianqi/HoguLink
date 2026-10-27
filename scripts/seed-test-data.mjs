// Creates login accounts and realistic test orders through the real API.
// Usage: see scripts/seed-test-data.sh (stops the main API, runs fixtures/seed-server.mts).
import { createHmac, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const base = process.env.SEED_API_ORIGIN,
  origin = process.env.SEED_WEB_ORIGIN,
  token = process.env.SEED_TOKEN,
  PASSWORD = process.env.SEED_PASSWORD || 'HoguLink@2026',
  out = process.env.SEED_OUTPUT;
const H = 3600000,
  D = 24 * H;
const log = (...a) => console.log(...a);
const summary = { accounts: [], bookings: [], errors: [] };

// RFC 6238 codes, matching the server's authenticator check.
function totp(secret, at) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function call(cookie, path, body, method = body === undefined ? 'GET' : 'POST', key) {
  const r = await fetch(`${base}/v1/${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key || (method === 'POST' && body !== undefined)
        ? { 'Idempotency-Key': key || randomUUID() }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
  const cookieHeader = r.headers.get('set-cookie');
  return cookieHeader ? { data, cookie: cookieHeader.split(';')[0] } : data;
}
const seedApi = async (path, body) => {
  const r = await fetch(`${base}/__seed/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-seed-token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`seed ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
};
const now = async () => (await seedApi('clock')).now;
const setClock = (at) => seedApi('clock', { at: Math.round(at) });
const slot = (t, hourJst) => {
  // Next day at the given JST hour.
  const jst = new Date(t + 9 * H);
  jst.setUTCHours(hourJst, 0, 0, 0);
  let v = jst.getTime() - 9 * H;
  while (v < t + 20 * H) v += D;
  return v;
};
async function attempt(label, fn) {
  try {
    return await fn();
  } catch (e) {
    log(`  ! ${label}: ${e.message}`);
    summary.errors.push(`${label}: ${e.message}`);
  }
}

// ---------- sessions ----------
const demo = async (role, extra = {}) => (await call('', 'auth/demo', { role, ...extra })).cookie;
const admin = await demo('ADMIN');
const shops = {
  'store-nagi': await demo('MERCHANT', { storeId: 'store-nagi' }),
  'store-sora': await demo('MERCHANT', { storeId: 'store-sora' }),
  'store-mori': await demo('MERCHANT', { storeId: 'store-mori' }),
};
const staffIds = ['aoi', 'ren', 'mio', 'haru', 'yuki', 'saki'];
const staff = {};
for (const s of staffIds) staff[`listing-${s}`] = await demo('STAFF', { staffId: `staff-${s}` });

// ---------- customer accounts ----------
const customerSpecs = [
  {
    email: 'zhang.wei@hogulink.test',
    name: '张伟',
    locale: 'zh-cn',
    area: 'shinjuku',
    hotel: '新宿华盛顿酒店',
  },
  {
    email: 'li.na@hogulink.test',
    name: '李娜',
    locale: 'zh-cn',
    area: 'shibuya',
    hotel: '涩谷东急卓越大酒店',
  },
  {
    email: 'tanaka.yuto@hogulink.test',
    name: '田中 悠斗',
    locale: 'ja',
    area: 'minato',
    hotel: 'ホテル赤坂テスト',
  },
  {
    email: 'sato.hana@hogulink.test',
    name: '佐藤 花',
    locale: 'ja',
    area: 'chuo',
    hotel: '銀座テストホテル',
  },
  {
    email: 'emily.clark@hogulink.test',
    name: 'Emily Clark',
    locale: 'en',
    area: 'shinjuku',
    hotel: 'Shinjuku Test Hotel',
  },
];
log('Creating customer accounts…');
const customers = [];
for (const c of customerSpecs) {
  await attempt(`register ${c.email}`, async () => {
    await call('', 'auth/customer/register', {
      email: c.email,
      password: PASSWORD,
      name: c.name,
      locale: c.locale,
      termsAccepted: true,
    });
    const mail = (await seedApi('outbox'))
      .filter((m) => m.to === c.email && m.type === 'CUSTOMER_VERIFY')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const verifyToken =
      mail &&
      new URLSearchParams(new URL(mail.text.match(/https?:\/\/\S+/)[0]).hash.slice(1)).get('token');
    if (verifyToken) await call('', 'auth/customer/verify-email', { token: verifyToken });
    const { cookie } = await call('', 'auth/customer/login', {
      email: c.email,
      password: PASSWORD,
    });
    let book = await call(cookie, 'customer/addresses');
    book = await call(cookie, 'customer/addresses', {
      version: book.version,
      label: c.locale === 'en' ? 'Hotel' : c.locale === 'ja' ? 'ホテル' : '酒店',
      setDefault: true,
      address: {
        name: c.name,
        area: c.area,
        type: 'HOTEL',
        detail: `${c.hotel} 1-2-3`,
        hotelName: c.hotel,
      },
    });
    customers.push({ ...c, cookie });
    summary.accounts.push({ type: '顾客', login: c.email, password: PASSWORD, name: c.name });
    log(`  ✓ ${c.email}`);
  });
}
const demoCustomer = await demo('CUSTOMER');
const buyers = [
  ...customers,
  {
    email: '(演示顾客按钮)',
    name: '演示顾客',
    locale: 'zh-cn',
    area: 'shinjuku',
    hotel: '演示酒店',
    cookie: demoCustomer,
  },
];

// ---------- booking helpers ----------
const menus = [
  ['listing-aoi', 'store-nagi-60'],
  ['listing-ren', 'store-nagi-90'],
  ['listing-mio', 'store-nagi-120'],
  ['listing-haru', 'store-sora-60'],
  ['listing-yuki', 'store-mori-60'],
  ['listing-saki', 'store-mori-90'],
  ['listing-aoi', 'store-nagi-90'],
  ['listing-haru', 'store-sora-90'],
];
const storeOf = (listingId) =>
  listingId.match(/aoi|ren|mio/)
    ? 'store-nagi'
    : listingId.includes('haru')
      ? 'store-sora'
      : 'store-mori';
const areaFor = (buyer, listingId) => {
  const store = storeOf(listingId);
  const allowed = {
    'store-nagi': ['shinjuku', 'shibuya', 'minato', 'chuo', 'taito'],
    'store-sora': ['shibuya', 'minato', 'shinjuku'],
    'store-mori': ['shinjuku', 'chuo', 'taito'],
  }[store];
  return allowed.includes(buyer.area) ? buyer.area : allowed[0];
};
async function book(buyer, [listingId, offeringId], startAt) {
  const area = areaFor(buyer, listingId);
  let q;
  for (let tries = 0; !q; tries++) {
    try {
      q = await call(buyer.cookie, 'quotes', {
        listingId,
        offeringId,
        bookingMode: 'SCHEDULED',
        nominationType: 'NOMINATED',
        startAt,
        area,
      });
    } catch (e) {
      if (tries >= 8 || !e.message.includes('SLOT_CONFLICT')) throw e;
      startAt += 2 * H; // Staff busy: try a later slot.
    }
  }
  const h = await call(buyer.cookie, 'booking-holds', { quoteId: q.id });
  const p = await call(buyer.cookie, 'payments/demo-authorizations', {
    holdId: h.id,
    challengePassed: true,
  });
  return call(buyer.cookie, 'bookings', {
    quoteId: q.id,
    holdId: h.id,
    paymentId: p.id,
    termsAccepted: true,
    policyVersion: q.cancellationPolicy.version,
    address: {
      name: buyer.name,
      type: 'HOTEL',
      area,
      detail: `${buyer.hotel} 1-2-3`,
      hotelName: buyer.hotel,
      room: `${1000 + Math.floor(Math.random() * 800)}`,
      hotelPermission: true,
    },
  });
}
async function confirmAndAck(b) {
  const store = b.storeId;
  if (b.status === 'REQUESTED')
    b = await call(shops[store], `merchant/bookings/${b.id}/accept`, { version: b.version });
  if (b.staffTaskStatus !== 'ACKNOWLEDGED')
    b = await call(staff[b.assignedListingId || b.quote.listingId], `staff/tasks/${b.id}/ack`, {
      version: b.version,
    });
  return b;
}
async function serve(b) {
  const s = staff[b.assignedListingId || b.quote.listingId];
  for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) {
    if (event === 'EN_ROUTE') await setClock(b.quote.startAt - 40 * 60000);
    if (event === 'ARRIVED') await setClock(b.quote.startAt - 5 * 60000);
    if (event === 'START') await setClock(b.quote.startAt + 60000);
    if (event === 'COMPLETE')
      await setClock(b.startedAt + (b.quote.endAt - b.quote.startAt) + 2 * 60000);
    b = await call(s, `staff/tasks/${b.id}/events`, { version: b.version, event });
  }
  return b;
}
async function confirmCompletion(buyer, b) {
  await setClock(b.quote.endAt + 20 * 60000);
  b = await call(buyer.cookie, `bookings/${b.id}`);
  if (b.completion?.status === 'PAYMENT_REVIEW')
    b = await call(buyer.cookie, `bookings/${b.id}/completion`, {
      version: b.version,
      action: 'REAUTHORIZE',
      expectedAmount: b.quote.total,
    });
  return call(buyer.cookie, `bookings/${b.id}/completion`, {
    version: b.version,
    action: 'CONFIRM',
    expectedAmount: b.quote.total,
  });
}
const reviewTexts = {
  'zh-cn': [
    '准时到达，沟通很耐心，服务前把流程讲得很清楚。',
    '服务认真细致，整体体验很放松，下次还会预约。',
    '提前联系确认，用品整洁，很满意。',
  ],
  ja: [
    '時間通りに到着し、説明も丁寧でした。とてもリラックスできました。',
    '事前の確認がしっかりしていて安心できました。また利用します。',
    '清潔感があり、コミュニケーションも心地よかったです。',
  ],
  en: [
    'Arrived on time and explained everything clearly. Very relaxing.',
    'Friendly communication and a tidy setup. Would book again.',
    'Great attention to detail and very professional.',
  ],
};
const record = (buyer, b, label) => {
  summary.bookings.push({
    customer: buyer.email,
    id: b.id,
    status: b.status,
    label,
    listing: b.quote.listingId,
    startAt: new Date(b.quote.startAt).toISOString(),
  });
  log(
    `  ✓ ${label.padEnd(16)} ${buyer.name} · ${b.quote.listingId} · ${new Date(b.quote.startAt + 9 * H).toISOString().slice(0, 16)} JST · ${b.status}`,
  );
};

// ---------- past history (clock starts ~28 days ago) ----------
log('Creating past completed orders…');
let i = 0;
const reviews = [];
const pastPlan = [];
for (const buyer of buyers) for (let k = 0; k < 3; k++) pastPlan.push(buyer);
for (const buyer of pastPlan) {
  const menu = menus[i++ % menus.length];
  await attempt(`past order ${buyer.email}`, async () => {
    let b = await book(buyer, menu, slot(await now(), 11 + (i % 9)));
    b = await confirmAndAck(b);
    b = await serve(b);
    b = await confirmCompletion(buyer, b);
    if (i % 3 !== 0) {
      const scores = {
        punctuality: 5,
        communication: 4 + (i % 2),
        explanation: 5,
        cleanliness: 5,
        overall: 4 + (i % 2),
      };
      const texts = reviewTexts[buyer.locale];
      const r = await call(
        buyer.cookie,
        `customer/bookings/${b.id}/review`,
        { version: 0, scores, text: texts[i % texts.length] },
        'PUT',
      );
      reviews.push(r);
    }
    record(buyer, b, '已完成');
  });
}
log('Approving reviews…');
for (const r of reviews)
  await attempt(`approve review ${r.id}`, () =>
    call(admin, `admin/experience/REVIEW/${r.id}`, {
      version: r.version,
      decision: 'APPROVE',
      reason: 'Reviewed the actual service feedback and content publication policy.',
      checks: { privacy: true, appearance: true, claims: true, relevance: true },
    }),
  );

log('Creating refund / cancel / reject cases…');
await attempt('partial refund', async () => {
  const buyer = buyers[0];
  let b = await book(buyer, menus[1], slot(await now(), 15));
  b = await serve(await confirmAndAck(b));
  b = await confirmCompletion(buyer, b);
  const req = await call(buyer.cookie, `customer/bookings/${b.id}/refund-requests`, {
    bookingVersion: b.version,
    amount: 2000,
    reason: '服务时长比预约少了一些，希望店铺核实后部分退款。',
    locale: 'zh-cn',
  });
  const detail = await call(shops[b.storeId], `support-tickets/${req.ticketId}/refund-request`);
  await call(shops[b.storeId], `refund-requests/${req.id}/decision`, {
    version: req.version,
    bookingVersion: detail.bookingVersion,
    action: 'APPROVE',
    amount: 2000,
    text: '已核实服务记录，同意部分退款 2000 日元。',
  });
  record(buyer, b, '已完成+部分退款');
});
await attempt('pending refund request', async () => {
  const buyer = buyers[2] || buyers[0];
  let b = await book(buyer, menus[4], slot(await now(), 18));
  b = await serve(await confirmAndAck(b));
  b = await confirmCompletion(buyer, b);
  await call(buyer.cookie, `customer/bookings/${b.id}/refund-requests`, {
    bookingVersion: b.version,
    amount: 1500,
    reason: '施術の説明と内容が少し違ったため、確認をお願いします。',
    locale: 'ja',
  });
  record(buyer, b, '退款申请待处理');
});
await attempt('customer cancel', async () => {
  const buyer = buyers[1] || buyers[0];
  let b = await book(buyer, menus[0], slot((await now()) + 3 * D, 16));
  b = await call(buyer.cookie, `customer/bookings/${b.id}/cancel`, { version: b.version });
  record(buyer, b, '顾客取消');
});
await attempt('shop reject', async () => {
  const buyer = buyers[4] || buyers[0];
  let b = await book(buyer, menus[5], slot((await now()) + 2 * D, 20));
  b = await call(shops['store-mori'], `merchant/bookings/${b.id}/reject`, { version: b.version });
  record(buyer, b, '店铺拒单');
});
await attempt('support ticket', async () => {
  const buyer = buyers[3] || buyers[0];
  const b = summary.bookings.find((x) => x.customer === buyer.email && x.status === 'COMPLETED');
  await call(buyer.cookie, 'customer/support-tickets', {
    bookingId: b.id,
    category: 'SERVICE_QUALITY',
    subject: 'サービス内容についての確認',
    description: '前回の施術で説明いただいた内容について、もう一度確認したいです。',
  });
  log(`  ✓ 售后工单           ${buyer.name}`);
});

// ---------- near-present: awaiting completion confirmation ----------
await attempt('awaiting confirmation', async () => {
  const real = Date.now();
  await setClock(real - 30 * H);
  const buyer = buyers[0];
  let b = await book(buyer, menus[3], real - 6 * H - ((real - 6 * H) % (30 * 60000)));
  b = await serve(await confirmAndAck(b));
  record(buyer, b, '待顾客确认完成');
});

// ---------- upcoming orders at real time ----------
log('Creating upcoming orders…');
await setClock(Date.now());
let u = 0;
for (const buyer of buyers) {
  for (const days of [1, 4]) {
    const menu = menus[(u + 2) % menus.length];
    u++;
    await attempt(`upcoming ${buyer.email}`, async () => {
      let b = await book(buyer, menu, slot((await now()) + (days - 1) * D, 10 + ((u * 3) % 11)));
      // Leave every third Mori order waiting for the shop to accept.
      if (!(b.status === 'REQUESTED' && u % 3 === 0)) b = await confirmAndAck(b);
      record(buyer, b, b.status === 'REQUESTED' ? '待店铺接单' : '已确认待服务');
    });
  }
}

// ---------- platform employees ----------
log('Creating platform employee accounts…');
const employees = [
  ['运营 王芳', 'ops@hogulink.test', 'OPERATIONS', ['CUSTOMER_SUPPORT', 'MERCHANT_OPERATIONS']],
  ['客服 陈静', 'support@hogulink.test', 'SUPPORT', ['CUSTOMER_SUPPORT']],
  ['安全 山本', 'safety@hogulink.test', 'TRUST_SAFETY', ['TRUST_SAFETY']],
  ['财务 刘洋', 'finance@hogulink.test', 'FINANCE', []],
  ['审计 Brown', 'auditor@hogulink.test', 'AUDITOR', []],
];
for (const [name, email, adminRole, teams] of employees)
  await attempt(`employee ${email}`, async () => {
    const created = await call(admin, 'admin/members', { name, email, adminRole, teams });
    const inviteToken = created.token ?? created.invitation?.token;
    // Platform staff sign in with an authenticator code; testers add this key to their app.
    const { totp: setup } = await call('', 'auth/employee/invitation', { token: inviteToken });
    await call('', 'auth/employee/activate', {
      token: inviteToken,
      password: PASSWORD,
      code: totp(setup.secret, Date.now()),
    });
    await call('', 'auth/employee/login', {
      email,
      password: PASSWORD,
      code: totp(setup.secret, Date.now() + 30000),
    });
    summary.accounts.push({
      type: `平台员工(${adminRole})`,
      login: email,
      password: PASSWORD,
      authenticatorKey: setup.secret,
      name,
    });
    log(`  ✓ ${email}`);
  });

// ---------- partner (onboarding) accounts ----------
log('Creating merchant / therapist onboarding accounts…');
for (const [role, email, name] of [
  ['MERCHANT', 'shop.owner@hogulink.test', '新店铺 店主测试'],
  ['STAFF', 'therapist@hogulink.test', '新技师 测试'],
])
  await attempt(`partner ${email}`, async () => {
    await call('', 'auth/partner/register', { role, email, password: PASSWORD, name });
    summary.accounts.push({
      type: role === 'MERCHANT' ? '入驻商户(待提交资料)' : '入驻技师(待提交资料)',
      login: email,
      password: PASSWORD,
      name,
    });
    log(`  ✓ ${email}`);
  });

await setClock(Date.now());
if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
log(
  `\nDone: ${summary.accounts.length} accounts, ${summary.bookings.length} orders, ${summary.errors.length} errors`,
);
