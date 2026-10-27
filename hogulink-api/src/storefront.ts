import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import {
  storefrontContentInput,
  storefrontAssetUrl,
  fulfillmentMode,
  type Actor,
  type Store,
  type Listing,
  type Offering,
  type StorefrontAsset,
  type StorefrontContent,
  type StorefrontDraft,
  type StorefrontWorkspace,
  type StorefrontReviewItem,
  type PublishedStorefront,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { currentAdmin, requireAdmin } from './admin-access.js';
import { ensure } from './errors.js';
import { loadEvidence, saveEvidence, removeEvidence } from './evidence-storage.js';

type Asset = { id: string; storeId: string; storageKey: string; size: number; createdAt: number };
const versionInput = z.object({ version: z.number().int().nonnegative() }).strict();
const assetView = (a: Asset): StorefrontAsset => ({
  id: a.id,
  url: storefrontAssetUrl(a.id),
  createdAt: a.createdAt,
});
const references = (c: StorefrontContent) => [
  ...new Set([c.logoId, c.coverId, ...c.photoIds].filter((x): x is string => !!x)),
];
const blank = (s: Store): StorefrontContent => ({
  tagline: { ja: '', en: '', 'zh-cn': '' },
  about: s.description ?? { ja: '', en: '', 'zh-cn': '' },
  logoId: null,
  coverId: null,
  photoIds: [],
  featuredOfferingIds: [],
  teamListingIds: [],
});
const eligible = (l: Listing) =>
  l.membershipActive &&
  l.identityVerified &&
  l.portraitConsent &&
  l.publicationStatus === 'PUBLISHED_INDEXABLE';

export class StorefrontService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
    private read: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
  ) {}
  private async shop(tx: Records, actor: Actor) {
    ensure(actor.role === 'MERCHANT' && actor.storeId, 'FORBIDDEN', 'Shop account required.', 403);
    const store = await tx.get<Store>('stores', actor.storeId);
    ensure(store?.approved, 'NOT_FOUND', 'Shop not found.', 404);
    return store;
  }
  private async draft(tx: Records, store: Store): Promise<StorefrontDraft> {
    return (
      (await tx.get<StorefrontDraft>('storefrontDrafts', store.id)) ?? {
        id: store.id,
        storeId: store.id,
        version: 0,
        status: 'DRAFT',
        content: blank(store),
        updatedAt: this.now(),
      }
    );
  }
  private async audit(tx: Records, actor: Actor, storeId: string, action: string) {
    await tx.put('audit', {
      id: `audit_${randomUUID()}`,
      actorId: actor.id,
      action,
      detail: storeId,
      at: this.now(),
    });
  }
  private async assets(tx: Records, storeId: string) {
    return (await tx.find<Asset>('storefrontFiles', { storeId })).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }
  async workspace(actor: Actor): Promise<StorefrontWorkspace> {
    return this.read(async (tx) => {
      const store = await this.shop(tx, actor);
      const offerings = await tx.find<Offering>('offerings', { storeId: store.id });
      const team = await tx.find<Listing>('listings', { storeId: store.id });
      const stats = await tx.storeStats([store.id], this.now() - 90 * 86400000);
      return {
        draft: await this.draft(tx, store),
        published: store.storefront,
        assets: (await this.assets(tx, store.id)).map(assetView),
        store: { id: store.id, slug: store.slug, name: store.name, plan: store.plan },
        offerings: offerings
          .filter((o) => o.approved && o.active !== false && o.regulatoryCategory === 'RELAXATION')
          .map((o) => ({
            id: o.id,
            name: o.name,
            durationMinutes: o.durationMinutes,
            fulfillmentMode: fulfillmentMode(o),
          })),
        team: team.filter(eligible).map((l) => ({ id: l.id, name: l.name, photo: l.photo })),
        stats: stats[store.id],
      };
    });
  }
  private async validate(
    tx: Records,
    store: Store,
    content: StorefrontContent,
    submitting = false,
  ) {
    for (const id of references(content))
      ensure(
        (await tx.get<Asset>('storefrontFiles', id))?.storeId === store.id,
        'INVALID_STOREFRONT_ASSET',
        'Select an image uploaded by this shop.',
      );
    for (const id of content.featuredOfferingIds) {
      const o = await tx.get<Offering>('offerings', id);
      ensure(
        o?.storeId === store.id,
        'INVALID_STOREFRONT_REFERENCE',
        'Select this shop’s projects.',
      );
      if (submitting)
        ensure(
          o.approved && o.active !== false && o.regulatoryCategory === 'RELAXATION',
          'INVALID_STOREFRONT_REFERENCE',
          'Refresh the available projects.',
        );
    }
    for (const id of content.teamListingIds) {
      const l = await tx.get<Listing>('listings', id);
      ensure(
        l?.storeId === store.id && l.membershipActive,
        'INVALID_STOREFRONT_REFERENCE',
        'Select current members of this shop.',
      );
      if (submitting)
        ensure(eligible(l), 'INVALID_STOREFRONT_REFERENCE', 'Refresh the published team.');
    }
    if (submitting)
      ensure(
        Object.values(content.about).every((s) => s.length >= 8),
        'STOREFRONT_CONTENT_REQUIRED',
        'Add an introduction in all three languages.',
      );
  }
  async save(actor: Actor, input: unknown) {
    const d = z
      .object({ version: z.number().int().nonnegative(), content: storefrontContentInput })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        old = await this.draft(tx, store);
      ensure(old.version === d.version, 'VERSION_CONFLICT', 'Refresh the shop page first.', 409);
      ensure(
        old.status !== 'PENDING',
        'STOREFRONT_REVIEW_PENDING',
        'Withdraw the submitted revision before editing it.',
        409,
      );
      await this.validate(tx, store, d.content);
      const next: StorefrontDraft = {
        id: store.id,
        storeId: store.id,
        version: old.version + 1,
        status: 'DRAFT',
        content: d.content,
        updatedAt: this.now(),
      };
      await tx.put('storefrontDrafts', next);
      await this.audit(tx, actor, store.id, 'STOREFRONT_SAVED');
      return next;
    });
  }
  async submit(actor: Actor, input: unknown) {
    const d = versionInput.parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        draft = await this.draft(tx, store);
      ensure(draft.version === d.version, 'VERSION_CONFLICT', 'Refresh the shop page first.', 409);
      ensure(
        draft.status === 'DRAFT' || draft.status === 'CHANGES_REQUESTED',
        'INVALID_STATE',
        'This revision cannot be submitted.',
        409,
      );
      await this.validate(tx, store, draft.content, true);
      Object.assign(draft, {
        version: draft.version + 1,
        status: 'PENDING',
        submittedAt: this.now(),
        updatedAt: this.now(),
      });
      delete draft.note;
      await tx.put('storefrontDrafts', draft);
      await this.audit(tx, actor, store.id, 'STOREFRONT_SUBMITTED');
      return draft;
    });
  }
  async withdraw(actor: Actor, input: unknown) {
    const d = versionInput.parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        draft = await this.draft(tx, store);
      ensure(draft.version === d.version, 'VERSION_CONFLICT', 'Refresh the shop page first.', 409);
      ensure(draft.status === 'PENDING', 'INVALID_STATE', 'There is no pending revision.', 409);
      Object.assign(draft, { version: draft.version + 1, status: 'DRAFT', updatedAt: this.now() });
      await tx.put('storefrontDrafts', draft);
      await this.audit(tx, actor, store.id, 'STOREFRONT_WITHDRAWN');
      return draft;
    });
  }
  async upload(actor: Actor, input: unknown) {
    const d = z
      .object({ mime: z.enum(['image/jpeg', 'image/png']), data: z.string().min(1).max(470000) })
      .strict()
      .parse(input);
    const raw = Buffer.from(d.data, 'base64');
    ensure(
      raw.length <= 350000 && raw.toString('base64') === d.data,
      'INVALID_PHOTO',
      'Select a valid photo under 350 KB.',
    );
    ensure(
      d.mime === 'image/png'
        ? raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : raw.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
      'INVALID_PHOTO',
      'The photo format does not match.',
    );
    let bytes: Buffer;
    try {
      bytes = await sharp(raw, { limitInputPixels: 20_000_000, failOn: 'warning' })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      ensure(false, 'INVALID_PHOTO', 'Choose a valid JPEG or PNG.');
    }
    ensure(bytes!.length <= 350000, 'INVALID_PHOTO', 'Choose a smaller photo.');
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor);
      ensure(
        (await tx.count('storefrontFiles', { storeId: store.id })) < 50,
        'STOREFRONT_ASSET_LIMIT',
        'The shop image library is full.',
      );
      const id = `brand_${randomUUID()}`;
      const file: Asset = {
        id,
        storeId: store.id,
        storageKey: await saveEvidence(id, bytes!),
        size: bytes!.length,
        createdAt: this.now(),
      };
      await tx.put('storefrontFiles', file);
      await this.audit(tx, actor, store.id, 'STOREFRONT_IMAGE_UPLOADED');
      return assetView(file);
    });
  }
  async remove(actor: Actor, id: string) {
    await this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        file = await tx.get<Asset>('storefrontFiles', id);
      ensure(file?.storeId === store.id, 'NOT_FOUND', 'Image unavailable.', 404);
      const draft = await this.draft(tx, store),
        live = store.storefront;
      ensure(
        !references(draft.content).includes(id) &&
          ![live?.logo?.id, live?.cover?.id, ...(live?.photos ?? []).map((p) => p.id)].includes(id),
        'STOREFRONT_ASSET_IN_USE',
        'Remove this image from the draft and published page first.',
        409,
      );
      await tx.remove('storefrontFiles', id);
      await this.audit(tx, actor, store.id, 'STOREFRONT_IMAGE_REMOVED');
    });
    // Only an unreferenced private file can reach this point. The storage helper validates its id.
    await removeEvidence(id);
    return { removed: true };
  }
  async file(id: string, actor?: Actor) {
    return this.read(async (tx) => {
      const file = await tx.get<Asset>('storefrontFiles', id);
      ensure(file, 'NOT_FOUND', 'Image unavailable.', 404);
      const store = await tx.get<Store>('stores', file.storeId),
        live = store?.storefront;
      const published = !!(
        store?.active &&
        store.approved &&
        live &&
        [live.logo?.id, live.cover?.id, ...live.photos.map((p) => p.id)].includes(id)
      );
      let allowed = published || (actor?.role === 'MERCHANT' && actor.storeId === file.storeId);
      if (!allowed && actor?.role === 'ADMIN') {
        requireAdmin(await currentAdmin(tx, actor), 'supply.read');
        allowed = true;
      }
      ensure(allowed, 'NOT_FOUND', 'Image unavailable.', 404);
      return { bytes: await loadEvidence(file), published };
    });
  }
  async queue(actor: Actor): Promise<StorefrontReviewItem[]> {
    return this.read(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.read');
      const result: StorefrontReviewItem[] = [];
      for (const d of (
        await tx.find<StorefrontDraft>('storefrontDrafts', { status: 'PENDING' })
      ).sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))) {
        const s = await tx.get<Store>('stores', d.storeId);
        if (!s) continue;
        result.push({
          ...d,
          name: s.name,
          offerings: (await tx.find<Offering>('offerings', { storeId: s.id }))
            .filter((o) => d.content.featuredOfferingIds.includes(o.id))
            .map((o) => ({
              id: o.id,
              name: o.name,
              durationMinutes: o.durationMinutes,
              fulfillmentMode: fulfillmentMode(o),
            })),
          team: (await tx.find<Listing>('listings', { storeId: s.id }))
            .filter((l) => d.content.teamListingIds.includes(l.id))
            .map((l) => ({ id: l.id, name: l.name, photo: l.photo })),
          published: s.storefront,
          assets: (await this.assets(tx, s.id))
            .filter((a) => references(d.content).includes(a.id))
            .map(assetView),
        });
      }
      return result;
    });
  }
  async review(actor: Actor, storeId: string, input: unknown) {
    const d = z
      .object({
        version: z.number().int().positive(),
        approved: z.boolean(),
        note: z.string().trim().min(4).max(1000),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.write');
      const store = await tx.get<Store>('stores', storeId),
        draft = await tx.get<StorefrontDraft>('storefrontDrafts', storeId);
      ensure(store?.approved && draft, 'NOT_FOUND', 'Shop page not found.', 404);
      ensure(
        draft.version === d.version && draft.status === 'PENDING',
        'VERSION_CONFLICT',
        'Refresh the review queue.',
        409,
      );
      if (d.approved) {
        await this.validate(tx, store, draft.content, true);
        const assets = await this.assets(tx, store.id),
          view = (id: string | null) => assets.find((a) => a.id === id);
        const c = draft.content,
          logo = view(c.logoId),
          cover = view(c.coverId);
        const live: PublishedStorefront = {
          version: draft.version + 1,
          publishedAt: this.now(),
          tagline: { ...c.tagline },
          about: { ...c.about },
          ...(logo ? { logo: assetView(logo) } : {}),
          ...(cover ? { cover: assetView(cover) } : {}),
          photos: c.photoIds.map((id) => assetView(view(id)!)),
          featuredOfferingIds: [...c.featuredOfferingIds],
          teamListingIds: [...c.teamListingIds],
        };
        // Brand content does not change a transaction, price policy, venue or hold version.
        await tx.put('stores', { ...store, storefront: live });
      }
      Object.assign(draft, {
        version: draft.version + 1,
        status: d.approved ? 'PUBLISHED' : 'CHANGES_REQUESTED',
        note: d.note,
        reviewedAt: this.now(),
        updatedAt: this.now(),
      });
      await tx.put('storefrontDrafts', draft);
      await this.audit(
        tx,
        actor,
        store.id,
        d.approved ? 'STOREFRONT_PUBLISHED' : 'STOREFRONT_RETURNED',
      );
      return draft;
    });
  }
}
