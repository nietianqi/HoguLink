import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  PLACEHOLDER_PORTRAIT,
  VIDEO_CHUNK_BYTES,
  listingMediaUrl,
  type Actor,
  type Listing,
} from '@hogulink/contracts';
import { fixture, customer, shop, staff, admin } from './helpers/experience-fixture.js';
import { mobileTherapists } from '../src/mobile.js';
import { inspectMp4, stripMp4Metadata } from '../src/mp4.js';

type E = Parameters<Parameters<typeof fixture>[0]>[0];
const minute = 60_000;
const code = (value: string) => (e: unknown) => (e as { code?: string }).code === value;
const otherStaff: Actor = { ...staff, id: 'quality-staff-ren', staffId: 'staff-ren' };
const photo = async (color = '#88aa99') =>
  (
    await sharp({ create: { width: 60, height: 80, channels: 3, background: color } })
      .jpeg()
      .toBuffer()
  ).toString('base64');

// A structurally valid MP4: ftyp, a movie header with a duration, one video track and
// camera metadata (a location string) that must not survive the upload.
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts),
    head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
function mp4({ seconds = 30, codec = 'avc1', size = 4000 } = {}) {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const hdlr = Buffer.alloc(25);
  hdlr.write('vide', 8, 'latin1');
  const entry = Buffer.alloc(86);
  entry.writeUInt32BE(86, 0);
  entry.write(codec, 4, 'latin1');
  const stsd = Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), entry]);
  const moov = box(
    'moov',
    box('mvhd', mvhd),
    box('trak', box('mdia', box('hdlr', hdlr), box('minf', box('stbl', box('stsd', stsd))))),
    box('udta', box('©xyz', Buffer.from('+35.6895+139.6917/'))),
  );
  const head = Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isomavc1')), moov]);
  return Buffer.concat([head, box('mdat', Buffer.alloc(Math.max(64, size - head.length - 8), 7))]);
}
async function uploadVideo(e: E, actor: Actor, file: Buffer, extra: Record<string, unknown> = {}) {
  const started = await e.media.startVideo(actor, { size: file.length, ...extra });
  for (let i = 0; i < started.chunks; i++)
    await e.media.videoChunk(actor, started.uploadId, {
      index: i,
      data: file.subarray(i * VIDEO_CHUNK_BYTES, (i + 1) * VIDEO_CHUNK_BYTES).toString('base64'),
    });
  return e.media.finishVideo(actor, started.uploadId, {
    durationSeconds: 30,
    poster: { mime: 'image/jpeg', data: await photo('#334455') },
  });
}
/** Therapist upload → shop confirmation → platform approval. */
async function published(e: E, color?: string) {
  let m = await e.media.uploadPhoto(staff, {
    mime: 'image/jpeg',
    data: await photo(color),
    consent: true,
  });
  m = await e.media.confirm(shop, m.id, { version: m.version, approved: true });
  return e.media.review(admin, m.id, { version: m.version, approved: true });
}
const publicListing = async (e: E, id = 'listing-aoi') =>
  (await e.publicCatalog({ fulfillmentMode: 'ALL' })).listings.find((l) => l.id === id);
const listing = (e: E, id = 'listing-aoi') =>
  e.repo.read((tx) => tx.get<Listing>('listings', id)) as Promise<Listing>;

test('a therapist photo goes public only after the shop confirms it and the platform approves it', () =>
  fixture(async (e) => {
    const data = await photo();
    await assert.rejects(
      e.media.uploadPhoto(staff, { mime: 'image/jpeg', data }),
      code('CONSENT_REQUIRED'),
      'the person shown authorizes their own upload',
    );
    let m = await e.media.uploadPhoto(staff, { mime: 'image/jpeg', data, consent: true });
    assert.equal(m.status, 'PENDING_SHOP');
    assert.equal(m.uploadedBy, 'STAFF');
    assert.equal((await publicListing(e))?.media, undefined, 'nothing is public yet');
    await assert.rejects(e.media.file(m.id, 'file'), code('NOT_FOUND'), 'customers cannot open it');
    assert.equal(
      (await e.media.file(m.id, 'file', staff)).published,
      false,
      'the owner can preview',
    );
    await assert.rejects(e.media.file(m.id, 'file', otherStaff), code('NOT_FOUND'));
    await assert.rejects(
      e.media.review(admin, m.id, { version: m.version, approved: true }),
      code('INVALID_STATE'),
      'the platform waits for the shop',
    );
    await assert.rejects(
      e.media.confirm(shop, m.id, { version: m.version, approved: false, note: '' }),
      code('NOTE_REQUIRED'),
    );
    m = await e.media.confirm(shop, m.id, { version: m.version, approved: true });
    assert.equal(m.status, 'PENDING_REVIEW');
    assert.equal(
      await e.repo.read((tx) => e.media.pendingCount(tx)),
      1,
      'counted in the platform to-do',
    );
    assert.equal((await e.media.reviewQueue(admin))[0].id, m.id);
    m = await e.media.review(admin, m.id, { version: m.version, approved: true });
    assert.equal(m.status, 'APPROVED');
    const live = await publicListing(e);
    assert.deepEqual(
      live?.media?.map((x) => [x.kind, x.url]),
      [['PHOTO', listingMediaUrl(m.id)]],
    );
    assert.equal((await e.media.file(m.id, 'file')).published, true);
    assert.equal(live?.photo, '/portraits/aoi.svg', 'an existing main photo is kept');
  }));

test('a shop upload waits for the person shown; rejection needs a reason and stays private', () =>
  fixture(async (e) => {
    let m = await e.media.uploadPhoto(shop, {
      listingId: 'listing-aoi',
      mime: 'image/jpeg',
      data: await photo(),
    });
    assert.equal(m.status, 'PENDING_CONSENT');
    await assert.rejects(e.media.authorize(shop, m.id, { version: m.version }), code('FORBIDDEN'));
    await assert.rejects(
      e.media.authorize(otherStaff, m.id, { version: m.version }),
      code('NOT_FOUND'),
      'another therapist cannot authorize someone else',
    );
    m = await e.media.authorize(staff, m.id, { version: m.version });
    assert.equal(m.status, 'PENDING_REVIEW', 'the shop already confirmed by uploading');
    await assert.rejects(
      e.media.review(admin, m.id, { version: m.version, approved: false }),
      code('NOTE_REQUIRED'),
    );
    m = await e.media.review(admin, m.id, {
      version: m.version,
      approved: false,
      note: 'The photo shows a phone number.',
    });
    assert.equal(m.status, 'REJECTED');
    assert.equal(m.note, 'The photo shows a phone number.');
    assert.equal((await e.media.list(staff)).items[0].note, m.note, 'the therapist sees why');
    assert.equal((await publicListing(e))?.media, undefined);
    await assert.rejects(
      e.media.uploadPhoto(shop, {
        listingId: 'listing-yuki',
        mime: 'image/jpeg',
        data: await photo(),
      }),
      code('NOT_FOUND'),
      'a shop manages only its own therapists',
    );
  }));

test('withdrawn or removed items leave the profile at once and the photo limit counts only live items', () =>
  fixture(async (e) => {
    const first = await published(e);
    const withdrawn = await e.media.withdraw(staff, first.id, { version: first.version });
    assert.equal(withdrawn.status, 'WITHDRAWN');
    assert.equal((await publicListing(e))?.media, undefined);
    await assert.rejects(e.media.file(first.id, 'file'), code('NOT_FOUND'));
    const second = await published(e, '#aa8899');
    await assert.rejects(
      e.media.remove(shop, second.id, { version: second.version, note: '' }),
      /too_small|String must contain/i,
    );
    const removed = await e.media.remove(shop, second.id, {
      version: second.version,
      note: 'Outdated photo.',
    });
    assert.equal(removed.status, 'REMOVED');
    for (let i = 0; i < 8; i++)
      await e.media.uploadPhoto(staff, {
        mime: 'image/jpeg',
        data: await photo(`#1${i}3456`),
        consent: true,
      });
    await assert.rejects(
      e.media.uploadPhoto(staff, {
        mime: 'image/jpeg',
        data: await photo('#ffffff'),
        consent: true,
      }),
      code('MEDIA_LIMIT'),
    );
  }));

test('an approved photo can become the main photo; taking it down restores the earlier one', () =>
  fixture(async (e) => {
    const a = await published(e),
      b = await published(e, '#aa8899');
    await e.media.setCover(staff, b.id, { version: b.version });
    let live = await publicListing(e);
    assert.equal(live?.photo, listingMediaUrl(b.id));
    assert.deepEqual(
      live?.media?.map((x) => x.id),
      [a.id],
      'the cover is not repeated in the gallery',
    );
    const current = (await e.media.list(shop, 'listing-aoi')).items.find((x) => x.id === b.id)!;
    assert.equal(current.cover, true);
    await e.media.reorder(staff, { ids: [b.id, a.id] });
    await assert.rejects(e.media.reorder(staff, { ids: [a.id] }), code('INVALID_ORDER'));
    await e.media.remove(admin, b.id, {
      version: current.version + 1,
      note: 'Not the same person.',
    });
    live = await publicListing(e);
    assert.equal(live?.photo, '/portraits/aoi.svg');
    assert.equal((await listing(e)).coverMediaId, undefined);
  }));

test('home visits need a main photo; in-store booking works with the initials avatar', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const l = (await tx.get<Listing>('listings', 'listing-aoi'))!;
      await tx.put('listings', { ...l, photo: PLACEHOLDER_PORTRAIT });
    });
    const home = await mobileTherapists(e, { fulfillmentMode: 'HOME_VISIT', duration: '60' });
    assert(!home.items.some((i) => i.listing.id === 'listing-aoi'), 'not offered for home visits');
    await assert.rejects(
      e.quote(customer, {
        listingId: 'listing-aoi',
        offeringId: 'store-nagi-60',
        bookingMode: 'SCHEDULED',
        nominationType: 'NOMINATED',
        startAt: e.now() + 180 * minute,
        area: 'shinjuku',
        requiredLanguage: '',
      }),
      code('INVALID_OFFERING'),
    );
    await assert.rejects(
      e.venues.staffModes(shop, 'listing-aoi', { modes: ['HOME_VISIT', 'IN_STORE'] }),
      code('MAIN_PHOTO_REQUIRED'),
    );
    // In-store visits are recognized at reception, so the initials avatar is enough there.
    const pending = await e.venues.save(shop, {
      version: 0,
      enabled: true,
      address: 'Tokyo Shinjuku private test venue',
      area: 'shinjuku',
      latitude: 35.69,
      longitude: 139.7,
      contact: '03-0000-0000',
      directions: 'Near the station',
      photos: ['/images/shop.jpg'],
      businessHours: { startMinute: 540, endMinute: 1320 },
      turnoverMinutes: 15,
      nominationFee: 300,
      cancellationTemplateId: 'FLEXIBLE_2H',
      resources: [{ id: 'bed-1', name: 'Bed 1', active: true }],
    });
    await e.venues.review(admin, shop.storeId!, {
      version: pending.version,
      decision: 'APPROVED',
      note: 'Checked the real reception location and capacity.',
    });
    await e.venues.staffModes(shop, 'listing-aoi', { modes: ['IN_STORE'] });
    await e.venues.createOffering(shop, 'store-nagi-60', { version: 1, price: 6000 });
    const inStore = await e.quote(customer, {
      listingId: 'listing-aoi',
      offeringId: 'store-nagi-60-in-store',
      fulfillmentMode: 'IN_STORE',
      bookingMode: 'SCHEDULED',
      nominationType: 'NOMINATED',
      startAt: e.now() + 180 * minute,
      requiredLanguage: '',
    });
    assert.equal(inStore.listingId, 'listing-aoi');
    // The first approved photo becomes the main photo, which reopens home visits.
    const m = await published(e);
    assert.equal((await listing(e)).photo, listingMediaUrl(m.id));
    await e.venues.staffModes(shop, 'listing-aoi', {
      version: 1,
      modes: ['HOME_VISIT', 'IN_STORE'],
    });
    const reopened = await mobileTherapists(e, { fulfillmentMode: 'HOME_VISIT', duration: '60' });
    assert(reopened.items.some((i) => i.listing.id === 'listing-aoi'));
  }));

test('the MP4 reader finds duration and codec and blanks camera metadata without moving samples', () => {
  const file = mp4({ seconds: 42 });
  assert.deepEqual(inspectMp4(file), {
    brand: 'isom',
    durationSeconds: 42,
    videoCodecs: ['avc1'],
    audioCodecs: [],
  });
  const clean = stripMp4Metadata(file);
  assert.equal(clean.length, file.length);
  assert(file.includes('+35.6895+139.6917'));
  assert(!clean.includes('+35.6895+139.6917'), 'location removed');
  assert.equal(inspectMp4(clean).durationSeconds, 42, 'still a readable movie');
  assert.throws(() => inspectMp4(Buffer.from('not a video at all')));
});

test('an introduction video uploads in parts, is checked, stripped and replaced only after approval', () =>
  fixture(async (e) => {
    const file = mp4({ seconds: 30, size: VIDEO_CHUNK_BYTES * 2 + 1234 });
    await assert.rejects(
      e.media.startVideo(staff, { size: file.length }),
      code('CONSENT_REQUIRED'),
    );
    const started = await e.media.startVideo(staff, { size: file.length, consent: true });
    assert.equal(started.chunks, 3);
    await assert.rejects(
      e.media.videoChunk(otherStaff, started.uploadId, {
        index: 0,
        data: file.subarray(0, 10).toString('base64'),
      }),
      code('UPLOAD_EXPIRED'),
      'nobody else can write into the upload',
    );
    await assert.rejects(
      e.media.videoChunk(staff, started.uploadId, {
        index: 0,
        data: file.subarray(0, 10).toString('base64'),
      }),
      code('INVALID_UPLOAD'),
    );
    await assert.rejects(
      e.media.finishVideo(staff, started.uploadId, {
        durationSeconds: 30,
        poster: { mime: 'image/jpeg', data: await photo() },
      }),
      code('INVALID_UPLOAD'),
      'all parts are required',
    );
    let video = await uploadVideo(e, staff, file, { consent: true });
    assert.equal(video.status, 'PENDING_SHOP');
    assert.equal(video.durationSeconds, 30);
    assert.ok(video.posterUrl);
    const stored = await e.media.file(video.id, 'file', staff);
    assert.equal(stored.mime, 'video/mp4');
    assert.equal(stored.bytes.length, file.length);
    assert(!stored.bytes.includes('+35.6895+139.6917'), 'camera location never stored');
    assert.equal((await e.media.file(video.id, 'poster', staff)).mime, 'image/jpeg');
    await assert.rejects(
      e.media.startVideo(staff, { size: file.length, consent: true }),
      code('MEDIA_LIMIT'),
      'one video at a time in review',
    );
    video = await e.media.confirm(shop, video.id, { version: video.version, approved: true });
    video = await e.media.review(admin, video.id, { version: video.version, approved: true });
    // A replacement waits in review while the current video stays on the profile.
    let next = await uploadVideo(e, shop, mp4({ seconds: 20 }), { listingId: 'listing-aoi' });
    assert.equal(next.status, 'PENDING_CONSENT');
    assert.deepEqual(
      (await publicListing(e))?.media?.map((x) => x.id),
      [video.id],
    );
    next = await e.media.authorize(staff, next.id, { version: next.version });
    next = await e.media.review(admin, next.id, { version: next.version, approved: true });
    const live = await publicListing(e);
    assert.deepEqual(
      live?.media?.map((x) => [x.id, x.kind, x.durationSeconds]),
      [[next.id, 'VIDEO', 20]],
    );
    const old = (await e.media.list(staff)).items.find((x) => x.id === video.id)!;
    assert.deepEqual([old.status, old.note], ['REMOVED', 'REPLACED']);
  }));

test('videos that would not play everywhere or run too long are refused', () =>
  fixture(async (e) => {
    await assert.rejects(
      uploadVideo(e, staff, mp4({ codec: 'hvc1' }), { consent: true }),
      code('VIDEO_CODEC'),
    );
    await assert.rejects(
      uploadVideo(e, staff, mp4({ seconds: 90 }), { consent: true }),
      code('VIDEO_TOO_LONG'),
    );
    await assert.rejects(
      uploadVideo(e, staff, Buffer.alloc(5000, 1), { consent: true }),
      code('INVALID_VIDEO'),
    );
    // A failed check does not occupy the single review slot.
    assert.equal((await uploadVideo(e, staff, mp4(), { consent: true })).status, 'PENDING_SHOP');
  }));

test('customers can report a public item once; the platform keeps or takes it down', () =>
  fixture(async (e) => {
    const m = await published(e);
    await assert.rejects(
      e.media.report(staff, m.id, { reason: 'INAPPROPRIATE' }),
      code('FORBIDDEN'),
    );
    await e.media.report(customer, m.id, { reason: 'NOT_THE_PERSON' });
    await e.media.report(customer, m.id, { reason: 'NOT_THE_PERSON' });
    let queue = await e.media.reviewQueue(admin);
    assert.deepEqual(
      queue.map((x) => [x.id, x.reports, x.reportReasons]),
      [[m.id, 1, ['NOT_THE_PERSON']]],
    );
    // Keeping it closes the report and leaves it public.
    const kept = await e.media.review(admin, m.id, { version: queue[0].version, approved: true });
    assert.equal(kept.status, 'APPROVED');
    assert.equal((await e.media.reviewQueue(admin)).length, 0);
    await e.media.report({ ...customer, id: 'another-customer' }, m.id, { reason: 'CONTACT_INFO' });
    queue = await e.media.reviewQueue(admin);
    const removed = await e.media.review(admin, m.id, {
      version: queue[0].version,
      approved: false,
      note: 'Contact details visible in the corner.',
    });
    assert.equal(removed.status, 'REMOVED');
    assert.equal((await publicListing(e))?.media, undefined);
    await assert.rejects(e.media.report(customer, m.id, { reason: 'OTHER' }), code('NOT_FOUND'));
  }));
