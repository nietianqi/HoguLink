import type { Actor, Listing, Offering, Store } from '@hogulink/contracts';
import type { Repository } from './repository.js';
import type { Engine } from './engine.js';
const local = (ja: string, en: string, zh: string) => ({ ja, en, 'zh-cn': zh });
export const stores: Store[] = [
  {
    id: 'store-nagi',
    merchantId: 'merchant-nagi',
    slug: 'nagi-tokyo',
    name: local('凪 リラクゼーション', 'Nagi Tokyo', '凪 · 东京'),
    legalName: '合同会社 Nagi Demo（架空の事業者）',
    acceptanceMode: 'AUTO_PREAUTHORIZED',
    active: true,
    approved: true,
    pspAccount: 'demo_acct_nagi',
    emergencyContact: 'demo_emergency_nagi',
    areas: ['shinjuku', 'shibuya', 'minato', 'chuo', 'taito'],
    plan: 'STANDARD',
    ruleVersion: 1,
    acceptanceRule: {
      version: 1,
      authorizedBy: 'demo-seed-owner',
      authorizedAt: Date.UTC(2026, 9, 17),
      active: true,
      instantEnabled: true,
      offeringIds: ['store-nagi-60', 'store-nagi-90', 'store-nagi-120'],
      listingIds: ['listing-aoi', 'listing-ren', 'listing-mio'],
      areas: ['shinjuku', 'shibuya', 'minato', 'chuo', 'taito'],
      startHour: 0,
      endHour: 24,
      minTotal: 0,
      maxTotal: 200000,
      dailyLimit: 1000,
    },
    legalAddress: '東京都新宿区（デモ用住所）',
    contact: 'nagi@example.invalid',
  },
  {
    id: 'store-sora',
    merchantId: 'merchant-sora',
    slug: 'sora-wellness',
    name: local('そら ウェルネス', 'Sora Wellness', '空 · 舒缓空间'),
    legalName: 'Sora Demo 個人事業（架空の事業者）',
    acceptanceMode: 'SOLO',
    active: true,
    approved: true,
    pspAccount: 'demo_acct_sora',
    emergencyContact: 'demo_emergency_sora',
    areas: ['shibuya', 'minato', 'shinjuku'],
    plan: 'TRIAL',
    ruleVersion: 1,
    ownerStaffId: 'staff-haru',
    legalAddress: '東京都渋谷区（デモ用住所）',
    contact: 'sora@example.invalid',
  },
  {
    id: 'store-mori',
    merchantId: 'merchant-mori',
    slug: 'mori-tokyo',
    name: local('森 リラクゼーション', 'Mori Tokyo', '森 · 东京'),
    legalName: '株式会社 Mori Demo（架空の事業者）',
    acceptanceMode: 'MANUAL',
    active: true,
    approved: true,
    pspAccount: 'demo_acct_mori',
    emergencyContact: 'demo_emergency_mori',
    areas: ['shinjuku', 'chuo', 'taito'],
    plan: 'ANNUAL',
    ruleVersion: 1,
    legalAddress: '東京都中央区（デモ用住所）',
    contact: 'mori@example.invalid',
  },
];
export const offerings: Offering[] = stores.flatMap((store, index) =>
  [60, 90, 120].map((duration) => ({
    id: `${store.id}-${duration}`,
    storeId: store.id,
    name: local('リラクゼーション', 'Relaxation session', '舒缓放松'),
    durationMinutes: duration,
    price: duration * (index === 1 ? 130 : 120),
    transportFee: 1000,
    version: 1,
    approved: true,
    regulatoryCategory: 'RELAXATION',
  })),
);
export const listings: Listing[] = [
  ['aoi', '葵', 'Aoi', '葵', 'store-nagi', ['ja', 'en', 'zh'], '#d8e9e1', false],
  ['ren', '蓮', 'Ren', '莲', 'store-nagi', ['ja', 'en'], '#e8e0d5', false],
  ['mio', '澪', 'Mio', '澪', 'store-nagi', ['ja', 'zh'], '#dce4ee', true],
  ['haru', 'はる', 'Haru', '晴', 'store-sora', ['ja', 'en'], '#eadedc', false],
  ['yuki', 'ゆき', 'Yuki', '雪', 'store-mori', ['ja', 'en', 'zh'], '#e3e4d8', false],
  ['saki', '咲', 'Saki', '咲', 'store-mori', ['ja', 'zh'], '#e9decc', false],
].map(([slug, ja, en, zh, storeId, languages, color, hotelOnly], i) => ({
  id: `listing-${slug}`,
  slug: `${slug}-tokyo`,
  staffId: `staff-${slug}`,
  storeId: storeId as string,
  name: local(ja as string, en as string, zh as string),
  description: local(
    '忙しい一日に、ひと息つく時間を。落ち着いたコミュニケーションで、ご希望を伺います。',
    'A calm moment in your day. We listen carefully and explain each step of your relaxation session.',
    '为忙碌的一天留一点休息时间。服务前充分沟通，并清楚说明服务内容。',
  ),
  languages: languages as string[],
  initials: (en as string).slice(0, 1),
  color: color as string,
  hotelOnly: hotelOnly as boolean,
  publicationStatus: 'PUBLISHED_INDEXABLE',
  membershipActive: true,
  portraitConsent: true,
  identityVerified: true,
  onDuty: i < 4,
  dutyUpdatedAt: Date.now(),
  offeringIds: offerings.filter((x) => x.storeId === storeId).map((x) => x.id),
  photo: `/portraits/${slug}.svg`,
}));
export async function seed(repo: Repository) {
  await repo.transaction(async (tx) => {
    if (await tx.get('meta', 'seed-v1')) return;
    for (const value of stores) {
      await tx.put('stores', value);
      if (value.acceptanceRule)
        await tx.put('acceptanceRules', {
          id: `${value.id}:v${value.acceptanceRule.version}`,
          storeId: value.id,
          ...value.acceptanceRule,
        });
    }
    for (const value of offerings) await tx.put('offerings', value);
    for (const value of listings) await tx.put('listings', value);
    await tx.put('meta', { id: 'seed-v1', createdAt: Date.now() });
  });
  // Demo-only: the fictional sample services have used their regular price since
  // before the demo began, so the promotion comparison rule can be demonstrated.
  await repo.transaction(async (tx) => {
    if (await tx.get('meta', 'demo-price-since-v1')) return;
    const since = Date.now() - 60 * 86_400_000;
    for (const sample of offerings) {
      const current = await tx.get<Offering>('offerings', sample.id);
      if (current && !current.priceSince && current.price === sample.price)
        await tx.put('offerings', { ...current, priceSince: since });
    }
    await tx.put('meta', { id: 'demo-price-since-v1', createdAt: Date.now() });
  });
}

/**
 * Demo-only: one fictional shop runs a 7-day limited price once, through the same
 * merchant rules as a real shop, so the H5 offer UI has honest sample data.
 */
export async function seedDemoPromotion(engine: Engine) {
  const id = 'store-sora-90';
  const owner: Actor = {
    id: 'merchant-sora',
    role: 'MERCHANT',
    storeId: 'store-sora',
    verificationLevel: 1,
  };
  const done = await engine.repo.transaction((tx) => tx.get('meta', 'demo-promotion-v1'));
  if (done) return;
  const service = await engine.repo.transaction((tx) => tx.get<Offering>('offerings', id));
  if (service && !service.promotion)
    await engine.merchant.promotion(owner, id, {
      version: service.version,
      price: Math.round((service.price * 0.84) / 100) * 100,
      startsAt: engine.now(),
      endsAt: engine.now() + 7 * 86_400_000,
    });
  await engine.repo.transaction((tx) =>
    tx.put('meta', { id: 'demo-promotion-v1', createdAt: engine.now() }),
  );
}
