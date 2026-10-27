import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  addressInput,
  bookingInput,
  quoteInput,
  automaticAcceptanceReason,
  dailyAutomaticCount,
  scheduledCancellationBps,
  IN_STORE_NO_SHOW_REPLY_MINUTES,
  effectiveServicePrice,
  timeSurchargeAt,
  travelFeeFor,
  withinBusinessHours,
  withinShifts,
  lateNight,
  fulfillmentMode,
  venueAvailable,
  venueSnapshot,
  withinVenueHours,
  venueCanServe,
  listingSupports,
  type FulfillmentMode,
  type Actor,
  type Audit,
  type Booking,
  type Hold,
  type Listing,
  type Message,
  type Offering,
  type Quote,
  type SafetyEvent,
  type Store,
  type TimeOffRequest,
  canAdmin,
  type AdminTodo,
  type SupportTicket,
  type TicketHandling,
  type ExperienceReview,
  type ExperienceReply,
  type ExperienceAppeal,
  type InvoiceRequest,
} from '@hogulink/contracts';
import { config } from './config.js';
import { VenueService } from './venues.js';
import { QualityService } from './quality.js';
import {
  availableResources,
  reserveResource,
  transitionAvailable,
  resourceKey,
} from './in-store.js';
import { toPublicStore, toPublicListing, toPublicOffering } from './public-catalog.js';
import { CustomerAuth } from './customer-auth.js';
import { NotificationWorker, configuredSender } from './notifications.js';
import { RateLimiter } from './rate-limit.js';
import { ContentReviewService, contentRuleIds, queueContentReview } from './content-review.js';
import { effectiveBookingRules } from './booking-rules.js';
import { DomainError, ensure } from './errors.js';
import { Repository, type Records } from './repository.js';
import { CareService, assertCanBook, safetyEventView } from './care.js';
import { MerchantService, type TimeBlock } from './merchant.js';
import { StaffService } from './staff.js';
import { AdminService } from './admin.js';
import { TicketHandlingService } from './ticket-handling.js';
import { EmployeeService } from './employees.js';
import { adminCaseVisible, currentAdmin, requireAdmin } from './admin-access.js';
import { staffBookingAccess } from './staff-access.js';
import { ExperienceService } from './experience.js';
import { EngagementService } from './engagement.js';
import { DiscoveryService } from './discovery.js';
import { AddressService } from './addresses.js';
import { RefundService } from './refund-requests.js';
import { CoordinationService } from './coordination.js';
import { GovernanceService } from './governance.js';
import { FinanceService, ensureMoneyOpening, recordMoney } from './finance.js';
import { SubscriptionService, sweepSubscriptions } from './subscription.js';
import { InvoicingService } from './invoicing.js';
import { ReportingService } from './reporting.js';
import { FulfillmentService, lateInstant, sweepFulfillment } from './fulfillment.js';
import { OnboardingService, requireCurrentQualifications, sweepOnboarding } from './onboarding.js';
import {
  completionCase,
  autoAcceptanceAllowed,
  completionReceipt,
  completionWindowMs,
  serviceEligibleAt,
} from './completion.js';

type Payment = {
  id: string;
  customerId: string;
  quoteId: string;
  holdId: string;
  amount: number;
  account: string;
  status: 'AUTHORIZED' | 'METHOD_SAVED' | 'PAID' | 'VOIDED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  /** Demo only: the saved method declines the pre-visit authorization. */
  demoDecline?: boolean;
  verified3ds: boolean;
  expiresAt: number;
  bookingId?: string;
  capturedAmount?: number;
  voidedAmount?: number;
  refundedAmount?: number;
};
type Idempotency = { id: string; hash: string; bookingId: string };
const terminal = new Set(['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED']);
const activeBookingStatuses = [
  'REQUESTED',
  'ACCEPTED',
  'CONFIRMED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_SERVICE',
  'AWAITING_COMPLETION',
];
const minute = 60_000;
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
/** A scheduled visit may not start before the booked time; an instant one starts on arrival. */
const startedOnTime = (b: Booking) =>
  b.startedAt !== undefined &&
  (b.quote.bookingMode === 'INSTANT' || b.startedAt >= b.quote.startAt);
/** Days of times a scheduled list may cover; quotes themselves accept up to 30 days. */
export const MAX_AVAILABILITY_DAYS = 14;
/** Remembers record lookups for one read-only scan, so a multi-day time list reads each once. */
function rememberReads(tx: Records): Records {
  const seen = new Map<string, Promise<unknown>>();
  const remember =
    (name: 'get' | 'find' | 'list') =>
    (...args: unknown[]) => {
      const key = `${name}:${JSON.stringify(args)}`;
      if (!seen.has(key))
        seen.set(key, (tx[name] as (...a: unknown[]) => Promise<unknown>)(...args));
      return seen.get(key);
    };
  return Object.assign(Object.create(tx), {
    get: remember('get'),
    find: remember('find'),
    list: remember('list'),
  });
}
export class Engine {
  readonly venues: VenueService;
  readonly customers: CustomerAuth;
  readonly notifications: NotificationWorker;
  readonly limits: RateLimiter;
  readonly contentReview: ContentReviewService;
  readonly care: CareService;
  readonly merchant: MerchantService;
  readonly staff: StaffService;
  readonly admin: AdminService;
  readonly quality: QualityService;
  readonly handling: TicketHandlingService;
  readonly employees: EmployeeService;
  readonly onboarding: OnboardingService;
  readonly experience: ExperienceService;
  readonly engagement: EngagementService;
  readonly discovery: DiscoveryService;
  readonly addresses: AddressService;
  readonly refunds: RefundService;
  readonly fulfillment: FulfillmentService;
  readonly coordination: CoordinationService;
  readonly governance: GovernanceService;
  readonly finance: FinanceService;
  readonly subscriptions: SubscriptionService;
  readonly invoicing: InvoicingService;
  readonly reporting: ReportingService;
  constructor(
    public repo: Repository,
    public now = () => Date.now(),
  ) {
    this.venues = new VenueService(
      (fn) => this.run(fn),
      now,
      (fn) => this.read(fn),
    );
    this.customers = new CustomerAuth(repo, now);
    this.notifications = new NotificationWorker(repo, configuredSender(), now);
    this.limits = new RateLimiter(repo, now);
    this.contentReview = new ContentReviewService(repo, now);
    this.care = new CareService(repo, now);
    this.merchant = new MerchantService((fn) => this.run(fn), now);
    this.staff = new StaffService((fn) => this.run(fn), now);
    this.admin = new AdminService((fn) => this.run(fn), now);
    this.quality = new QualityService((fn) => this.read(fn), now);
    this.handling = new TicketHandlingService((fn) => this.run(fn), now);
    this.employees = new EmployeeService((fn) => this.run(fn), now);
    this.onboarding = new OnboardingService((fn) => this.run(fn), now);
    this.experience = new ExperienceService((fn) => this.run(fn), now);
    this.engagement = new EngagementService((fn) => this.run(fn), now);
    this.discovery = new DiscoveryService(this);
    this.addresses = new AddressService((fn) => this.run(fn), now);
    this.refunds = new RefundService(
      (fn) => this.run(fn),
      now,
      this.care,
      (tx, actor, b, amount) => this.applyRefund(tx, actor, b, amount),
    );
    this.fulfillment = new FulfillmentService((fn) => this.run(fn), now);
    this.coordination = new CoordinationService((fn) => this.run(fn), now);
    this.governance = new GovernanceService((fn) => this.run(fn), now, this.care);
    this.finance = new FinanceService((fn) => this.run(fn), now);
    this.subscriptions = new SubscriptionService((fn) => this.run(fn), now);
    this.invoicing = new InvoicingService(
      (fn) => this.run(fn),
      now,
      (tx, id) => this.finance.rows(tx, id),
    );
    this.reporting = new ReportingService(
      (fn) => this.run(fn),
      now,
      (tx, id) => this.finance.rows(tx, id),
    );
  }
  run<T>(fn: (tx: Records) => Promise<T>) {
    return this.repo.transaction(async (tx) => {
      await this.sweep(tx);
      return fn(tx);
    });
  }
  private async read<T>(fn: (tx: Records) => Promise<T>) {
    // Background cleanup normally processes deadlines. Catch up only when an indexed deadline
    // is due, so discovery also remains correct after a stopped worker or a clock jump.
    if (await this.repo.hasDue(this.now())) await this.run(async () => {});
    return this.repo.read(fn);
  }
  private async dailyAutomaticCount(tx: Records, storeId: string, startAt: number) {
    const start = Math.floor((startAt + 9 * 3600000) / 86400000) * 86400000 - 9 * 3600000;
    const filters = { storeId, 'quote.startAt': { gte: start, lt: start + 86400000 } };
    return (
      (await tx.count('bookings', { ...filters, 'acceptanceDecision.outcome': 'AUTO_ACCEPTED' })) +
      (await tx.count('bookings', {
        ...filters,
        acceptanceDecision: null,
        merchantAcceptance: 'AUTO_ACCEPTED',
      }))
    );
  }
  private async audit(tx: Records, actor: Actor, action: string, bookingId?: string, detail = '') {
    await tx.put<Audit>('audit', {
      id: id('audit'),
      actorId: actor.id,
      action,
      bookingId,
      bookingVersion: bookingId
        ? (await tx.get<Booking>('bookings', bookingId))?.version
        : undefined,
      detail,
      at: this.now(),
    });
    await tx.put('outbox', {
      id: id('outbox'),
      type: action,
      bookingId,
      createdAt: this.now(),
      status: 'PENDING',
      delivery: 'DEMO_LOCAL_ONLY',
    });
  }
  private role(actor: Actor, ...roles: Actor['role'][]) {
    ensure(
      roles.includes(actor.role),
      'FORBIDDEN',
      'This operation is not available to this role.',
      403,
    );
  }
  private async listing(tx: Records, listingId: string, existingOrder = false) {
    const listing = await tx.get<Listing>('listings', listingId);
    const store = listing && (await tx.get<Store>('stores', listing.storeId));
    ensure(
      listing &&
        store &&
        listing.membershipActive &&
        listing.portraitConsent &&
        listing.identityVerified &&
        listing.publicationStatus === 'PUBLISHED_INDEXABLE' &&
        store.active &&
        store.approved &&
        store.pspAccount,
      'LISTING_UNAVAILABLE',
      'This listing is no longer available.',
      409,
    );
    ensure(
      existingOrder || !store.billingBlocked,
      'LISTING_UNAVAILABLE',
      'This shop is temporarily unavailable for new bookings.',
      409,
    );
    return { listing, store };
  }
  private async allowed(tx: Records, actor: Actor, storeId: string) {
    await assertCanBook(tx, actor, storeId, this.now());
  }
  private async currentQuote(tx: Records, quote: Quote) {
    const { store, listing } = await this.listing(tx, quote.listingId);
    ensure(
      quote.nominationType === 'FREE' || listingSupports(listing, fulfillmentMode(quote)),
      'LISTING_UNAVAILABLE',
      'This therapist no longer accepts this service mode.',
      409,
    );
    const offering = await tx.get<Offering>('offerings', quote.offeringId);
    ensure(
      offering && fulfillmentMode(offering) === fulfillmentMode(quote),
      'INVALID_OFFERING',
      'Service mode changed.',
      409,
    );
    if (fulfillmentMode(quote) === 'IN_STORE')
      ensure(
        venueAvailable(store) && store.venue?.version === quote.venue?.version,
        'SHOP_RULES_CHANGED',
        'Venue changed. Request a new quote.',
        409,
      );
    else
      ensure(
        store.homeVisitsEnabled !== false,
        'LISTING_UNAVAILABLE',
        'Home visits are unavailable.',
        409,
      );
    ensure(
      offering?.approved && offering.active !== false && offering.version === quote.offeringVersion,
      'PRICE_CHANGED',
      'Service pricing changed. Request a new quote.',
      409,
    );
    ensure(
      quote.storeRuleVersion === undefined || quote.storeRuleVersion === store.ruleVersion,
      'SHOP_RULES_CHANGED',
      'Shop booking rules changed. Request a new quote.',
      409,
    );
    // In-store prices and policy come from the venue, checked above by its version.
    if (fulfillmentMode(quote) === 'HOME_VISIT')
      ensure(
        (quote.bookingRulesVersion ?? 0) === effectiveBookingRules(store).version,
        'SHOP_RULES_CHANGED',
        'Shop prices or cancellation policy changed. Request a new quote.',
        409,
      );
  }
  private async getBooking(tx: Records, actor: Actor, bookingId: string, version?: number) {
    const booking = await tx.get<Booking>('bookings', bookingId);
    ensure(booking, 'NOT_FOUND', 'Booking not found.', 404);
    ensure(
      actor.role === 'ADMIN' ||
        (actor.role === 'CUSTOMER' && actor.id === booking.customerId) ||
        (actor.role === 'MERCHANT' && actor.storeId === booking.storeId) ||
        (actor.role === 'STAFF' && (await staffBookingAccess(tx, actor, booking))),
      'NOT_FOUND',
      'Booking not found.',
      404,
    );
    if (version !== undefined)
      ensure(
        version === booking.version,
        'VERSION_CONFLICT',
        'This booking has changed. Refresh and try again.',
        409,
      );
    return booking;
  }
  private async save(tx: Records, booking: Booking, actor: Actor, action: string, detail = '') {
    booking.version++;
    booking.updatedAt = this.now();
    await tx.put('bookings', booking);
    await this.audit(tx, actor, action, booking.id, detail);
    return this.redact(booking, actor);
  }
  private deadline(quote: Quote, replacement = false) {
    const lead = (quote.startAt - this.now()) / minute;
    const window = replacement
      ? lead <= 1440
        ? config.windows.replacementSameDayMinutes
        : config.windows.advanceMinutes
      : quote.bookingMode === 'INSTANT'
        ? config.windows.instantMinutes
        : lead <= 1440
          ? config.windows.sameDayMinutes
          : config.windows.advanceMinutes;
    return Math.min(
      this.now() + window * minute,
      quote.startAt - (lead > 1440 && !replacement ? 720 : 15) * minute,
    );
  }
  /** Therapist safety conditions the shop approved, checked against this customer. */
  private async conditionsAllow(
    tx: Records,
    listing: Listing,
    customerId: string,
    quote: Pick<Quote, 'startAt' | 'fulfillmentMode'>,
  ) {
    if (
      !listing.safetyConditions?.noFirstLateNight ||
      fulfillmentMode(quote) !== 'HOME_VISIT' ||
      !lateNight(quote.startAt)
    )
      return true;
    return (await tx.find<Booking>('bookings', { customerId, status: 'COMPLETED' })).some(
      (b) =>
        b.customerId === customerId && b.storeId === listing.storeId && b.status === 'COMPLETED',
    );
  }
  private buffered(quote: Quote) {
    if (fulfillmentMode(quote) === 'IN_STORE')
      return {
        startAt: quote.startAt,
        endAt: quote.endAt + (quote.venue?.turnoverMinutes ?? 15) * minute,
      };
    return {
      startAt:
        quote.bookingMode === 'INSTANT'
          ? this.now()
          : quote.startAt - config.bufferMinutes * minute,
      endAt: quote.endAt + config.bufferMinutes * minute,
    };
  }
  private async freeStaff(tx: Records, quote: Quote, exceptId = '') {
    const serving = new Set(
      quote.bookingMode === 'INSTANT'
        ? (await tx.find<Booking>('bookings', { status: ['IN_SERVICE', 'EN_ROUTE', 'ARRIVED'] }))
            .filter(
              (b) =>
                b.id !== exceptId &&
                (b.status === 'IN_SERVICE' ||
                  (['EN_ROUTE', 'ARRIVED'].includes(b.status) && b.quote.endAt <= this.now())),
            )
            .map((b) => b.assignedStaffId)
        : [],
    );
    const candidates = (await tx.list<Listing>('listings')).filter(
      (x) =>
        x.storeId === quote.storeId &&
        x.membershipActive &&
        x.portraitConsent &&
        x.identityVerified &&
        x.publicationStatus === 'PUBLISHED_INDEXABLE' &&
        x.offeringIds.includes(quote.offeringId) &&
        !serving.has(x.staffId) &&
        (!quote.requiredLanguage || x.languages.includes(quote.requiredLanguage)) &&
        listingSupports(x, fulfillmentMode(quote)) &&
        (quote.nominationType === 'FREE' || x.id === quote.listingId) &&
        (quote.bookingMode !== 'INSTANT'
          ? withinShifts(x.shifts, quote.startAt, quote.endAt)
          : x.onDuty && this.now() - x.dutyUpdatedAt < 4 * 60 * minute),
    );
    const available: Listing[] = [];
    for (const candidate of candidates)
      if (
        (await this.conditionsAllow(tx, candidate, quote.customerId, quote)) &&
        (await transitionAvailable(tx, candidate.staffId, quote, this.now(), exceptId)) &&
        !(await tx.conflicts(
          candidate.staffId,
          this.buffered(quote).startAt,
          this.buffered(quote).endAt,
          exceptId,
        ))
      )
        available.push(candidate);
    return available;
  }
  async publicCatalog(
    filters: { area?: string; language?: string; mode?: string; fulfillmentMode?: string } = {},
  ) {
    return this.read(async (tx) => {
      const selectedMode: FulfillmentMode =
        filters.fulfillmentMode === 'IN_STORE' ? 'IN_STORE' : 'HOME_VISIT';
      const allModes = filters.fulfillmentMode === 'ALL';
      const serving = new Set(
        (await tx.find<Booking>('bookings', { status: ['IN_SERVICE', 'EN_ROUTE', 'ARRIVED'] }))
          .filter(
            (b) =>
              b.status === 'IN_SERVICE' ||
              (['EN_ROUTE', 'ARRIVED'].includes(b.status) && b.quote.endAt <= this.now()),
          )
          .map((b) => b.assignedStaffId),
      );
      const stores = (await tx.list<Store>('stores')).filter(
        (x) =>
          x.active &&
          x.approved &&
          !x.billingBlocked &&
          (allModes ||
            (selectedMode === 'IN_STORE'
              ? venueAvailable(x) && filters.mode !== 'INSTANT'
              : x.homeVisitsEnabled !== false)),
      );
      const catalogOfferings = await tx.list<Offering>('offerings');
      const firstInstant = Math.ceil((this.now() + 60 * minute) / (15 * minute)) * 15 * minute;
      const catalogCounts = new Map<string, number>();
      if (filters.mode === 'INSTANT')
        for (const store of stores)
          catalogCounts.set(store.id, await this.dailyAutomaticCount(tx, store.id, firstInstant));
      const listings = (await tx.list<Listing>('listings')).filter(
        (x) =>
          x.membershipActive &&
          x.portraitConsent &&
          x.identityVerified &&
          x.publicationStatus === 'PUBLISHED_INDEXABLE' &&
          (allModes || listingSupports(x, selectedMode)) &&
          stores.some(
            (s) =>
              s.id === x.storeId &&
              (!filters.area ||
                (allModes
                  ? (s.homeVisitsEnabled !== false && s.areas.includes(filters.area)) ||
                    (venueAvailable(s) && s.venue?.area === filters.area)
                  : selectedMode === 'IN_STORE'
                    ? s.venue?.area === filters.area
                    : s.areas.includes(filters.area))) &&
              (filters.mode !== 'INSTANT' ||
                (s.acceptanceMode !== 'MANUAL' &&
                  !!s.emergencyContact &&
                  (s.acceptanceMode === 'SOLO' ||
                    catalogOfferings.some(
                      (o) =>
                        o.storeId === s.id &&
                        o.approved &&
                        o.active !== false &&
                        x.offeringIds.includes(o.id) &&
                        automaticAcceptanceReason(
                          s,
                          {
                            bookingMode: 'INSTANT',
                            offeringId: o.id,
                            area: filters.area || s.acceptanceRule?.areas[0] || '',
                            startAt: firstInstant,
                            endAt: firstInstant + o.durationMinutes * minute,
                            total:
                              effectiveServicePrice(o, this.now()).price +
                              travelFeeFor(
                                o,
                                effectiveBookingRules(s),
                                filters.area || s.acceptanceRule?.areas[0],
                              ) +
                              effectiveBookingRules(s).nominationFee +
                              timeSurchargeAt(effectiveBookingRules(s), firstInstant),
                          },
                          x.id,
                          catalogCounts.get(s.id) ?? 0,
                        ) === 'ELIGIBLE',
                    )))),
          ) &&
          (!filters.language || x.languages.includes(filters.language)) &&
          (filters.mode !== 'INSTANT' ||
            (x.onDuty &&
              !serving.has(x.staffId) &&
              this.now() - x.dutyUpdatedAt < 4 * 60 * minute)),
      );
      const managedStores = new Set(
        (await tx.list<import('@hogulink/contracts').PartnerApplication>('partnerApplications'))
          .filter((a) => a.type === 'MERCHANT')
          .map((a) => a.storeId),
      );
      const visibleStores = stores.filter(
        (s) => !managedStores.has(s.id) || listings.some((l) => l.storeId === s.id),
      );
      return {
        listings: listings.map((x) =>
          toPublicListing(
            x,
            x.onDuty && !serving.has(x.staffId) && this.now() - x.dutyUpdatedAt < 4 * 60 * minute,
          ),
        ),
        stores: visibleStores.map((store) => toPublicStore(store, selectedMode)),
        offerings: (await tx.list<Offering>('offerings'))
          .filter(
            (x) =>
              x.approved &&
              x.active !== false &&
              (allModes || fulfillmentMode(x) === selectedMode) &&
              visibleStores.some((s) => s.id === x.storeId),
          )
          .sort((a, b) => a.durationMinutes - b.durationMinutes)
          .map((x) => toPublicOffering(x, this.now())),
        demo: true,
        bookingRules: {
          nominationFee: config.nominationFee,
          cancellationPolicy: { ...config.cancellation },
        },
      };
    });
  }
  async availability(
    listingId: string,
    offeringId?: string,
    free = false,
    language = '',
    mode = 'SCHEDULED',
    area = '',
    serviceMode: FulfillmentMode = 'HOME_VISIT',
    days = 3,
    customerId = '',
  ) {
    const horizonDays = Math.min(MAX_AVAILABILITY_DAYS, Math.max(1, Math.floor(days) || 3));
    return this.read(async (source) => {
      const tx = rememberReads(source);
      const { listing, store } = await this.listing(tx, listingId);
      ensure(
        serviceMode === 'IN_STORE' || store.homeVisitsEnabled !== false,
        'LISTING_UNAVAILABLE',
        'This shop is not accepting new home visits.',
        409,
      );
      const offerings = (await tx.list<Offering>('offerings')).filter(
        (x) =>
          x.approved &&
          x.active !== false &&
          x.regulatoryCategory === 'RELAXATION' &&
          fulfillmentMode(x) === serviceMode &&
          x.storeId === store.id &&
          (free || listing.offeringIds.includes(x.id)),
      );
      const offering = offeringId
        ? offerings.find((x) => x.id === offeringId)
        : offerings.sort((a, b) => a.durationMinutes - b.durationMinutes)[0];
      ensure(offering, 'INVALID_OFFERING', 'Select a valid service.');
      const inStore = serviceMode === 'IN_STORE';
      ensure(
        !inStore || (venueAvailable(store) && mode !== 'INSTANT'),
        'VENUE_UNAVAILABLE',
        'Select an approved venue and a scheduled time.',
      );
      const instant = mode === 'INSTANT';
      const pool = free
        ? (await tx.list<Listing>('listings')).filter(
            (x) =>
              x.storeId === store.id &&
              x.membershipActive &&
              x.portraitConsent &&
              x.identityVerified &&
              x.publicationStatus === 'PUBLISHED_INDEXABLE' &&
              x.offeringIds.includes(offering.id) &&
              (!language || x.languages.includes(language)),
          )
        : [listing];
      const serving = new Set(
        instant
          ? (await tx.find<Booking>('bookings', { status: ['IN_SERVICE', 'EN_ROUTE', 'ARRIVED'] }))
              .filter(
                (b) =>
                  b.status === 'IN_SERVICE' ||
                  (['EN_ROUTE', 'ARRIVED'].includes(b.status) && b.quote.endAt <= this.now()),
              )
              .map((b) => b.assignedStaffId)
          : [],
      );
      const candidates = pool.filter(
        (x) =>
          (!area || inStore || store.areas.includes(area)) &&
          listingSupports(x, serviceMode) &&
          !serving.has(x.staffId) &&
          (!language || x.languages.includes(language)) &&
          (!instant ||
            (store.acceptanceMode !== 'MANUAL' &&
              !!store.emergencyContact &&
              x.onDuty &&
              this.now() - x.dutyUpdatedAt < 4 * 60 * minute)),
      );
      const values: number[] = [];
      for (
        let value =
          Math.ceil((this.now() + 60 * minute) / ((instant ? 15 : 30) * minute)) *
          (instant ? 15 : 30) *
          minute;
        value < this.now() + (instant ? 76 * minute : horizonDays * 24 * 60 * minute);
        value += 30 * minute
      ) {
        const slotQuote = {
          startAt: value,
          endAt: value + offering.durationMinutes * minute,
          fulfillmentMode: serviceMode,
          storeId: store.id,
          venue: inStore ? venueSnapshot(store.venue!) : undefined,
        } as Quote;
        if (
          inStore
            ? !venueCanServe(store.venue!, slotQuote.startAt, slotQuote.endAt)
            : !instant && !withinBusinessHours(effectiveBookingRules(store), value)
        )
          continue;
        if (inStore && !(await availableResources(tx, store, slotQuote, this.now())).length)
          continue;
        for (const candidate of candidates)
          if (
            (!instant ||
              store.acceptanceMode !== 'AUTO_PREAUTHORIZED' ||
              automaticAcceptanceReason(
                store,
                {
                  bookingMode: 'INSTANT',
                  offeringId: offering.id,
                  area: area || store.acceptanceRule?.areas[0] || '',
                  startAt: value,
                  endAt: value + offering.durationMinutes * minute,
                  total:
                    effectiveServicePrice(offering, this.now()).price +
                    travelFeeFor(
                      offering,
                      effectiveBookingRules(store),
                      area || store.acceptanceRule?.areas[0],
                    ) +
                    (free ? 0 : effectiveBookingRules(store).nominationFee) +
                    timeSurchargeAt(effectiveBookingRules(store), value),
                },
                candidate.id,
                await this.dailyAutomaticCount(tx, store.id, value),
              ) === 'ELIGIBLE') &&
            (instant || withinShifts(candidate.shifts, slotQuote.startAt, slotQuote.endAt)) &&
            // Same safety conditions as the quote: hidden unless this viewer may book them.
            (await this.conditionsAllow(tx, candidate, customerId, slotQuote)) &&
            (await transitionAvailable(tx, candidate.staffId, slotQuote, this.now())) &&
            !(await tx.conflicts(
              candidate.staffId,
              inStore ? value : instant ? this.now() : value - config.bufferMinutes * minute,
              inStore
                ? this.buffered(slotQuote).endAt
                : value + (offering.durationMinutes + config.bufferMinutes) * minute,
            ))
          ) {
            values.push(value);
            break;
          }
      }
      return { slots: values, timezone: 'Asia/Tokyo', arrivalRangeMinutes: [30, 60] };
    });
  }
  async quote(actor: Actor, input: unknown) {
    this.role(actor, 'CUSTOMER');
    const data = quoteInput.parse(input);
    return this.run(async (tx) => {
      const { listing, store } = await this.listing(tx, data.listingId);
      await this.allowed(tx, actor, store.id);
      const offering = await tx.get<Offering>('offerings', data.offeringId);
      const inStore = data.fulfillmentMode === 'IN_STORE';
      ensure(
        offering &&
          offering.approved &&
          offering.active !== false &&
          offering.regulatoryCategory === 'RELAXATION' &&
          offering.storeId === store.id &&
          listing.offeringIds.includes(offering.id) &&
          fulfillmentMode(offering) === data.fulfillmentMode &&
          listingSupports(listing, data.fulfillmentMode),
        'INVALID_OFFERING',
        'Select an available service from this shop.',
      );
      ensure(
        inStore || (store.homeVisitsEnabled !== false && store.areas.includes(data.area)),
        'OUTSIDE_SERVICE_AREA',
        'The address is outside this shop’s service area.',
      );
      ensure(
        data.startAt > this.now() + 15 * minute &&
          data.startAt < this.now() + 30 * 24 * 60 * minute,
        'INVALID_TIME',
        'Select a future time within 30 days.',
      );
      // Scheduled starts follow the shop's business hours, the same rule the time list uses.
      if (inStore)
        ensure(
          venueAvailable(store) && data.bookingMode === 'SCHEDULED',
          'VENUE_UNAVAILABLE',
          'Only scheduled visits to an approved venue are available.',
        );
      if (data.bookingMode === 'SCHEDULED')
        ensure(
          inStore
            ? venueCanServe(
                store.venue!,
                data.startAt,
                data.startAt + offering.durationMinutes * minute,
              )
            : withinBusinessHours(effectiveBookingRules(store), data.startAt),
          'OUTSIDE_BOOKING_HOURS',
          'Choose a start time within this shop’s business hours.',
        );
      if (data.bookingMode === 'INSTANT')
        ensure(
          data.startAt <= this.now() + 180 * minute &&
            store.acceptanceMode !== 'MANUAL' &&
            !!store.emergencyContact,
          'INSTANT_UNAVAILABLE',
          'Instant booking is not available for this shop.',
        );
      const q: Quote = {
        ...data,
        area: inStore ? store.venue!.area : data.area,
        ...(inStore ? { venue: venueSnapshot(store.venue!) } : {}),
        completionPolicy: { version: 'silence-72h-v1', windowHours: 72 },
        id: id('quote'),
        customerId: actor.id,
        storeId: store.id,
        merchantId: store.merchantId,
        offeringVersion: offering.version,
        serviceName: { ...offering.name },
        regulatoryCategory: offering.regulatoryCategory,
        storeRuleVersion: store.ruleVersion,
        endAt: data.startAt + offering.durationMinutes * minute,
        expiresAt: this.now() + config.quoteTtlSeconds * 1000,
        ...(() => {
          // A shop promotion applies to orders placed while it is active.
          const priced = effectiveServicePrice(offering, this.now());
          return priced.promotion
            ? {
                serviceFee: priced.price,
                promotionId: priced.promotion.id,
                regularServiceFee: offering.price,
              }
            : { serviceFee: offering.price };
        })(),
        nominationFee:
          data.nominationType === 'NOMINATED'
            ? inStore
              ? store.venue!.nominationFee
              : effectiveBookingRules(store).nominationFee
            : 0,
        bookingRulesVersion: effectiveBookingRules(store).version,
        transportFee: inStore ? 0 : travelFeeFor(offering, effectiveBookingRules(store), data.area),
        ...(timeSurchargeAt(inStore ? store.venue : effectiveBookingRules(store), data.startAt)
          ? {
              timeSurcharge: timeSurchargeAt(
                inStore ? store.venue : effectiveBookingRules(store),
                data.startAt,
              ),
            }
          : {}),
        total: 0,
        cancellationPolicy: inStore
          ? store.venue!.cancellationPolicy!
          : effectiveBookingRules(store).cancellationPolicy,
      };
      q.total = q.serviceFee + q.nominationFee + q.transportFee + (q.timeSurcharge ?? 0);
      if (inStore)
        ensure(
          (await availableResources(tx, store, q, this.now())).length,
          'RESOURCE_UNAVAILABLE',
          'No reception resource is available.',
          409,
        );
      if (q.nominationType === 'NOMINATED')
        ensure(
          await this.conditionsAllow(tx, listing, q.customerId, q),
          'STAFF_CONDITIONS',
          'This therapist takes late-night home visits only from returning customers of this shop.',
          409,
        );
      const availableStaff = await this.freeStaff(tx, q);
      ensure(
        availableStaff.length,
        'SLOT_CONFLICT',
        'No matching staff are available at this time.',
        409,
      );
      if (q.bookingMode === 'INSTANT' && store.acceptanceMode === 'AUTO_PREAUTHORIZED') {
        const candidates = availableStaff;
        const used = await this.dailyAutomaticCount(tx, store.id, q.startAt);
        ensure(
          candidates.some(
            (candidate) => automaticAcceptanceReason(store, q, candidate.id, used) === 'ELIGIBLE',
          ),
          'INSTANT_UNAVAILABLE',
          'No authorized automatic acceptance rule covers this visit.',
          409,
        );
      }
      await tx.put('quotes', q);
      return q;
    });
  }
  async hold(actor: Actor, quoteId: string) {
    this.role(actor, 'CUSTOMER');
    ensure(
      actor.verificationLevel >= 1,
      'VERIFICATION_REQUIRED',
      'Please sign in before reserving a time.',
      403,
    );
    return this.run(async (tx) => {
      const q = await tx.get<Quote>('quotes', quoteId);
      ensure(
        q && q.customerId === actor.id && q.expiresAt > this.now(),
        'QUOTE_EXPIRED',
        'Your quote expired. Please select the service again.',
        409,
      );
      await this.currentQuote(tx, q);
      await this.allowed(tx, actor, q.storeId);
      const holds = await tx.find<Hold>('holds', {
        customerId: actor.id,
        createdAt: { gte: this.now() - 3600000 },
      });
      const existing = holds.find(
        (x) => x.active && x.quoteId === q.id && x.phase === 'CHECKOUT_HOLD',
      );
      if (existing) return existing;
      ensure(
        holds.filter((x) => x.active && x.phase === 'CHECKOUT_HOLD').length <
          config.maxActiveHolds &&
          holds.filter((x) => x.createdAt > this.now() - 60 * minute).length <
            config.maxHoldsPerHour,
        'HOLD_LIMIT',
        'Too many time reservations. Wait for an existing hold to expire.',
        429,
      );
      const pool = await this.freeStaff(tx, q);
      const store = (await this.listing(tx, q.listingId)).store;
      const used =
        store.acceptanceMode === 'AUTO_PREAUTHORIZED'
          ? await this.dailyAutomaticCount(tx, store.id, q.startAt)
          : 0;
      const authorized = pool.find(
        (candidate) => automaticAcceptanceReason(store, q, candidate.id, used) === 'ELIGIBLE',
      );
      if (q.bookingMode === 'INSTANT' && store.acceptanceMode === 'AUTO_PREAUTHORIZED')
        ensure(
          authorized,
          'INSTANT_UNAVAILABLE',
          'Automatic acceptance is no longer available.',
          409,
        );
      const staff = authorized ?? pool[0];
      ensure(staff, 'SLOT_CONFLICT', 'This time was just reserved. Select another time.', 409);
      const hold: Hold = {
        id: id('hold'),
        quoteId: q.id,
        customerId: actor.id,
        listingId: staff.id,
        staffId: staff.staffId,
        phase: 'CHECKOUT_HOLD',
        expiresAt: Math.min(this.now() + config.holdTtlSeconds * 1000, q.expiresAt),
        active: true,
        createdAt: this.now(),
      };
      if (fulfillmentMode(q) === 'IN_STORE') {
        const resources = await availableResources(tx, store, q, this.now());
        ensure(
          resources[0],
          'RESOURCE_UNAVAILABLE',
          'This reception resource was just reserved.',
          409,
        );
        hold.resourceId = resources[0];
        await reserveResource(tx, q, hold);
      }
      await tx.interval({
        id: hold.id,
        staffId: hold.staffId,
        ...this.buffered(q),
        expiresAt: hold.expiresAt,
      });
      await tx.put('holds', hold);
      await this.audit(tx, actor, 'HOLD_CREATED', undefined, hold.id);
      return hold;
    });
  }
  async checkoutSubmission(actor: Actor, holdId: string) {
    this.role(actor, 'CUSTOMER');
    return this.run(async (tx) => {
      const h = await tx.get<Hold>('holds', holdId);
      ensure(h?.customerId === actor.id, 'NOT_FOUND', 'Reservation not found.', 404);
      const b = h.bookingId ? await tx.get<Booking>('bookings', h.bookingId) : undefined;
      return { bookingId: b?.customerId === actor.id ? b.id : null };
    });
  }
  async checkout(actor: Actor, holdId: string) {
    // An already submitted hold is recovered through checkoutSubmission, without a new payment.
    this.role(actor, 'CUSTOMER');
    return this.run(async (tx) => {
      const hold = await tx.get<Hold>('holds', holdId);
      ensure(
        hold &&
          hold.customerId === actor.id &&
          hold.active &&
          hold.expiresAt > this.now() &&
          hold.phase === 'CHECKOUT_HOLD',
        'HOLD_EXPIRED',
        'This reservation has expired. Select another time.',
        409,
      );
      const quote = await tx.get<Quote>('quotes', hold.quoteId);
      ensure(quote, 'QUOTE_EXPIRED', 'Quote not found.', 404);
      await this.currentQuote(tx, quote);
      const { store, listing } = await this.listing(tx, quote.listingId);
      const heldListing = await tx.get<Listing>('listings', hold.listingId);
      const offering = await tx.get<Offering>('offerings', quote.offeringId);
      const payment = (await tx.find<Payment>('payments', { holdId: hold.id })).find(
        (x) =>
          x.holdId === hold.id &&
          x.customerId === actor.id &&
          !x.bookingId &&
          ['AUTHORIZED', 'METHOD_SAVED'].includes(x.status) &&
          x.expiresAt > this.now(),
      );
      return {
        serverNow: this.now(),
        hold,
        quote,
        legalName: store.legalName,
        storeName: store.name,
        storeSlug: store.slug,
        payment: payment ? { id: payment.id, status: payment.status } : undefined,
        visit: {
          listingSlug: listing.slug,
          listingName: quote.nominationType === 'NOMINATED' ? listing.name : undefined,
          photo: quote.nominationType === 'NOMINATED' ? listing.photo : undefined,
          offeringName: offering?.name,
          durationMinutes: (quote.endAt - quote.startAt) / minute,
          hotelOnly: fulfillmentMode(quote) === 'HOME_VISIT' && (heldListing?.hotelOnly ?? true),
          acceptanceMode:
            store.acceptanceMode === 'AUTO_PREAUTHORIZED' &&
            automaticAcceptanceReason(
              store,
              quote,
              hold.listingId,
              await this.dailyAutomaticCount(tx, store.id, quote.startAt),
            ) !== 'ELIGIBLE'
              ? 'MANUAL'
              : store.acceptanceMode,
        },
      };
    });
  }
  async releaseCheckoutHold(actor: Actor, holdId: string) {
    this.role(actor, 'CUSTOMER');
    return this.run(async (tx) => {
      const hold = await tx.get<Hold>('holds', holdId);
      ensure(hold && hold.customerId === actor.id, 'NOT_FOUND', 'Reservation not found.', 404);
      ensure(
        hold.phase === 'CHECKOUT_HOLD' && !hold.bookingId,
        'INVALID_STATE',
        'This reservation is already submitted.',
        409,
      );
      if (!hold.active) return { released: true };
      hold.active = false;
      await tx.put('holds', hold);
      await tx.releaseInterval(hold.id);
      await tx.releaseInterval(`resource:${hold.id}`);
      for (const payment of await tx.find<Payment>('payments', { holdId: hold.id })) {
        if (
          payment.holdId === hold.id &&
          !payment.bookingId &&
          ['AUTHORIZED', 'METHOD_SAVED'].includes(payment.status)
        )
          await tx.put('payments', { ...payment, status: 'VOIDED' });
      }
      await this.audit(tx, actor, 'CHECKOUT_HOLD_RELEASED', undefined, hold.id);
      return { released: true };
    });
  }
  async authorizeDemo(actor: Actor, holdId: string, passed: boolean) {
    this.role(actor, 'CUSTOMER');
    const secured = await this.run(async (tx) => {
      const hold = await tx.get<Hold>('holds', holdId);
      ensure(
        hold &&
          hold.customerId === actor.id &&
          hold.active &&
          hold.phase === 'CHECKOUT_HOLD' &&
          hold.expiresAt > this.now(),
        'HOLD_EXPIRED',
        'The reserved time expired.',
        409,
      );
      if (!passed) {
        hold.active = false;
        await tx.put('holds', hold);
        await tx.releaseInterval(hold.id);
        await tx.releaseInterval(`resource:${hold.id}`);
        for (const p of await tx.find<Payment>('payments', { holdId: hold.id }))
          if (
            p.holdId === hold.id &&
            !p.bookingId &&
            ['AUTHORIZED', 'METHOD_SAVED'].includes(p.status)
          )
            await tx.put('payments', { ...p, status: 'VOIDED' });
        await this.audit(tx, actor, 'PAYMENT_AUTHENTICATION_FAILED', undefined, hold.id);
        return null;
      }
      const quote = await tx.get<Quote>('quotes', hold.quoteId);
      ensure(quote && quote.expiresAt > this.now(), 'QUOTE_EXPIRED', 'Quote expired.', 409);
      await this.currentQuote(tx, quote);
      const { store } = await this.listing(tx, quote.listingId);
      const existing = (await tx.find<Payment>('payments', { holdId: hold.id })).find(
        (p) =>
          p.holdId === hold.id && !p.bookingId && ['AUTHORIZED', 'METHOD_SAVED'].includes(p.status),
      );
      if (existing) return existing;
      const payment: Payment = {
        id: id('pay'),
        customerId: actor.id,
        quoteId: quote.id,
        holdId: hold.id,
        amount: quote.total,
        account: store.pspAccount,
        status:
          quote.endAt + completionWindowMs <
          this.now() + config.authorizationDays * 24 * 60 * minute
            ? 'AUTHORIZED'
            : 'METHOD_SAVED',
        verified3ds: true,
        expiresAt: this.now() + config.authorizationDays * 24 * 60 * minute,
      };
      await tx.put('payments', payment);
      await this.audit(tx, actor, 'DEMO_PAYMENT_SECURED', undefined, payment.id);
      return payment;
    });
    // Release commits before the HTTP layer receives the authentication error.
    ensure(
      secured,
      'PAYMENT_FAILED',
      'Authentication failed. The reserved time was released.',
      402,
    );
    return secured;
  }
  async createBooking(actor: Actor, input: unknown, key: string) {
    this.role(actor, 'CUSTOMER');
    const data = bookingInput.parse(input);
    ensure(
      key && key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'An Idempotency-Key is required.',
    );
    return this.run(async (tx) => {
      const idemId = createHash('sha256').update(`${actor.id}:booking:${key}`).digest('hex');
      const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
      const prior = await tx.get<Idempotency>('idempotency', idemId);
      if (prior) {
        ensure(
          prior.hash === hash,
          'IDEMPOTENCY_CONFLICT',
          'This retry key was used for different input.',
          409,
        );
        return this.redact((await tx.get<Booking>('bookings', prior.bookingId))!, actor);
      }
      ensure(actor.verificationLevel >= 1, 'VERIFICATION_REQUIRED', 'Sign in first.', 403);
      const h = await tx.get<Hold>('holds', data.holdId);
      const q = await tx.get<Quote>('quotes', data.quoteId);
      ensure(
        h &&
          h.customerId === actor.id &&
          h.active &&
          h.phase === 'CHECKOUT_HOLD' &&
          h.expiresAt > this.now() &&
          q &&
          q.id === h.quoteId &&
          q.customerId === actor.id &&
          q.expiresAt > this.now(),
        'HOLD_EXPIRED',
        'Your reserved time or quote expired.',
        409,
      );
      const { listing, store } = await this.listing(tx, q.listingId);
      await this.currentQuote(tx, q);
      const heldListing = (await this.listing(tx, h.listingId)).listing;
      ensure(
        listingSupports(heldListing, fulfillmentMode(q)),
        'LISTING_UNAVAILABLE',
        'The reserved therapist no longer accepts this service mode.',
        409,
      );
      await this.allowed(tx, actor, store.id);
      const offering = await tx.get<Offering>('offerings', q.offeringId);
      ensure(
        offering &&
          offering.approved &&
          offering.version === q.offeringVersion &&
          // The unchanged version also freezes the promotion; a valid quote keeps its price.
          (q.promotionId
            ? offering.promotion?.id === q.promotionId &&
              offering.promotion.price === q.serviceFee &&
              offering.price === q.regularServiceFee
            : offering.price === q.serviceFee) &&
          (fulfillmentMode(q) === 'IN_STORE'
            ? 0
            : travelFeeFor(offering, effectiveBookingRules(store), q.area)) === q.transportFee,
        'PRICE_CHANGED',
        'The service or price changed. Request a new quote.',
        409,
      );
      ensure(
        data.policyVersion === q.cancellationPolicy.version,
        'POLICY_OR_AREA_CHANGED',
        'Confirm the current policy.',
        409,
      );
      if (fulfillmentMode(q) === 'IN_STORE') {
        ensure(
          data.contact && !data.address && h.resourceId && q.venue,
          'CONTACT_REQUIRED',
          'Confirm your contact details and venue.',
        );
        ensure(
          (await availableResources(tx, store, q, this.now(), h.id, false, h.resourceId)).includes(
            h.resourceId,
          ),
          'RESOURCE_UNAVAILABLE',
          'The reserved resource is unavailable.',
          409,
        );
      } else {
        ensure(data.address, 'ADDRESS_REQUIRED', 'Enter your service address.');
        ensure(
          data.policyVersion === q.cancellationPolicy.version &&
            data.address.area === q.area &&
            store.areas.includes(data.address.area),
          'POLICY_OR_AREA_CHANGED',
          'Confirm the current policy and address.',
        );
        ensure(
          !heldListing.hotelOnly || data.address.type === 'HOTEL',
          'HOTEL_ONLY',
          'This staff member accepts hotel visits only.',
        );
        if (data.address.type === 'HOTEL')
          ensure(
            data.address.hotelName && data.address.room && data.address.hotelPermission,
            'HOTEL_DETAILS_REQUIRED',
            'Enter hotel name and room, and confirm visitors are allowed.',
          );
        const jstHour = new Date(q.startAt + 9 * 60 * minute).getUTCHours();
        if (
          data.address.type === 'HOME' &&
          (jstHour >= 22 || jstHour < 6) &&
          !(await tx.find<Booking>('bookings', { customerId: actor.id, status: 'COMPLETED' })).some(
            (b) => b.customerId === actor.id && b.status === 'COMPLETED',
          )
        )
          ensure(
            actor.verificationLevel >= 3,
            'L3_REQUIRED',
            'A first late-night home visit requires identity verification. Choose a hotel or another time.',
            403,
          );
      }
      if (q.bookingMode === 'INSTANT')
        ensure(
          store.acceptanceMode !== 'MANUAL' &&
            !!store.emergencyContact &&
            heldListing.onDuty &&
            this.now() - heldListing.dutyUpdatedAt < 4 * 60 * minute,
          'INSTANT_UNAVAILABLE',
          'Instant availability changed.',
          409,
        );
      const p = await tx.get<Payment>('payments', data.paymentId);
      ensure(
        p &&
          p.customerId === actor.id &&
          p.quoteId === q.id &&
          p.holdId === h.id &&
          p.account === store.pspAccount &&
          p.amount === q.total &&
          p.verified3ds &&
          !p.bookingId &&
          ['AUTHORIZED', 'METHOD_SAVED'].includes(p.status) &&
          p.expiresAt > this.now(),
        'PAYMENT_REQUIRED',
        'A valid authenticated payment guarantee is required.',
        402,
      );
      const acceptanceReason = automaticAcceptanceReason(
        store,
        q,
        h.listingId,
        await this.dailyAutomaticCount(tx, store.id, q.startAt),
      );
      const auto = acceptanceReason === 'ELIGIBLE';
      if (q.bookingMode === 'INSTANT' && store.acceptanceMode === 'AUTO_PREAUTHORIZED')
        ensure(
          auto,
          'INSTANT_UNAVAILABLE',
          'Automatic acceptance is no longer available. Choose a scheduled visit.',
          409,
        );
      const b: Booking = {
        id: id('booking'),
        customerId: actor.id,
        merchantId: store.merchantId,
        storeId: store.id,
        selectedStaffId: q.nominationType === 'NOMINATED' ? listing.staffId : null,
        selectedStaffListingId: q.nominationType === 'NOMINATED' ? listing.id : null,
        assignedStaffId: q.nominationType === 'NOMINATED' ? listing.staffId : null,
        assignedListingId: q.nominationType === 'NOMINATED' ? listing.id : null,
        status: auto ? 'ACCEPTED' : 'REQUESTED',
        merchantAcceptance: auto ? 'AUTO_ACCEPTED' : 'PENDING',
        staffTaskStatus: auto && q.nominationType === 'NOMINATED' ? 'OFFERED' : 'NOT_SENT',
        acceptanceMode:
          store.acceptanceMode === 'AUTO_PREAUTHORIZED' && !auto ? 'MANUAL' : store.acceptanceMode,
        acceptanceDecision:
          store.acceptanceMode === 'AUTO_PREAUTHORIZED'
            ? {
                outcome: auto ? 'AUTO_ACCEPTED' : 'MANUAL_REVIEW',
                reason: acceptanceReason,
                evaluatedAt: this.now(),
                rule: store.acceptanceRule ? structuredClone(store.acceptanceRule) : undefined,
              }
            : undefined,
        paymentStatus: p.status,
        replacementConsent: 'NOT_REQUIRED',
        quote: q,
        address: data.address,
        ...(fulfillmentMode(q) === 'IN_STORE'
          ? {
              contact: data.contact,
              resourceId: h.resourceId,
              resourceName: store.venue?.resources.find((resource) => resource.id === h.resourceId)
                ?.name,
              checkInCode: randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(),
            }
          : {}),
        legalNameSnapshot: store.legalName,
        deadline: this.deadline(q),
        version: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
        capturedAmount: 0,
        refundedAmount: 0,
        platformFee: 0,
        paymentId: p.id,
        holdId: h.id,
      };
      ensure(b.deadline > this.now(), 'TIME_TOO_CLOSE', 'Select a later start time.', 409);
      h.phase = 'BOOKING_RESERVATION';
      h.bookingId = b.id;
      h.expiresAt = b.deadline;
      await reserveResource(tx, q, h);
      await tx.interval({
        id: h.id,
        staffId: h.staffId,
        ...this.buffered(q),
        expiresAt: h.expiresAt,
      });
      p.bookingId = b.id;
      await tx.put('payments', p);
      await tx.put('holds', h);
      await tx.put('bookings', b);
      await tx.put<Idempotency>('idempotency', { id: idemId, hash, bookingId: b.id });
      await this.audit(
        tx,
        actor,
        'BOOKING_CREATED',
        b.id,
        store.acceptanceMode === 'AUTO_PREAUTHORIZED'
          ? `rule_version=${store.acceptanceRule?.version ?? 'none'};decision=${acceptanceReason}`
          : '',
      );
      return this.redact(b, actor);
    });
  }
  async bookings(actor: Actor) {
    if ((actor.role === 'STAFF' || actor.role === 'MERCHANT') && !actor.storeId) return [];
    return this.run(async (tx) => {
      const staffVisible = new Set<string>();
      const bookings = await tx.find<Booking>(
        'bookings',
        actor.role === 'CUSTOMER'
          ? { customerId: actor.id }
          : actor.role === 'MERCHANT' || actor.role === 'STAFF'
            ? { storeId: actor.storeId! }
            : {},
      );
      if (actor.role === 'STAFF')
        for (const b of bookings)
          if (await staffBookingAccess(tx, actor, b)) staffVisible.add(b.id);
      return bookings
        .filter(
          (b) =>
            actor.role === 'ADMIN' ||
            (actor.role === 'CUSTOMER' && b.customerId === actor.id) ||
            (actor.role === 'MERCHANT' && b.storeId === actor.storeId) ||
            (actor.role === 'STAFF' && staffVisible.has(b.id)),
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((b) => this.redact(b, actor));
    });
  }
  redact(b: Booking, actor: Actor): Booking {
    if (actor.role !== 'CUSTOMER') b = { ...b, checkInCode: undefined };
    if (b.acceptanceDecision && !['MERCHANT', 'ADMIN'].includes(actor.role)) {
      const { rule: _rule, ...decision } = b.acceptanceDecision;
      b = { ...b, acceptanceDecision: decision };
    }
    if (b.completion && (actor.role === 'ADMIN' || actor.role === 'STAFF'))
      b = {
        ...b,
        completion: {
          ...b.completion,
          history: b.completion.history.map((h) =>
            actor.role === 'ADMIN' || h.role === 'CUSTOMER' ? { ...h, note: undefined } : h,
          ),
        },
      };
    if (actor.role === 'ADMIN' && b.noShow)
      b = { ...b, noShow: { ...b.noShow, reviewNote: undefined } };
    const visible =
      actor.role === 'CUSTOMER' ||
      actor.role === 'MERCHANT' ||
      (actor.role === 'STAFF' &&
        b.staffTaskStatus === 'ACKNOWLEDGED' &&
        ['CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'IN_SERVICE'].includes(b.status) &&
        b.replacementConsent !== 'PENDING');
    return visible ? b : { ...b, address: undefined, contact: undefined };
  }
  /** Pending work for the platform team, counted with each queue's own rules and permissions. */
  async adminTodo(actor: Actor): Promise<AdminTodo> {
    this.role(actor, 'ADMIN');
    const viewer = await this.repo.read((tx) => currentAdmin(tx, actor));
    requireAdmin(viewer, 'overview.read');
    const todo: AdminTodo = {};
    if (canAdmin(viewer, 'orders.read')) {
      const open = (await this.governance.monitor(actor)).alerts.filter(
        (a) => a.state !== 'RESOLVED',
      );
      todo.orderAlerts = {
        open: open.length,
        high: open.filter((a) => a.severity === 'HIGH').length,
      };
    }
    if (canAdmin(viewer, 'supply.read'))
      todo.aftercare = (await this.quality.suspensionImpact(actor)).reduce(
        (n, x) => n + x.bookings.length,
        0,
      );
    await this.read(async (tx) => {
      const now = this.now();
      if (canAdmin(viewer, 'safety.write')) {
        todo.safetyEvents = (await tx.list<SafetyEvent>('safety')).filter(
          (s) => s.status === 'OPEN',
        ).length;
        todo.contentReviews = (await tx.list<{ status: string }>('contentReviews')).filter(
          (x) => x.status === 'PENDING',
        ).length;
      }
      if (canAdmin(viewer, 'cases.read')) {
        const cases = { unassigned: 0, overdue: 0, escalated: 0, attention: 0 };
        for (const t of await tx.list<SupportTicket>('supportTickets')) {
          if (['RESOLVED', 'CLOSED'].includes(t.status) || !(await adminCaseVisible(tx, viewer, t)))
            continue;
          const unassigned = !(await tx.get<TicketHandling>('ticketHandling', t.id))?.ownerId,
            overdue = t.dueAt < now,
            escalated = t.status === 'PLATFORM_ESCALATED';
          cases.unassigned += Number(unassigned);
          cases.overdue += Number(overdue);
          cases.escalated += Number(escalated);
          cases.attention += Number(unassigned || overdue || escalated);
        }
        todo.cases = cases;
      }
      if (canAdmin(viewer, 'supply.write')) {
        todo.onboarding = (await tx.list<{ status: string }>('partnerApplications')).filter(
          (a) => a.status === 'SUBMITTED',
        ).length;
        todo.venues = (await tx.list<Store>('stores')).filter(
          (s) => (s.venueDraft ?? s.venue)?.status === 'PENDING',
        ).length;
        // Same queue as the review moderation page: new reviews, replies and open appeals.
        const reviews = await tx.list<ExperienceReview>('experienceReviews'),
          replies = await tx.list<ExperienceReply>('experienceReplies'),
          appeals = await tx.list<ExperienceAppeal>('experienceAppeals');
        todo.experience = reviews.reduce((n, r) => {
          const reply = replies.find((x) => x.reviewId === r.id);
          return (
            n +
            Number(r.status === 'PENDING') +
            Number(
              r.status === 'APPROVED' &&
                reply?.status === 'PENDING' &&
                reply.reviewRevision === r.revision,
            ) +
            appeals.filter(
              (a) => a.reviewId === r.id && a.reviewRevision === r.revision && a.status === 'OPEN',
            ).length
          );
        }, 0);
      }
      if (canAdmin(viewer, 'finance.read')) {
        let unmatched = 0;
        for (const s of await tx.list<Store>('stores'))
          unmatched += (await this.finance.rows(tx, s.id)).filter(
            (e) => !e.recordedBatchId && e.report?.status !== 'MATCHED',
          ).length;
        todo.finance = {
          unmatched,
          invoices: (await tx.list<InvoiceRequest>('invoiceRequests')).filter(
            (r) => r.state === 'SUBMITTED' || r.state === 'REVIEWED',
          ).length,
        };
      }
    });
    return todo;
  }
  async booking(actor: Actor, bookingId: string) {
    return this.run(async (tx) => this.redact(await this.getBooking(tx, actor, bookingId), actor));
  }
  async accept(actor: Actor, bookingId: string, version: number) {
    this.role(actor, 'MERCHANT');
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, version);
      await requireCurrentQualifications(tx, b.storeId, b.assignedListingId, this.now());
      ensure(
        b.status === 'REQUESTED',
        'INVALID_STATE',
        'Only a pending request can be accepted.',
        409,
      );
      if (b.acceptanceMode === 'SOLO') {
        const store = await tx.get<Store>('stores', b.storeId);
        if (store?.acceptanceMode !== 'SOLO') {
          if (b.quote.bookingMode === 'INSTANT') {
            await this.closeBooking(tx, b, 'CANCELLED', 'MERCHANT_RULES_CHANGED');
            return this.save(tx, b, actor, 'SOLO_INSTANT_CANCELLED');
          }
          b.acceptanceMode = 'MANUAL';
        }
      }
      if (b.acceptanceMode === 'SOLO') {
        const store = await tx.get<Store>('stores', b.storeId);
        const staff = (await tx.list<Listing>('listings')).filter(
          (x) => x.storeId === b.storeId && x.membershipActive,
        );
        ensure(
          store?.ownerStaffId && staff.length === 1 && staff[0].staffId === store.ownerStaffId,
          'SOLO_INVALID',
          'This shop no longer meets SOLO conditions.',
          409,
        );
        ensure(
          await this.assignmentEligible(tx, b, staff[0]),
          'INVALID_ASSIGNMENT',
          'The shop owner no longer meets this visit requirements. Review the task or cancel without a fee.',
          409,
        );
        b.assignedStaffId = staff[0].staffId;
        b.assignedListingId = staff[0].id;
        b.staffTaskStatus = 'ACKNOWLEDGED';
        b.status = 'CONFIRMED';
        if (b.quote.bookingMode === 'INSTANT') b.arrival = { promisedAt: this.now() + 60 * minute };
        await this.confirmHold(tx, b);
      } else {
        b.status = 'ACCEPTED';
        b.staffTaskStatus = b.assignedStaffId ? 'OFFERED' : 'NOT_SENT';
        b.deadline = this.deadline(b.quote);
      }
      b.merchantAcceptance = 'MANUALLY_ACCEPTED';
      return this.save(tx, b, actor, 'MERCHANT_ACCEPTED');
    });
  }
  private async confirmHold(tx: Records, b: Booking) {
    ensure(
      ['AUTHORIZED', 'METHOD_SAVED'].includes(b.paymentStatus),
      'PAYMENT_REQUIRED',
      'Payment guarantee is no longer valid.',
      402,
    );
    const h = await tx.get<Hold>('holds', b.holdId);
    ensure(h?.active, 'HOLD_EXPIRED', 'Reserved time expired.', 409);
    h.phase = 'CONFIRMED_BLOCK';
    h.expiresAt = b.quote.endAt + config.bufferMinutes * minute;
    await reserveResource(tx, b.quote, h);
    await tx.interval({
      id: h.id,
      staffId: h.staffId,
      ...this.buffered(b.quote),
      expiresAt: h.expiresAt,
    });
    await tx.put('holds', h);
  }
  async assignmentCandidates(actor: Actor, bookingId: string) {
    this.role(actor, 'MERCHANT');
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId);
      if (
        !['ACCEPTED', 'CONFIRMED'].includes(b.status) ||
        (b.replacementConsent === 'PENDING' && b.proposedListingId)
      )
        return [];
      const result: Listing[] = [];
      for (const x of await tx.list<Listing>('listings')) {
        if (!(await this.assignmentEligible(tx, b, x))) continue;
        if (
          x.storeId !== b.storeId ||
          x.staffId === b.assignedStaffId ||
          !x.membershipActive ||
          !x.identityVerified ||
          !x.portraitConsent ||
          x.publicationStatus !== 'PUBLISHED_INDEXABLE' ||
          !x.offeringIds.includes(b.quote.offeringId) ||
          (b.quote.requiredLanguage && !x.languages.includes(b.quote.requiredLanguage)) ||
          (fulfillmentMode(b.quote) === 'HOME_VISIT' &&
            x.hotelOnly &&
            b.address?.type !== 'HOTEL') ||
          (b.quote.bookingMode === 'INSTANT' &&
            (!x.onDuty || this.now() - x.dutyUpdatedAt >= 4 * 60 * minute))
        )
          continue;
        if (
          !(await tx.conflicts(
            x.staffId,
            this.buffered(b.quote).startAt,
            this.buffered(b.quote).endAt,
            b.holdId,
          ))
        )
          result.push(x);
      }
      return result;
    });
  }
  private async assignmentEligible(tx: Records, b: Booking, listing: Listing) {
    if (!(await this.conditionsAllow(tx, listing, b.customerId, b.quote))) return false;
    // A replacement must also be working at the booked time.
    if (
      b.quote.bookingMode !== 'INSTANT' &&
      !withinShifts(listing.shifts, b.quote.startAt, b.quote.endAt)
    )
      return false;
    const store = await tx.get<Store>('stores', b.storeId);
    if (
      !store?.active ||
      !store.approved ||
      !store.pspAccount ||
      listing.storeId !== b.storeId ||
      !listing.membershipActive ||
      !listing.identityVerified ||
      !listing.portraitConsent ||
      listing.publicationStatus !== 'PUBLISHED_INDEXABLE' ||
      !listing.offeringIds.includes(b.quote.offeringId) ||
      (b.quote.requiredLanguage && !listing.languages.includes(b.quote.requiredLanguage)) ||
      !listingSupports(listing, fulfillmentMode(b.quote)) ||
      (fulfillmentMode(b.quote) === 'HOME_VISIT' &&
        listing.hotelOnly &&
        b.address?.type !== 'HOTEL') ||
      (b.quote.bookingMode === 'INSTANT' &&
        (!listing.onDuty || this.now() - listing.dutyUpdatedAt >= 4 * 60 * minute))
    )
      return false;
    if (
      b.quote.bookingMode === 'INSTANT' &&
      (
        await tx.find<Booking>('bookings', {
          assignedStaffId: listing.staffId,
          status: ['IN_SERVICE', 'EN_ROUTE', 'ARRIVED'],
        })
      ).some(
        (x) =>
          x.id !== b.id &&
          x.assignedStaffId === listing.staffId &&
          (x.status === 'IN_SERVICE' ||
            (['EN_ROUTE', 'ARRIVED'].includes(x.status) && x.quote.endAt <= this.now())),
      )
    )
      return false;
    if (!(await transitionAvailable(tx, listing.staffId, b.quote, this.now(), b.holdId)))
      return false;
    try {
      await requireCurrentQualifications(tx, b.storeId, listing.id, this.now());
    } catch (e) {
      if (e instanceof DomainError && e.code === 'QUALIFICATION_UNAVAILABLE') return false;
      throw e;
    }
    return true;
  }
  async assign(
    actor: Actor,
    bookingId: string,
    version: number,
    listingId: string,
    replacement = false,
  ) {
    this.role(actor, 'MERCHANT');
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, version);
      ensure(
        ['ACCEPTED', 'CONFIRMED'].includes(b.status) &&
          (b.replacementConsent !== 'PENDING' || !b.proposedListingId),
        'INVALID_STATE',
        'Assignment is not available at this stage.',
        409,
      );
      ensure(
        replacement || b.quote.nominationType === 'FREE',
        'CONSENT_REQUIRED',
        'Nominated bookings require a replacement proposal.',
      );
      const { listing, store } = await this.listing(tx, listingId, true);
      ensure(
        await this.assignmentEligible(tx, b, listing),
        'INVALID_ASSIGNMENT',
        'The therapist no longer meets this visit requirements.',
        409,
      );
      ensure(
        store.id === b.storeId &&
          listing.offeringIds.includes(b.quote.offeringId) &&
          (!b.quote.requiredLanguage || listing.languages.includes(b.quote.requiredLanguage)) &&
          (fulfillmentMode(b.quote) === 'IN_STORE' ||
            !listing.hotelOnly ||
            b.address?.type === 'HOTEL') &&
          (b.quote.bookingMode !== 'INSTANT' ||
            (listing.onDuty && this.now() - listing.dutyUpdatedAt < 4 * 60 * minute)),
        'INVALID_ASSIGNMENT',
        'Choose qualified staff from this shop who meet all conditions.',
      );
      ensure(
        listing.staffId !== b.assignedStaffId,
        'INVALID_ASSIGNMENT',
        'Choose another staff member.',
      );
      ensure(
        !(await tx.conflicts(
          listing.staffId,
          this.buffered(b.quote).startAt,
          this.buffered(b.quote).endAt,
          b.holdId,
        )),
        'SLOT_CONFLICT',
        'This staff member is unavailable.',
        409,
      );
      // Keep the original reservation and protect the proposed replacement too.
      if (b.quote.nominationType === 'NOMINATED') {
        const originalDeadline =
          b.replacementConsent === 'PENDING' ? b.replacementDeadline : undefined;
        await tx.interval({
          id: `replacement:${b.id}`,
          staffId: listing.staffId,
          ...this.buffered(b.quote),
          expiresAt: b.quote.endAt + config.bufferMinutes * minute,
        });
        b.proposedListingId = listing.id;
        b.replacementConsent = 'PENDING';
        b.replacementDeadline = Math.min(
          originalDeadline ?? Infinity,
          this.deadline(b.quote, true),
        );
        ensure(
          b.replacementDeadline > this.now(),
          'TIME_TOO_CLOSE',
          'No time remains to obtain explicit consent.',
          409,
        );
      } else await this.applyAssignment(tx, b, listing);
      return this.save(
        tx,
        b,
        actor,
        b.quote.nominationType === 'NOMINATED' ? 'REPLACEMENT_PROPOSED' : 'STAFF_ASSIGNED',
      );
    });
  }
  private async applyAssignment(tx: Records, b: Booking, listing: Listing) {
    const h = await tx.get<Hold>('holds', b.holdId);
    ensure(h, 'HOLD_EXPIRED', 'Reserved time is unavailable.', 409);
    await tx.releaseInterval(`replacement:${b.id}`);
    await tx.interval({
      id: h.id,
      staffId: listing.staffId,
      ...this.buffered(b.quote),
      expiresAt: h.expiresAt,
    });
    h.staffId = listing.staffId;
    h.listingId = listing.id;
    await tx.put('holds', h);
    b.assignedStaffId = listing.staffId;
    b.assignedListingId = listing.id;
    b.staffTaskStatus = 'OFFERED';
    b.deadline = this.deadline(b.quote);
  }
  async withdrawProposal(actor: Actor, bookingId: string, input: unknown) {
    this.role(actor, 'MERCHANT');
    const d = z
      .object({ version: z.number().int().positive(), reason: z.string().trim().min(10).max(300) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, d.version);
      ensure(
        ['ACCEPTED', 'CONFIRMED'].includes(b.status) &&
          b.replacementConsent === 'PENDING' &&
          b.proposedListingId,
        'INVALID_STATE',
        'No active replacement candidate.',
        409,
      );
      await tx.releaseInterval(`replacement:${b.id}`);
      b.proposedListingId = undefined;
      return this.save(tx, b, actor, 'REPLACEMENT_WITHDRAWN', d.reason);
    });
  }
  async consent(actor: Actor, bookingId: string, version: number, approved: boolean) {
    this.role(actor, 'CUSTOMER');
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, version);
      ensure(
        b.replacementConsent === 'PENDING' && b.replacementDeadline! > this.now(),
        'INVALID_STATE',
        'No active replacement proposal.',
        409,
      );
      ensure(
        !approved || b.proposedListingId,
        'PROPOSAL_REQUIRED',
        'The shop has not proposed a replacement yet.',
        409,
      );
      b.replacementConsent = approved ? 'APPROVED' : 'DECLINED';
      if (!approved) await this.closeBooking(tx, b, 'CANCELLED', 'MERCHANT_UNABLE');
      else {
        const { listing } = await this.listing(tx, b.proposedListingId!, true);
        ensure(
          await this.assignmentEligible(tx, b, listing),
          'INVALID_ASSIGNMENT',
          'The proposed therapist is no longer available. Ask the shop to review or cancel without a fee.',
          409,
        );
        await tx.releaseInterval(`replacement:${b.id}`);
        ensure(
          !(await tx.conflicts(
            listing.staffId,
            this.buffered(b.quote).startAt,
            this.buffered(b.quote).endAt,
            b.holdId,
          )),
          'SLOT_CONFLICT',
          'The proposed therapist is no longer available.',
          409,
        );
        await this.applyAssignment(tx, b, listing);
        b.quote = { ...b.quote, total: b.quote.total - b.quote.nominationFee, nominationFee: 0 };
      }
      return this.save(tx, b, actor, approved ? 'REPLACEMENT_APPROVED' : 'REPLACEMENT_DECLINED');
    });
  }
  async ack(actor: Actor, bookingId: string, version: number, arrivalMinutes?: number) {
    this.role(actor, 'STAFF');
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, version);
      await requireCurrentQualifications(tx, b.storeId, b.assignedListingId, this.now());
      if (fulfillmentMode(b.quote) === 'IN_STORE') {
        const assigned = await tx.get<Listing>('listings', b.assignedListingId!);
        ensure(
          assigned && listingSupports(assigned, 'IN_STORE'),
          'INVALID_ASSIGNMENT',
          'Arrange a therapist who accepts in-store service.',
          409,
        );
      }
      ensure(
        ['ACCEPTED', 'CONFIRMED'].includes(b.status) &&
          b.staffTaskStatus === 'OFFERED' &&
          b.replacementConsent !== 'PENDING',
        'INVALID_STATE',
        'This task is not awaiting confirmation.',
        409,
      );
      if (b.quote.bookingMode === 'INSTANT') {
        ensure(
          arrivalMinutes && arrivalMinutes >= 30 && arrivalMinutes <= 60,
          'ARRIVAL_REQUIRED',
          'Choose an arrival estimate between 30 and 60 minutes.',
        );
        b.arrivalMinutes = arrivalMinutes;
        const estimate = this.now() + arrivalMinutes * minute;
        b.arrival = b.arrival
          ? { ...b.arrival, revisedAt: estimate, reportedAt: this.now() }
          : { promisedAt: estimate };
      }
      b.staffTaskStatus = 'ACKNOWLEDGED';
      b.status = 'CONFIRMED';
      await this.confirmHold(tx, b);
      return this.save(tx, b, actor, 'STAFF_ACKNOWLEDGED');
    });
  }
  async decline(actor: Actor, bookingId: string, version: number, reason: string) {
    this.role(actor, 'STAFF');
    ensure(reason.trim().length >= 3, 'REASON_REQUIRED', 'Provide a reason.');
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, version);
      ensure(
        ['ACCEPTED', 'CONFIRMED'].includes(b.status) &&
          ['OFFERED', 'ACKNOWLEDGED'].includes(b.staffTaskStatus),
        'INVALID_STATE',
        'This task cannot be declined.',
        409,
      );
      b.staffTaskStatus = b.staffTaskStatus === 'ACKNOWLEDGED' ? 'WITHDRAWN' : 'DECLINED';
      b.deadline = this.deadline(b.quote, true);
      if (b.status === 'CONFIRMED' && b.quote.nominationType === 'NOMINATED') {
        b.replacementConsent = 'PENDING';
        b.proposedListingId = undefined;
        b.replacementDeadline = b.deadline;
      }
      return this.save(tx, b, actor, 'STAFF_UNAVAILABLE', reason.slice(0, 300));
    });
  }
  /** The shop desk, or the assigned therapist in shops without one, confirms the customer's code. */
  async checkIn(actor: Actor, bookingId: string, input: unknown) {
    this.role(actor, 'MERCHANT', 'STAFF');
    const data = z
      .object({
        version: z.number().int().positive(),
        code: z
          .string()
          .trim()
          .regex(/^[A-F0-9]{12}$/),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, data.version);
      ensure(
        actor.role !== 'STAFF' || b.assignedStaffId === actor.staffId,
        'FORBIDDEN',
        'Only the assigned therapist can check in this customer.',
        403,
      );
      ensure(
        fulfillmentMode(b.quote) === 'IN_STORE' &&
          b.status === 'CONFIRMED' &&
          b.staffTaskStatus === 'ACKNOWLEDGED' &&
          b.replacementConsent !== 'PENDING' &&
          !b.checkIn,
        'INVALID_STATE',
        'This booking cannot be checked in.',
        409,
      );
      ensure(
        data.code === b.checkInCode,
        'INVALID_CHECK_IN_CODE',
        'Check the customer reservation code.',
        409,
      );
      ensure(
        this.now() >= b.quote.startAt - 30 * minute && this.now() <= b.quote.endAt,
        'INVALID_TIME',
        'Check-in is outside the reservation window.',
        409,
      );
      ensure(
        b.paymentStatus !== 'FAILED',
        'PAYMENT_REQUIRED',
        'Payment guarantee requires renewal.',
        402,
      );
      b.checkIn = { at: this.now(), actorId: actor.id };
      if (b.noShow && ['CONTACTING', 'REPORTED'].includes(b.noShow.status)) {
        b.noShow.status = 'DISMISSED';
        b.noShow.resolvedAt = this.now();
      }
      return this.save(tx, b, actor, 'CUSTOMER_CHECKED_IN');
    });
  }
  /** The full purchased session must fit before closing, the next customer and the bed. */
  private async ensureInStoreStart(tx: Records, b: Booking, at: number) {
    const duration = b.quote.endAt - b.quote.startAt;
    ensure(
      at <= b.quote.endAt,
      'INVALID_TIME',
      'This appointment window has ended. Arrange a new reservation.',
      409,
    );
    ensure(
      b.quote.venue && venueCanServe(b.quote.venue, at, at + duration),
      'OUTSIDE_BOOKING_HOURS',
      'The full service cannot finish before closing.',
      409,
    );
    const actual = { ...b.quote, startAt: at, endAt: at + duration };
    ensure(
      (await transitionAvailable(tx, b.assignedStaffId!, actual, this.now(), b.holdId)) &&
        !(await tx.conflicts(b.assignedStaffId!, at, this.buffered(actual).endAt, b.holdId)),
      'SLOT_CONFLICT',
      'The full service conflicts with the next appointment.',
      409,
    );
    const store = (await tx.get<Store>('stores', b.storeId))!;
    ensure(
      (
        await availableResources(tx, store, actual, this.now(), b.holdId, true, b.resourceId)
      ).includes(b.resourceId!),
      'RESOURCE_UNAVAILABLE',
      'The resource or the following reservation is unavailable.',
      409,
    );
  }
  /**
   * A checked-in customer who arrived too late for the full session. Allowed only when the
   * server-recorded check-in was after the booked start and a full session could not have
   * started even at that moment, so delays caused by the shop never become customer fees.
   * The frozen cancellation policy applies as for a cancellation at the booked start.
   */
  async closeLateArrival(actor: Actor, bookingId: string, input: unknown) {
    this.role(actor, 'MERCHANT');
    const data = z
      .object({
        version: z.number().int().positive(),
        note: z.string().trim().min(10).max(500),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, data.version);
      ensure(
        fulfillmentMode(b.quote) === 'IN_STORE' &&
          b.status === 'CONFIRMED' &&
          !!b.checkIn &&
          b.startedAt === undefined,
        'INVALID_STATE',
        'Only a checked-in visit that has not started can be closed for late arrival.',
        409,
      );
      ensure(
        b.checkIn!.at > b.quote.startAt,
        'NOT_LATE',
        'The customer arrived on time. Start the service or cancel as the shop.',
        409,
      );
      let blocked = false;
      try {
        await this.ensureInStoreStart(tx, b, b.checkIn!.at);
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        blocked = [
          'INVALID_TIME',
          'OUTSIDE_BOOKING_HOURS',
          'SLOT_CONFLICT',
          'RESOURCE_UNAVAILABLE',
        ].includes(e.code);
      }
      ensure(
        blocked,
        'SERVICE_STILL_POSSIBLE',
        'A full session could start when the customer arrived. Start it or cancel as the shop.',
        409,
      );
      const payment = await tx.get<Payment>('payments', b.paymentId);
      const fee = Math.floor(
        ((b.quote.total - b.quote.transportFee) *
          scheduledCancellationBps(b.quote.cancellationPolicy, 0)) /
          10000,
      );
      ensure(
        fee === 0 ||
          (payment &&
            payment.bookingId === b.id &&
            payment.expiresAt > this.now() &&
            ['AUTHORIZED', 'METHOD_SAVED'].includes(payment.status) &&
            fee <= payment.amount),
        'PAYMENT_REQUIRED',
        'A valid payment guarantee is required.',
        402,
      );
      await this.closeBooking(tx, b, 'CANCELLED', 'CUSTOMER_LATE_ARRIVAL', fee);
      return this.save(tx, b, actor, 'LATE_ARRIVAL_CLOSED', data.note);
    });
  }
  async event(actor: Actor, bookingId: string, version: number, event: string) {
    this.role(actor, 'STAFF');
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, version);
      const inStore = fulfillmentMode(b.quote) === 'IN_STORE';
      ensure(
        !inStore || !['EN_ROUTE', 'ARRIVED'].includes(event),
        'INVALID_TRANSITION',
        'In-store visits use customer check-in.',
        409,
      );
      if (['EN_ROUTE', 'ARRIVED', 'START'].includes(event))
        await requireCurrentQualifications(tx, b.storeId, b.assignedListingId, this.now());
      const next = {
        EN_ROUTE: ['CONFIRMED', 'EN_ROUTE'],
        ARRIVED: ['EN_ROUTE', 'ARRIVED'],
        START: [inStore ? 'CONFIRMED' : 'ARRIVED', 'IN_SERVICE'],
        COMPLETE: ['IN_SERVICE', 'COMPLETED'],
      }[event];
      ensure(
        next &&
          b.status === next[0] &&
          b.staffTaskStatus === 'ACKNOWLEDGED' &&
          b.replacementConsent !== 'PENDING',
        'INVALID_TRANSITION',
        'Complete the previous step before continuing.',
        409,
      );
      if (['EN_ROUTE', 'ARRIVED', 'START'].includes(event))
        ensure(
          !(
            await tx.find<Booking>('bookings', {
              assignedStaffId: b.assignedStaffId!,
              status: ['EN_ROUTE', 'ARRIVED', 'IN_SERVICE'],
            })
          ).some((other) => other.id !== b.id),
          'STAFF_VISIT_IN_PROGRESS',
          'Another visit is still in progress. Finish that visit or ask the shop to arrange assistance before continuing.',
          409,
        );
      if (event === 'EN_ROUTE')
        ensure(
          b.paymentStatus !== 'FAILED',
          'PAYMENT_REQUIRED',
          'The customer has not renewed the payment guarantee yet. Do not depart; the shop will follow up.',
          402,
        );
      if (event === 'START')
        ensure(
          // Scheduled visits start no earlier than the booked time; an instant visit starts
          // once the therapist has arrived, and its end is still checked from the actual start.
          (b.quote.bookingMode === 'INSTANT' || this.now() >= b.quote.startAt) &&
            (inStore
              ? !!b.checkIn && this.now() >= b.checkIn.at
              : b.arrivedAt !== undefined && this.now() >= b.arrivedAt),
          'SERVICE_TOO_EARLY',
          'Service cannot start before the booked time and arrival.',
          409,
        );
      if (event === 'START' && inStore) {
        ensure(
          b.paymentStatus !== 'FAILED',
          'PAYMENT_REQUIRED',
          'Renew the payment guarantee first.',
          402,
        );
        await this.ensureInStoreStart(tx, b, this.now());
      }
      if (event === 'COMPLETE') {
        const eligibleAt = serviceEligibleAt(b);
        ensure(
          eligibleAt !== undefined && startedOnTime(b) && this.now() >= eligibleAt,
          'SERVICE_TOO_SHORT',
          'The purchased service duration has not elapsed. Report an exception if service ended early.',
          409,
        );
        b.status = 'AWAITING_COMPLETION';
        b.completion = {
          status: 'PENDING',
          eligibleAt,
          endedAt: this.now(),
          requestedAt: this.now(),
          confirmBy: this.now() + completionWindowMs,
          history: [{ action: 'REQUEST', role: actor.role, at: this.now() }],
        };
        await this.release(tx, b);
        return this.save(tx, b, actor, 'STAFF_COMPLETE');
      }
      if (event === 'START') {
        // Reserve the actual full duration too, so a late start cannot sell its remaining time.
        const actual = {
          ...b.quote,
          startAt: this.now(),
          endAt: this.now() + b.quote.endAt - b.quote.startAt,
        };
        const free =
          (await transitionAvailable(tx, b.assignedStaffId!, actual, this.now(), b.holdId)) &&
          !(await tx.conflicts(
            b.assignedStaffId!,
            this.buffered(actual).startAt,
            this.buffered(actual).endAt,
            b.holdId,
          ));
        // In store the full session was checked above. At the customer's place the therapist is
        // already at the door, so the visit starts even when the next booking leaves no room;
        // that booking then follows the usual delay and reassignment handling.
        ensure(
          free || !inStore,
          'SLOT_CONFLICT',
          'The full service conflicts with the next appointment.',
          409,
        );
        const h = await tx.get<Hold>('holds', b.holdId);
        ensure(h?.active, 'HOLD_EXPIRED', 'The reservation is unavailable.', 409);
        if (free) {
          h.expiresAt = this.buffered(actual).endAt;
          await tx.interval({
            id: h.id,
            staffId: h.staffId,
            ...this.buffered(actual),
            expiresAt: h.expiresAt,
          });
          await reserveResource(tx, actual, h);
          await tx.put('holds', h);
        }
      }
      b.status = next[1] as Booking['status'];
      if (event === 'ARRIVED') b.arrivedAt = this.now();
      if (event === 'START') b.startedAt = this.now();
      if (event === 'START' && b.noShow && ['CONTACTING', 'REPORTED'].includes(b.noShow.status)) {
        b.noShow.status = 'DISMISSED';
        b.noShow.resolvedAt = this.now();
      }
      return this.save(tx, b, actor, `STAFF_${event}`);
    });
  }
  async completionView(actor: Actor, bookingId: string) {
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId);
      return {
        autoConfirmationEligible: await autoAcceptanceAllowed(tx, b),
        bookingVersion: b.version,
        serverNow: this.now(),
        eligibleAt: serviceEligibleAt(b),
        completion: this.redact(b, actor).completion ?? null,
      };
    });
  }
  async completionAction(actor: Actor, bookingId: string, input: unknown, key: string) {
    const data = z
      .object({
        version: z.number().int().positive(),
        action: z.enum(['CONFIRM', 'DISPUTE', 'EXCEPTION', 'REVIEW', 'VOID', 'REAUTHORIZE']),
        note: z.string().trim().max(1000).optional(),
        expectedAmount: z.number().int().nonnegative().optional(),
      })
      .strict()
      .parse(input);
    this.role(
      actor,
      ...(['CONFIRM', 'DISPUTE', 'REAUTHORIZE'].includes(data.action)
        ? ['CUSTOMER' as const]
        : data.action === 'EXCEPTION'
          ? ['STAFF' as const, 'MERCHANT' as const]
          : ['MERCHANT' as const]),
    );
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    if (!['CONFIRM', 'REAUTHORIZE'].includes(data.action))
      ensure(
        (data.note?.length ?? 0) >= 10,
        'REASON_REQUIRED',
        'Describe the facts in at least 10 characters.',
      );
    return this.run(async (tx) => {
      let b = await this.getBooking(tx, actor, bookingId);
      const keyId = createHash('sha256').update(`${actor.id}:completion:${key}`).digest('hex');
      const hash = createHash('sha256')
        .update(JSON.stringify({ bookingId, ...data }))
        .digest('hex');
      const previous = await tx.get<{ id: string; hash: string }>('completionIdempotency', keyId);
      if (previous) {
        ensure(
          previous.hash === hash,
          'IDEMPOTENCY_CONFLICT',
          'This retry key was used for different input.',
          409,
        );
        return this.redact(b, actor);
      }
      b = await this.getBooking(tx, actor, bookingId, data.version);
      const now = this.now(),
        eligibleAt = serviceEligibleAt(b);
      ensure(
        ['IN_SERVICE', 'AWAITING_COMPLETION'].includes(b.status),
        'INVALID_STATE',
        'Service is not awaiting completion.',
        409,
      );
      if (data.action === 'EXCEPTION' || data.action === 'DISPUTE') {
        ensure(
          actor.role !== 'STAFF' || b.staffTaskStatus === 'ACKNOWLEDGED',
          'FORBIDDEN',
          'Task confirmation is required.',
          403,
        );
        b.completion ??= {
          status: 'DISPUTED',
          eligibleAt: eligibleAt ?? b.quote.endAt,
          timingInvalid: eligibleAt === undefined || !startedOnTime(b),
          endedAt: now,
          requestedAt: now,
          confirmBy: now + completionWindowMs,
          history: [],
        };
        if (b.completion.status === 'PAYMENT_REVIEW') b.completion.reviewStatus = 'DISPUTED';
        else b.completion.status = 'DISPUTED';
        b.status = 'AWAITING_COMPLETION';
        await completionCase(tx, b, now, data.note!);
        await this.release(tx, b);
      } else {
        const c = b.completion;
        ensure(
          b.status === 'AWAITING_COMPLETION' && c,
          'INVALID_STATE',
          'Wait for the therapist to submit the service end record.',
          409,
        );
        if (data.action === 'REAUTHORIZE') {
          ensure(
            c.status === 'PAYMENT_REVIEW',
            'INVALID_STATE',
            'Payment review is required before renewing authorization.',
            409,
          );
          ensure(
            data.expectedAmount === b.quote.total,
            'COMPLETION_AMOUNT_CHANGED',
            'Review the order amount before renewing authorization.',
            409,
          );
          const p = await tx.get<Payment>('payments', b.paymentId);
          ensure(
            p &&
              p.bookingId === b.id &&
              p.customerId === actor.id &&
              p.verified3ds &&
              !p.capturedAmount &&
              p.amount >= b.quote.total &&
              ['AUTHORIZED', 'METHOD_SAVED'].includes(p.status),
            'PAYMENT_REQUIRED',
            'The saved demo payment method is unavailable.',
            402,
          );
          p.status = 'AUTHORIZED';
          p.expiresAt = now + config.authorizationDays * 24 * 60 * minute;
          await tx.put('payments', p);
          b.paymentStatus = 'AUTHORIZED';
          c.status = c.reviewStatus ?? (c.endedAt < c.eligibleAt ? 'DISPUTED' : 'TIMED_OUT');
          c.reviewStatus = undefined;
          if (c.status === 'PENDING') c.confirmBy = now + completionWindowMs;
          await completionReceipt(
            tx,
            b,
            actor,
            now,
            'Customer renewed the demo payment authorization. No capture was made; service confirmation is still required.',
          );
        } else if (data.action === 'CONFIRM' || data.action === 'REVIEW') {
          ensure(
            !c.timingInvalid &&
              eligibleAt !== undefined &&
              c.endedAt >= eligibleAt &&
              now >= c.endedAt &&
              startedOnTime(b),
            'SERVICE_TOO_SHORT',
            'Shortened or invalid service records require exception handling.',
            409,
          );
          if (data.action === 'CONFIRM') {
            ensure(
              data.expectedAmount === b.quote.total,
              'COMPLETION_AMOUNT_CHANGED',
              'Review the current order amount before confirming.',
              409,
            );
            ensure(
              c.status === 'PENDING' && now < c.confirmBy,
              'COMPLETION_REVIEW_REQUIRED',
              'The shop must review this exception before requesting confirmation again.',
              409,
            );
            const p = await tx.get<Payment>('payments', b.paymentId);
            if (
              !p ||
              p.status !== 'AUTHORIZED' ||
              p.expiresAt <= now ||
              !p.verified3ds ||
              p.bookingId !== b.id ||
              p.amount < b.quote.total
            ) {
              c.reviewStatus = 'PENDING';
              c.status = 'PAYMENT_REVIEW';
              await completionCase(
                tx,
                b,
                now,
                'Payment authorization is unavailable. No charge was made; the shop must review or close without charge.',
              );
            } else {
              c.status = 'CONFIRMED';
              c.confirmedAt = now;
              await this.captureCompleted(tx, b);
              await completionReceipt(
                tx,
                b,
                actor,
                now,
                'Customer confirmed service completion; the authorized order amount was captured once.',
              );
            }
          } else {
            ensure(
              ['DISPUTED', 'TIMED_OUT'].includes(c.status),
              'INVALID_STATE',
              'Only disputed or timed out confirmations can be reviewed.',
              409,
            );
            c.status = 'PENDING';
            c.requestedAt = now;
            c.confirmBy = now + completionWindowMs;
            await completionReceipt(tx, b, actor, now, data.note!);
          }
        } else {
          ensure(
            b.capturedAmount === 0,
            'INVALID_STATE',
            'Use the refund process for captured orders.',
            409,
          );
          c.status = 'VOIDED';
          await this.closeBooking(tx, b, 'CANCELLED', 'SERVICE_EXCEPTION');
          await completionReceipt(tx, b, actor, now, `Closed without charge: ${data.note}`);
        }
      }
      b.completion!.history.push({
        action: data.action,
        at: now,
        role: actor.role,
        note: data.note,
      });
      await tx.put('completionIdempotency', { id: keyId, hash });
      return this.save(tx, b, actor, `COMPLETION_${data.action}`);
    });
  }
  /**
   * PRD CP-44: a far-future booking keeps a saved method and is authorized before the visit.
   * A failed authorization gives the customer a short window to renew it; otherwise the
   * booking is cancelled free and the time released. Returns true when the booking closed.
   */
  private async paymentGuarantee(tx: Records, b: Booking, system: Actor) {
    if (b.startedAt !== undefined || !['REQUESTED', 'ACCEPTED', 'CONFIRMED'].includes(b.status))
      return false;
    const now = this.now(),
      hour = 60 * minute;
    if (
      b.paymentStatus === 'FAILED' &&
      b.paymentActionBy !== undefined &&
      now >= b.paymentActionBy
    ) {
      await this.closeBooking(tx, b, 'CANCELLED', 'PAYMENT_GUARANTEE_FAILED');
      b.paymentActionBy = undefined;
      await this.save(tx, b, system, 'PAYMENT_GUARANTEE_EXPIRED');
      return true;
    }
    if (
      b.paymentStatus !== 'METHOD_SAVED' ||
      b.quote.startAt - now > config.preAuthorizeHours * hour
    )
      return false;
    const p = await tx.get<Payment>('payments', b.paymentId);
    if (!p || p.bookingId !== b.id || p.status !== 'METHOD_SAVED') return false;
    if (p.demoDecline) {
      b.paymentStatus = 'FAILED';
      b.paymentActionBy = Math.min(
        now + config.paymentUpdateHours * hour,
        b.quote.startAt - 60 * minute,
      );
      await this.save(tx, b, system, 'PAYMENT_GUARANTEE_FAILED');
      return false;
    }
    p.status = 'AUTHORIZED';
    p.expiresAt = now + config.authorizationDays * 24 * hour;
    await tx.put('payments', p);
    b.paymentStatus = 'AUTHORIZED';
    await this.save(tx, b, system, 'PAYMENT_PREAUTHORIZED');
    return false;
  }
  /** The customer renews a failed pre-visit authorization before its deadline. */
  async renewPaymentGuarantee(actor: Actor, bookingId: string, input: unknown) {
    this.role(actor, 'CUSTOMER');
    const data = z.object({ version: z.number().int().positive() }).strict().parse(input);
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, data.version);
      ensure(
        b.paymentStatus === 'FAILED' &&
          b.paymentActionBy !== undefined &&
          this.now() < b.paymentActionBy &&
          b.startedAt === undefined &&
          !terminal.has(b.status),
        'INVALID_STATE',
        'This booking does not need a payment renewal.',
        409,
      );
      const p = await tx.get<Payment>('payments', b.paymentId);
      ensure(p && p.bookingId === b.id, 'PAYMENT_REQUIRED', 'Payment is unavailable.', 402);
      // Demo payments re-authenticate the saved method; a real PSP confirms with 3-D Secure.
      p.status = 'AUTHORIZED';
      p.demoDecline = false;
      p.verified3ds = true;
      p.expiresAt = this.now() + config.authorizationDays * 24 * 60 * minute;
      await tx.put('payments', p);
      b.paymentStatus = 'AUTHORIZED';
      b.paymentActionBy = undefined;
      return this.save(tx, b, actor, 'PAYMENT_GUARANTEE_RENEWED');
    });
  }
  private async captureCompleted(tx: Records, b: Booking) {
    b.status = 'COMPLETED';
    b.completedAt = this.now();
    const p = await tx.get<Payment>('payments', b.paymentId);
    const store = await tx.get<Store>('stores', b.storeId);
    ensure(p && store, 'PAYMENT_REQUIRED', 'Payment is unavailable.', 402);
    p.status = 'PAID';
    p.capturedAmount = b.quote.total;
    p.voidedAmount = Math.max(0, p.amount - b.quote.total);
    b.paymentStatus = 'PAID';
    b.capturedAmount = b.quote.total;
    const repeat = (
      await tx.find<Booking>('bookings', {
        customerId: b.customerId,
        storeId: b.storeId,
        status: 'COMPLETED',
      })
    ).some(
      (x) =>
        x.id !== b.id &&
        x.customerId === b.customerId &&
        x.storeId === b.storeId &&
        x.status === 'COMPLETED' &&
        x.capturedAmount > x.refundedAmount,
    );
    const rate =
      (store.plan === 'TRIAL'
        ? 0
        : store.plan === 'ANNUAL'
          ? config.annualFeeBps
          : config.standardFeeBps) * (repeat ? 0.5 : 1);
    b.captureFeeRateBps = rate;
    b.platformFee = Math.floor(((b.quote.total - b.quote.transportFee) * rate) / 10000);
    await tx.put('payments', p);
    const feeId = id('fee');
    await tx.put('feeEntries', {
      id: feeId,
      bookingId: b.id,
      storeId: b.storeId,
      amount: b.platformFee,
      type: 'CAPTURE',
      createdAt: this.now(),
    });
    await recordMoney(tx, b, feeId, 'CAPTURE', b.capturedAmount, 0, b.platformFee, this.now());
    await this.release(tx, b);
  }
  private async release(tx: Records, b: Booking) {
    const h = await tx.get<Hold>('holds', b.holdId);
    if (h?.active && b.resourceId && b.startedAt !== undefined) {
      const key = resourceKey(b.storeId, b.resourceId);
      await tx.put('venueTurnovers', {
        id: key,
        startAt: this.now(),
        endAt: this.now() + (b.quote.venue?.turnoverMinutes ?? 15) * minute,
      });
    }
    if (h) {
      h.active = false;
      await tx.put('holds', h);
    }
    await tx.releaseInterval(b.holdId);
    await tx.releaseInterval(`resource:${b.holdId}`);
    await tx.releaseInterval(`replacement:${b.id}`);
  }
  async noShowAction(actor: Actor, bookingId: string, input: unknown, key: string) {
    const data = z
      .object({
        version: z.number().int().positive(),
        action: z.enum(['CONTACT', 'REPORT', 'CONFIRM', 'DISMISS']),
        text: z.string().trim().min(10).max(500),
      })
      .strict()
      .parse(input);
    this.role(
      actor,
      ...(data.action === 'CONTACT' || data.action === 'REPORT'
        ? ['STAFF' as const, 'MERCHANT' as const]
        : ['MERCHANT' as const]),
    );
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId);
      const inStore = fulfillmentMode(b.quote) === 'IN_STORE';
      if (!inStore && ['CONTACT', 'REPORT'].includes(data.action)) this.role(actor, 'STAFF');
      const arrivalAt = inStore ? b.quote.startAt : b.arrivedAt;
      const requestId = createHash('sha256')
        .update(`${actor.id}:${bookingId}:${key}`)
        .digest('hex');
      const hash = createHash('sha256')
        .update(JSON.stringify({ action: data.action, text: data.text }))
        .digest('hex');
      const prior = await tx.get<{ id: string; hash: string }>('noShowRequests', requestId);
      if (prior) {
        ensure(
          prior.hash === hash,
          'IDEMPOTENCY_CONFLICT',
          'This retry key has different input.',
          409,
        );
        return this.redact(b, actor);
      }
      ensure(
        b.version === data.version,
        'VERSION_CONFLICT',
        'The booking changed. Refresh first.',
        409,
      );
      ensure(
        (inStore
          ? b.status === 'CONFIRMED' && !b.checkIn && this.now() >= b.quote.startAt
          : b.status === 'ARRIVED') &&
          b.staffTaskStatus === 'ACKNOWLEDGED' &&
          b.replacementConsent !== 'PENDING',
        'INVALID_STATE',
        'No-show handling requires an acknowledged arrival.',
        409,
      );
      const policy = b.quote.cancellationPolicy.noShow;
      ensure(
        policy && arrivalAt !== undefined,
        'NO_SHOW_POLICY_REQUIRED',
        'This booking has no agreed no-show policy or recorded arrival.',
        409,
      );
      const now = this.now();
      const response = (await tx.list<Message>('messages')).some(
        (m) => m.bookingId === b.id && m.role === 'CUSTOMER' && m.createdAt >= arrivalAt!,
      );
      if (data.action !== 'DISMISS')
        ensure(
          !response,
          'CUSTOMER_RESPONDED',
          'The customer responded. Resolve the visit with the shop.',
          409,
        );
      if (data.action === 'CONTACT') {
        ensure(
          !b.noShow || b.noShow.status === 'CONTACTING',
          'INVALID_STATE',
          'This report is already awaiting review or closed.',
          409,
        );
        const last = b.noShow?.contacts.at(-1);
        ensure(
          !last || now >= last.at + policy.contactGapMinutes * minute,
          'CONTACT_TOO_SOON',
          'Wait before recording another contact attempt.',
          409,
        );
        ensure(
          !/(happy\s*ending|erotic|nuru|特殊服务|全套|ヌキ|回春)/i.test(data.text),
          'CONTENT_BLOCKED',
          'This message requires safety review.',
        );
        ensure(
          (b.noShow?.contacts.length ?? 0) < 10,
          'CONTACT_LIMIT',
          'Contact limit reached. Ask your shop for help.',
          409,
        );
        const messageId = id('msg');
        await tx.put<Message>('messages', {
          id: messageId,
          bookingId,
          actorId: actor.id,
          role: actor.role,
          text: data.text,
          createdAt: now,
        });
        b.noShow ??= {
          status: 'CONTACTING',
          startedAt: now,
          waitUntil: Math.max(now, arrivalAt!, b.quote.startAt) + policy.waitMinutes * minute,
          contacts: [],
        };
        b.noShow.contacts.push({ id: id('contact'), messageId, at: now, actorId: actor.id });
      } else {
        ensure(b.noShow, 'CONTACTS_REQUIRED', 'Record contact attempts first.', 409);
        if (data.action === 'DISMISS') {
          ensure(
            ['CONTACTING', 'REPORTED'].includes(b.noShow.status),
            'INVALID_STATE',
            'This report is already closed.',
            409,
          );
          b.noShow.status = 'DISMISSED';
          b.noShow.resolvedAt = now;
        } else {
          ensure(
            b.noShow.contacts.length >= policy.minContacts && now >= b.noShow.waitUntil,
            'NO_SHOW_NOT_READY',
            'Contact evidence or the waiting period is incomplete.',
            409,
          );
          if (data.action === 'REPORT') {
            ensure(
              b.noShow.status === 'CONTACTING',
              'INVALID_STATE',
              'This report is already submitted.',
              409,
            );
            b.noShow.status = 'REPORTED';
            b.noShow.reportedAt = now;
          } else {
            ensure(
              b.noShow.status === 'REPORTED',
              'INVALID_STATE',
              'The therapist must submit a report first.',
              409,
            );
            // The shop both reports and confirms an in-store no-show, so the customer is
            // notified of the report and any reply in this window stops the fee.
            ensure(
              !inStore ||
                now >= (b.noShow.reportedAt ?? now) + IN_STORE_NO_SHOW_REPLY_MINUTES * minute,
              'NO_SHOW_NOT_READY',
              'The customer can still reply to this report.',
              409,
            );
            const payment = await tx.get<Payment>('payments', b.paymentId);
            ensure(
              payment &&
                payment.bookingId === b.id &&
                payment.expiresAt > now &&
                ['AUTHORIZED', 'METHOD_SAVED'].includes(payment.status),
              'PAYMENT_REQUIRED',
              'A payment guarantee is required.',
              402,
            );
            const fee = Math.floor(
              ((b.quote.total - b.quote.transportFee) * policy.feeBps) / 10000,
            );
            ensure(
              fee <= payment.amount,
              'PAYMENT_REQUIRED',
              'The fee exceeds the agreed guarantee.',
              402,
            );
            b.noShow.status = 'CONFIRMED';
            b.noShow.resolvedAt = now;
            b.noShow.fee = fee;
            await this.closeBooking(tx, b, 'CANCELLED', 'CUSTOMER_NO_SHOW', fee, 'NO_SHOW');
          }
        }
      }
      await tx.put('noShowRequests', { id: requestId, hash });
      if (data.action !== 'CONTACT') {
        b.noShow!.reviewNote = data.text;
        await tx.put('noShowDecisions', {
          id: requestId,
          bookingId,
          actorId: actor.id,
          action: data.action,
          note: data.text,
          at: now,
        });
      }
      // Message body stays in the access-controlled conversation, not the shared audit/outbox.
      return this.save(tx, b, actor, `NO_SHOW_${data.action}`, b.noShow?.status);
    });
  }
  private async closeBooking(
    tx: Records,
    b: Booking,
    status: 'CANCELLED' | 'REJECTED' | 'EXPIRED',
    reason: string,
    fee = 0,
    feeType = 'CANCELLATION',
  ) {
    b.status = status;
    b.cancelReason = reason;
    if (b.noShow && ['CONTACTING', 'REPORTED'].includes(b.noShow.status)) {
      b.noShow.status = 'DISMISSED';
      b.noShow.resolvedAt = this.now();
    }
    const p = await tx.get<Payment>('payments', b.paymentId);
    if (fee > 0) {
      b.capturedAmount = fee;
      b.paymentStatus = 'PAID';
      if (p) {
        p.status = 'PAID';
        p.capturedAmount = fee;
        p.voidedAmount = p.amount - fee;
      }
      const feeId = id('fee');
      await tx.put('feeEntries', {
        id: feeId,
        bookingId: b.id,
        storeId: b.storeId,
        amount: 0,
        type: feeType,
        createdAt: this.now(),
      });
      await recordMoney(tx, b, feeId, 'CANCELLATION', fee, 0, 0, this.now());
    } else {
      b.paymentStatus = 'VOIDED';
      if (p) {
        p.status = 'VOIDED';
        p.capturedAmount = 0;
        p.voidedAmount = p.amount;
      }
    }
    if (p) await tx.put('payments', p);
    await this.release(tx, b);
  }
  private cancellationCost(actor: Actor, b: Booking) {
    const provider =
      actor.role === 'MERCHANT' ||
      b.replacementConsent === 'PENDING' ||
      ['DECLINED', 'WITHDRAWN'].includes(b.staffTaskStatus) ||
      lateInstant(b, this.now());
    // A failed pre-visit authorization lapses into a free cancellation anyway.
    const late =
      !provider &&
      b.paymentStatus !== 'FAILED' &&
      b.quote.startAt - this.now() < b.quote.cancellationPolicy.freeBeforeMinutes * minute;
    const instant =
      b.quote.bookingMode === 'INSTANT' && b.quote.cancellationPolicy.instantTravelOnly;
    const fee = instant
      ? !provider && ['EN_ROUTE', 'ARRIVED'].includes(b.status)
        ? b.quote.transportFee
        : 0
      : late
        ? Math.floor(
            ((b.quote.total - b.quote.transportFee) *
              scheduledCancellationBps(
                b.quote.cancellationPolicy,
                (b.quote.startAt - this.now()) / minute,
              )) /
              10000,
          )
        : 0;
    return {
      fee,
      reason: lateInstant(b, this.now())
        ? 'PROVIDER_ARRIVAL_DELAY'
        : provider
          ? 'MERCHANT_UNABLE'
          : 'CUSTOMER_REQUEST',
    };
  }
  async cancellationPreview(actor: Actor, bookingId: string) {
    this.role(actor, 'CUSTOMER', 'MERCHANT');
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId);
      ensure(!terminal.has(b.status), 'INVALID_STATE', 'This booking has already ended.', 409);
      ensure(
        !['IN_SERVICE', 'AWAITING_COMPLETION'].includes(b.status),
        'SERVICE_IN_PROGRESS',
        'Contact support to end a service already in progress.',
        409,
      );
      return {
        ...this.cancellationCost(actor, b),
        bookingVersion: b.version,
        serverNow: this.now(),
      };
    });
  }
  async cancel(
    actor: Actor,
    bookingId: string,
    version: number,
    reject = false,
    expectedFee?: number,
  ) {
    this.role(actor, 'CUSTOMER', 'MERCHANT');
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, version);
      ensure(!terminal.has(b.status), 'INVALID_STATE', 'This booking has already ended.', 409);
      ensure(
        !['IN_SERVICE', 'AWAITING_COMPLETION'].includes(b.status),
        'SERVICE_IN_PROGRESS',
        'Contact the shop or support to end a service that has already started.',
        409,
      );
      if (reject)
        ensure(
          actor.role === 'MERCHANT' && b.status === 'REQUESTED',
          'INVALID_STATE',
          'Only pending requests can be rejected.',
          409,
        );
      const { fee, reason } = this.cancellationCost(actor, b);
      ensure(
        expectedFee === undefined || expectedFee === fee,
        'CANCELLATION_PRICE_CHANGED',
        'Cancellation fee changed. Review the current fee before confirming.',
        409,
      );
      await this.closeBooking(
        tx,
        b,
        reject ? 'REJECTED' : 'CANCELLED',
        reject ? 'MERCHANT_REJECTED' : reason,
        fee,
      );
      if (reject) b.merchantAcceptance = 'REJECTED';
      return this.save(tx, b, actor, 'BOOKING_CANCELLED', `fee=${fee}`);
    });
  }
  async refund(actor: Actor, bookingId: string, version: number, amount: number) {
    this.role(actor, 'MERCHANT');
    ensure(
      Number.isSafeInteger(amount) && amount > 0,
      'INVALID_AMOUNT',
      'Enter a positive amount in yen.',
    );
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, version);
      return this.applyRefund(tx, actor, b, amount);
    });
  }
  private async applyRefund(tx: Records, actor: Actor, b: Booking, amount: number) {
    ensure(
      b.capturedAmount > 0 && amount <= b.capturedAmount - b.refundedAmount,
      'INVALID_AMOUNT',
      'The refund exceeds the remaining captured amount.',
    );
    await ensureMoneyOpening(tx, b, this.now());
    const oldReversal = Math.floor((b.platformFee * b.refundedAmount) / b.capturedAmount);
    b.refundedAmount += amount;
    b.paymentStatus = b.refundedAmount === b.capturedAmount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    const p = await tx.get<Payment>('payments', b.paymentId);
    if (p) {
      p.status = b.paymentStatus;
      p.refundedAmount = b.refundedAmount;
      await tx.put('payments', p);
    }
    const feeId = id('fee'),
      reversal = -(Math.floor((b.platformFee * b.refundedAmount) / b.capturedAmount) - oldReversal);
    await tx.put('feeEntries', {
      id: feeId,
      bookingId: b.id,
      storeId: b.storeId,
      amount: reversal,
      type: 'REFUND',
      createdAt: this.now(),
    });
    await recordMoney(tx, b, feeId, 'REFUND', 0, amount, reversal, this.now());
    return this.save(tx, b, actor, 'DEMO_REFUND_SUCCEEDED', `amount=${amount}`);
  }
  async safety(actor: Actor, bookingId: string, type: SafetyEvent['type'], version: number) {
    this.role(actor, 'STAFF');
    return this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId, version);
      ensure(!terminal.has(b.status), 'INVALID_STATE', 'This task has ended.', 409);
      const existing = (await tx.list<SafetyEvent>('safety')).find(
        (x) => x.bookingId === b.id && x.type === type && x.status === 'OPEN',
      );
      if (existing) return this.redact(b, actor);
      await tx.put<SafetyEvent>('safety', {
        id: id('safety'),
        bookingId: b.id,
        staffId: actor.staffId!,
        storeId: b.storeId,
        type,
        status: 'OPEN',
        createdAt: this.now(),
      });
      if (type === 'SAFETY_TERMINATION')
        await this.closeBooking(tx, b, 'CANCELLED', 'SAFETY_TERMINATION');
      return this.save(tx, b, actor, type);
    });
  }
  async messages(actor: Actor, bookingId: string, text?: string) {
    const result = await this.run(async (tx) => {
      const b = await this.getBooking(tx, actor, bookingId);
      if (actor.role === 'STAFF')
        ensure(
          b.staffTaskStatus === 'ACKNOWLEDGED' &&
            ['CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'IN_SERVICE'].includes(b.status) &&
            b.replacementConsent !== 'PENDING',
          'FORBIDDEN',
          'Messages are not available for this task.',
          403,
        );
      if (text !== undefined) {
        ensure(
          text.trim().length > 0 && text.length <= 1000,
          'INVALID_MESSAGE',
          'Enter a message of up to 1,000 characters.',
        );
        const matched = contentRuleIds(text);
        if (matched.length) {
          await queueContentReview(tx, actor, b.id, text, matched, this.now());
          return { blocked: true as const };
        }
        let safe = text.trim();
        if (!['CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'IN_SERVICE', 'COMPLETED'].includes(b.status))
          safe = safe.replace(
            /(?:\+?\d[\d\s().-]{6,}\d)|(?:[\w.+-]+@[\w.-]+\.[a-z]{2,})|(?:(?:line|ライン|微信|wechat)\s*[:：@]?\s*[\w.-]+)/gi,
            '[contact hidden]',
          );
        await tx.put<Message>('messages', {
          id: id('msg'),
          bookingId: b.id,
          actorId: actor.id,
          role: actor.role,
          text: safe,
          createdAt: this.now(),
        });
        await this.audit(tx, actor, 'MESSAGE_SENT', b.id);
      }
      return {
        messages: (await tx.find<Message>('messages', { bookingId: b.id })).sort(
          (a, b) => a.createdAt - b.createdAt,
        ),
      };
    });
    ensure(
      !result.blocked,
      'CONTENT_BLOCKED',
      'This message was not sent and has been queued for safety review.',
    );
    return result.messages!;
  }
  async dashboard(actor: Actor) {
    this.role(actor, 'MERCHANT', 'ADMIN');
    return this.run(async (tx) => ({
      stores: (await tx.list<Store>('stores')).filter(
        (s) => actor.role === 'ADMIN' || s.id === actor.storeId,
      ),
      listings: (await tx.list<Listing>('listings')).filter(
        (l) => actor.role === 'ADMIN' || l.storeId === actor.storeId,
      ),
      safety: (await tx.list<SafetyEvent>('safety'))
        .filter((x) => actor.role === 'ADMIN' || x.storeId === actor.storeId)
        .map((event) => safetyEventView(actor, event)),
      audit: (await tx.list<Audit>('audit'))
        .filter((x) => actor.role === 'ADMIN')
        .sort((a, b) => b.at - a.at)
        .slice(0, 100),
      feeEntries: (
        await tx.list<{
          id: string;
          storeId: string;
          amount: number;
          bookingId: string;
          type: string;
        }>('feeEntries')
      ).filter((x) => actor.role === 'ADMIN' || x.storeId === actor.storeId),
      outboxPending:
        actor.role === 'ADMIN'
          ? (await tx.list<{ status: string }>('outbox')).filter((x) => x.status === 'PENDING')
              .length
          : 0,
    }));
  }
  async duty(actor: Actor, onDuty: boolean, expectedAt?: number) {
    return this.staff.duty(actor, onDuty, expectedAt);
  }
  async enforce(actor: Actor, listingId: string, suspend: boolean, reason: string) {
    requireAdmin(actor, 'supply.write');
    this.role(actor, 'ADMIN');
    ensure(reason.trim().length >= 3, 'REASON_REQUIRED', 'Record the moderation reason.');
    return this.run(async (tx) => {
      const l = await tx.get<Listing>('listings', listingId);
      ensure(l, 'NOT_FOUND', 'Listing not found.', 404);
      if (!suspend) {
        const store = await tx.get<Store>('stores', l.storeId);
        ensure(
          l.membershipActive &&
            l.identityVerified &&
            l.portraitConsent &&
            store?.active &&
            store.approved &&
            store.pspAccount,
          'LISTING_UNAVAILABLE',
          'Publication requirements are incomplete.',
          409,
        );
      }
      l.publicationStatus = suspend ? 'SUSPENDED' : 'PUBLISHED_INDEXABLE';
      l.moderationVersion = (l.moderationVersion ?? 1) + 1;
      await tx.put('listings', l);
      await this.audit(
        tx,
        actor,
        suspend ? 'CONTENT_SUSPENDED' : 'CONTENT_RESTORED',
        undefined,
        `${listingId}:${reason.slice(0, 300)}`,
      );
      return l;
    });
  }
  async sweep(tx: Records) {
    await sweepOnboarding(tx, this.now());
    await sweepSubscriptions(tx, this.now());
    const stores = await tx.list<Store>('stores'),
      listings = await tx.list<Listing>('listings');
    for (const store of stores.filter((s) => s.acceptanceMode === 'SOLO')) {
      const team = listings.filter((l) => l.storeId === store.id && l.membershipActive);
      const shopCount = stores.filter((s) => s.merchantId === store.merchantId && s.active).length;
      if (
        shopCount === 1 &&
        team.length === 1 &&
        team[0].staffId === store.ownerStaffId &&
        team[0].identityVerified
      )
        continue;
      await tx.put('stores', {
        ...store,
        acceptanceMode: 'MANUAL',
        ruleVersion: store.ruleVersion + 1,
      });
      await this.audit(
        tx,
        { id: 'system', role: 'ADMIN', verificationLevel: 3 },
        'SOLO_EXITED',
        undefined,
        store.id,
      );
    }
    for (const block of await tx.find<TimeBlock>('timeBlocks', {
      active: true,
      endAt: { lte: this.now() },
    })) {
      if (block.active && block.endAt <= this.now()) {
        await tx.releaseInterval(`block:${block.id}`);
        await tx.put('timeBlocks', { ...block, active: false, version: block.version + 1 });
      }
    }
    await this.care.sweep(tx);
    const system: Actor = { id: 'system', role: 'ADMIN', verificationLevel: 3 };
    for (const request of await tx.find<TimeOffRequest>('timeOffRequests', {
      status: 'PENDING',
      startAt: { lte: this.now() },
    })) {
      if (request.status === 'PENDING' && request.startAt <= this.now()) {
        request.status = 'EXPIRED';
        request.version++;
        request.updatedAt = this.now();
        await tx.put('timeOffRequests', request);
        await this.audit(tx, system, 'TIME_OFF_EXPIRED', undefined, request.id);
      }
    }
    for (const h of await tx.find<Hold>('holds', { active: true, expiresAt: { lte: this.now() } }))
      if (h.active && h.phase === 'CHECKOUT_HOLD' && h.expiresAt <= this.now()) {
        h.active = false;
        await tx.put('holds', h);
        await tx.releaseInterval(h.id);
        await tx.releaseInterval(`resource:${h.id}`);
        for (const p of await tx.find<Payment>('payments', { holdId: h.id }))
          if (
            p.holdId === h.id &&
            !p.bookingId &&
            ['AUTHORIZED', 'METHOD_SAVED'].includes(p.status)
          ) {
            p.status = 'VOIDED';
            await tx.put('payments', p);
          }
      }
    for (const b of await tx.find<Booking>('bookings', { status: activeBookingStatuses })) {
      if (terminal.has(b.status)) continue;
      if (await this.paymentGuarantee(tx, b, system)) continue;
      if (
        fulfillmentMode(b.quote) === 'IN_STORE' &&
        b.status === 'CONFIRMED' &&
        b.staffTaskStatus === 'ACKNOWLEDGED' &&
        !b.visitReminderAt &&
        this.now() >= b.quote.startAt - 24 * 60 * minute
      ) {
        b.visitReminderAt = this.now();
        await this.save(
          tx,
          b,
          system,
          this.now() < b.quote.startAt
            ? 'IN_STORE_APPOINTMENT_REMINDER'
            : 'IN_STORE_ATTENDANCE_REVIEW',
        );
      }
      if (b.status === 'AWAITING_COMPLETION' && b.completion) {
        const c = b.completion;
        const p = await tx.get<Payment>('payments', b.paymentId);
        const paymentUnavailable = !p || p.status !== 'AUTHORIZED' || p.expiresAt <= this.now();
        if (c.status !== 'PAYMENT_REVIEW' && paymentUnavailable) {
          if (['PENDING', 'DISPUTED', 'TIMED_OUT'].includes(c.status))
            c.reviewStatus =
              c.status === 'PENDING' && c.confirmBy <= this.now()
                ? 'TIMED_OUT'
                : (c.status as 'PENDING' | 'DISPUTED' | 'TIMED_OUT');
          c.status = 'PAYMENT_REVIEW';
          c.history.push({ action: 'PAYMENT_REVIEW', role: 'ADMIN', at: this.now() });
          b.paymentStatus =
            p && p.expiresAt <= this.now()
              ? 'AUTH_EXPIRED'
              : p?.status === 'METHOD_SAVED'
                ? 'METHOD_SAVED'
                : 'FAILED';
          await completionCase(
            tx,
            b,
            this.now(),
            'Payment authorization expired or is unavailable. No automatic charge; manual review is required.',
          );
          await this.save(tx, b, system, 'COMPLETION_PAYMENT_REVIEW');
        } else if (c.status === 'PENDING' && c.confirmBy <= this.now()) {
          const eligibleAt = serviceEligibleAt(b);
          // Only an undisputed, full-length visit is accepted by silence; once anyone raised a
          // problem, the customer must confirm or the shop must close it out.
          const capturable =
            (await autoAcceptanceAllowed(tx, b)) &&
            !c.timingInvalid &&
            eligibleAt !== undefined &&
            c.endedAt >= eligibleAt &&
            startedOnTime(b) &&
            !c.history.some((h) => h.action === 'DISPUTE' || h.action === 'EXCEPTION') &&
            !!p &&
            p.verified3ds &&
            p.bookingId === b.id &&
            p.amount >= b.quote.total;
          if (capturable) {
            // No dispute within the disclosed window: the visit counts as accepted.
            c.status = 'CONFIRMED';
            c.confirmedAt = this.now();
            c.autoConfirmed = true;
            c.history.push({ action: 'AUTO_CONFIRMED', role: 'ADMIN', at: this.now() });
            await this.captureCompleted(tx, b);
            await completionReceipt(
              tx,
              b,
              system,
              this.now(),
              'No dispute within 72 hours after the visit ended; the authorized order amount was captured once.',
            );
            await this.save(tx, b, system, 'COMPLETION_AUTO_CONFIRMED');
          } else {
            c.status = 'TIMED_OUT';
            c.history.push({ action: 'TIMED_OUT', role: 'ADMIN', at: this.now() });
            await completionCase(
              tx,
              b,
              this.now(),
              'Customer completion confirmation timed out and the record cannot be charged automatically; the shop must follow up.',
            );
            await this.save(tx, b, system, 'COMPLETION_TIMED_OUT');
          }
        }
      }
      const replacementExpired =
        b.replacementConsent === 'PENDING' && b.replacementDeadline! <= this.now();
      const taskExpired =
        (['REQUESTED', 'ACCEPTED'].includes(b.status) && b.deadline <= this.now()) ||
        (b.status === 'CONFIRMED' &&
          b.staffTaskStatus !== 'ACKNOWLEDGED' &&
          b.deadline <= this.now());
      if (replacementExpired || taskExpired) {
        if (replacementExpired) b.replacementConsent = 'EXPIRED';
        if (b.merchantAcceptance === 'PENDING') b.merchantAcceptance = 'EXPIRED';
        if (b.staffTaskStatus === 'OFFERED') b.staffTaskStatus = 'EXPIRED';
        await this.closeBooking(tx, b, 'EXPIRED', 'TIMEOUT');
        await this.save(tx, b, system, 'BOOKING_EXPIRED');
      }
    }
    await sweepFulfillment(tx, this.now());
    await tx.clearDue(this.now());
  }
}
