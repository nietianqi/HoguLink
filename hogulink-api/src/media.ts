import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  hasMainPhoto,
  listingMediaPosterUrl,
  listingMediaUrl,
  mediaDecisionInput,
  mediaOrderInput,
  mediaPhotoInput,
  mediaRemoveInput,
  mediaReportInput,
  mediaVersionInput,
  mediaVideoChunkInput,
  mediaVideoFinishInput,
  mediaVideoStartInput,
  LISTING_PHOTO_LIMIT,
  LISTING_VIDEO_LIMIT,
  PENDING_MEDIA,
  PLACEHOLDER_PORTRAIT,
  VIDEO_CHUNK_BYTES,
  VIDEO_MAX_SECONDS,
  type Actor,
  type Listing,
  type ListingMedia,
  type ListingMediaKind,
  type ListingMediaReportReason,
  type ListingMediaReviewItem,
  type ListingMediaStatus,
  type PublicListingMedia,
  type Store,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { currentAdmin, requireAdmin } from './admin-access.js';
import { ensure } from './errors.js';
import { loadEvidence, saveEvidence } from './evidence-storage.js';
import { inspectMp4, stripMp4Metadata } from './mp4.js';

type MediaRecord = Omit<ListingMedia, 'url' | 'posterUrl' | 'cover' | 'reports'> & {
  staffId: string;
  fileId: string;
  posterFileId?: string;
  uploadedById: string;
  consentBy?: string;
  shopConfirmedBy?: string;
  reviewedBy?: string;
};
type MediaFile = {
  id: string;
  mediaId: string;
  storageKey: string;
  mime: string;
  size: number;
  createdAt: number;
};
type Upload = {
  id: string;
  ownerId: string;
  role: 'STAFF' | 'MERCHANT';
  listingId: string;
  storeId: string;
  staffId: string;
  size: number;
  chunks: number;
  consent: boolean;
  expiresAt: number;
  createdAt: number;
};
type Report = {
  id: string;
  mediaId: string;
  customerId: string;
  reason: ListingMediaReportReason;
  detail?: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: number;
};
const UPLOAD_MINUTES = 30;
const LIVE: ListingMediaStatus[] = [...PENDING_MEDIA, 'APPROVED'];
const VIDEO_CODECS = new Set(['avc1', 'avc3']);
/** Decrypted video files kept in memory so range requests do not decrypt the whole file each time. */
const videoCache = new Map<string, Buffer>();
const VIDEO_CACHE_BYTES = 120 * 1024 * 1024;
function cacheVideo(id: string, bytes: Buffer) {
  videoCache.delete(id);
  videoCache.set(id, bytes);
  let total = [...videoCache.values()].reduce((n, b) => n + b.length, 0);
  for (const key of videoCache.keys()) {
    if (total <= VIDEO_CACHE_BYTES) break;
    total -= videoCache.get(key)!.length;
    videoCache.delete(key);
  }
}
/** A listing whose profile customers can currently see. */
function liveListing(listing: Listing | undefined, store: Store | undefined) {
  return (
    !!listing &&
    !!store &&
    listing.membershipActive &&
    listing.portraitConsent &&
    listing.identityVerified &&
    listing.publicationStatus === 'PUBLISHED_INDEXABLE' &&
    store.active &&
    store.approved
  );
}
export function publicMedia(m: MediaRecord): PublicListingMedia {
  return {
    id: m.id,
    kind: m.kind,
    url: listingMediaUrl(m.id),
    ...(m.posterFileId ? { posterUrl: listingMediaPosterUrl(m.id) } : {}),
    ...(m.durationSeconds ? { durationSeconds: m.durationSeconds } : {}),
    ...(m.width ? { width: m.width, height: m.height } : {}),
  };
}
/** Approved gallery items per listing, in display order; the chosen cover is shown as the main photo instead. */
export async function approvedMedia(tx: Records, listings: Listing[]) {
  const wanted = new Map(listings.map((l) => [l.id, l]));
  const result = new Map<string, PublicListingMedia[]>();
  for (const m of (await tx.find<MediaRecord>('listingMedia', { status: 'APPROVED' })).sort(
    (a, b) => a.sort - b.sort || a.createdAt - b.createdAt,
  )) {
    const listing = wanted.get(m.listingId);
    if (!listing || listing.coverMediaId === m.id) continue;
    result.set(m.listingId, [...(result.get(m.listingId) ?? []), publicMedia(m)]);
  }
  return result;
}
async function image(data: string, mime: string, maxSide: number) {
  const bytes = Buffer.from(data, 'base64');
  ensure(
    bytes.length <= 350_000 && bytes.toString('base64') === data,
    'INVALID_PHOTO',
    'Select a photo no larger than 350 KB.',
  );
  ensure(
    mime === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
    'INVALID_PHOTO',
    'The photo format does not match the file.',
  );
  try {
    // Re-encoding drops embedded metadata such as the camera location.
    const { data: out, info } = await sharp(bytes, {
      limitInputPixels: 20_000_000,
      failOn: 'warning',
    })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    ensure(out.length <= 350_000, 'INVALID_PHOTO', 'Select a smaller photo.');
    return { bytes: out, width: info.width, height: info.height };
  } catch (error) {
    if ((error as { code?: string }).code === 'INVALID_PHOTO') throw error;
    ensure(false, 'INVALID_PHOTO', 'Select a valid JPEG or PNG photo.');
  }
}
export class ListingMediaService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
    private read: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
  ) {}
  private async audit(tx: Records, actor: Actor, action: string, detail: string) {
    await tx.put('audit', {
      id: `audit_${randomUUID()}`,
      actorId: actor.id,
      action,
      detail,
      at: this.now(),
    });
  }
  /** The therapist's own listing, or a listing of the signed-in shop. */
  private async target(tx: Records, actor: Actor, listingId?: string) {
    let listing: Listing | undefined;
    if (actor.role === 'STAFF') {
      ensure(actor.staffId && actor.storeId, 'FORBIDDEN', 'Staff account required.', 403);
      listing = (await tx.find<Listing>('listings', { staffId: actor.staffId })).find(
        (x) => x.storeId === actor.storeId && x.membershipActive,
      );
    } else if (actor.role === 'MERCHANT') {
      ensure(actor.storeId, 'FORBIDDEN', 'Shop account required.', 403);
      listing = listingId ? await tx.get<Listing>('listings', listingId) : undefined;
      ensure(
        !listing || listing.storeId === actor.storeId,
        'NOT_FOUND',
        'Therapist not found.',
        404,
      );
    } else ensure(false, 'FORBIDDEN', 'A therapist or shop account is required.', 403);
    ensure(listing?.membershipActive, 'NOT_FOUND', 'Active therapist profile not found.', 404);
    return listing;
  }
  private async item(tx: Records, actor: Actor, id: string, version?: number) {
    const m = await tx.get<MediaRecord>('listingMedia', id);
    ensure(m, 'NOT_FOUND', 'Photo or video not found.', 404);
    if (actor.role === 'ADMIN') {
      requireAdmin(await currentAdmin(tx, actor), 'supply.write');
    } else {
      const listing = await this.target(tx, actor, m.listingId);
      ensure(listing.id === m.listingId, 'NOT_FOUND', 'Photo or video not found.', 404);
    }
    ensure(
      version === undefined || m.version === version,
      'VERSION_CONFLICT',
      'Refresh before changing this item.',
      409,
    );
    return m;
  }
  private async save(tx: Records, m: MediaRecord) {
    m.version++;
    m.updatedAt = this.now();
    await tx.put('listingMedia', m);
  }
  private async view(tx: Records, m: MediaRecord): Promise<ListingMedia> {
    const listing = await tx.get<Listing>('listings', m.listingId);
    const reports = (await tx.list<Report>('mediaReports')).filter(
      (r) => r.mediaId === m.id && r.status === 'OPEN',
    ).length;
    const {
      staffId: _s,
      fileId: _f,
      posterFileId: _p,
      uploadedById: _u,
      consentBy: _c,
      shopConfirmedBy: _sc,
      reviewedBy: _r,
      ...rest
    } = m;
    return {
      ...rest,
      ...publicMedia(m),
      ...(listing?.coverMediaId === m.id ? { cover: true } : {}),
      ...(reports ? { reports } : {}),
    };
  }
  /** Counts that limit new uploads: everything public or still in the review pipeline. */
  private async limit(tx: Records, listing: Listing, kind: ListingMediaKind) {
    const items = (await tx.find<MediaRecord>('listingMedia', { listingId: listing.id })).filter(
      (m) => m.kind === kind && LIVE.includes(m.status),
    );
    if (kind === 'PHOTO')
      ensure(
        items.length < LISTING_PHOTO_LIMIT,
        'MEDIA_LIMIT',
        `Up to ${LISTING_PHOTO_LIMIT} photos can be shown or waiting for review.`,
        409,
      );
    else
      ensure(
        items.filter((m) => m.status === 'APPROVED').length <= LISTING_VIDEO_LIMIT &&
          !items.some((m) => PENDING_MEDIA.includes(m.status)),
        'MEDIA_LIMIT',
        'One introduction video is shown. Wait for the replacement under review to finish.',
        409,
      );
  }
  /** Who uploads decides the first step: a therapist authorizes at once, a shop confirms at once. */
  private initial(actor: Actor, consent?: boolean) {
    if (actor.role === 'STAFF') {
      ensure(
        consent === true,
        'CONSENT_REQUIRED',
        'Confirm that you are the person shown and allow the shop and platform to publish it.',
      );
      return {
        status: 'PENDING_SHOP' as const,
        consentAt: this.now(),
        consentBy: actor.id,
      };
    }
    return {
      status: 'PENDING_CONSENT' as const,
      shopConfirmedAt: this.now(),
      shopConfirmedBy: actor.id,
    };
  }
  private async storeFile(tx: Records, mediaId: string, bytes: Buffer, mime: string) {
    const id = `evidence_${randomUUID()}`;
    const file: MediaFile = {
      id,
      mediaId,
      storageKey: await saveEvidence(id, bytes),
      mime,
      size: bytes.length,
      createdAt: this.now(),
    };
    await tx.put('mediaFiles', file);
    return id;
  }
  async list(actor: Actor, listingId?: string) {
    return this.read(async (tx) => {
      let listings: Listing[];
      if (actor.role === 'MERCHANT' && !listingId) {
        ensure(actor.storeId, 'FORBIDDEN', 'Shop account required.', 403);
        listings = (await tx.find<Listing>('listings', { storeId: actor.storeId })).filter(
          (l) => l.membershipActive,
        );
      } else listings = [await this.target(tx, actor, listingId)];
      const items: ListingMedia[] = [];
      for (const listing of listings)
        for (const m of (await tx.find<MediaRecord>('listingMedia', { listingId: listing.id }))
          // Closed items stay visible for 30 days so the reason for a rejection can be read.
          .filter((m) => LIVE.includes(m.status) || m.updatedAt > this.now() - 30 * 86400000)
          .sort((a, b) => a.sort - b.sort || b.createdAt - a.createdAt))
          items.push(await this.view(tx, m));
      return {
        items,
        listings: listings.map((l) => ({
          id: l.id,
          name: l.name,
          photo: l.photo,
          hasMainPhoto: hasMainPhoto(l),
        })),
      };
    });
  }
  async uploadPhoto(actor: Actor, input: unknown) {
    const d = mediaPhotoInput.parse(input);
    const processed = (await image(d.data, d.mime, 1600))!;
    return this.run(async (tx) => {
      const listing = await this.target(tx, actor, d.listingId);
      await this.limit(tx, listing, 'PHOTO');
      const id = `media_${randomUUID()}`;
      const m: MediaRecord = {
        id,
        listingId: listing.id,
        storeId: listing.storeId,
        staffId: listing.staffId,
        kind: 'PHOTO',
        ...this.initial(actor, d.consent),
        fileId: await this.storeFile(tx, id, processed.bytes, 'image/jpeg'),
        width: processed.width,
        height: processed.height,
        sort: 0,
        uploadedBy: actor.role as 'STAFF' | 'MERCHANT',
        uploadedById: actor.id,
        version: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      await tx.put('listingMedia', m);
      await this.audit(tx, actor, 'LISTING_MEDIA_UPLOADED', id);
      return this.view(tx, m);
    });
  }
  async startVideo(actor: Actor, input: unknown) {
    const d = mediaVideoStartInput.parse(input);
    return this.run(async (tx) => {
      const listing = await this.target(tx, actor, d.listingId);
      await this.limit(tx, listing, 'VIDEO');
      this.initial(actor, d.consent);
      // Only the newest upload per person continues; an abandoned one is cleared now.
      for (const old of await tx.find<Upload>('mediaUploads', { ownerId: actor.id }))
        await this.discard(tx, old);
      const upload: Upload = {
        id: `upload_${randomUUID()}`,
        ownerId: actor.id,
        role: actor.role as 'STAFF' | 'MERCHANT',
        listingId: listing.id,
        storeId: listing.storeId,
        staffId: listing.staffId,
        size: d.size,
        chunks: Math.ceil(d.size / VIDEO_CHUNK_BYTES),
        consent: d.consent === true,
        expiresAt: this.now() + UPLOAD_MINUTES * 60000,
        createdAt: this.now(),
      };
      await tx.put('mediaUploads', upload);
      return { uploadId: upload.id, chunkBytes: VIDEO_CHUNK_BYTES, chunks: upload.chunks };
    });
  }
  private async upload(tx: Records, actor: Actor, uploadId: string) {
    const upload = await tx.get<Upload>('mediaUploads', uploadId);
    ensure(
      upload && upload.ownerId === actor.id && upload.expiresAt > this.now(),
      'UPLOAD_EXPIRED',
      'The upload expired. Choose the video again.',
      409,
    );
    return upload;
  }
  private async discard(tx: Records, upload: Upload) {
    for (let i = 0; i < upload.chunks; i++)
      await tx.remove('mediaUploadChunks', `${upload.id}:${i}`);
    await tx.remove('mediaUploads', upload.id);
  }
  async videoChunk(actor: Actor, uploadId: string, input: unknown) {
    const d = mediaVideoChunkInput.parse(input);
    const bytes = Buffer.from(d.data, 'base64');
    return this.run(async (tx) => {
      const upload = await this.upload(tx, actor, uploadId);
      ensure(d.index < upload.chunks, 'INVALID_UPLOAD', 'Unexpected part of the video.');
      const expected =
        d.index < upload.chunks - 1
          ? VIDEO_CHUNK_BYTES
          : upload.size - VIDEO_CHUNK_BYTES * (upload.chunks - 1);
      ensure(
        bytes.length === expected && bytes.toString('base64') === d.data,
        'INVALID_UPLOAD',
        'A part of the video was damaged. Try again.',
      );
      await tx.put('mediaUploadChunks', {
        id: `${upload.id}:${d.index}`,
        uploadId: upload.id,
        data: d.data,
        createdAt: this.now(),
      });
      return { received: d.index };
    });
  }
  async finishVideo(actor: Actor, uploadId: string, input: unknown) {
    const d = mediaVideoFinishInput.parse(input);
    const { upload, parts } = await this.read(async (tx) => {
      const upload = await this.upload(tx, actor, uploadId);
      const parts: string[] = [];
      for (let i = 0; i < upload.chunks; i++) {
        const part = await tx.get<{ data: string }>('mediaUploadChunks', `${upload.id}:${i}`);
        ensure(part, 'INVALID_UPLOAD', 'The video upload is incomplete. Try again.', 409);
        parts.push(part.data);
      }
      return { upload, parts };
    });
    const raw = Buffer.concat(parts.map((p) => Buffer.from(p, 'base64')));
    ensure(raw.length === upload.size, 'INVALID_UPLOAD', 'The video upload is incomplete.', 409);
    let info: ReturnType<typeof inspectMp4>;
    try {
      info = inspectMp4(raw);
    } catch {
      ensure(false, 'INVALID_VIDEO', 'Select an MP4 video.');
    }
    ensure(
      info!.videoCodecs.some((c) => VIDEO_CODECS.has(c)),
      'VIDEO_CODEC',
      'Use an H.264 MP4 video. On iPhone choose “Most Compatible” for camera formats, or export as MP4.',
    );
    // Fragmented recordings may not state a total duration; the browser's reading is used then.
    const duration = info!.durationSeconds ?? d.durationSeconds;
    ensure(
      duration <= VIDEO_MAX_SECONDS + 0.5,
      'VIDEO_TOO_LONG',
      `Keep the introduction video within ${VIDEO_MAX_SECONDS} seconds.`,
    );
    const video = stripMp4Metadata(raw);
    const poster = (await image(d.poster.data, d.poster.mime, 1280))!;
    return this.run(async (tx) => {
      await this.upload(tx, actor, uploadId);
      const listing = await this.target(tx, actor, upload.listingId);
      await this.limit(tx, listing, 'VIDEO');
      const id = `media_${randomUUID()}`;
      const m: MediaRecord = {
        id,
        listingId: listing.id,
        storeId: listing.storeId,
        staffId: listing.staffId,
        kind: 'VIDEO',
        ...this.initial(actor, upload.consent),
        fileId: await this.storeFile(tx, id, video, 'video/mp4'),
        posterFileId: await this.storeFile(tx, id, poster.bytes, 'image/jpeg'),
        durationSeconds: Math.round(duration * 10) / 10,
        width: poster.width,
        height: poster.height,
        sort: 0,
        uploadedBy: upload.role,
        uploadedById: actor.id,
        version: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      await tx.put('listingMedia', m);
      await this.discard(tx, upload);
      await this.audit(tx, actor, 'LISTING_MEDIA_UPLOADED', id);
      return this.view(tx, m);
    });
  }
  /** The person shown authorizes an item their shop uploaded. */
  async authorize(actor: Actor, id: string, input: unknown) {
    const d = mediaVersionInput.parse(input);
    return this.run(async (tx) => {
      ensure(actor.role === 'STAFF', 'FORBIDDEN', 'Only the person shown can authorize.', 403);
      const m = await this.item(tx, actor, id, d.version);
      ensure(m.status === 'PENDING_CONSENT', 'INVALID_STATE', 'Nothing to authorize.', 409);
      Object.assign(m, { status: 'PENDING_REVIEW', consentAt: this.now(), consentBy: actor.id });
      await this.save(tx, m);
      await this.audit(tx, actor, 'LISTING_MEDIA_AUTHORIZED', id);
      return this.view(tx, m);
    });
  }
  /** The shop confirms or returns an item its therapist uploaded. */
  async confirm(actor: Actor, id: string, input: unknown) {
    const d = mediaDecisionInput.parse(input);
    return this.run(async (tx) => {
      ensure(actor.role === 'MERCHANT', 'FORBIDDEN', 'Shop account required.', 403);
      const m = await this.item(tx, actor, id, d.version);
      ensure(m.status === 'PENDING_SHOP', 'INVALID_STATE', 'Nothing to confirm.', 409);
      ensure(
        d.approved || (d.note?.length ?? 0) >= 4,
        'NOTE_REQUIRED',
        'Tell the therapist what to change.',
      );
      Object.assign(
        m,
        d.approved
          ? { status: 'PENDING_REVIEW', shopConfirmedAt: this.now(), shopConfirmedBy: actor.id }
          : { status: 'REJECTED', note: d.note },
      );
      await this.save(tx, m);
      await this.audit(
        tx,
        actor,
        d.approved ? 'LISTING_MEDIA_SHOP_CONFIRMED' : 'LISTING_MEDIA_SHOP_RETURNED',
        id,
      );
      return this.view(tx, m);
    });
  }
  /** Platform decision: publish or reject a pending item; keep or take down a reported one. */
  async review(actor: Actor, id: string, input: unknown) {
    const d = mediaDecisionInput.parse(input);
    return this.run(async (tx) => {
      const m = await this.item(tx, actor, id, d.version);
      const reports = (await tx.list<Report>('mediaReports')).filter(
        (r) => r.mediaId === m.id && r.status === 'OPEN',
      );
      ensure(
        m.status === 'PENDING_REVIEW' || (m.status === 'APPROVED' && reports.length > 0),
        'INVALID_STATE',
        'This item is not waiting for a decision.',
        409,
      );
      ensure(
        d.approved || (d.note?.length ?? 0) >= 4,
        'NOTE_REQUIRED',
        'Give the reason so the therapist and shop can correct it.',
      );
      const listing = (await tx.get<Listing>('listings', m.listingId))!;
      if (m.status === 'PENDING_REVIEW' && d.approved) {
        const approved = (
          await tx.find<MediaRecord>('listingMedia', { listingId: m.listingId })
        ).filter((x) => x.status === 'APPROVED');
        m.sort = Math.max(0, ...approved.map((x) => x.sort)) + 1;
        // A newly approved introduction video replaces the one on the profile.
        if (m.kind === 'VIDEO')
          for (const old of approved.filter((x) => x.kind === 'VIDEO')) {
            Object.assign(old, { status: 'REMOVED', note: 'REPLACED' });
            await this.save(tx, old);
          }
        Object.assign(m, { status: 'APPROVED', reviewedAt: this.now(), reviewedBy: actor.id });
        delete m.note;
        await this.save(tx, m);
        if (m.kind === 'PHOTO' && !hasMainPhoto(listing)) await this.applyCover(tx, listing, m);
      } else if (d.approved) {
        await this.save(tx, m);
      } else {
        Object.assign(m, {
          status: m.status === 'APPROVED' ? 'REMOVED' : 'REJECTED',
          note: d.note,
          reviewedAt: this.now(),
          reviewedBy: actor.id,
        });
        await this.save(tx, m);
        await this.dropCover(tx, listing, m);
      }
      for (const r of reports) await tx.put('mediaReports', { ...r, status: 'CLOSED' });
      await this.audit(
        tx,
        actor,
        d.approved ? 'LISTING_MEDIA_APPROVED' : 'LISTING_MEDIA_REJECTED',
        id,
      );
      return this.view(tx, m);
    });
  }
  /** The person shown withdraws authorization; the item leaves the profile at once. */
  async withdraw(actor: Actor, id: string, input: unknown) {
    const d = mediaVersionInput.parse(input);
    return this.run(async (tx) => {
      ensure(actor.role === 'STAFF', 'FORBIDDEN', 'Only the person shown can withdraw.', 403);
      const m = await this.item(tx, actor, id, d.version);
      ensure(LIVE.includes(m.status), 'INVALID_STATE', 'This item is no longer shown.', 409);
      m.status = 'WITHDRAWN';
      await this.save(tx, m);
      await this.dropCover(tx, (await tx.get<Listing>('listings', m.listingId))!, m);
      await this.audit(tx, actor, 'LISTING_MEDIA_WITHDRAWN', id);
      return this.view(tx, m);
    });
  }
  /** The shop or platform takes an item down with a reason. */
  async remove(actor: Actor, id: string, input: unknown) {
    const d = mediaRemoveInput.parse(input);
    return this.run(async (tx) => {
      ensure(
        ['MERCHANT', 'ADMIN'].includes(actor.role),
        'FORBIDDEN',
        'Shop or platform account required.',
        403,
      );
      const m = await this.item(tx, actor, id, d.version);
      ensure(LIVE.includes(m.status), 'INVALID_STATE', 'This item is no longer shown.', 409);
      Object.assign(m, { status: 'REMOVED', note: d.note });
      await this.save(tx, m);
      await this.dropCover(tx, (await tx.get<Listing>('listings', m.listingId))!, m);
      for (const r of (await tx.list<Report>('mediaReports')).filter(
        (r) => r.mediaId === m.id && r.status === 'OPEN',
      ))
        await tx.put('mediaReports', { ...r, status: 'CLOSED' });
      await this.audit(tx, actor, 'LISTING_MEDIA_REMOVED', id);
      return this.view(tx, m);
    });
  }
  private async applyCover(tx: Records, listing: Listing, m: MediaRecord) {
    if (!listing.coverMediaId) listing.basePhoto = listing.photo;
    listing.photo = listingMediaUrl(m.id);
    listing.coverMediaId = m.id;
    await tx.put('listings', listing);
  }
  /** Restores the onboarding portrait when the chosen cover leaves the profile. */
  private async dropCover(tx: Records, listing: Listing, m: MediaRecord) {
    if (listing.coverMediaId !== m.id) return;
    listing.photo = listing.basePhoto ?? PLACEHOLDER_PORTRAIT;
    delete listing.coverMediaId;
    delete listing.basePhoto;
    await tx.put('listings', listing);
  }
  /** Uses an approved gallery photo as the main photo without another review. */
  async setCover(actor: Actor, id: string, input: unknown) {
    const d = mediaVersionInput.parse(input);
    return this.run(async (tx) => {
      ensure(
        ['STAFF', 'MERCHANT'].includes(actor.role),
        'FORBIDDEN',
        'Therapist or shop account required.',
        403,
      );
      const m = await this.item(tx, actor, id, d.version);
      ensure(
        m.kind === 'PHOTO' && m.status === 'APPROVED',
        'INVALID_STATE',
        'Choose an approved photo.',
        409,
      );
      await this.applyCover(tx, (await tx.get<Listing>('listings', m.listingId))!, m);
      await this.audit(tx, actor, 'LISTING_MEDIA_COVER', id);
      return this.view(tx, m);
    });
  }
  async reorder(actor: Actor, input: unknown, listingId?: string) {
    const d = mediaOrderInput.parse(input);
    return this.run(async (tx) => {
      const listing = await this.target(tx, actor, listingId);
      const approved = (
        await tx.find<MediaRecord>('listingMedia', { listingId: listing.id })
      ).filter((m) => m.status === 'APPROVED');
      ensure(
        d.ids.length === approved.length &&
          new Set(d.ids).size === d.ids.length &&
          approved.every((m) => d.ids.includes(m.id)),
        'INVALID_ORDER',
        'Refresh and arrange every shown item.',
        409,
      );
      for (const m of approved) {
        m.sort = d.ids.indexOf(m.id) + 1;
        await this.save(tx, m);
      }
      await this.audit(tx, actor, 'LISTING_MEDIA_REORDERED', listing.id);
      return { ids: d.ids };
    });
  }
  /** A signed-in customer reports a public photo or video once. */
  async report(actor: Actor, id: string, input: unknown) {
    const d = mediaReportInput.parse(input);
    return this.run(async (tx) => {
      ensure(actor.role === 'CUSTOMER', 'FORBIDDEN', 'Sign in to report.', 403);
      const m = await tx.get<MediaRecord>('listingMedia', id);
      ensure(m?.status === 'APPROVED', 'NOT_FOUND', 'Photo or video not found.', 404);
      const reportId = `${m.id}:${actor.id}`;
      const existing = await tx.get<Report>('mediaReports', reportId);
      if (existing?.status === 'OPEN') return { reported: true };
      const r: Report = {
        id: reportId,
        mediaId: m.id,
        customerId: actor.id,
        reason: d.reason,
        ...(d.detail ? { detail: d.detail } : {}),
        status: 'OPEN',
        createdAt: this.now(),
      };
      await tx.put('mediaReports', r);
      await this.audit(tx, actor, 'LISTING_MEDIA_REPORTED', m.id);
      return { reported: true };
    });
  }
  async reviewQueue(actor: Actor): Promise<ListingMediaReviewItem[]> {
    return this.read(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.read');
      const reports = (await tx.list<Report>('mediaReports')).filter((r) => r.status === 'OPEN');
      const items = [
        ...(await tx.find<MediaRecord>('listingMedia', { status: 'PENDING_REVIEW' })),
        ...(await tx.find<MediaRecord>('listingMedia', { status: 'APPROVED' })).filter((m) =>
          reports.some((r) => r.mediaId === m.id),
        ),
      ].sort((a, b) => a.updatedAt - b.updatedAt);
      const result: ListingMediaReviewItem[] = [];
      for (const m of items) {
        const listing = await tx.get<Listing>('listings', m.listingId);
        const store = await tx.get<Store>('stores', m.storeId);
        result.push({
          ...(await this.view(tx, m)),
          listingName: listing?.name ?? { ja: '—', en: '—', 'zh-cn': '—' },
          storeName: store?.name ?? { ja: '—', en: '—', 'zh-cn': '—' },
          reportReasons: reports.filter((r) => r.mediaId === m.id).map((r) => r.reason),
        });
      }
      return result;
    });
  }
  async pendingCount(tx: Records) {
    const reported = new Set(
      (await tx.list<Report>('mediaReports'))
        .filter((r) => r.status === 'OPEN')
        .map((r) => r.mediaId),
    );
    return (
      (await tx.count('listingMedia', { status: 'PENDING_REVIEW' })) +
      (await tx.find<MediaRecord>('listingMedia', { status: 'APPROVED' })).filter((m) =>
        reported.has(m.id),
      ).length
    );
  }
  /**
   * Public once approved on a profile customers can see; before that only the therapist,
   * their shop and platform reviewers may open it.
   */
  async file(id: string, variant: 'file' | 'poster', viewer?: Actor) {
    return this.read(async (tx) => {
      const m = await tx.get<MediaRecord>('listingMedia', id);
      ensure(m, 'NOT_FOUND', 'Not available.', 404);
      const listing = await tx.get<Listing>('listings', m.listingId);
      const published =
        m.status === 'APPROVED' && liveListing(listing, await tx.get<Store>('stores', m.storeId));
      let allowed = published;
      if (!allowed && viewer?.role === 'STAFF')
        allowed = viewer.staffId === m.staffId && viewer.storeId === m.storeId;
      if (!allowed && viewer?.role === 'MERCHANT') allowed = viewer.storeId === m.storeId;
      if (!allowed && viewer?.role === 'ADMIN') {
        requireAdmin(await currentAdmin(tx, viewer), 'supply.read');
        allowed = true;
      }
      ensure(allowed, 'NOT_FOUND', 'Not available.', 404);
      const fileId = variant === 'poster' ? m.posterFileId : m.fileId;
      const file = fileId && (await tx.get<MediaFile>('mediaFiles', fileId));
      ensure(file, 'NOT_FOUND', 'Not available.', 404);
      let bytes = file.mime.startsWith('video/') ? videoCache.get(file.id) : undefined;
      if (!bytes) {
        bytes = await loadEvidence(file);
        if (file.mime.startsWith('video/')) cacheVideo(file.id, bytes);
      }
      return { published, mime: file.mime, bytes };
    });
  }
}
/** Abandoned chunked uploads are deleted after they expire. */
export async function sweepMediaUploads(tx: Records, now: number) {
  for (const upload of await tx.find<Upload>('mediaUploads', { expiresAt: { lte: now } })) {
    for (let i = 0; i < upload.chunks; i++)
      await tx.remove('mediaUploadChunks', `${upload.id}:${i}`);
    await tx.remove('mediaUploads', upload.id);
  }
}
