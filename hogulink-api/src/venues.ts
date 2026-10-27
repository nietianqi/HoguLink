import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import sharp from 'sharp';
import {
  venueInput,
  venueAvailable,
  venueCanServe,
  editableVenue,
  venuePhotoId,
  venuePhotoUrl,
  VENUE_REVIEWED_FIELDS,
  timeSurchargesInput,
  makeCancellationPolicy,
  fulfillmentMode,
  hasMainPhoto,
  type Actor,
  type Store,
  type Offering,
  type Listing,
  type Hold,
  type Venue,
  type FulfillmentMode,
  type Booking,
  type Quote,
  type VenueCalendar,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { currentAdmin, requireAdmin } from './admin-access.js';
import { ensure } from './errors.js';
import { loadEvidence, saveEvidence } from './evidence-storage.js';

type VenuePhoto = {
  id: string;
  storeId: string;
  ownerId: string;
  storageKey: string;
  size: number;
  createdAt: number;
};
/** Settings the shop runs day to day; they apply at once without platform review. */
const OPERATING_FIELDS = [
  'enabled',
  'businessHours',
  'closedDates',
  'closedWeekdays',
  'turnoverMinutes',
  'nominationFee',
  'timeSurcharges',
  'cancellationTemplateId',
  'resources',
] as const;
const pick = <K extends keyof Venue>(v: Pick<Venue, K>, keys: readonly K[]) =>
  JSON.stringify(keys.map((key) => v[key] ?? null));
const moves = (from: Venue, to: Venue) =>
  from.address !== to.address ||
  from.area !== to.area ||
  from.latitude !== to.latitude ||
  from.longitude !== to.longitude;

export class VenueService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
    private read: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
  ) {}
  private async shop(tx: Records, actor: Actor) {
    ensure(actor.role === 'MERCHANT' && actor.storeId, 'FORBIDDEN', 'Shop account required.', 403);
    const store = await tx.get<Store>('stores', actor.storeId);
    ensure(store?.active && store.approved, 'NOT_FOUND', 'Shop not found.', 404);
    return store;
  }
  private async audit(tx: Records, actor: Actor, action: string, storeId: string) {
    await tx.put('audit', {
      id: `audit_${randomUUID()}`,
      actorId: actor.id,
      action,
      at: this.now(),
      detail: storeId,
    });
    await tx.put('outbox', {
      id: `outbox_${randomUUID()}`,
      type: action,
      storeId,
      createdAt: this.now(),
      status: 'PENDING',
    });
  }
  async save(actor: Actor, input: unknown) {
    const d = venueInput.extend({ timeSurcharges: timeSurchargesInput.default([]) }).parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        live = store.venue,
        draft = store.venueDraft;
      ensure(
        (editableVenue(store)?.version ?? 0) === d.version,
        'VERSION_CONFLICT',
        'The venue changed. Refresh first.',
        409,
      );
      for (const photo of d.photos) {
        const id = venuePhotoId(photo);
        if (id)
          ensure(
            (await tx.get<VenuePhoto>('venuePhotos', id))?.storeId === store.id,
            'INVALID_PHOTO',
            'Upload venue photos from this shop.',
          );
      }
      const holds = await tx.find<Hold>('holds', { active: true });
      for (const h of holds) {
        if (!h.resourceId) continue;
        const q = await tx.get<Quote>('quotes', h.quoteId);
        if (q?.storeId !== store.id) continue;
        ensure(
          !live ||
            (live.address === d.address &&
              live.area === d.area &&
              live.latitude === d.latitude &&
              live.longitude === d.longitude),
          'VENUE_HAS_BOOKINGS',
          'Resolve existing reservations before moving this venue.',
          409,
        );
        ensure(
          d.resources.some((r) => r.id === h.resourceId && r.active),
          'VENUE_HAS_BOOKINGS',
          'A reserved resource cannot be removed or disabled.',
          409,
        );
      }
      const version = d.version + 1;
      const submitted: Venue = {
        ...d,
        version,
        status: 'PENDING',
        cancellationPolicy: makeCancellationPolicy(
          d.cancellationTemplateId,
          `in-store-v${version}`,
        ),
      };
      if (live?.status !== 'APPROVED') {
        // Nothing is live yet, so the whole venue goes to review.
        await tx.put('stores', {
          ...store,
          venue: submitted,
          venueDraft: undefined,
        });
        await this.audit(tx, actor, 'VENUE_SUBMITTED', store.id);
        return submitted;
      }
      // An approved venue keeps taking bookings: operating settings apply now, while changed
      // address, contact, directions or photos wait for review.
      const operating = pick(live, OPERATING_FIELDS) !== pick(submitted, OPERATING_FIELDS);
      const nextLive: Venue = operating
        ? {
            ...live,
            ...Object.fromEntries(OPERATING_FIELDS.map((key) => [key, submitted[key]])),
            cancellationPolicy: submitted.cancellationPolicy,
            version,
          }
        : live;
      if (operating) await this.ensureBookingsFit(tx, store, nextLive);
      const facts =
        pick(nextLive, VENUE_REVIEWED_FIELDS) !== pick(submitted, VENUE_REVIEWED_FIELDS);
      // Resubmitting the same rejected facts keeps the rejection instead of queuing it again.
      const unchangedRejection =
        draft?.status === 'REJECTED' &&
        pick(draft, VENUE_REVIEWED_FIELDS) === pick(submitted, VENUE_REVIEWED_FIELDS);
      const nextDraft: Venue | undefined = facts
        ? {
            ...nextLive,
            ...Object.fromEntries(VENUE_REVIEWED_FIELDS.map((key) => [key, submitted[key]])),
            version,
            ...(unchangedRejection
              ? { status: 'REJECTED', reviewedBy: draft.reviewedBy, reviewNote: draft.reviewNote }
              : { status: 'PENDING', reviewedBy: undefined, reviewNote: undefined }),
          }
        : undefined;
      if (!operating && !facts && !draft) return live;
      await tx.put('stores', {
        ...store,
        venue: nextLive,
        venueDraft: nextDraft,
      });
      await this.audit(
        tx,
        actor,
        facts && !unchangedRejection ? 'VENUE_SUBMITTED' : 'VENUE_UPDATED',
        store.id,
      );
      return editableVenue({ venue: nextLive, venueDraft: nextDraft })!;
    });
  }
  /** New hours or closures cannot silently strand customers who already booked. */
  private async ensureBookingsFit(tx: Records, store: Store, venue: Venue) {
    for (const b of await tx.find<Booking>('bookings', {
      storeId: store.id,
      status: ['REQUESTED', 'ACCEPTED', 'CONFIRMED'],
    }))
      if (fulfillmentMode(b.quote) === 'IN_STORE' && b.startedAt === undefined)
        ensure(
          venueCanServe(venue, b.quote.startAt, b.quote.endAt),
          'VENUE_HAS_BOOKINGS',
          'Existing reservations fall outside the new hours. Resolve them first.',
          409,
        );
  }
  async uploadPhoto(actor: Actor, input: unknown) {
    const d = z
      .object({
        mime: z.enum(['image/jpeg', 'image/png']),
        data: z
          .string()
          .min(8)
          .max(470000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .parse(input);
    let bytes: Buffer = Buffer.from(d.data, 'base64');
    ensure(
      bytes.length <= 350000 && bytes.toString('base64') === d.data,
      'INVALID_PHOTO',
      'Select a photo no larger than 350 KB.',
    );
    ensure(
      d.mime === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
      'INVALID_PHOTO',
      'The photo format does not match the file.',
    );
    try {
      // Re-encoding drops embedded metadata such as the camera location.
      bytes = await sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning' })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      ensure(false, 'INVALID_PHOTO', 'Select a valid JPEG or PNG photo.');
    }
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor);
      ensure(
        (await tx.count('venuePhotos', { storeId: store.id })) < 40,
        'PHOTO_LIMIT',
        'The venue photo limit has been reached.',
        409,
      );
      // Stored like other private evidence, so backups carry the file with its record.
      const id = `evidence_${randomUUID()}`;
      const photo: VenuePhoto = {
        id,
        storeId: store.id,
        ownerId: actor.id,
        storageKey: await saveEvidence(id, bytes),
        size: bytes.length,
        createdAt: this.now(),
      };
      await tx.put('venuePhotos', photo);
      await this.audit(tx, actor, 'VENUE_PHOTO_UPLOADED', store.id);
      return { id, url: venuePhotoUrl(id) };
    });
  }
  /**
   * Anyone may see photos of an approved live venue. Unreviewed uploads are visible only to
   * the shop that uploaded them and to platform reviewers.
   */
  async photo(id: string, viewer?: Actor) {
    return this.read(async (tx) => {
      const photo = await tx.get<VenuePhoto>('venuePhotos', id);
      ensure(photo, 'NOT_FOUND', 'Photo not available.', 404);
      const store = await tx.get<Store>('stores', photo.storeId);
      const published =
        !!store?.active &&
        store.approved &&
        store.venue?.status === 'APPROVED' &&
        store.venue.photos.includes(venuePhotoUrl(id));
      let allowed = published;
      if (!allowed && viewer?.role === 'MERCHANT') allowed = viewer.storeId === photo.storeId;
      if (!allowed && viewer?.role === 'ADMIN') {
        requireAdmin(await currentAdmin(tx, viewer), 'supply.read');
        allowed = true;
      }
      ensure(allowed, 'NOT_FOUND', 'Photo not available.', 404);
      return { published, mime: 'image/jpeg', bytes: await loadEvidence(photo) };
    });
  }
  async list(actor: Actor) {
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'supply.read');
      return (await tx.list<Store>('stores'))
        .filter((s) => s.venue || s.venueDraft)
        .map((s) => ({
          storeId: s.id,
          name: s.name,
          venue: editableVenue(s)!,
          ...(s.venueDraft ? { live: s.venue } : {}),
        }));
    });
  }
  async calendar(actor: Actor, input: unknown): Promise<VenueCalendar> {
    const d = z
      .object({ date: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/) })
      .strict()
      .parse(input);
    const begin = Date.parse(`${d.date}T00:00:00+09:00`),
      end = begin + 86400000;
    ensure(
      Number.isFinite(begin) && new Date(begin + 9 * 3600000).toISOString().slice(0, 10) === d.date,
      'INVALID_TIME',
      'Select a valid day.',
    );
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor);
      const result: VenueCalendar = {
        date: d.date,
        serverNow: this.now(),
        resources: store.venue?.resources ?? [],
        entries: [],
      };
      const overlaps = (from: number, to: number) => from < end && to > begin;
      const scheduled = await tx.find<Booking>('bookings', {
        storeId: store.id,
        'quote.startAt': { gte: begin - 86400000, lt: end },
      });
      // An unfinished service still occupies its bed after its scheduled end, including overnight.
      const running = await tx.find<Booking>('bookings', {
        storeId: store.id,
        status: 'IN_SERVICE',
      });
      for (const b of new Map([...scheduled, ...running].map((b) => [b.id, b])).values()) {
        if (fulfillmentMode(b.quote) !== 'IN_STORE' || !b.resourceId) continue;
        const from = b.startedAt ?? b.quote.startAt,
          ongoing = b.status === 'IN_SERVICE',
          to = Math.max(from + b.quote.endAt - b.quote.startAt, ongoing ? this.now() + 1 : 0);
        if (!overlaps(from, to)) continue;
        const person = b.assignedListingId
          ? await tx.get<Listing>('listings', b.assignedListingId)
          : undefined;
        result.entries.push({
          id: b.id,
          bookingId: b.id,
          resourceId: b.resourceId,
          phase: b.status === 'CONFIRMED' && b.checkIn ? 'CHECKED_IN' : b.status,
          startAt: from,
          endAt: to,
          ...(ongoing ? { ongoing: true } : {}),
          serviceName: b.quote.serviceName,
          staffName: person?.name,
        });
      }
      for (const h of await tx.find<Hold>('holds', { active: true, phase: 'CHECKOUT_HOLD' })) {
        if (!h.resourceId) continue;
        const q = await tx.get<Quote>('quotes', h.quoteId);
        if (q?.storeId === store.id && overlaps(q.startAt, q.endAt))
          result.entries.push({
            id: `hold:${h.id}`,
            resourceId: h.resourceId,
            phase: 'CHECKOUT_HOLD',
            startAt: q.startAt,
            endAt: q.endAt,
            serviceName: q.serviceName,
          });
      }
      for (const resource of result.resources) {
        const clean = await tx.get<{ id: string; startAt: number; endAt: number }>(
          'venueTurnovers',
          `venue:${store.id}:${resource.id}`,
        );
        if (clean && overlaps(clean.startAt, clean.endAt))
          result.entries.push({ ...clean, resourceId: resource.id, phase: 'CLEANING' });
      }
      result.entries.sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id));
      return result;
    });
  }
  async review(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({
        version: z.number().int().positive(),
        decision: z.enum(['APPROVED', 'REJECTED']),
        note: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'supply.write');
      const store = await tx.get<Store>('stores', id);
      const draft = store?.venueDraft;
      const target = draft ?? store?.venue;
      ensure(
        store && target && target.version === d.version && target.status === 'PENDING',
        'VERSION_CONFLICT',
        'Refresh the venue review.',
        409,
      );
      if (draft && store.venue) {
        if (d.decision === 'REJECTED') {
          // The approved venue keeps serving; the shop sees why its change was rejected.
          const rejected: Venue = {
            ...draft,
            status: 'REJECTED',
            reviewedBy: actor.id,
            reviewNote: d.note,
            version: d.version + 1,
          };
          await tx.put('stores', { ...store, venueDraft: rejected });
          await this.audit(tx, actor, 'VENUE_REJECTED', store.id);
          return rejected;
        }
        if (moves(store.venue, draft))
          for (const h of await tx.find<Hold>('holds', { active: true })) {
            if (!h.resourceId) continue;
            const q = await tx.get<Quote>('quotes', h.quoteId);
            ensure(
              q?.storeId !== store.id,
              'VENUE_HAS_BOOKINGS',
              'Customers have booked the current address. Resolve their reservations first.',
              409,
            );
          }
        const venue: Venue = {
          ...store.venue,
          ...Object.fromEntries(VENUE_REVIEWED_FIELDS.map((key) => [key, draft[key]])),
          status: 'APPROVED',
          reviewedBy: actor.id,
          reviewNote: d.note,
          version: d.version + 1,
        };
        await tx.put('stores', {
          ...store,
          venue,
          venueDraft: undefined,
        });
        await this.audit(tx, actor, 'VENUE_APPROVED', store.id);
        return venue;
      }
      const venue = {
        ...store.venue!,
        status: d.decision,
        reviewedBy: actor.id,
        reviewNote: d.note,
        version: d.version + 1,
      };
      await tx.put('stores', { ...store, venue });
      await this.audit(tx, actor, `VENUE_${d.decision}`, store.id);
      return venue;
    });
  }
  /**
   * Address search for shops placing their venue, via the free GSI (国土地理院) service. The
   * shop confirms the result; customers' positions are never sent anywhere.
   */
  async geocode(actor: Actor, input: unknown) {
    const { q } = z.object({ q: z.string().trim().min(3).max(200) }).parse(input);
    await this.run((tx) => this.shop(tx, actor));
    let rows: { geometry?: { coordinates?: number[] }; properties?: { title?: string } }[];
    try {
      const response = await fetch(
        `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`,
        { signal: AbortSignal.timeout(5000) },
      );
      ensure(response.ok, 'GEOCODE_UNAVAILABLE', 'Address search is unavailable.', 503);
      rows = await response.json();
    } catch {
      ensure(
        false,
        'GEOCODE_UNAVAILABLE',
        'Address search is unavailable. Enter coordinates.',
        503,
      );
    }
    return rows
      .flatMap((row) => {
        const [longitude, latitude] = row.geometry?.coordinates ?? [];
        // Japan only; anything else is a mismatch.
        return Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          latitude >= 20 &&
          latitude <= 46 &&
          longitude >= 122 &&
          longitude <= 154
          ? [{ latitude, longitude, label: String(row.properties?.title ?? q).slice(0, 200) }]
          : [];
      })
      .slice(0, 5);
  }
  /** Platform action: pause or resume new in-store bookings without touching existing ones. */
  async suspend(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({ suspended: z.boolean(), note: z.string().trim().min(10).max(500) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'supply.write');
      const store = await tx.get<Store>('stores', id);
      ensure(store?.venue?.status === 'APPROVED', 'NOT_FOUND', 'Approved venue not found.', 404);
      const venue: Venue = d.suspended
        ? { ...store.venue, suspension: { at: this.now(), by: actor.id, note: d.note } }
        : { ...store.venue, suspension: undefined };
      await tx.put('stores', { ...store, venue });
      await this.audit(tx, actor, d.suspended ? 'VENUE_SUSPENDED' : 'VENUE_RESTORED', store.id);
      return venue;
    });
  }
  async staffModes(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({
        version: z.number().int().nonnegative().default(0),
        modes: z
          .array(z.enum(['HOME_VISIT', 'IN_STORE']))
          .min(1)
          .max(2),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        listing = await tx.get<Listing>('listings', id);
      ensure(
        listing?.storeId === store.id && listing.membershipActive,
        'NOT_FOUND',
        'Staff not found.',
        404,
      );
      ensure(
        (listing.serviceModesVersion ?? 0) === d.version,
        'VERSION_CONFLICT',
        'Staff service modes changed. Refresh first.',
        409,
      );
      const modes: FulfillmentMode[] = [...new Set(d.modes)];
      ensure(
        !modes.includes('HOME_VISIT') || hasMainPhoto(listing),
        'MAIN_PHOTO_REQUIRED',
        'Home visits need an approved main photo so the customer can recognize the therapist.',
      );
      const offerings = await tx.find<Offering>('offerings', { storeId: store.id });
      const next = {
        ...listing,
        serviceModesVersion: d.version + 1,
        fulfillmentModes: modes,
        offeringIds: [
          ...new Set([
            ...listing.offeringIds,
            ...offerings
              .filter(
                (o) =>
                  fulfillmentMode(o) === 'IN_STORE' &&
                  modes.includes('IN_STORE') &&
                  listing.offeringIds.includes(o.id.replace(/-in-store$/, '')),
              )
              .map((o) => o.id),
          ]),
        ],
      };
      await tx.put('listings', next);
      await this.audit(tx, actor, 'STAFF_SERVICE_MODES_UPDATED', store.id);
      return next;
    });
  }
  async homeVisits(actor: Actor, input: unknown) {
    const d = z
      .object({ version: z.number().int().nonnegative(), enabled: z.boolean() })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor);
      ensure(
        store.ruleVersion === d.version,
        'VERSION_CONFLICT',
        'Shop changed. Refresh first.',
        409,
      );
      await tx.put('stores', {
        ...store,
        homeVisitsEnabled: d.enabled,
        ruleVersion: store.ruleVersion + 1,
      });
      await this.audit(tx, actor, 'HOME_VISITS_UPDATED', store.id);
      return { enabled: d.enabled };
    });
  }
  async createOffering(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({
        version: z.number().int().positive(),
        price: z.number().int().min(1000).max(200000),
        active: z.boolean().default(true),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        source = await tx.get<Offering>('offerings', id);
      ensure(
        source?.storeId === store.id &&
          source.approved &&
          source.regulatoryCategory === 'RELAXATION' &&
          fulfillmentMode(source) === 'HOME_VISIT',
        'INVALID_OFFERING',
        'Select an approved home service.',
      );
      ensure(source.version === d.version, 'VERSION_CONFLICT', 'Service changed.', 409);
      const nextId = `${source.id}-in-store`,
        prior = await tx.get<Offering>('offerings', nextId);
      ensure(!prior, 'ALREADY_EXISTS', 'Edit the existing in-store service.', 409);
      const next: Offering = {
        ...source,
        id: nextId,
        fulfillmentMode: 'IN_STORE',
        price: d.price,
        active: d.active,
        transportFee: 0,
        version: 1,
        priceSince: this.now(),
        promotion: undefined,
        promotionHistory: [],
      };
      await tx.put('offerings', next);
      for (const listing of await tx.find<Listing>('listings', { storeId: store.id }))
        if (
          listing.offeringIds.includes(source.id) &&
          listing.fulfillmentModes?.includes('IN_STORE')
        )
          await tx.put('listings', {
            ...listing,
            offeringIds: [...new Set([...listing.offeringIds, next.id])],
          });
      await this.audit(tx, actor, 'IN_STORE_OFFERING_CREATED', store.id);
      return next;
    });
  }
}
