// Bulk test orders: ~60 days of history across all shops, plus the coming week.
// Runs against fixtures/seed-server.mts (movable clock); see scripts/seed-test-data.sh.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const base = process.env.SEED_API_ORIGIN,
  origin = process.env.SEED_WEB_ORIGIN,
  token = process.env.SEED_TOKEN,
  PASSWORD = process.env.SEED_PASSWORD || 'HoguLink@2026',
  DAYS = Number(process.env.SEED_DAYS || 55),
  out = process.env.SEED_OUTPUT;
const M = 60000,
  H = 60 * M,
  D = 24 * H;
const stats = { created: 0, completed: 0, reviews: 0, replies: 0, refunds: 0, refundPending: 0, cancelled: 0, rejected: 0, upcoming: 0, requested: 0, promotions: 0, errors: [] };
let seedState = 20261023;
const rand = () => ((seedState = (seedState * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];

async function call(cookie, path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(`${base}/v1/${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 240)}`);
  const data = text ? JSON.parse(text) : {};
  const c = r.headers.get('set-cookie');
  return c ? { data, cookie: c.split(';')[0] } : data;
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
const setClock = async (at) => {
  const current = await now();
  if (at > current) await seedApi('clock', { at: Math.round(at) });
};
async function attempt(label, fn) {
  try {
    return await fn();
  } catch (e) {
    stats.errors.push(`${label}: ${e.message}`);
  }
}
const jstMidnight = (t) => {
  const d = new Date(t + 9 * H);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - 9 * H;
};

// ---------- actors ----------
const demo = async (role, extra = {}) => (await call('', 'auth/demo', { role, ...extra })).cookie;
const admin = await demo('ADMIN');
const storeIds = ['store-nagi', 'store-sora', 'store-mori', 'store-hana', 'store-umi'];
const shops = {};
for (const storeId of storeIds) shops[storeId] = await demo('MERCHANT', { storeId });
const catalog = {
  'store-nagi': { listings: ['aoi', 'ren', 'mio'], offerings: ['store-nagi-60', 'store-nagi-90', 'store-nagi-120', 'store-nagi-shoulder-60', 'store-nagi-foot-60', 'store-nagi-aroma-90', 'store-nagi-deep-120'], areas: ['shinjuku', 'shibuya', 'minato', 'chuo', 'taito'] },
  'store-sora': { listings: ['haru'], offerings: ['store-sora-60', 'store-sora-90', 'store-sora-light-60', 'store-sora-back-90', 'store-sora-shoulder-60', 'store-sora-travel-90'], areas: ['shibuya', 'minato', 'shinjuku'] },
  'store-mori': { listings: ['yuki', 'saki'], offerings: ['store-mori-60', 'store-mori-90', 'store-mori-shoulder-60', 'store-mori-leg-60', 'store-mori-fullbody-90', 'store-mori-head-60', 'store-mori-leg-90'], areas: ['shinjuku', 'chuo', 'taito'] },
  'store-hana': { listings: ['rina', 'kaito', 'mei'], offerings: ['store-hana-60', 'store-hana-90', 'store-hana-120', 'store-hana-shoulder-60', 'store-hana-aroma-90', 'store-hana-pair-90'], areas: ['chuo', 'minato', 'shinjuku', 'shibuya'] },
  'store-umi': { listings: ['sho', 'nana'], offerings: ['store-umi-60', 'store-umi-90', 'store-umi-foot-60', 'store-umi-travel-90'], areas: ['taito', 'chuo', 'shinjuku'] },
};
const staff = {};
for (const storeId of storeIds)
  for (const s of catalog[storeId].listings) staff[`listing-${s}`] = await demo('STAFF', { staffId: `staff-${s}` });
const listingStore = Object.fromEntries(storeIds.flatMap((id) => catalog[id].listings.map((s) => [`listing-${s}`, id])));
// Weight shops so the larger ones see more orders.
const weightedListings = Object.keys(listingStore).flatMap((l) => (listingStore[l] === 'store-sora' ? [l, l] : [l]));

// ---------- customers ----------
const existing = [
  ['zhang.wei@hogulink.test', '张伟', 'zh-cn', 'shinjuku', '新宿华盛顿酒店'],
  ['li.na@hogulink.test', '李娜', 'zh-cn', 'shibuya', '涩谷东急卓越大酒店'],
  ['tanaka.yuto@hogulink.test', '田中 悠斗', 'ja', 'minato', 'ホテル赤坂テスト'],
  ['sato.hana@hogulink.test', '佐藤 花', 'ja', 'chuo', '銀座テストホテル'],
  ['emily.clark@hogulink.test', 'Emily Clark', 'en', 'shinjuku', 'Shinjuku Test Hotel'],
];
const fresh = [
  ['wang.fang@hogulink.test', '王芳', 'zh-cn', 'chuo', '银座测试酒店'],
  ['chen.hao@hogulink.test', '陈浩', 'zh-cn', 'taito', '浅草测试酒店'],
  ['liu.yang@hogulink.test', '刘洋', 'zh-cn', 'minato', '六本木测试酒店'],
  ['zhao.min@hogulink.test', '赵敏', 'zh-cn', 'shinjuku', '新宿测试公寓'],
  ['suzuki.ken@hogulink.test', '鈴木 健', 'ja', 'shibuya', '渋谷テストホテル'],
  ['takahashi.mai@hogulink.test', '高橋 舞', 'ja', 'taito', '上野テストホテル'],
  ['yamada.ryo@hogulink.test', '山田 涼', 'ja', 'chuo', '日本橋テストホテル'],
  ['james.wilson@hogulink.test', 'James Wilson', 'en', 'minato', 'Roppongi Test Hotel'],
  ['sophie.martin@hogulink.test', 'Sophie Martin', 'en', 'shibuya', 'Shibuya Test Hotel'],
  ['kim.minji@hogulink.test', 'Kim Minji', 'en', 'shinjuku', 'Shinjuku Test Residence'],
];
const customers = [];
for (const [email, name, locale, area, hotel] of [...existing, ...fresh]) {
  await attempt(`customer ${email}`, async () => {
    if (fresh.some((f) => f[0] === email)) {
      await call('', 'auth/customer/register', { email, password: PASSWORD, name, locale, termsAccepted: true });
      const mail = (await seedApi('outbox'))
        .filter((m) => m.to === email && m.type === 'CUSTOMER_VERIFY')
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      const t = mail && new URLSearchParams(new URL(mail.text.match(/https?:\/\/\S+/)[0]).hash.slice(1)).get('token');
      if (t) await call('', 'auth/customer/verify-email', { token: t });
    }
    const { cookie } = await call('', 'auth/customer/login', { email, password: PASSWORD });
    let book = await call(cookie, 'customer/addresses');
    if (!book.items?.length)
      await call(cookie, 'customer/addresses', {
        version: book.version,
        label: locale === 'en' ? 'Hotel' : locale === 'ja' ? 'ホテル' : '酒店',
        setDefault: true,
        address: { name, area, type: 'HOTEL', detail: `${hotel} 2-4-6`, hotelName: hotel },
      });
    customers.push({ email, name, locale, area, hotel, cookie });
  });
}
customers.push({ email: 'demo', name: '演示顾客', locale: 'zh-cn', area: 'shinjuku', hotel: '演示酒店', cookie: await demo('CUSTOMER') });
console.log(`customers ready: ${customers.length}`);

// ---------- content ----------
const reviewTexts = {
  'zh-cn': ['准时到达，沟通很耐心，服务前把流程讲得很清楚。', '力度刚好，整个过程很放松，下次还会预约。', '提前联系确认，用品整洁，很满意。', '出差很累，服务后整个人轻松多了。', '技师很专业，会根据反馈调整力度。', '整体不错，就是到达比预计晚了几分钟。'],
  ja: ['時間通りに到着し、説明も丁寧でした。とてもリラックスできました。', '事前の確認がしっかりしていて安心できました。また利用します。', '清潔感があり、コミュニケーションも心地よかったです。', '出張の疲れがすっかり取れました。', '力加減を何度も確認してくれて良かったです。', '全体的に満足ですが、到着が少し遅れました。'],
  en: ['Arrived on time and explained everything clearly. Very relaxing.', 'Friendly communication and a tidy setup. Would book again.', 'Great attention to detail and very professional.', 'Exactly what I needed after a long flight.', 'Checked in on the pressure throughout. Lovely session.', 'Good overall, though arrival was a few minutes late.'],
};
const replies = {
  'zh-cn': '感谢您的评价，期待再次为您服务。',
  ja: 'ご利用ありがとうございました。またのご利用をお待ちしております。',
  en: 'Thank you for your kind feedback. We look forward to seeing you again.',
};
const refundReasons = {
  'zh-cn': '服务时长比预约少了一些，希望店铺核实后部分退款。',
  ja: '施術時間が予約より短かったため、確認をお願いします。',
  en: 'The session ended earlier than booked. Please review and refund part of it.',
};

// ---------- booking flow ----------
async function book(c, listingId, offeringId, startAt) {
  const store = listingStore[listingId];
  const area = catalog[store].areas.includes(c.area) ? c.area : catalog[store].areas[0];
  const q = await call(c.cookie, 'quotes', { listingId, offeringId, bookingMode: 'SCHEDULED', nominationType: 'NOMINATED', startAt, area });
  const h = await call(c.cookie, 'booking-holds', { quoteId: q.id });
  const p = await call(c.cookie, 'payments/demo-authorizations', { holdId: h.id, challengePassed: true });
  const b = await call(c.cookie, 'bookings', {
    quoteId: q.id,
    holdId: h.id,
    paymentId: p.id,
    termsAccepted: true,
    policyVersion: q.cancellationPolicy.version,
    address: { name: c.name, type: 'HOTEL', area, detail: `${c.hotel} 2-4-6`, hotelName: c.hotel, room: String(300 + Math.floor(rand() * 1500)), hotelPermission: true },
  });
  stats.created++;
  return b;
}
const listingOf = (b) => b.assignedListingId || b.quote.listingId;
async function accept(b) {
  if (b.status === 'REQUESTED') b = await call(shops[b.storeId], `merchant/bookings/${b.id}/accept`, { version: b.version });
  if (b.staffTaskStatus !== 'ACKNOWLEDGED') b = await call(staff[listingOf(b)], `staff/tasks/${b.id}/ack`, { version: b.version });
  return b;
}
const fresh_ = async (c, b) => call(c.cookie, `bookings/${b.id}`);

// One past day: create the day's orders the previous morning, then play the visits in time order.
async function playDay(dayStart, count) {
  await setClock(dayStart - 16 * H); // 08:00 JST the day before
  const plans = [];
  const used = new Set();
  for (let k = 0; k < count; k++) {
    const listingId = pick(weightedListings);
    const store = listingStore[listingId];
    const offeringId = pick(catalog[store].offerings);
    let hour = 10 + Math.floor(rand() * 11);
    while (used.has(`${listingId}:${hour}`) || used.has(`${listingId}:${hour - 1}`) || used.has(`${listingId}:${hour - 2}`)) hour++;
    if (hour > 21) continue;
    used.add(`${listingId}:${hour}`);
    const c = pick(customers);
    const r = rand();
    const outcome = r < 0.05 ? 'cancel' : r < 0.08 ? 'reject' : r < 0.12 ? 'refund' : r < 0.15 ? 'refundPending' : 'complete';
    await attempt(`book ${dayStart}`, async () => {
      let b = await book(c, listingId, offeringId, dayStart + hour * H + (rand() < 0.5 ? 0 : 30 * M));
      if (outcome === 'cancel') {
        await call(c.cookie, `customer/bookings/${b.id}/cancel`, { version: b.version });
        stats.cancelled++;
        return;
      }
      if (outcome === 'reject' && b.status === 'REQUESTED') {
        await call(shops[b.storeId], `merchant/bookings/${b.id}/reject`, { version: b.version });
        stats.rejected++;
        return;
      }
      b = await accept(b);
      plans.push({ c, b, outcome });
    });
  }
  // Interleave every visit's steps in real time order.
  const steps = [];
  for (const p of plans) {
    const s = p.b.quote.startAt,
      len = p.b.quote.endAt - p.b.quote.startAt;
    for (const [at, ev] of [[s - 40 * M, 'EN_ROUTE'], [s - 5 * M, 'ARRIVED'], [s + M, 'START'], [s + len + 3 * M, 'COMPLETE'], [s + len + 25 * M, 'CONFIRM']]) steps.push({ at, ev, p });
  }
  steps.sort((a, b) => a.at - b.at);
  for (const { at, ev, p } of steps) {
    if (p.failed) continue;
    await setClock(at);
    try {
      if (ev === 'CONFIRM') {
        let b = await fresh_(p.c, p.b);
        if (b.completion?.status === 'PAYMENT_REVIEW')
          b = await call(p.c.cookie, `bookings/${b.id}/completion`, { version: b.version, action: 'REAUTHORIZE', expectedAmount: b.quote.total });
        p.b = await call(p.c.cookie, `bookings/${b.id}/completion`, { version: b.version, action: 'CONFIRM', expectedAmount: b.quote.total });
        stats.completed++;
      } else p.b = await call(staff[listingOf(p.b)], `staff/tasks/${p.b.id}/events`, { version: p.b.version, event: ev });
    } catch (e) {
      p.failed = true;
      stats.errors.push(`${ev} ${p.b.id}: ${e.message}`);
    }
  }
  // Same evening: reviews and after-care.
  await setClock(dayStart + 23 * H);
  for (const p of plans.filter((x) => !x.failed && x.b.status === 'COMPLETED')) {
    await attempt(`aftercare ${p.b.id}`, async () => {
      if (p.outcome === 'refund' || p.outcome === 'refundPending') {
        const amount = pick([1000, 1500, 2000, 3000]);
        const req = await call(p.c.cookie, `customer/bookings/${p.b.id}/refund-requests`, { bookingVersion: p.b.version, amount, reason: refundReasons[p.c.locale], locale: p.c.locale });
        if (p.outcome === 'refund') {
          const detail = await call(shops[p.b.storeId], `support-tickets/${req.ticketId}/refund-request`);
          await call(shops[p.b.storeId], `refund-requests/${req.id}/decision`, { version: req.version, bookingVersion: detail.bookingVersion, action: 'APPROVE', amount, text: 'Checked the visit record and approved a partial refund.' });
          stats.refunds++;
        } else stats.refundPending++;
        return;
      }
      if (rand() < 0.7) {
        const overall = rand() < 0.75 ? 5 : rand() < 0.8 ? 4 : 3;
        const sc = () => Math.max(1, Math.min(5, overall + (rand() < 0.3 ? -1 : 0)));
        const r = await call(p.c.cookie, `customer/bookings/${p.b.id}/review`, { version: 0, scores: { punctuality: sc(), communication: sc(), explanation: sc(), cleanliness: sc(), overall }, text: pick(reviewTexts[p.c.locale]) }, 'PUT');
        stats.reviews++;
        if (rand() < 0.9) {
          await call(admin, `admin/experience/REVIEW/${r.id}`, { version: r.version, decision: 'APPROVE', reason: 'Reviewed the actual service feedback and content publication policy.', checks: { privacy: true, appearance: true, claims: true, relevance: true } });
          if (rand() < 0.45) {
            const current = (await call(p.c.cookie, `customer/bookings/${p.b.id}/experience`)).review;
            await call(shops[p.b.storeId], `merchant/reviews/${current.id}/reply`, { version: 0, reviewVersion: current.version, text: replies[p.c.locale] });
            stats.replies++;
          }
        }
      }
    });
  }
}

// ---------- history ----------
const realNow = Date.now();
const firstDay = jstMidnight(realNow) - DAYS * D;
for (let d = 0; d < DAYS - 1; d++) {
  const day = firstDay + d * D;
  const weekday = new Date(day + 9 * H).getUTCDay();
  const count = 2 + Math.floor(rand() * 3) + (weekday === 5 || weekday === 6 ? 2 : 0) + Math.floor((d / DAYS) * 2); // busier lately and on weekends
  await playDay(day, count);
  if (d % 5 === 0) console.log(`day ${d + 1}/${DAYS - 1}: ${stats.completed} completed, ${stats.errors.length} errors`);
}

// ---------- coming week ----------
await setClock(realNow);
const today = jstMidnight(realNow);
const used = new Set();
for (let k = 0; k < 30; k++) {
  const listingId = pick(weightedListings);
  const store = listingStore[listingId];
  const day = today + (1 + Math.floor(rand() * 7)) * D;
  const hour = 10 + Math.floor(rand() * 11);
  if (used.has(`${listingId}:${day}:${hour}`)) continue;
  used.add(`${listingId}:${day}:${hour}`);
  const c = pick(customers);
  await attempt('upcoming', async () => {
    let b = await book(c, listingId, pick(catalog[store].offerings), day + hour * H);
    if (b.status === 'REQUESTED' && rand() < 0.5) stats.requested++;
    else {
      b = await accept(b);
      stats.upcoming++;
    }
  });
}

// ---------- promotions ----------
for (const [storeId, id] of [['store-nagi', 'store-nagi-aroma-90'], ['store-hana', 'store-hana-shoulder-60'], ['store-umi', 'store-umi-travel-90'], ['store-mori', 'store-mori-head-60']])
  await attempt(`promotion ${id}`, async () => {
    const svc = (await call(shops[storeId], 'merchant/workspace')).offerings.find((s) => s.id === id);
    const price = Math.round((svc.price * 0.85) / 100) * 100;
    await call(shops[storeId], `merchant/services/${id}/promotion`, { version: svc.version, price, startsAt: realNow, endsAt: realNow + 10 * D }, 'PUT');
    stats.promotions++;
  });

if (out) writeFileSync(out, JSON.stringify(stats, null, 2));
console.log(JSON.stringify({ ...stats, errors: stats.errors.length }, null, 1));
console.log(stats.errors.slice(0, 15).join('\n'));
