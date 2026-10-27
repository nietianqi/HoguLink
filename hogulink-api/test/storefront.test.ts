import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { Store, StorefrontContent, Actor, Offering } from '@hogulink/contracts';
import { fixture, shop, admin, staff, customer } from './helpers/experience-fixture.js';
import { bundleEvidence } from '../src/evidence-storage.js';
const code = (s: string) => (e: unknown) => (e as { code?: string }).code === s;
const content = (): StorefrontContent => ({
  tagline: { ja: '東京でくつろぐ時間', en: 'A moment of calm', 'zh-cn': '在东京享受从容放松' },
  about: {
    ja: 'お店が担当者とサービスを手配します。',
    en: 'Our shop arranges your relaxation service and therapist.',
    'zh-cn': '由店铺安排放松服务，费用与预约规则清晰展示。',
  },
  logoId: null,
  coverId: null,
  photoIds: [],
  featuredOfferingIds: ['store-nagi-60'],
  teamListingIds: ['listing-aoi'],
});
const image = async () => ({
  mime: 'image/jpeg',
  data: (
    await sharp({ create: { width: 80, height: 60, channels: 3, background: '#208c69' } })
      .jpeg()
      .toBuffer()
  ).toString('base64'),
});
test('shop image cleanup cannot break a saved draft, pending review or public version', () =>
  fixture(async (e) => {
    const a = await e.storefronts.upload(shop, await image()),
      b = await e.storefronts.upload(shop, await image());
    await assert.rejects(
      e.storefronts.remove({ ...shop, storeId: 'store-mori' }, a.id),
      code('NOT_FOUND'),
    );
    assert.equal((await e.storefronts.remove(shop, b.id)).removed, true);
    await assert.rejects(e.storefronts.file(b.id, shop), code('NOT_FOUND'));
    let d = await e.storefronts.save(shop, {
      version: 0,
      content: { ...content(), coverId: a.id },
    });
    await assert.rejects(e.storefronts.remove(shop, a.id), code('STOREFRONT_ASSET_IN_USE'));
    d = await e.storefronts.submit(shop, { version: d.version });
    await assert.rejects(e.storefronts.remove(shop, a.id), code('STOREFRONT_ASSET_IN_USE'));
    d = await e.storefronts.review(admin, shop.storeId!, {
      version: d.version,
      approved: true,
      note: 'Image rights verified in test.',
    });
    await e.storefronts.save(shop, { version: d.version, content: content() });
    await assert.rejects(
      e.storefronts.remove(shop, a.id),
      code('STOREFRONT_ASSET_IN_USE'),
      'the old public page still needs its image',
    );
  }));
test('shop page drafts and files are scoped, versioned and private until platform approval', () =>
  fixture(async (e) => {
    const sf = e.storefronts,
      asset = await sf.upload(shop, await image());
    await assert.rejects(sf.workspace(customer), code('FORBIDDEN'));
    await assert.rejects(sf.save(staff, { version: 0, content: content() }), code('FORBIDDEN'));
    await assert.rejects(sf.file(asset.id), code('NOT_FOUND'));
    await assert.rejects(sf.file(asset.id, { ...shop, storeId: 'store-mori' }), code('NOT_FOUND'));
    assert.equal((await sf.file(asset.id, shop)).published, false);
    assert.equal((await sharp((await sf.file(asset.id, shop)).bytes).metadata()).format, 'jpeg');
    const c = { ...content(), coverId: asset.id, logoId: asset.id, photoIds: [asset.id] };
    let d = await sf.save(shop, { version: 0, content: c });
    await assert.rejects(sf.save(shop, { version: 0, content: c }), code('VERSION_CONFLICT'));
    d = await sf.submit(shop, { version: d.version });
    assert.equal(d.status, 'PENDING');
    assert.equal((await sf.queue(admin))[0].storeId, shop.storeId);
    assert.equal((await e.adminTodo(admin)).storefronts, 1);
    await assert.rejects(
      sf.save(shop, { version: d.version, content: c }),
      code('STOREFRONT_REVIEW_PENDING'),
    );
    assert.equal(
      (await e.publicCatalog({ fulfillmentMode: 'ALL' })).stores.find((s) => s.id === shop.storeId)
        ?.storefront,
      undefined,
    );
    d = await sf.review(admin, shop.storeId!, {
      version: d.version,
      approved: true,
      note: 'Verified image rights and all three language introductions.',
    });
    assert.equal(d.status, 'PUBLISHED');
    assert.equal((await sf.file(asset.id)).published, true);
    const published = (await e.publicCatalog({ fulfillmentMode: 'ALL' })).stores.find(
      (s) => s.id === shop.storeId,
    )!.storefront!;
    assert.equal(published.cover?.id, asset.id);
    assert.equal('note' in published, false);
    assert.equal('storeId' in published, false);
    const record = await e.repo.read((tx) => tx.get<any>('storefrontFiles', asset.id));
    assert.equal(
      (
        await bundleEvidence([
          { kind: 'storefrontFiles', id: asset.id, body: JSON.stringify(record) },
        ])
      ).length,
      1,
      'shop image bytes are backed up',
    );
    assert.equal((await e.adminTodo(admin)).storefronts, 0);
  }));
test('withdrawal and requested changes preserve the last public page; replacement publishes atomically', () =>
  fixture(async (e) => {
    const sf = e.storefronts,
      a = await sf.upload(shop, await image()),
      b = await sf.upload(shop, await image());
    let d = await sf.save(shop, { version: 0, content: { ...content(), coverId: a.id } });
    d = await sf.submit(shop, { version: d.version });
    d = await sf.review(admin, shop.storeId!, {
      version: d.version,
      approved: true,
      note: 'Approved original brand image.',
    });
    const original = (await sf.workspace(shop)).published;
    d = await sf.save(shop, { version: d.version, content: { ...content(), coverId: b.id } });
    d = await sf.submit(shop, { version: d.version });
    assert.deepEqual((await sf.workspace(shop)).published, original);
    assert.equal((await sf.file(a.id)).published, true);
    await assert.rejects(sf.file(b.id), code('NOT_FOUND'));
    const stale = d.version;
    d = await sf.withdraw(shop, { version: d.version });
    await assert.rejects(
      sf.review(admin, shop.storeId!, {
        version: stale,
        approved: true,
        note: 'Old queue must not publish.',
      }),
      code('VERSION_CONFLICT'),
    );
    d = await sf.submit(shop, { version: d.version });
    d = await sf.review(admin, shop.storeId!, {
      version: d.version,
      approved: false,
      note: 'Please clarify the brand photo.',
    });
    assert.equal(d.status, 'CHANGES_REQUESTED');
    assert.deepEqual((await sf.workspace(shop)).published, original);
    d = await sf.submit(shop, { version: d.version });
    await sf.review(admin, shop.storeId!, {
      version: d.version,
      approved: true,
      note: 'Corrected content verified.',
    });
    await assert.rejects(sf.file(a.id), code('NOT_FOUND'));
    assert.equal((await sf.file(b.id)).published, true);
    await e.repo.transaction(async (tx) => {
      const s = await tx.get<Store>('stores', shop.storeId!);
      await tx.put('stores', { ...s!, active: false });
    });
    await assert.rejects(sf.file(b.id), code('NOT_FOUND'));
  }));
test('cross-shop references and non-public supply cannot be promoted through brand content', () =>
  fixture(async (e) => {
    const sf = e.storefronts,
      other = { ...shop, storeId: 'store-mori' },
      a = await sf.upload(other, await image());
    for (const c of [
      { ...content(), coverId: a.id },
      { ...content(), featuredOfferingIds: ['store-mori-60'] },
      { ...content(), teamListingIds: ['listing-yuki'] },
    ])
      await assert.rejects(sf.save(shop, { version: 0, content: c }));
    let d = await sf.save(shop, { version: 0, content: content() });
    await e.repo.transaction(async (tx) => {
      const o = await tx.get<Offering>('offerings', 'store-nagi-60');
      await tx.put('offerings', { ...o!, active: false });
    });
    await assert.rejects(
      sf.submit(shop, { version: d.version }),
      code('INVALID_STOREFRONT_REFERENCE'),
    );
    d = await sf.save(shop, {
      version: d.version,
      content: {
        ...content(),
        featuredOfferingIds: [],
        about: { ...content().about, en: 'short' },
      },
    });
    await assert.rejects(
      sf.submit(shop, { version: d.version }),
      code('STOREFRONT_CONTENT_REQUIRED'),
    );
  }));
test('publishing a brand revision leaves live transaction rules and existing quote holds valid', () =>
  fixture(async (e) => {
    const before = await e.repo.read((tx) => tx.get<Store>('stores', shop.storeId!));
    const q = await e.quote(customer, {
      listingId: 'listing-aoi',
      offeringId: 'store-nagi-60',
      bookingMode: 'SCHEDULED',
      nominationType: 'FREE',
      startAt: e.now() + 180 * 60000,
      area: 'shinjuku',
      requiredLanguage: '',
    });
    let d = await e.storefronts.save(shop, { version: 0, content: content() });
    d = await e.storefronts.submit(shop, { version: d.version });
    await e.storefronts.review(admin, shop.storeId!, {
      version: d.version,
      approved: true,
      note: 'Approved genuine shop introduction.',
    });
    const after = await e.repo.read((tx) => tx.get<Store>('stores', shop.storeId!));
    assert.deepEqual({ ...after, storefront: undefined }, { ...before, storefront: undefined });
    assert.ok((await e.hold(customer, q.id)).id);
  }));
test('admin review permission uses current staff privileges, not a supplied owner claim', () =>
  fixture(async (e) => {
    const restricted: Actor = {
      id: 'qa-finance',
      role: 'ADMIN',
      verificationLevel: 3,
      adminRole: 'FINANCE',
      adminSessionVersion: 1,
    };
    await e.repo.transaction(async (tx) => {
      await tx.put('adminMembers', {
        id: restricted.id,
        name: 'Finance',
        email: 'finance@qa.example',
        adminRole: 'FINANCE',
        teams: [],
        status: 'ACTIVE',
        version: 1,
        sessionVersion: 1,
        createdAt: e.now(),
        updatedAt: e.now(),
      });
    });
    await assert.rejects(e.storefronts.queue(restricted), code('FORBIDDEN'));
    await assert.rejects(
      e.storefronts.review({ ...restricted, adminRole: 'OWNER' }, shop.storeId!, {
        version: 1,
        approved: true,
        note: 'Cannot trust stale privileges.',
      }),
      code('FORBIDDEN'),
    );
  }));
