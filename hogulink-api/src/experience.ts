import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  experienceDimensions,
  fulfillmentMode,
  venueAvailable,
  listingSupports,
  type Actor,
  type Booking,
  type CustomerExperience,
  type CustomerOverview,
  type Hold,
  type Quote,
  type SupportTicket,
  type ExperienceAppeal,
  type ExperienceModerationItem,
  type ExperienceModerationLog,
  type ExperienceReply,
  type ExperienceReview,
  type ExperienceScores,
  type ExperienceSummary,
  type FavoriteItem,
  effectiveServicePrice,
  travelFeeFor,
  type FavoriteRecord,
  type StoreFavoriteRecord,
  type Listing,
  type MerchantExperienceRow,
  type Offering,
  type PublicExperience,
  type PublicExperiencePage,
  type Store,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { ensure } from './errors.js';
import { effectiveBookingRules } from './booking-rules.js';
import { toPublicStore, toPublicListing } from './public-catalog.js';
import { currentAdmin, requireAdmin } from './admin-access.js';
import { activeStaffMembership } from './staff-access.js';
const uid = (p: string) => `${p}_${randomUUID()}`;
const scores = z
  .object({
    punctuality: z.number().int().min(1).max(5),
    communication: z.number().int().min(1).max(5),
    explanation: z.number().int().min(1).max(5),
    cleanliness: z.number().int().min(1).max(5),
    overall: z.number().int().min(1).max(5),
  })
  .strict();
const text = z.string().trim().max(600);
const blocked =
  /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d ()-]{8,}\d)|line\s*id|微信号|房号|部屋番号|room\s*(?:number|#)|颜值|身材|胸部|外貌|容姿|スタイルが|セクシー|sexy|beautiful body|cure\b|治愈|治療効果|必ず治る)/i;
function cleanText(value: string) {
  ensure(
    !blocked.test(value),
    'REVIEW_CONTENT_REJECTED',
    'Describe the service without private contacts, appearance comments or medical claims.',
  );
  return value;
}
export function summarizeExperiences(items: Pick<ExperienceReview, 'scores'>[]): ExperienceSummary {
  const average = (key: keyof ExperienceScores) =>
    items.length
      ? Math.round((items.reduce((sum, r) => sum + r.scores[key], 0) / items.length) * 10) / 10
      : null;
  return {
    count: items.length,
    average: average('overall'),
    dimensions: Object.fromEntries(
      experienceDimensions.map((k) => [k, average(k)]),
    ) as ExperienceSummary['dimensions'],
  };
}
async function available(tx: Records, id: string) {
  const listing = await tx.get<Listing>('listings', id),
    store = listing && (await tx.get<Store>('stores', listing.storeId));
  if (
    !listing ||
    !store ||
    !listing.membershipActive ||
    !listing.identityVerified ||
    !listing.portraitConsent ||
    listing.publicationStatus !== 'PUBLISHED_INDEXABLE' ||
    !store.approved ||
    !store.active ||
    store.billingBlocked ||
    !store.pspAccount
  )
    return undefined;
  const offerings = (await tx.list<Offering>('offerings')).filter(
    (o) =>
      o.storeId === store.id &&
      listing.offeringIds.includes(o.id) &&
      o.approved &&
      o.active !== false &&
      o.regulatoryCategory === 'RELAXATION',
  );
  return offerings.length ? { listing, store, offerings } : undefined;
}
async function log(tx: Records, actor: Actor, action: string, target: string, now: number) {
  await tx.put('audit', { id: uid('audit'), actorId: actor.id, action, detail: target, at: now });
  await tx.put('outbox', {
    id: uid('outbox'),
    type: action,
    target,
    createdAt: now,
    status: 'PENDING',
    delivery: 'DEMO_LOCAL_ONLY',
  });
}
export class ExperienceService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private customer(actor: Actor) {
    ensure(
      actor.role === 'CUSTOMER' && actor.verificationLevel >= 1,
      'FORBIDDEN',
      'Sign in with your customer account.',
      403,
    );
  }
  private async ownBooking(tx: Records, actor: Actor, id: string) {
    this.customer(actor);
    const b = await tx.get<Booking>('bookings', id);
    ensure(b && b.customerId === actor.id, 'NOT_FOUND', 'Booking not found.', 404);
    return b;
  }
  async overview(actor: Actor): Promise<CustomerOverview> {
    this.customer(actor);
    return this.run(async (tx) => {
      const bookings = (await tx.find<Booking>('bookings', { customerId: actor.id })).sort(
        (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
      );
      const reviews = (await tx.list<ExperienceReview>('experienceReviews')).filter(
        (r) => r.customerId === actor.id,
      );
      const actionable: Booking[] = [];
      for (const b of bookings) {
        const review = reviews.find((r) => r.bookingId === b.id);
        if (
          (await this.eligible(tx, b)) &&
          (!review || ['REJECTED', 'WITHDRAWN'].includes(review.status))
        )
          actionable.push(b);
      }
      const holds = (await tx.find<Hold>('holds', { customerId: actor.id }))
        .filter(
          (h) =>
            h.customerId === actor.id &&
            h.active &&
            h.phase === 'CHECKOUT_HOLD' &&
            !h.bookingId &&
            h.expiresAt > this.now(),
        )
        .sort((a, b) => a.expiresAt - b.expiresAt);
      const resumable: { holdId: string; expiresAt: number; total: number }[] = [];
      for (const h of holds) {
        const q = await tx.get<Quote>('quotes', h.quoteId);
        if (q?.customerId === actor.id && q.expiresAt > this.now())
          resumable.push({
            holdId: h.id,
            expiresAt: Math.min(h.expiresAt, q.expiresAt),
            total: q.total,
          });
      }
      const recent: CustomerOverview['recent'] = [];
      for (const b of bookings.slice(0, 3)) {
        const o = await tx.get<Offering>('offerings', b.quote.offeringId);
        recent.push({
          id: b.id,
          status: b.status,
          startAt: b.quote.startAt,
          total: b.quote.total,
          serviceName: b.quote.serviceName ??
            o?.name ?? { ja: 'サービス', en: 'Service', 'zh-cn': '服务' },
        });
      }
      // Select from the full owned history: a live visit can be older than
      // the three recent cards, and consent must not disappear behind them.
      const current = bookings
        .filter((b) => !['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status))
        .sort((a, b) => {
          const priority = (x: Booking) =>
            x.replacementConsent === 'PENDING' && x.proposedListingId
              ? 0
              : x.status === 'AWAITING_COMPLETION'
                ? 1
                : ['IN_SERVICE', 'ARRIVED', 'EN_ROUTE'].includes(x.status)
                  ? 2
                  : 3;
          return (
            priority(a) - priority(b) ||
            a.quote.startAt - b.quote.startAt ||
            a.id.localeCompare(b.id)
          );
        })[0];
      let focus: CustomerOverview['focus'];
      if (current) {
        const offering = await tx.get<Offering>('offerings', current.quote.offeringId);
        focus = {
          id: current.id,
          status: current.status,
          startAt: current.quote.startAt,
          total: current.quote.total,
          serviceName: current.quote.serviceName ??
            offering?.name ?? { ja: 'サービス', en: 'Service', 'zh-cn': '服务' },
          requiresConsent: current.replacementConsent === 'PENDING' && !!current.proposedListingId,
        };
      }
      return {
        counts: {
          checkout: resumable.length,
          closed: bookings.filter((b) => ['CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status))
            .length,
          active: bookings.filter(
            (b) => !['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status),
          ).length,
          review: actionable.length,
          support: (await tx.list<SupportTicket>('supportTickets')).filter(
            (t) =>
              t.reporterId === actor.id &&
              t.reporterRole === 'CUSTOMER' &&
              !['RESOLVED', 'CLOSED'].includes(t.status),
          ).length,
          favorites:
            (await tx.list<FavoriteRecord>('favorites')).filter(
              (f) => f.customerId === actor.id && f.active,
            ).length +
            (await tx.list<StoreFavoriteRecord>('storeFavorites')).filter(
              (f) => f.customerId === actor.id && f.active,
            ).length +
            (await tx.count('discoveryReactions', { customerId: actor.id, saved: true })),
        },
        resumeCheckout: resumable[0],
        reviewBookingId: actionable[0]?.id,
        focus,
        recent,
        now: this.now(),
      };
    });
  }
  private async eligible(tx: Records, b: Booking) {
    const o = await tx.get<Offering>('offerings', b.quote.offeringId);
    return (
      b.status === 'COMPLETED' &&
      b.capturedAmount > 0 &&
      !!b.assignedListingId &&
      !!b.assignedStaffId &&
      (b.quote.regulatoryCategory ?? o?.regulatoryCategory) === 'RELAXATION'
    );
  }
  private async publicView(tx: Records, r: ExperienceReview): Promise<PublicExperience> {
    const reply = await tx.get<ExperienceReply>('experienceReplies', r.id),
      live = await available(tx, r.listingId);
    return {
      id: r.id,
      storeId: r.storeId,
      ...(live ? { listingId: r.listingId } : {}),
      serviceName: r.serviceName,
      scores: r.scores,
      text: r.text,
      createdAt: r.publishedAt ?? r.createdAt,
      ...(reply?.status === 'APPROVED' && reply.reviewRevision === r.revision
        ? { reply: { text: reply.text, at: reply.updatedAt } }
        : {}),
    };
  }
  async customerExperience(actor: Actor, bookingId: string): Promise<CustomerExperience> {
    return this.run(async (tx) => {
      const b = await this.ownBooking(tx, actor, bookingId),
        r = (await tx.list<ExperienceReview>('experienceReviews')).find(
          (r) => r.bookingId === b.id,
        );
      const listingId = b.assignedListingId ?? b.selectedStaffListingId;
      let review: CustomerExperience['review'];
      if (r) {
        const { customerId: _c, merchantId: _m, staffId: _s, ...rest } = r;
        review = rest;
      }
      return {
        eligible: await this.eligible(tx, b),
        review,
        reply: r?.status === 'APPROVED' ? (await this.publicView(tx, r)).reply : undefined,
        listingId,
        canFavorite: !!listingId && !!(await available(tx, listingId)),
      };
    });
  }
  async saveReview(actor: Actor, bookingId: string, input: unknown) {
    const d = z
      .object({ version: z.number().int().nonnegative(), scores, text })
      .strict()
      .parse(input);
    cleanText(d.text);
    return this.run(async (tx) => {
      const b = await this.ownBooking(tx, actor, bookingId);
      ensure(
        await this.eligible(tx, b),
        'REVIEW_NOT_ELIGIBLE',
        'Only a completed visit with a recorded charge can be reviewed.',
        409,
      );
      const old = (await tx.list<ExperienceReview>('experienceReviews')).find(
        (r) => r.bookingId === b.id,
      );
      ensure(
        (old?.version ?? 0) === d.version,
        'VERSION_CONFLICT',
        'Refresh the review before changing it.',
        409,
      );
      const offering = await tx.get<Offering>('offerings', b.quote.offeringId);
      const r: ExperienceReview = {
        id: old?.id ?? uid('review'),
        bookingId: b.id,
        customerId: actor.id,
        merchantId: b.merchantId,
        storeId: b.storeId,
        listingId: b.assignedListingId!,
        staffId: b.assignedStaffId!,
        serviceName: old?.serviceName ??
          b.quote.serviceName ??
          offering?.name ?? { ja: 'サービス', en: 'Service', 'zh-cn': '服务' },
        scores: d.scores,
        text: d.text,
        status: 'PENDING',
        version: (old?.version ?? 0) + 1,
        revision: (old?.revision ?? 0) + 1,
        createdAt: old?.createdAt ?? this.now(),
        updatedAt: this.now(),
      };
      await tx.put('experienceReviews', r);
      await tx.put('experienceRevisions', { ...r, id: `${r.id}:${r.revision}`, reviewId: r.id });
      for (const appeal of await tx.list<ExperienceAppeal>('experienceAppeals'))
        if (appeal.reviewId === r.id && appeal.status === 'OPEN')
          await tx.put('experienceAppeals', {
            ...appeal,
            status: 'STALE',
            version: appeal.version + 1,
            resolvedAt: this.now(),
          });
      await log(tx, actor, 'EXPERIENCE_SUBMITTED', r.id, this.now());
      return { id: r.id, version: r.version, status: r.status };
    });
  }
  async withdraw(actor: Actor, reviewId: string, input: unknown) {
    const d = z.object({ version: z.number().int().positive() }).strict().parse(input);
    this.customer(actor);
    return this.run(async (tx) => {
      const r = await tx.get<ExperienceReview>('experienceReviews', reviewId);
      ensure(r && r.customerId === actor.id, 'NOT_FOUND', 'Review not found.', 404);
      ensure(r.version === d.version, 'VERSION_CONFLICT', 'Refresh the review.', 409);
      ensure(
        r.status !== 'WITHDRAWN',
        'INVALID_STATE',
        'This review has already been withdrawn.',
        409,
      );
      r.status = 'WITHDRAWN';
      r.version++;
      r.updatedAt = this.now();
      await tx.put('experienceReviews', r);
      for (const a of await tx.list<ExperienceAppeal>('experienceAppeals'))
        if (a.reviewId === r.id && a.status === 'OPEN')
          await tx.put('experienceAppeals', {
            ...a,
            status: 'STALE',
            version: a.version + 1,
            resolvedAt: this.now(),
          });
      await log(tx, actor, 'EXPERIENCE_WITHDRAWN', r.id, this.now());
      return { id: r.id, version: r.version, status: r.status };
    });
  }
  async favorites(actor: Actor): Promise<FavoriteItem[]> {
    this.customer(actor);
    return this.run(async (tx) => {
      const rows: FavoriteItem[] = [];
      for (const f of (await tx.list<FavoriteRecord>('favorites'))
        .filter((f) => f.customerId === actor.id && f.active)
        .sort((a, b) => b.updatedAt - a.updatedAt)) {
        const live = await available(tx, f.listingId);
        const store = live ? toPublicStore(live.store) : null;
        rows.push({
          listingId: f.listingId,
          version: f.version,
          available: !!live,
          createdAt: f.createdAt,
          listing: live ? toPublicListing(live.listing) : null,
          store,
          offerings: live?.offerings ?? [],
        });
      }
      return rows;
    });
  }
  async favoriteState(actor: Actor, listingId: string) {
    this.customer(actor);
    return this.run(async (tx) => {
      const f = (await tx.list<FavoriteRecord>('favorites')).find(
        (f) => f.customerId === actor.id && f.listingId === listingId,
      );
      return { active: f?.active ?? false, version: f?.version ?? 0 };
    });
  }
  async favorite(actor: Actor, listingId: string, input: unknown) {
    this.customer(actor);
    const d = z
      .object({ version: z.number().int().nonnegative(), active: z.boolean() })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const id = createHash('sha256').update(`${actor.id}:${listingId}`).digest('hex'),
        old = await tx.get<FavoriteRecord>('favorites', id);
      ensure((old?.version ?? 0) === d.version, 'VERSION_CONFLICT', 'Refresh your favorites.', 409);
      const live = d.active ? await available(tx, listingId) : undefined;
      ensure(!d.active || live, 'LISTING_UNAVAILABLE', 'This profile is no longer available.', 409);
      ensure(d.active || old, 'NOT_FOUND', 'Favorite not found.', 404);
      ensure(
        !d.active ||
          old?.active ||
          (await tx.list<FavoriteRecord>('favorites')).filter(
            (f) => f.customerId === actor.id && f.active,
          ).length < 100,
        'FAVORITE_LIMIT',
        'You can save up to 100 profiles.',
        409,
      );
      const f: FavoriteRecord = {
        id,
        customerId: actor.id,
        listingId,
        storeId: live?.store.id ?? old!.storeId,
        active: d.active,
        version: (old?.version ?? 0) + 1,
        createdAt: old?.createdAt ?? this.now(),
        updatedAt: this.now(),
      };
      await tx.put('favorites', f);
      return { active: f.active, version: f.version };
    });
  }
  async rebook(actor: Actor, bookingId: string) {
    return this.run(async (tx) => {
      const b = await this.ownBooking(tx, actor, bookingId);
      ensure(
        ['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status),
        'INVALID_STATE',
        'The current reservation is still active.',
        409,
      );
      const target = b.assignedListingId ?? b.selectedStaffListingId;
      let live = target ? await available(tx, target) : undefined;
      if (
        b.quote.nominationType === 'FREE' &&
        (!live || !live.offerings.some((o) => o.id === b.quote.offeringId))
      )
        for (const l of await tx.list<Listing>('listings')) {
          if (l.storeId !== b.storeId) continue;
          const next = await available(tx, l.id);
          if (
            next?.offerings.some((o) => o.id === b.quote.offeringId) &&
            (!b.quote.requiredLanguage || next.listing.languages.includes(b.quote.requiredLanguage))
          ) {
            live = next;
            break;
          }
        }
      ensure(
        live &&
          live.store.id === b.storeId &&
          live.offerings.some((o) => o.id === b.quote.offeringId) &&
          (!b.quote.requiredLanguage || live.listing.languages.includes(b.quote.requiredLanguage)),
        'REBOOK_UNAVAILABLE',
        'This shop, therapist or service is unavailable. Select a current service.',
        409,
      );
      const o = live.offerings.find((o) => o.id === b.quote.offeringId)!;
      const inStore = fulfillmentMode(b.quote) === 'IN_STORE';
      ensure(
        fulfillmentMode(o) === fulfillmentMode(b.quote) &&
          listingSupports(live.listing, fulfillmentMode(b.quote)) &&
          (inStore ? venueAvailable(live.store) : live.store.homeVisitsEnabled !== false),
        'REBOOK_UNAVAILABLE',
        'This service mode is no longer available.',
        409,
      );
      const area = live.store.areas.includes(b.quote.area) ? b.quote.area : live.store.areas[0];
      return {
        listingSlug: live.listing.slug,
        storeSlug: live.store.slug,
        offeringId: o.id,
        nominationType: b.quote.nominationType,
        bookingMode: 'SCHEDULED',
        ...(inStore ? { fulfillmentMode: 'IN_STORE' as const } : {}),
        area,
        language: b.quote.requiredLanguage,
        priceChanged:
          effectiveServicePrice(o, this.now()).price !== b.quote.serviceFee ||
          travelFeeFor(o, effectiveBookingRules(live.store), area) !== b.quote.transportFee ||
          o.version !== b.quote.offeringVersion,
      };
    });
  }
  async publicReviews(filter: {
    storeId?: string;
    listingId?: string;
    cursor?: string;
  }): Promise<PublicExperiencePage> {
    return this.run(async (tx) => {
      ensure(
        !!filter.storeId !== !!filter.listingId,
        'INVALID_INPUT',
        'Select a shop or therapist.',
      );
      let storeId = filter.storeId;
      if (filter.listingId) {
        const live = await available(tx, filter.listingId);
        ensure(live, 'NOT_FOUND', 'Profile not found.', 404);
        storeId = live.store.id;
      }
      const s = await tx.get<Store>('stores', storeId!);
      ensure(s?.active && s.approved && s.pspAccount, 'NOT_FOUND', 'Shop not found.', 404);
      const rows = (await tx.list<ExperienceReview>('experienceReviews'))
        .filter(
          (r) =>
            r.status === 'APPROVED' &&
            r.storeId === storeId &&
            (!filter.listingId || r.listingId === filter.listingId),
        )
        .sort(
          (a, b) =>
            (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt) ||
            a.id.localeCompare(b.id),
        );
      const index = filter.cursor ? rows.findIndex((r) => r.id === filter.cursor) + 1 : 0;
      ensure(!filter.cursor || index > 0, 'INVALID_CURSOR', 'Refresh the review list.', 409);
      const page = rows.slice(index, index + 6);
      const items: PublicExperience[] = [];
      for (const r of page) items.push(await this.publicView(tx, r));
      return {
        items,
        summary: summarizeExperiences(rows),
        nextCursor: index + page.length < rows.length ? page.at(-1)!.id : null,
      };
    });
  }
  async merchant(actor: Actor) {
    ensure(actor.role === 'MERCHANT' && actor.storeId, 'FORBIDDEN', 'Shop account required.', 403);
    return this.run(async (tx) => {
      const reviews = (await tx.list<ExperienceReview>('experienceReviews'))
          .filter((r) => r.storeId === actor.storeId && r.status === 'APPROVED')
          .sort((a, b) => b.updatedAt - a.updatedAt),
        items: MerchantExperienceRow[] = [];
      const appeals = await tx.list<ExperienceAppeal>('experienceAppeals');
      for (const r of reviews)
        items.push({
          review: await this.publicView(tx, r),
          version: r.version,
          revision: r.revision,
          reply: await tx.get<ExperienceReply>('experienceReplies', r.id),
          appeal: appeals
            .filter((a) => a.reviewId === r.id && a.reviewRevision === r.revision)
            .sort((a, b) => b.createdAt - a.createdAt)[0],
        });
      return { items, summary: summarizeExperiences(reviews) };
    });
  }
  async staff(actor: Actor) {
    return this.run(async (tx) => {
      ensure(
        await activeStaffMembership(tx, actor),
        'FORBIDDEN',
        'An active staff membership is required.',
        403,
      );
      const rows = (await tx.list<ExperienceReview>('experienceReviews'))
          .filter(
            (r) =>
              r.storeId === actor.storeId && r.staffId === actor.staffId && r.status === 'APPROVED',
          )
          .sort((a, b) => b.updatedAt - a.updatedAt),
        items: PublicExperience[] = [];
      for (const r of rows.slice(0, 30)) items.push(await this.publicView(tx, r));
      return { items, summary: summarizeExperiences(rows) };
    });
  }
  async reply(actor: Actor, reviewId: string, input: unknown) {
    ensure(actor.role === 'MERCHANT' && actor.storeId, 'FORBIDDEN', 'Shop account required.', 403);
    const d = z
      .object({
        version: z.number().int().nonnegative(),
        reviewVersion: z.number().int().positive(),
        text: text.min(5),
      })
      .strict()
      .parse(input);
    cleanText(d.text);
    return this.run(async (tx) => {
      const r = await tx.get<ExperienceReview>('experienceReviews', reviewId);
      ensure(
        r && r.storeId === actor.storeId && r.status === 'APPROVED',
        'NOT_FOUND',
        'Published review not found.',
        404,
      );
      ensure(
        r.version === d.reviewVersion,
        'VERSION_CONFLICT',
        'The review changed. Refresh before replying.',
        409,
      );
      const old = await tx.get<ExperienceReply>('experienceReplies', r.id);
      ensure(
        (old?.version ?? 0) === d.version,
        'VERSION_CONFLICT',
        'The reply changed. Refresh before editing.',
        409,
      );
      const reply: ExperienceReply = {
        id: r.id,
        reviewId: r.id,
        storeId: r.storeId,
        reviewRevision: r.revision,
        text: d.text,
        status: 'PENDING',
        version: (old?.version ?? 0) + 1,
        createdAt: old?.createdAt ?? this.now(),
        updatedAt: this.now(),
      };
      await tx.put('experienceReplies', reply);
      await tx.put('experienceReplyRevisions', {
        ...reply,
        id: `${reply.id}:${reply.version}`,
        replyId: reply.id,
      });
      await log(tx, actor, 'EXPERIENCE_REPLY_SUBMITTED', reply.id, this.now());
      return reply;
    });
  }
  async appeal(actor: Actor, reviewId: string, input: unknown) {
    ensure(actor.role === 'MERCHANT' && actor.storeId, 'FORBIDDEN', 'Shop account required.', 403);
    const d = z
      .object({
        reviewVersion: z.number().int().positive(),
        reason: z.string().trim().min(10).max(500),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const r = await tx.get<ExperienceReview>('experienceReviews', reviewId);
      ensure(
        r && r.storeId === actor.storeId && r.status === 'APPROVED',
        'NOT_FOUND',
        'Published review not found.',
        404,
      );
      ensure(r.version === d.reviewVersion, 'VERSION_CONFLICT', 'The review changed.', 409);
      ensure(
        !(await tx.list<ExperienceAppeal>('experienceAppeals')).some(
          (a) => a.reviewId === r.id && a.reviewRevision === r.revision,
        ),
        'APPEAL_EXISTS',
        'An appeal has already been submitted for this revision.',
        409,
      );
      const a: ExperienceAppeal = {
        id: uid('review_appeal'),
        reviewId: r.id,
        reviewRevision: r.revision,
        storeId: r.storeId,
        reason: d.reason,
        status: 'OPEN',
        version: 1,
        createdAt: this.now(),
      };
      await tx.put('experienceAppeals', a);
      await log(tx, actor, 'EXPERIENCE_APPEALED', a.id, this.now());
      return a;
    });
  }
  async moderation(actor: Actor) {
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'supply.write');
      const reviews = await tx.list<ExperienceReview>('experienceReviews'),
        replies = await tx.list<ExperienceReply>('experienceReplies'),
        appeals = await tx.list<ExperienceAppeal>('experienceAppeals'),
        stores = await tx.list<Store>('stores'),
        items: ExperienceModerationItem[] = [];
      for (const r of reviews) {
        const base = {
          reviewId: r.id,
          scores: r.scores,
          serviceName: r.serviceName,
          storeName: stores.find((s) => s.id === r.storeId)?.name ?? {
            ja: '店舗',
            en: 'Shop',
            'zh-cn': '店铺',
          },
        };
        if (r.status === 'PENDING')
          items.push({
            ...base,
            type: 'REVIEW',
            id: r.id,
            version: r.version,
            text: r.text,
            status: r.status,
            createdAt: r.updatedAt,
          });
        const reply = replies.find((x) => x.reviewId === r.id);
        if (
          r.status === 'APPROVED' &&
          reply?.status === 'PENDING' &&
          reply.reviewRevision === r.revision
        )
          items.push({
            ...base,
            type: 'REPLY',
            id: reply.id,
            version: reply.version,
            text: reply.text,
            reviewText: r.text,
            status: reply.status,
            createdAt: reply.updatedAt,
          });
        for (const a of appeals.filter(
          (a) => a.reviewId === r.id && a.reviewRevision === r.revision,
        ))
          items.push({
            ...base,
            type: 'APPEAL',
            id: a.id,
            version: a.version,
            text: a.reason,
            reviewText: r.text,
            status: a.status,
            createdAt: a.createdAt,
          });
      }
      return {
        items: items.sort((a, b) => a.createdAt - b.createdAt),
        history: (await tx.list<ExperienceModerationLog>('experienceModeration'))
          .sort((a, b) => b.at - a.at)
          .slice(0, 50),
      };
    });
  }
  async moderate(actor: Actor, kind: string, targetId: string, input: unknown) {
    const d = z
      .object({
        version: z.number().int().positive(),
        decision: z.enum(['APPROVE', 'REJECT', 'UPHOLD', 'REMOVE']),
        reason: z.string().trim().min(10).max(500),
        checks: z
          .object({
            privacy: z.boolean(),
            appearance: z.boolean(),
            claims: z.boolean(),
            relevance: z.boolean(),
          })
          .strict(),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'supply.write');
      ensure(
        ['REVIEW', 'REPLY', 'APPEAL'].includes(kind),
        'INVALID_INPUT',
        'Select a review item.',
      );
      if (kind === 'APPEAL') {
        ensure(
          Object.values(d.checks).every(Boolean),
          'REVIEW_CHECKS_REQUIRED',
          'Complete all appeal review checks.',
        );
        ensure(
          ['UPHOLD', 'REMOVE'].includes(d.decision),
          'INVALID_STATE',
          'Choose an appeal outcome.',
          409,
        );
        const a = await tx.get<ExperienceAppeal>('experienceAppeals', targetId),
          r = a && (await tx.get<ExperienceReview>('experienceReviews', a.reviewId));
        ensure(a && r, 'NOT_FOUND', 'Appeal not found.', 404);
        ensure(a.version === d.version, 'VERSION_CONFLICT', 'The appeal changed.', 409);
        ensure(
          a.status === 'OPEN' && a.reviewRevision === r.revision && r.status === 'APPROVED',
          'INVALID_STATE',
          'This appeal is no longer open.',
          409,
        );
        a.status = d.decision === 'REMOVE' ? 'REMOVED' : 'UPHELD';
        a.version++;
        a.feedback = d.reason;
        a.resolvedAt = this.now();
        if (d.decision === 'REMOVE') {
          r.status = 'REMOVED';
          r.version++;
          r.feedback = d.reason;
          r.updatedAt = this.now();
          await tx.put('experienceReviews', r);
        }
        await tx.put('experienceAppeals', a);
      } else {
        ensure(
          ['APPROVE', 'REJECT'].includes(d.decision),
          'INVALID_STATE',
          'Choose a content review outcome.',
          409,
        );
        const record =
          kind === 'REVIEW'
            ? await tx.get<ExperienceReview>('experienceReviews', targetId)
            : await tx.get<ExperienceReply>('experienceReplies', targetId);
        ensure(record, 'NOT_FOUND', 'Review item not found.', 404);
        ensure(record.version === d.version, 'VERSION_CONFLICT', 'The review item changed.', 409);
        ensure(
          record.status === 'PENDING',
          'INVALID_STATE',
          'This item has already been reviewed.',
          409,
        );
        if (kind === 'REPLY') {
          const reply = record as ExperienceReply,
            r = await tx.get<ExperienceReview>('experienceReviews', reply.reviewId);
          ensure(
            r?.status === 'APPROVED' && r.revision === reply.reviewRevision,
            'INVALID_STATE',
            'The underlying review changed.',
            409,
          );
        }
        if (d.decision === 'APPROVE')
          ensure(
            Object.values(d.checks).every(Boolean),
            'REVIEW_CHECKS_REQUIRED',
            'Complete all publication checks.',
          );
        record.status = d.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        record.version++;
        record.updatedAt = this.now();
        record.feedback = d.reason;
        if (kind === 'REVIEW' && d.decision === 'APPROVE')
          (record as ExperienceReview).publishedAt = this.now();
        await tx.put(kind === 'REVIEW' ? 'experienceReviews' : 'experienceReplies', record);
      }
      await tx.put<ExperienceModerationLog>('experienceModeration', {
        id: uid('experience_moderation'),
        targetType: kind,
        targetId,
        actorId: actor.id,
        decision: d.decision,
        reason: d.reason,
        at: this.now(),
      });
      await log(tx, actor, `EXPERIENCE_${kind}_${d.decision}`, targetId, this.now());
      return { ok: true };
    });
  }
}
