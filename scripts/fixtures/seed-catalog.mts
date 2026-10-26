// Test-data catalog: extra fictional shops, therapists and service menus.
// Written directly (there is no create-service API); safe to run more than once.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Repository } from '../../hogulink-api/src/repository.js';

const local = (ja: string, en: string, zh: string) => ({ ja, en, 'zh-cn': zh });
const service = (id: string, storeId: string, name: ReturnType<typeof local>, durationMinutes: number, price: number) => ({
  id,
  storeId,
  name,
  durationMinutes,
  price,
  transportFee: 1000,
  version: 1,
  approved: true,
  active: true,
  regulatoryCategory: 'RELAXATION',
});
const N = {
  base: local('リラクゼーション', 'Relaxation session', '舒缓放松'),
  shoulder: local('首・肩のリラクゼーション', 'Neck & shoulder relaxation', '肩颈舒缓'),
  foot: local('足のリラクゼーション', 'Foot relaxation', '足部放松'),
  aroma: local('アロマ全身リラクゼーション', 'Aroma full-body relaxation', '香氛全身放松'),
  deep: local('ゆったり全身リラクゼーション', 'Unhurried full-body relaxation', '深度全身舒缓'),
  head: local('頭と首のリラクゼーション', 'Head & neck relaxation', '头颈放松'),
  legDeep: local('脚のじっくりリラクゼーション', 'Extended leg relaxation', '腿部深度放松'),
  travel: local('旅の疲れリフレッシュ', 'Travel recovery relaxation', '旅途疲劳舒缓'),
  pair: local('ペアでリラクゼーション（お一人様分）', 'Couples relaxation (per person)', '双人同享放松（单人价）'),
};
export const extraOfferings = [
  // Existing shops: more named menus.
  service('store-nagi-shoulder-60', 'store-nagi', N.shoulder, 60, 7800),
  service('store-nagi-foot-60', 'store-nagi', N.foot, 60, 7200),
  service('store-nagi-aroma-90', 'store-nagi', N.aroma, 90, 12800),
  service('store-nagi-deep-120', 'store-nagi', N.deep, 120, 16800),
  service('store-sora-shoulder-60', 'store-sora', N.shoulder, 60, 7900),
  service('store-sora-travel-90', 'store-sora', N.travel, 90, 12200),
  service('store-mori-head-60', 'store-mori', N.head, 60, 7400),
  service('store-mori-leg-90', 'store-mori', N.legDeep, 90, 10800),
  // New shop: Hana (Ginza, automatic acceptance).
  service('store-hana-60', 'store-hana', N.base, 60, 7600),
  service('store-hana-90', 'store-hana', N.base, 90, 11200),
  service('store-hana-120', 'store-hana', N.base, 120, 14800),
  service('store-hana-shoulder-60', 'store-hana', N.shoulder, 60, 8200),
  service('store-hana-aroma-90', 'store-hana', N.aroma, 90, 13400),
  service('store-hana-pair-90', 'store-hana', N.pair, 90, 11800),
  // New shop: Umi (Asakusa, manual acceptance).
  service('store-umi-60', 'store-umi', N.base, 60, 6800),
  service('store-umi-90', 'store-umi', N.base, 90, 9800),
  service('store-umi-foot-60', 'store-umi', N.foot, 60, 6600),
  service('store-umi-travel-90', 'store-umi', N.travel, 90, 10400),
];
const offeringsOf = (storeId: string) => extraOfferings.filter((o) => o.storeId === storeId).map((o) => o.id);

export const extraStores = [
  {
    id: 'store-hana',
    merchantId: 'merchant-hana',
    slug: 'hana-ginza',
    name: local('花 リラクゼーション 銀座', 'Hana Ginza', '花 · 银座'),
    legalName: '株式会社 Hana Demo（架空の事業者）',
    acceptanceMode: 'AUTO_PREAUTHORIZED',
    active: true,
    approved: true,
    pspAccount: 'demo_acct_hana',
    emergencyContact: 'demo_emergency_hana',
    areas: ['chuo', 'minato', 'shinjuku', 'shibuya'],
    plan: 'STANDARD',
    ruleVersion: 1,
    acceptanceRule: {
      version: 1,
      authorizedBy: 'demo-seed-owner',
      authorizedAt: Date.UTC(2026, 7, 1),
      active: true,
      instantEnabled: true,
      offeringIds: offeringsOf('store-hana'),
      listingIds: ['listing-rina', 'listing-kaito', 'listing-mei'],
      areas: ['chuo', 'minato', 'shinjuku', 'shibuya'],
      startHour: 0,
      endHour: 24,
      minTotal: 0,
      maxTotal: 200000,
      dailyLimit: 1000,
    },
    legalAddress: '東京都中央区銀座（デモ用住所）',
    contact: 'hana@example.invalid',
  },
  {
    id: 'store-umi',
    merchantId: 'merchant-umi',
    slug: 'umi-asakusa',
    name: local('海 リラクゼーション 浅草', 'Umi Asakusa', '海 · 浅草'),
    legalName: 'Umi Demo 合同会社（架空の事業者）',
    acceptanceMode: 'MANUAL',
    active: true,
    approved: true,
    pspAccount: 'demo_acct_umi',
    emergencyContact: 'demo_emergency_umi',
    areas: ['taito', 'chuo', 'shinjuku'],
    plan: 'STANDARD',
    ruleVersion: 1,
    legalAddress: '東京都台東区浅草（デモ用住所）',
    contact: 'umi@example.invalid',
  },
];
const descriptions = [
  local(
    'お疲れの部位やお好みの強さを丁寧に伺い、落ち着いた時間をご用意します。',
    'I check which areas feel tired and your preferred pressure, then keep the session calm and unhurried.',
    '会先仔细了解您疲劳的部位和喜欢的力度，为您安排安静放松的时间。',
  ),
  local(
    '出張先や旅行中でも、ホテルのお部屋でゆっくりお過ごしいただけるよう心がけています。',
    'Whether you are travelling or on business, I aim to make your hotel room feel restful.',
    '无论是出差还是旅行，都希望让您在酒店房间里好好休息。',
  ),
  local(
    '会話は控えめでも大丈夫です。施術前に流れとお時間をご説明します。',
    'Quiet sessions are welcome. I explain the flow and timing before we begin.',
    '不想多聊也没关系，开始前会说明流程和时长。',
  ),
];
const people = [
  // slug, ja, en, zh, store, languages, card colour, portrait palette
  ['rina', '莉奈', 'Rina', '莉奈', 'store-hana', ['ja', 'en', 'zh'], '#e6e0ee', { bg: '#efe8ee', wall: '#ddd0dc', uniform: '#3b3a5a', skin: '#e2c4a8', hair: '#3a3134', long: true, glasses: false }],
  ['kaito', '海斗', 'Kaito', '海斗', 'store-hana', ['ja', 'en'], '#dfe7ee', { bg: '#e8edf0', wall: '#d2dce2', uniform: '#2c4456', skin: '#d4b192', hair: '#2b2f33', long: false, glasses: false }],
  ['mei', '芽衣', 'Mei', '芽衣', 'store-hana', ['ja', 'zh'], '#eee4dc', { bg: '#f1e9e2', wall: '#e2d4c8', uniform: '#5a3f3a', skin: '#e6caae', hair: '#4a3a30', long: true, glasses: true }],
  ['sho', '翔', 'Sho', '翔', 'store-umi', ['ja', 'en'], '#dcebe8', { bg: '#e6efed', wall: '#cfe0dc', uniform: '#24504a', skin: '#caa585', hair: '#26302e', long: false, glasses: true }],
  ['nana', '七海', 'Nana', '七海', 'store-umi', ['ja', 'zh', 'en'], '#e8ecdc', { bg: '#eef0e4', wall: '#dde2cc', uniform: '#45502e', skin: '#e0c2a2', hair: '#4b4033', long: true, glasses: false }],
] as const;
export const extraListings = people.map(([slug, ja, en, zh, storeId, languages, color], i) => ({
  id: `listing-${slug}`,
  slug: `${slug}-tokyo`,
  staffId: `staff-${slug}`,
  storeId,
  name: local(ja, en, zh),
  description: descriptions[i % descriptions.length],
  languages: [...languages],
  initials: en.slice(0, 1),
  color,
  hotelOnly: false,
  publicationStatus: 'PUBLISHED_INDEXABLE',
  membershipActive: true,
  portraitConsent: true,
  identityVerified: true,
  onDuty: i % 2 === 0,
  dutyUpdatedAt: Date.now(),
  offeringIds: offeringsOf(storeId),
  photo: `/portraits/${slug}.svg`,
}));

// Same illustration style as scripts/generate-demo-assets.mjs.
function portrait(p: (typeof people)[number][7], n: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="440" viewBox="0 0 600 440" role="img" aria-label="Fictional demo staff illustration"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${p.bg}"/><stop offset="1" stop-color="${p.wall}"/></linearGradient><linearGradient id="shirt" x2="1" y2="1"><stop stop-color="${p.uniform}"/><stop offset="1" stop-color="${p.uniform}" stop-opacity=".82"/></linearGradient></defs><path fill="url(#bg)" d="M0 0h600v440H0z"/><path d="M25 440V178a132 132 0 0 1 264 0v262" fill="${p.bg}" opacity=".7"/><path d="M470 0v440m12-440v440" stroke="#fff" stroke-opacity=".22" stroke-width="2"/><ellipse cx="320" cy="443" rx="152" ry="14" fill="${p.hair}" opacity=".1"/>
 ${p.long ? `<path d="M238 135q0-78 82-80 89 2 88 89l12 169-193 3z" fill="${p.hair}"/>` : `<path d="M244 144q-12-79 78-83 96-3 82 91l-15 43-130-4z" fill="${p.hair}"/>`}
 <path d="M191 440q0-103 48-133l50-17h61l51 16q54 24 55 134z" fill="url(#shirt)"/><path d="M289 252v52q29 36 61 0v-52" fill="${p.skin}"/><path d="M289 274q32 19 61-2v14q-31 18-61-1" fill="${p.hair}" opacity=".09"/><ellipse cx="252" cy="188" rx="12" ry="21" fill="${p.skin}"/><ellipse cx="390" cy="188" rx="12" ry="21" fill="${p.skin}"/><path d="M254 146q-3-59 66-60 72-1 70 61l-4 65q-3 61-65 69-63-9-67-69z" fill="${p.skin}"/>
 <path d="M246 149q-16-83 75-85 90-4 77 83-53-4-79-49-18 42-73 51" fill="${p.hair}"/><path d="M273 177q12-5 22-1m50 0q11-4 22 2" fill="none" stroke="${p.hair}" stroke-width="3" stroke-linecap="round"/><path d="M276 191q7 4 13 0m60 0q7 4 13 0" fill="none" stroke="${p.hair}" stroke-width="3" stroke-linecap="round"/><path d="m319 192-5 25 10 1" fill="none" stroke="${p.hair}" stroke-width="2" opacity=".2"/><path d="M305 239q16 9 31-1" fill="none" stroke="#a77f69" stroke-width="2.5" stroke-linecap="round"/>
 ${p.glasses ? `<g fill="none" stroke="${p.hair}" stroke-width="2.3" opacity=".7"><rect x="266" y="179" width="39" height="26" rx="8"/><rect x="338" y="179" width="39" height="26" rx="8"/><path d="M305 188q17-9 33 0m-72-1-12-4m123 4 13-4"/></g>` : ''}
 <path d="m280 292 39 33-25 25-28-51m94-7-41 33 25 25 29-51" fill="${p.bg}" opacity=".9"/><path d="M319 325v115" stroke="${p.bg}" stroke-opacity=".3" stroke-width="2"/><circle cx="328" cy="370" r="2" fill="${p.bg}"/><circle cx="328" cy="397" r="2" fill="${p.bg}"/><path d="M368 349h31v25h-31z" fill="${p.bg}" opacity=".65"/><path d="M373 356h20m-20 6h14" stroke="${p.uniform}" stroke-width="2"/><path d="m230 351-8 89m190-89 9 89" stroke="${p.hair}" opacity=".1" stroke-width="3"/><path d="M515 376h45v64h-45" fill="${p.bg}" opacity=".5"/><text x="570" y="419" font-family="Arial,sans-serif" font-size="9" text-anchor="end" letter-spacing="2" fill="${p.hair}" opacity=".32">HL / ${String(n).padStart(2, '0')}</text></svg>`;
}

export async function seedCatalog(repo: Repository, now: number) {
  const dir = fileURLToPath(new URL('../../hogulink-web/public/portraits/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  people.forEach((p, i) => writeFileSync(`${dir}/${p[0]}.svg`, portrait(p[7], 7 + i)));
  await repo.transaction(async (tx) => {
    if (await tx.get('meta', 'test-catalog-v1')) return;
    for (const o of extraOfferings)
      if (!(await tx.get('offerings', o.id))) await tx.put('offerings', { ...o, priceSince: now - 90 * 86_400_000 });
    for (const s of extraStores) {
      if (await tx.get('stores', s.id)) continue;
      await tx.put('stores', s);
      if (s.acceptanceRule)
        await tx.put('acceptanceRules', { id: `${s.id}:v${s.acceptanceRule.version}`, storeId: s.id, ...s.acceptanceRule });
      await tx.put('merchantSubscriptions', {
        id: s.id,
        version: 1,
        status: 'STANDARD',
        renewal: 'STANDARD',
        overdueAction: 'DOWNGRADE',
        legacy: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const l of extraListings) if (!(await tx.get('listings', l.id))) await tx.put('listings', l);
    // Existing therapists offer their shop's new menus too.
    for (const id of ['listing-aoi', 'listing-ren', 'listing-mio', 'listing-haru', 'listing-yuki', 'listing-saki']) {
      const l = await tx.get<{ storeId: string; offeringIds: string[] }>('listings', id);
      if (!l) continue;
      const offeringIds = [...new Set([...l.offeringIds, ...offeringsOf(l.storeId)])];
      if (offeringIds.length !== l.offeringIds.length) await tx.put('listings', { ...l, offeringIds });
    }
    await tx.put('meta', { id: 'test-catalog-v1', createdAt: now });
  });
}
