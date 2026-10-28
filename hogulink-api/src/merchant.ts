import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { acceptanceScopeInput, fulfillmentMode, type AcceptanceRule } from '@hogulink/contracts';
import {
  makeCancellationPolicy,
  storeBookingRulesInput,
  promotionInput,
  promotionPriceFloor,
  comparisonEligibility,
  PROMOTION_RULES,
  type BookingRulesHistory,
  type OfferingPromotion,
} from '@hogulink/contracts';
import { effectiveBookingRules } from './booking-rules.js';
import type {
  Actor,
  Audit,
  Booking,
  Listing,
  Offering,
  Store,
  StoreBookingRules,
  SafetyEvent,
  ExperienceReview,
  ExperienceReply,
  TimeOffRequest,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { ensure } from './errors.js';
import { config } from './config.js';
import { timeOffHistory } from './staff.js';
import { closedPromotionHistory as closedHistory } from './promotion-history.js';

export type TimeBlock = {
  id: string;
  storeId: string;
  listingId: string;
  staffId: string;
  startAt: number;
  endAt: number;
  reason: 'BREAK' | 'TIME_OFF' | 'TRAINING';
  active: boolean;
  version: number;
  createdAt: number;
};
export class MerchantService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private async shop(tx: Records, actor: Actor) {
    ensure(actor.role === 'MERCHANT' && actor.storeId, 'FORBIDDEN', 'Shop account required.', 403);
    const store = await tx.get<Store>('stores', actor.storeId);
    ensure(store, 'NOT_FOUND', 'Shop not found.', 404);
    return store;
  }
  private async audit(tx: Records, actor: Actor, action: string, target: string) {
    await tx.put<Audit>('audit', {
      id: randomUUID(),
      actorId: actor.id,
      actorRole: actor.role,
      action,
      detail: target,
      at: this.now(),
    });
  }
  async snapshot(actor: Actor) {
    return this.run(async (tx) => {
      const { pspAccount: _account, ...store } = await this.shop(tx, actor);
      const orders = await tx.find<Booking>('bookings', { storeId: store.id });
      const feeEntries = (
        await tx.list<{
          id: string;
          storeId: string;
          bookingId: string;
          amount: number;
          type: string;
          createdAt?: number;
        }>('feeEntries')
      )
        .filter((f) => f.storeId === store.id)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      const captured = orders.reduce((n, b) => n + b.capturedAmount, 0),
        refunded = orders.reduce((n, b) => n + b.refundedAmount, 0),
        platform = feeEntries.reduce((n, f) => n + f.amount, 0);
      const reviews = await tx.find<ExperienceReview>('experienceReviews', {
        storeId: store.id,
        status: 'APPROVED',
      });
      const replies = await tx.find<ExperienceReply>('experienceReplies', { storeId: store.id });
      return {
        unrepliedReviews: reviews.filter(
          (r) =>
            !replies.some(
              (reply) =>
                reply.reviewId === r.id &&
                reply.reviewRevision === r.revision &&
                ['PENDING', 'APPROVED'].includes(reply.status),
            ),
        ).length,
        store,
        bookingRules: effectiveBookingRules(store),
        bookingRulesHistory: (await tx.list<BookingRulesHistory>('bookingRulesHistory'))
          .filter((r) => r.storeId === store.id)
          .sort((a, b) => b.version - a.version)
          .slice(0, 5),
        acceptanceHistory: (
          await tx.list<AcceptanceRule & { id: string; storeId: string }>('acceptanceRules')
        )
          .filter((r) => r.storeId === store.id)
          .sort((a, b) => b.version - a.version)
          .slice(0, 5),
        timeOffRequests: timeOffHistory(
          (await tx.list<TimeOffRequest>('timeOffRequests')).filter((r) => r.storeId === store.id),
        ),
        billingRates: { TRIAL: 0, STANDARD: config.standardFeeBps, ANNUAL: config.annualFeeBps },
        totals: {
          captured,
          refunded,
          net: captured - refunded,
          platform,
          afterFees: captured - refunded - platform,
        },
        listings: (await tx.list<Listing>('listings')).filter((x) => x.storeId === store.id),
        offerings: (await tx.list<Offering>('offerings'))
          .filter((x) => x.storeId === store.id)
          .sort((a, b) => a.durationMinutes - b.durationMinutes),
        blocks: (await tx.list<TimeBlock>('timeBlocks'))
          .filter((x) => x.storeId === store.id && x.active && x.endAt > this.now())
          .sort((a, b) => a.startAt - b.startAt),
        feeEntries,
      };
    });
  }
  /** Pauses only new intake; existing orders and platform restrictions are untouched. */
  async intake(actor: Actor, input: unknown) {
    const d = z
      .object({ version: z.number().int().nonnegative(), paused: z.boolean() })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor);
      ensure(
        (store.intakeVersion ?? 0) === d.version,
        'VERSION_CONFLICT',
        'Intake status changed. Refresh first.',
        409,
      );
      const next = { ...store, intakePaused: d.paused, intakeVersion: d.version + 1 };
      await tx.put('stores', next);
      await this.audit(
        tx,
        actor,
        d.paused ? 'SHOP_INTAKE_PAUSED' : 'SHOP_INTAKE_RESUMED',
        store.id,
      );
      return { paused: next.intakePaused, version: next.intakeVersion };
    });
  }
  async safetyContact(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({ version: z.number().int().positive(), note: z.string().trim().min(10).max(500) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        event = await tx.get<SafetyEvent>('safety', id);
      ensure(event?.storeId === store.id, 'NOT_FOUND', 'Safety event not found.', 404);
      ensure((event.version ?? 1) === d.version, 'VERSION_CONFLICT', 'Safety event changed.', 409);
      ensure(event.status === 'OPEN', 'INVALID_STATE', 'Safety event is closed.', 409);
      event.merchantContact = { at: this.now(), note: d.note };
      event.version = (event.version ?? 1) + 1;
      await tx.put('safety', event);
      await this.audit(tx, actor, 'SAFETY_SHOP_CONTACT_RECORDED', id);
      return { version: event.version };
    });
  }
  async block(actor: Actor, input: unknown, key: string) {
    const data = z
      .object({
        listingId: z.string(),
        startAt: z.number().int(),
        endAt: z.number().int(),
        reason: z.enum(['BREAK', 'TIME_OFF', 'TRAINING']),
      })
      .strict()
      .parse(input);
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor);
      const listing = await tx.get<Listing>('listings', data.listingId);
      ensure(
        listing?.storeId === store.id && listing.membershipActive,
        'NOT_FOUND',
        'Team member not found.',
        404,
      );
      const id = createHash('sha256').update(`${store.id}:${key}`).digest('hex');
      const prior = await tx.get<TimeBlock>('timeBlocks', id);
      if (prior) {
        ensure(
          prior.listingId === data.listingId &&
            prior.startAt === data.startAt &&
            prior.endAt === data.endAt &&
            prior.reason === data.reason,
          'IDEMPOTENCY_CONFLICT',
          'This retry key has different input.',
          409,
        );
        return prior;
      }
      ensure(
        data.startAt >= this.now() &&
          data.startAt < this.now() + 90 * 86400_000 &&
          data.endAt > data.startAt &&
          data.endAt - data.startAt <= 14 * 86400_000,
        'INVALID_TIME',
        'Choose a future period of up to 14 days within 90 days.',
      );
      ensure(
        !(await tx.conflicts(listing.staffId, data.startAt, data.endAt)),
        'SLOT_CONFLICT',
        'This period overlaps a booking, travel buffer, or blocked time.',
        409,
      );
      const block: TimeBlock = {
        id,
        storeId: store.id,
        staffId: listing.staffId,
        ...data,
        active: true,
        version: 1,
        createdAt: this.now(),
      };
      await tx.interval({
        id: `block:${id}`,
        staffId: block.staffId,
        startAt: block.startAt,
        endAt: block.endAt,
        expiresAt: block.endAt,
      });
      await tx.put('timeBlocks', block);
      await this.audit(tx, actor, 'TEAM_TIME_BLOCKED', id);
      return block;
    });
  }
  async releaseBlock(actor: Actor, id: string, input: unknown) {
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        block = await tx.get<TimeBlock>('timeBlocks', id);
      ensure(block?.storeId === store.id, 'NOT_FOUND', 'Blocked time not found.', 404);
      ensure(
        block.version === version,
        'VERSION_CONFLICT',
        'This record changed. Refresh first.',
        409,
      );
      await tx.releaseInterval(`block:${id}`);
      const next = { ...block, active: false, version: block.version + 1 };
      await tx.put('timeBlocks', next);
      await this.audit(tx, actor, 'TEAM_TIME_RELEASED', id);
      return next;
    });
  }
  async service(actor: Actor, id: string, input: unknown) {
    const data = z
      .object({
        version: z.number().int().positive(),
        price: z.number().int().min(1000).max(200000),
        transportFee: z.number().int().min(0).max(20000),
        active: z.boolean(),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        service = await tx.get<Offering>('offerings', id);
      ensure(service?.storeId === store.id, 'NOT_FOUND', 'Service not found.', 404);
      ensure(
        service.version === data.version,
        'VERSION_CONFLICT',
        'This service changed. Refresh first.',
        409,
      );
      ensure(
        service.approved && service.regulatoryCategory === 'RELAXATION',
        'FORBIDDEN',
        'Only approved relaxation services can be edited.',
        403,
      );
      if (
        service.price === data.price &&
        service.transportFee === data.transportFee &&
        (service.active !== false) === data.active
      )
        return service;
      const priceChanged = service.price !== data.price;
      ensure(
        fulfillmentMode(service) !== 'IN_STORE' || data.transportFee === 0,
        'INVALID_TRANSPORT_FEE',
        'In-store services have no travel fee.',
      );
      const next: Offering = {
        ...service,
        ...data,
        version: service.version + 1,
        // A new regular price restarts the comparison clock and ends any promotion.
        ...(priceChanged ? { priceSince: this.now(), promotion: undefined } : {}),
        promotionHistory:
          priceChanged && service.promotion
            ? closedHistory(service, this.now())
            : service.promotionHistory,
      };
      await tx.put('offerings', next);
      await this.audit(tx, actor, 'SERVICE_PRICING_UPDATED', id);
      return next;
    });
  }
  /** Set or replace a time-limited shop promotion on one approved service. */
  async promotion(actor: Actor, id: string, input: unknown) {
    const data = promotionInput.parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        service = await tx.get<Offering>('offerings', id);
      ensure(service?.storeId === store.id, 'NOT_FOUND', 'Service not found.', 404);
      ensure(
        service.version === data.version,
        'VERSION_CONFLICT',
        'This service changed. Refresh first.',
        409,
      );
      ensure(
        service.approved && service.active !== false && service.regulatoryCategory === 'RELAXATION',
        'FORBIDDEN',
        'Only active approved relaxation services can run a promotion.',
        403,
      );
      const now = this.now(),
        day = 86_400_000;
      ensure(
        data.price < service.price && data.price >= promotionPriceFloor(service.price),
        'INVALID_PROMOTION',
        `The promotion price must be below the regular price and at least ${Math.round(PROMOTION_RULES.minPriceRatio * 100)}% of it.`,
      );
      ensure(
        data.startsAt >= now - 60_000 &&
          data.startsAt <= now + PROMOTION_RULES.maxLeadDays * day &&
          data.endsAt >= data.startsAt + 3_600_000 &&
          data.endsAt - data.startsAt <= PROMOTION_RULES.maxDays * day,
        'INVALID_PROMOTION',
        `A promotion starts within ${PROMOTION_RULES.maxLeadDays} days and lasts between 1 hour and ${PROMOTION_RULES.maxDays} days.`,
      );
      const history = closedHistory(service, now);
      const window = { startsAt: Math.max(data.startsAt, now), endsAt: data.endsAt };
      const reason = comparisonEligibility(window, service.priceSince, history);
      const promotion: OfferingPromotion = {
        id: randomUUID(),
        price: data.price,
        regularPrice: service.price,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        createdAt: now,
        comparisonAllowed: reason === 'ELIGIBLE',
        comparisonReason: reason,
      };
      const next: Offering = {
        ...service,
        promotion,
        promotionHistory: history,
        version: service.version + 1,
      };
      await tx.put('offerings', next);
      await this.audit(tx, actor, 'SERVICE_PROMOTION_SET', `${id}:${data.price}`);
      return next;
    });
  }
  async clearPromotion(actor: Actor, id: string, input: unknown) {
    const data = z.object({ version: z.number().int().positive() }).strict().parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor),
        service = await tx.get<Offering>('offerings', id);
      ensure(service?.storeId === store.id, 'NOT_FOUND', 'Service not found.', 404);
      ensure(
        service.version === data.version,
        'VERSION_CONFLICT',
        'This service changed. Refresh first.',
        409,
      );
      if (!service.promotion) return service;
      const next: Offering = {
        ...service,
        promotion: undefined,
        promotionHistory: closedHistory(service, this.now()),
        version: service.version + 1,
      };
      await tx.put('offerings', next);
      await this.audit(tx, actor, 'SERVICE_PROMOTION_ENDED', id);
      return next;
    });
  }
  async settings(actor: Actor, input: unknown) {
    const data = z
      .object({
        version: z.number().int().positive(),
        acceptanceMode: z.enum(['MANUAL', 'AUTO_PREAUTHORIZED', 'SOLO']),
        emergencyContact: z.string().trim().min(5).max(120),
        acceptanceRule: acceptanceScopeInput.optional(),
        confirmAuthorization: z.boolean().optional(),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor);
      ensure(
        store.ruleVersion === data.version,
        'VERSION_CONFLICT',
        'Shop rules changed. Refresh first.',
        409,
      );
      ensure(
        store.acceptanceMode === 'SOLO'
          ? data.acceptanceMode === 'SOLO'
          : data.acceptanceMode !== 'SOLO',
        'INVALID_STATE',
        'Solo ownership requires a separate review.',
        409,
      );
      if (data.acceptanceRule) {
        ensure(
          store.acceptanceMode !== 'SOLO',
          'INVALID_STATE',
          'SOLO uses owner acceptance.',
          409,
        );
        const offerings = (await tx.list<Offering>('offerings')).filter(
          (o) =>
            o.storeId === store.id &&
            (!data.acceptanceRule!.active ||
              (o.approved && o.active !== false && o.regulatoryCategory === 'RELAXATION')),
        );
        const listings = (await tx.list<Listing>('listings')).filter(
          (l) =>
            l.storeId === store.id &&
            (!data.acceptanceRule!.active ||
              (l.membershipActive &&
                l.identityVerified &&
                l.portraitConsent &&
                l.publicationStatus === 'PUBLISHED_INDEXABLE')),
        );
        ensure(
          data.acceptanceRule.offeringIds.every((id) => offerings.some((o) => o.id === id)) &&
            data.acceptanceRule.listingIds.every((id) => listings.some((l) => l.id === id)) &&
            data.acceptanceRule.areas.every((area) => store.areas.includes(area)),
          'INVALID_ACCEPTANCE_SCOPE',
          'Choose approved services, team members and areas from this shop.',
        );
      }
      const priorScope = store.acceptanceRule
        ? acceptanceScopeInput.parse(
            Object.fromEntries(
              Object.keys(acceptanceScopeInput.shape).map((key) => [
                key,
                store.acceptanceRule![key as keyof AcceptanceRule],
              ]),
            ),
          )
        : undefined;
      const changed =
        data.acceptanceRule !== undefined &&
        JSON.stringify(data.acceptanceRule) !== JSON.stringify(priorScope);
      const enabling =
        data.acceptanceMode === 'AUTO_PREAUTHORIZED' &&
        store.acceptanceMode !== 'AUTO_PREAUTHORIZED';
      if (changed || enabling)
        ensure(
          data.confirmAuthorization === true ||
            (changed && !data.acceptanceRule!.active && !enabling),
          'ACCEPTANCE_AUTHORIZATION_REQUIRED',
          'Confirm the shop authorization before enabling or changing these rules.',
        );
      if (data.acceptanceMode === 'AUTO_PREAUTHORIZED')
        ensure(
          data.acceptanceRule || store.acceptanceRule,
          'ACCEPTANCE_AUTHORIZATION_REQUIRED',
          'Define and authorize a bounded acceptance rule first.',
        );
      if (
        store.acceptanceMode === data.acceptanceMode &&
        store.emergencyContact === data.emergencyContact &&
        !changed
      ) {
        const { pspAccount: _account, ...view } = store;
        return view;
      }
      const next = {
        ...store,
        acceptanceMode: data.acceptanceMode,
        emergencyContact: data.emergencyContact,
        ruleVersion: store.ruleVersion + 1,
        acceptanceRule:
          changed || enabling
            ? {
                ...(data.acceptanceRule ?? priorScope)!,
                version: store.ruleVersion + 1,
                authorizedBy: actor.id,
                authorizedAt: this.now(),
              }
            : store.acceptanceRule,
      };
      if (changed || enabling)
        await tx.put('acceptanceRules', {
          id: `${store.id}:v${next.ruleVersion}`,
          storeId: store.id,
          ...next.acceptanceRule!,
        });
      await tx.put('stores', next);
      await this.audit(tx, actor, 'SHOP_RULES_UPDATED', store.id);
      const { pspAccount: _account, ...view } = next;
      return view;
    });
  }
  async bookingRules(actor: Actor, input: unknown) {
    const data = storeBookingRulesInput.parse(input);
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor);
      const prior = effectiveBookingRules(store);
      ensure(
        data.version === prior.version,
        'VERSION_CONFLICT',
        'Booking prices and policies changed. Refresh first.',
        409,
      );
      const policy = makeCancellationPolicy(
        data.templateId,
        `${store.id}-policy-v${prior.version + 1}`,
        data.customPolicy,
      );
      const { version: _priorVersion, ...priorPolicy } = prior.cancellationPolicy;
      const { version: _nextVersion, ...nextPolicy } = policy;
      // Omitted bands keep the current ones; an explicit empty list removes them.
      const bands = data.timeSurcharges ?? prior.timeSurcharges ?? [];
      ensure(
        !data.areaTransportFees ||
          Object.keys(data.areaTransportFees).every((area) => store.areas.includes(area)),
        'INVALID_AREA',
        'Travel fees can only be set for this shop’s own service areas.',
      );
      const sorted = (fees: Record<string, number> = {}) =>
        Object.fromEntries(Object.entries(fees).sort(([a], [b]) => a.localeCompare(b)));
      const travel = sorted(data.areaTransportFees ?? prior.areaTransportFees);
      const hours = data.businessHours ?? prior.businessHours;
      if (
        data.nominationFee === prior.nominationFee &&
        data.templateId === prior.templateId &&
        JSON.stringify(priorPolicy) === JSON.stringify(nextPolicy) &&
        JSON.stringify(bands) === JSON.stringify(prior.timeSurcharges ?? []) &&
        JSON.stringify(travel) === JSON.stringify(sorted(prior.areaTransportFees)) &&
        JSON.stringify(hours ?? null) === JSON.stringify(prior.businessHours ?? null)
      )
        return prior;
      const next: StoreBookingRules = {
        version: prior.version + 1,
        nominationFee: data.nominationFee,
        templateId: data.templateId,
        cancellationPolicy: policy,
        ...(bands.length ? { timeSurcharges: bands } : {}),
        ...(Object.keys(travel).length ? { areaTransportFees: travel } : {}),
        ...(hours ? { businessHours: hours } : {}),
      };
      // Home quotes compare `bookingRules.version`; the shop-wide version is left alone so
      // in-store checkouts, priced from the venue, are not cancelled by this change.
      await tx.put('stores', { ...store, bookingRules: next });
      await tx.put<BookingRulesHistory>('bookingRulesHistory', {
        ...next,
        id: `${store.id}:booking-rules:v${next.version}`,
        storeId: store.id,
        changedBy: actor.id,
        changedAt: this.now(),
      });
      await this.audit(
        tx,
        actor,
        'SHOP_BOOKING_PRICES_POLICY_UPDATED',
        `${store.id}:v${next.version}`,
      );
      return next;
    });
  }
}

/** Keep the days a promotion actually ran (it may be ended early), newest last, bounded. */
