import { z } from 'zod';
import type { FulfillmentMode, Venue, VenueSnapshot, PublicVenue } from './service-mode.js';
export type * from './service-mode.js';
export type * from './admin-operations.js';
export type * from './merchant-operations.js';

export const locales = ['ja', 'en', 'zh-cn'] as const;
export type Locale = (typeof locales)[number];
export const localeMap = {
  ja: { code: 'ja-JP', label: '日本語' },
  en: { code: 'en', label: 'English' },
  'zh-cn': { code: 'zh-CN', label: '简体中文' },
} as const;
export type Localized = Record<Locale, string>;
export const bookingStatuses = [
  'REQUESTED',
  'ACCEPTED',
  'CONFIRMED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_SERVICE',
  'AWAITING_COMPLETION',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type BookingStatus = (typeof bookingStatuses)[number];
export type PaymentStatus =
  | 'REQUIRES_METHOD'
  | 'METHOD_SAVED'
  | 'AUTHORIZED'
  | 'PAID'
  | 'VOIDED'
  | 'AUTH_EXPIRED'
  | 'FAILED'
  | 'REFUND_PENDING'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';
export type AcceptanceMode = 'MANUAL' | 'AUTO_PREAUTHORIZED' | 'SOLO';
export type Role = 'CUSTOMER' | 'MERCHANT' | 'STAFF' | 'ADMIN';
export type Actor = {
  id: string;
  role: Role;
  storeId?: string;
  staffId?: string;
  verificationLevel: number;
  adminRole?: AdminRole;
  adminTeams?: TicketTeam[];
  adminSessionVersion?: number;
  displayName?: string;
  partnerAccountId?: string;
  customerAccountId?: string;
  customerSessionVersion?: number;
  onboardingOnly?: boolean;
};
export type * from './onboarding.js';
export type * from './governance.js';
export type * from './finance.js';
export type * from './experience.js';
export const experienceDimensions = [
  'punctuality',
  'communication',
  'explanation',
  'cleanliness',
  'overall',
] as const;
export const adminRoles = [
  'OWNER',
  'OPERATIONS',
  'SUPPORT',
  'TRUST_SAFETY',
  'FINANCE',
  'AUDITOR',
] as const;
export type AdminRole = (typeof adminRoles)[number];
export const adminPermissions = [
  'overview.read',
  'orders.read',
  'supply.read',
  'supply.write',
  'cases.read',
  'cases.write',
  'cases.assign',
  'safety.write',
  'finance.read',
  'finance.write',
  'finance.approve',
  'finance.export',
  'audit.read',
  'system.read',
  'members.manage',
] as const;
export type AdminPermission = (typeof adminPermissions)[number];
export const adminRolePermissions: Record<AdminRole, readonly AdminPermission[]> = {
  OWNER: adminPermissions,
  OPERATIONS: [
    'overview.read',
    'orders.read',
    'supply.read',
    'supply.write',
    'cases.read',
    'cases.write',
    'cases.assign',
    'audit.read',
  ],
  SUPPORT: ['overview.read', 'orders.read', 'cases.read', 'cases.write'],
  TRUST_SAFETY: [
    'overview.read',
    'orders.read',
    'supply.read',
    'cases.read',
    'cases.write',
    'cases.assign',
    'safety.write',
    'audit.read',
  ],
  FINANCE: ['overview.read', 'orders.read', 'finance.read', 'finance.write', 'finance.export'],
  AUDITOR: [
    'overview.read',
    'orders.read',
    'supply.read',
    'finance.read',
    'audit.read',
    'system.read',
  ],
};
export const canAdmin = (actor: Actor | null | undefined, permission: AdminPermission) =>
  actor?.role === 'ADMIN' && adminRolePermissions[actor.adminRole ?? 'OWNER'].includes(permission);
export type AdminMember = {
  id: string;
  name: string;
  email: string;
  adminRole: AdminRole;
  teams: TicketTeam[];
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  version: number;
  sessionVersion: number;
  createdAt: number;
  updatedAt: number;
  inviteExpiresAt?: number;
  lastLoginAt?: number;
  bootstrap?: boolean;
};
export type AdminAssignee = Pick<AdminMember, 'id' | 'name' | 'adminRole' | 'teams'> & {
  openCases: number;
};
export type Store = {
  storefront?: PublishedStorefront;
  id: string;
  merchantId: string;
  slug: string;
  name: Localized;
  /** Public introduction, copied only from an approved merchant application. */
  description?: Localized;
  legalName: string;
  acceptanceMode: AcceptanceMode;
  active: boolean;
  approved: boolean;
  pspAccount: string;
  emergencyContact: string;
  areas: string[];
  plan: 'TRIAL' | 'STANDARD' | 'ANNUAL';
  billingBlocked?: boolean;
  ruleVersion: number;
  bookingRules?: StoreBookingRules;
  acceptanceRule?: AcceptanceRule;
  moderationVersion?: number;
  ownerStaffId?: string;
  legalAddress: string;
  contact: string;
  /** The live venue that bookings use. */
  venue?: Venue;
  /** Reviewed facts (address, photos, ...) awaiting platform review; the live venue keeps serving. */
  venueDraft?: Venue;
  homeVisitsEnabled?: boolean;
  /** Shop-owned intake switch, independent of platform suspension and existing orders. */
  intakePaused?: boolean;
  intakeVersion?: number;
};
export type Offering = {
  fulfillmentMode?: FulfillmentMode;
  id: string;
  storeId: string;
  name: Localized;
  durationMinutes: number;
  price: number;
  transportFee: number;
  version: number;
  approved: boolean;
  active?: boolean;
  regulatoryCategory: 'RELAXATION' | 'LICENSED';
  /** When the current regular price took effect (for fair price comparisons). */
  priceSince?: number;
  promotion?: OfferingPromotion;
  /** Past promotion windows, newest last, kept for the comparison look-back. */
  promotionHistory?: PromotionWindow[];
};
export type PublicStore = Pick<
  Store,
  | 'id'
  | 'slug'
  | 'name'
  | 'description'
  | 'legalName'
  | 'legalAddress'
  | 'contact'
  | 'acceptanceMode'
  | 'active'
  | 'approved'
  | 'areas'
> & {
  storefront?: PublishedStorefront;
  venue?: PublicVenue;
  homeVisitsEnabled?: boolean;
  bookingRules?: Pick<
    StoreBookingRules,
    | 'version'
    | 'nominationFee'
    | 'templateId'
    | 'cancellationPolicy'
    | 'timeSurcharges'
    | 'areaTransportFees'
    | 'businessHours'
  >;
};
export type Listing = {
  serviceModesVersion?: number;
  fulfillmentModes?: FulfillmentMode[];
  id: string;
  slug: string;
  storeId: string;
  staffId: string;
  name: Localized;
  description: Localized;
  languages: string[];
  initials: string;
  color: string;
  publicationStatus: 'PUBLISHED_INDEXABLE' | 'SUSPENDED';
  moderationVersion?: number;
  membershipActive: boolean;
  portraitConsent: boolean;
  identityVerified: boolean;
  onDuty: boolean;
  dutyUpdatedAt: number;
  offeringIds: string[];
  hotelOnly: boolean;
  /** The main photo shown on cards, at checkout and for recognizing the therapist at the door. */
  photo: string;
  /** Approved gallery photos and introduction video, in display order (public view only). */
  media?: PublicListingMedia[];
  /** The approved gallery photo currently used as the main photo. */
  coverMediaId?: string;
  /** The onboarding portrait to restore when the chosen gallery cover is taken down. */
  basePhoto?: string;
  /** When the therapist works scheduled visits. Unset keeps every business hour bookable. */
  shifts?: StaffShifts;
  /** Safety conditions approved by the shop; enforced as hard filters on new home visits. */
  safetyConditions?: SafetyConditions & { approvedAt: number; approvedBy: string };
  /** A stricter condition the therapist asked for, waiting for the shop. */
  safetyRequest?: {
    conditions: SafetyConditions;
    requestedAt: number;
    status: 'PENDING' | 'REJECTED';
    note?: string;
  };
};
export type SafetyConditions = {
  /** 22:00-06:00 home visits only for customers who completed a visit with this shop. */
  noFirstLateNight: boolean;
};
export const safetyConditionsInput = z.object({ noFirstLateNight: z.boolean() }).strict();
/** Whether a visit start falls in the late-night band used by safety rules (22:00-06:00 JST). */
export const lateNight = (startAt: number) => {
  const hour = new Date(startAt + 9 * 3_600_000).getUTCHours();
  return hour >= 22 || hour < 6;
};
/** Scheduled home travel may be recorded within 90 minutes before the appointment. */
export const HOME_TRAVEL_RECORD_LEAD_MINUTES = 90;
export function travelRecordOpensAt(
  quote: Pick<Quote, 'fulfillmentMode' | 'bookingMode' | 'startAt'>,
) {
  return fulfillmentMode(quote) === 'HOME_VISIT' && quote.bookingMode === 'SCHEDULED'
    ? quote.startAt - HOME_TRAVEL_RECORD_LEAD_MINUTES * 60000
    : undefined;
}
/** JST minutes; an end at or before the start runs past midnight and belongs to the start day. */
export type ShiftWindow = { startMinute: number; endMinute: number };
export type StaffShifts = {
  version: number;
  /** Seven days, Sunday first; an empty day is a day off. */
  weekly: ShiftWindow[][];
  /** Replacements for single dates (YYYY-MM-DD); an empty list is a day off. */
  exceptions: { date: string; windows: ShiftWindow[] }[];
  updatedAt: number;
  updatedBy: string;
};
const shiftWindowInput = z
  .object({
    startMinute: z.number().int().min(0).max(1410).multipleOf(30),
    endMinute: z.number().int().min(30).max(1440).multipleOf(30),
  })
  .strict()
  .refine((w) => w.startMinute !== w.endMinute % 1440 || w.endMinute === 1440);
export const staffShiftsInput = z
  .object({
    version: z.number().int().min(0),
    weekly: z.array(z.array(shiftWindowInput).max(2)).length(7),
    exceptions: z
      .array(
        z
          .object({
            date: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),
            windows: z.array(shiftWindowInput).max(2),
          })
          .strict(),
      )
      .max(90)
      .refine((list) => new Set(list.map((x) => x.date)).size === list.length),
  })
  .strict();
/** Whether a scheduled visit lies wholly inside one of the therapist's working windows. */
export function withinShifts(
  shifts: Pick<StaffShifts, 'weekly' | 'exceptions'> | undefined,
  startAt: number,
  endAt: number,
) {
  if (!shifts) return true;
  const day = 86_400_000,
    midnight = Math.floor((startAt + 9 * 3_600_000) / day) * day - 9 * 3_600_000;
  for (const base of [midnight - day, midnight]) {
    const date = new Date(base + 9 * 3_600_000);
    const windows =
      shifts.exceptions.find((x) => x.date === date.toISOString().slice(0, 10))?.windows ??
      shifts.weekly[date.getUTCDay()] ??
      [];
    for (const w of windows) {
      const from = base + w.startMinute * 60_000,
        to = base + (w.endMinute <= w.startMinute ? w.endMinute + 1440 : w.endMinute) * 60_000;
      if (startAt >= from && endAt <= to) return true;
    }
  }
  return false;
}
export type Quote = {
  fulfillmentMode?: FulfillmentMode;
  venue?: VenueSnapshot;
  completionPolicy?: { version: 'silence-72h-v1'; windowHours: 72 };
  id: string;
  customerId: string;
  listingId: string;
  storeId: string;
  merchantId: string;
  offeringId: string;
  offeringVersion: number;
  serviceName?: Localized;
  regulatoryCategory?: 'RELAXATION' | 'LICENSED';
  storeRuleVersion?: number;
  bookingRulesVersion?: number;
  startAt: number;
  endAt: number;
  expiresAt: number;
  bookingMode: 'INSTANT' | 'SCHEDULED';
  nominationType: 'NOMINATED' | 'FREE';
  area: string;
  requiredLanguage: string;
  serviceFee: number;
  /** Set when serviceFee is a shop promotion price; the regular price at quote time. */
  promotionId?: string;
  regularServiceFee?: number;
  nominationFee: number;
  transportFee: number;
  /** Shop time-band surcharge (e.g. late night) by the visit start in JST; absent means none. */
  timeSurcharge?: number;
  total: number;
  cancellationPolicy: CancellationPolicy;
};
export type Hold = {
  resourceId?: string;
  id: string;
  quoteId: string;
  customerId: string;
  listingId: string;
  staffId: string;
  phase: 'CHECKOUT_HOLD' | 'BOOKING_RESERVATION' | 'CONFIRMED_BLOCK';
  expiresAt: number;
  bookingId?: string;
  active: boolean;
  createdAt: number;
};
export type Address = {
  name: string;
  area: string;
  type: 'HOTEL' | 'HOME';
  detail: string;
  hotelName: string;
  room: string;
  hotelPermission: boolean;
};
export type Booking = {
  id: string;
  customerId: string;
  merchantId: string;
  storeId: string;
  selectedStaffId: string | null;
  selectedStaffListingId: string | null;
  assignedStaffId: string | null;
  assignedListingId: string | null;
  status: BookingStatus;
  merchantAcceptance: 'PENDING' | 'MANUALLY_ACCEPTED' | 'AUTO_ACCEPTED' | 'REJECTED' | 'EXPIRED';
  staffTaskStatus: 'NOT_SENT' | 'OFFERED' | 'ACKNOWLEDGED' | 'DECLINED' | 'EXPIRED' | 'WITHDRAWN';
  acceptanceMode: AcceptanceMode;
  paymentStatus: PaymentStatus;
  /**
   * Set when the pre-visit authorization of a far-future booking failed: the customer must
   * renew the payment guarantee by this time, otherwise the booking is cancelled free.
   */
  paymentActionBy?: number;
  acceptanceDecision?: AcceptanceDecision;
  replacementConsent: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'DECLINED' | 'EXPIRED';
  proposedListingId?: string;
  replacementDeadline?: number;
  cancelReason?: string;
  quote: Quote;
  address?: Address;
  contact?: { name: string; phone: string };
  resourceId?: string;
  checkIn?: { at: number; actorId: string };
  resourceName?: string;
  checkInCode?: string;
  visitReminderAt?: number;
  legalNameSnapshot: string;
  deadline: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  capturedAmount: number;
  refundedAmount: number;
  platformFee: number;
  captureFeeRateBps?: number;
  arrivalMinutes?: number;
  arrivedAt?: number;
  startedAt?: number;
  completedAt?: number;
  completion?: {
    status: 'PENDING' | 'DISPUTED' | 'TIMED_OUT' | 'PAYMENT_REVIEW' | 'CONFIRMED' | 'VOIDED';
    eligibleAt: number;
    timingInvalid?: boolean;
    endedAt: number;
    requestedAt: number;
    confirmBy: number;
    confirmedAt?: number;
    /** Confirmed because no dispute arrived within the disclosed window. */
    autoConfirmed?: boolean;
    ticketId?: string;
    reviewStatus?: 'PENDING' | 'DISPUTED' | 'TIMED_OUT';
    history: { action: string; at: number; role: Role; note?: string }[];
  };
  arrival?: {
    promisedAt: number;
    revisedAt?: number;
    reason?: 'TRAFFIC' | 'PREVIOUS_VISIT' | 'TRANSPORT' | 'OTHER';
    reportedAt?: number;
  };
  noShow?: {
    status: 'CONTACTING' | 'REPORTED' | 'CONFIRMED' | 'DISMISSED';
    startedAt: number;
    waitUntil: number;
    contacts: { id: string; messageId: string; at: number; actorId: string }[];
    reportedAt?: number;
    resolvedAt?: number;
    fee?: number;
    reviewNote?: string;
  };
  paymentId: string;
  holdId: string;
};
export type Audit = {
  id: string;
  bookingId?: string;
  bookingVersion?: number;
  actorId: string;
  actorRole?: import('./admin-operations.js').AuditActorRole;
  action: string;
  at: number;
  detail: string;
};
export type SafetyEvent = {
  /** View-only delivery state; acceptance does not prove a recipient has read the alert. */
  notificationStatus?: 'NOT_CONFIGURED' | 'PENDING' | 'SENT' | 'PARTIAL' | 'FAILED';
  /** Therapist-safe progress, without internal safety notes or operator identity. */
  followUp?: 'SHOP_CONTACTED' | 'PLATFORM_HANDLING';
  /** Shop follow-up is shared only with that shop and the platform safety team. */
  merchantContact?: { at: number; note: string };
  id: string;
  bookingId: string;
  staffId: string;
  storeId: string;
  type: 'SOS' | 'SAFETY_TERMINATION' | 'MISSED_CHECK_IN';
  status: 'OPEN' | 'RESOLVED';
  createdAt: number;
  version?: number;
  resolvedAt?: number;
  resolvedBy?: string;
  resolution?: string;
  /** Internal safety-team work; omitted from merchant and therapist views. */
  handling?: import('./admin-operations.js').SafetyHandling;
  /** Shared once by the therapist after raising the event; shown to the shop and safety team while open. */
  location?: SafetyLocation;
  /** View only: the shop's emergency number, shown to the therapist who raised the event. */
  emergencyContact?: string;
};
export type SafetyLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  sharedAt: number;
};
export const safetyLocationInput = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000),
  })
  .strict();
/** What the safety team may see during an open safety event, after recording a reason. */
export type EmergencyLocation = {
  eventId: string;
  bookingId: string;
  mode: 'HOME_VISIT' | 'IN_STORE';
  address?: string;
  place?: string;
  storeEmergencyContact: string;
  location?: SafetyLocation;
};
export const supportCategories = [
  'SERVICE_QUALITY',
  'PRICE_OR_REFUND',
  'LATE_ARRIVAL',
  'MERCHANT_UNREACHABLE',
  'QUALIFICATION',
  'SAFETY',
  'PRIVACY',
  'FINANCIAL',
  'APPEAL',
] as const;
export type SupportCategory = (typeof supportCategories)[number];
export type SupportTicketStatus =
  'OPEN' | 'NEEDS_MERCHANT' | 'PLATFORM_ESCALATED' | 'RESOLVED' | 'CLOSED';
export type SupportTicket = {
  id: string;
  refundRequestId?: string;
  bookingId?: string;
  storeId?: string;
  customerId: string;
  reporterId: string;
  reporterRole: 'CUSTOMER' | 'STAFF';
  category: SupportCategory;
  subject: string;
  description: string;
  visibility: 'SHOP_AND_CUSTOMER' | 'PLATFORM_ONLY';
  priority: 'NORMAL' | 'HIGH';
  status: SupportTicketStatus;
  version: number;
  createdAt: number;
  updatedAt: number;
  dueAt: number;
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: number;
  restrictionVersion?: number;
  sourceSafetyEventId?: string;
};
/** A photo added to a case as evidence; the file is only served through the case's visibility. */
export type TicketAttachment = { id: string; role: Role; createdAt: number };
export type TicketMessage = {
  id: string;
  ticketVersion?: number;
  ticketId: string;
  actorId: string;
  role: Role;
  text: string;
  kind: 'MESSAGE' | 'RESOLUTION' | 'ESCALATION' | 'REOPEN';
  createdAt: number;
};
// Stored separately from requester-visible tickets and messages.
export const ticketTeams = ['CUSTOMER_SUPPORT', 'MERCHANT_OPERATIONS', 'TRUST_SAFETY'] as const;
export type TicketTeam = (typeof ticketTeams)[number];
export const ticketHandlingStates = [
  'TRIAGE',
  'ACTIVE',
  'WAITING_CUSTOMER',
  'WAITING_MERCHANT',
  'WAITING_INTERNAL',
] as const;
export type TicketHandling = {
  id: string;
  version: number;
  team: (typeof ticketTeams)[number];
  ownerId: string | null;
  state: (typeof ticketHandlingStates)[number] | 'DONE';
  followUpAt: number;
  updatedAt: number;
};
export type TicketHandlingLog = TicketHandling & {
  id: string;
  ticketId: string;
  actorId: string;
  kind: 'UPDATED' | 'REPLY_RECEIVED' | 'RESOLVED' | 'REOPENED' | 'ESCALATED' | 'OWNER_UNAVAILABLE';
  note?: string;
};
export type TicketHandlingDetail = {
  handling: TicketHandling;
  history: TicketHandlingLog[];
  assignees?: AdminAssignee[];
  people?: { id: string; name: string }[];
};
export const ticketHandlingInput = z
  .object({
    ticketVersion: z.number().int().positive(),
    version: z.number().int().nonnegative(),
    team: z.enum(ticketTeams),
    state: z.enum(ticketHandlingStates),
    ownership: z.enum(['KEEP', 'CLAIM', 'RELEASE', 'ASSIGN']),
    assigneeId: z.string().min(1).optional(),
    followUpAt: z.number().int().positive(),
    note: z.string().trim().min(10).max(3000),
  })
  .strict();
export type CustomerBlock = {
  id: string;
  storeId: string;
  customerId: string;
  active: boolean;
  reason: string;
  reviewRequired: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
};
export type CustomerRestriction = {
  id: string;
  active: boolean;
  reason: string;
  expiresAt: number;
  version: number;
  createdAt: number;
  updatedAt: number;
};
export type PublicRestriction = Pick<CustomerRestriction, 'id' | 'expiresAt' | 'version'>;
export const supportTicketInput = z
  .object({
    bookingId: z.string().optional(),
    category: z.enum([
      'SERVICE_QUALITY',
      'PRICE_OR_REFUND',
      'LATE_ARRIVAL',
      'MERCHANT_UNREACHABLE',
      'QUALIFICATION',
      'SAFETY',
      'PRIVACY',
      'FINANCIAL',
    ]),
    subject: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(3000),
  })
  .strict();
export const ticketActionInput = z
  .object({
    version: z.number().int().positive(),
    action: z.enum(['ESCALATE', 'RESOLVE', 'CLOSE', 'REOPEN']),
    text: z.string().trim().min(3).max(3000),
    releaseRestriction: z.boolean().default(false),
    releaseShopBlock: z.boolean().default(false),
  })
  .strict();
export const customerBlockInput = z
  .object({
    active: z.boolean(),
    reason: z.string().trim().min(3).max(1000),
    version: z.number().int().min(0),
  })
  .strict();
export const customerRestrictionInput = z
  .object({
    customerId: z.string().min(1),
    active: z.boolean(),
    reason: z.string().trim().min(3).max(1000),
    expiresAt: z.number().int().positive(),
    version: z.number().int().min(0),
  })
  .strict();
export type Message = {
  id: string;
  bookingId: string;
  actorId: string;
  role: Role;
  text: string;
  createdAt: number;
};
export type ApiError = { error: { code: string; message: string }; requestId?: string };
export type AdminBooking = Omit<
  Booking,
  'address' | 'contact' | 'checkInCode' | 'customerId' | 'paymentId' | 'holdId' | 'quote'
> & { quote: Omit<Quote, 'customerId'> };
export type AdminReview = {
  id: string;
  targetType: 'STORE' | 'LISTING' | 'OFFERING';
  targetId: string;
  storeId: string;
  decision: 'APPROVE' | 'SUSPEND' | 'REJECT';
  reason: string;
  actorId: string;
  at: number;
  previousVersion: number;
  nextVersion: number;
};
export type TimeOffRequest = {
  id: string;
  storeId: string;
  listingId: string;
  staffId: string;
  startAt: number;
  endAt: number;
  reason: 'BREAK' | 'TIME_OFF' | 'TRAINING';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED';
  version: number;
  createdAt: number;
  updatedAt: number;
  blockId?: string;
};
export const quoteInput = z
  .object({
    fulfillmentMode: z.enum(['HOME_VISIT', 'IN_STORE']).default('HOME_VISIT'),
    listingId: z.string().min(1),
    offeringId: z.string().min(1),
    bookingMode: z.enum(['INSTANT', 'SCHEDULED']),
    nominationType: z.enum(['NOMINATED', 'FREE']),
    startAt: z.number().int().positive(),
    area: z.enum(['', 'shinjuku', 'shibuya', 'minato', 'chuo', 'taito']).default(''),
    requiredLanguage: z.enum(['', 'ja', 'en', 'zh']).default(''),
  })
  .strict();
export const addressInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    area: z.string(),
    type: z.enum(['HOTEL', 'HOME']),
    detail: z.string().trim().min(5).max(250),
    hotelName: z.string().trim().max(100).default(''),
    room: z.string().trim().max(30).default(''),
    hotelPermission: z.boolean().default(false),
  })
  .strict();
export const bookingInput = z
  .object({
    holdId: z.string(),
    quoteId: z.string(),
    paymentId: z.string(),
    address: addressInput.optional(),
    contact: z
      .object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().min(5).max(40) })
      .strict()
      .optional(),
    termsAccepted: z.literal(true),
    policyVersion: z.string(),
  })
  .strict();
export const versionInput = z.object({ version: z.number().int().positive() });
export type CancellationPolicy = {
  version: string;
  freeBeforeMinutes: number;
  lateFeeBps: number;
  scheduledTiers?: { withinMinutes: number; feeBps: number }[];
  instantDelayGraceMinutes?: number;
  instantTravelOnly?: boolean;
  noShow?: { feeBps: number; waitMinutes: number; minContacts: number; contactGapMinutes: number };
};
/**
 * A shop's surcharge for visits that start inside a band of Japan time, e.g. 22:00-06:00.
 * Minutes count from 00:00 JST; an end before the start crosses midnight. The start is
 * inclusive and the end exclusive, and only the visit start decides it, so a visit is never
 * charged twice for running past midnight.
 */
export type TimeSurcharge = { startMinute: number; endMinute: number; amount: number };
export type StoreBookingRules = {
  version: number;
  nominationFee: number;
  templateId: 'LEGACY' | 'FLEXIBLE_2H' | 'STANDARD_24H' | 'CUSTOM';
  cancellationPolicy: CancellationPolicy;
  timeSurcharges?: TimeSurcharge[];
  /**
   * Travel fee by service area (e.g. { shinjuku: 0, minato: 1500 }). A listed area replaces the
   * menu's travel fee; other areas use the menu's own fee. Free-travel menus stay free.
   */
  areaTransportFees?: Record<string, number>;
  /**
   * When scheduled visits may start, in JST minutes. An end before the start crosses
   * midnight; 0-1440 means all day. Unset shops use the platform default 09:00-22:00.
   * Instant visits follow on-duty status instead.
   */
  businessHours?: BusinessHours;
};
export type BusinessHours = { startMinute: number; endMinute: number };
export const DEFAULT_BUSINESS_HOURS: BusinessHours = { startMinute: 9 * 60, endMinute: 22 * 60 };
/** Whether a scheduled visit may start at `startAt` under the shop's business hours. */
export function withinBusinessHours(
  rules: { businessHours?: BusinessHours } | undefined,
  startAt: number,
) {
  const hours = rules?.businessHours ?? DEFAULT_BUSINESS_HOURS;
  const minute = japanMinute(startAt);
  return surchargeSegments(hours).some(([start, end]) => minute >= start && minute < end);
}
export const businessHoursInput = z
  .object({
    startMinute: z.number().int().min(0).max(1410).multipleOf(30),
    endMinute: z.number().int().min(30).max(1440).multipleOf(30),
  })
  .strict()
  .refine((h) => h.startMinute !== h.endMinute % 1440 || h.endMinute === 1440);
export const AREA_TRAVEL_RULES = { maxFee: 20000 } as const;
/** The travel fee a visit to `area` pays for this menu under the shop's current rules. */
export function travelFeeFor(
  offering: { transportFee: number },
  rules: { areaTransportFees?: Record<string, number> } | undefined,
  area?: string,
) {
  if (offering.transportFee === 0) return 0;
  const byArea = area ? rules?.areaTransportFees?.[area] : undefined;
  return byArea ?? offering.transportFee;
}
export const areaTransportFeesInput = z
  .record(
    z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
    z.number().int().min(0).max(AREA_TRAVEL_RULES.maxFee),
  )
  .refine((fees) => Object.keys(fees).length <= 50);
export const TIME_SURCHARGE_RULES = {
  maxBands: 2,
  stepMinutes: 15,
  minAmount: 100,
  maxAmount: 20000,
} as const;
const japanMinute = (at: number) =>
  Math.floor(((((at + 9 * 3_600_000) % 86_400_000) + 86_400_000) % 86_400_000) / 60_000);
const surchargeSegments = (band: Pick<TimeSurcharge, 'startMinute' | 'endMinute'>) =>
  band.startMinute < band.endMinute
    ? [[band.startMinute, band.endMinute]]
    : [
        [band.startMinute, 1440],
        [0, band.endMinute],
      ];
export function surchargeBandsOverlap(a: TimeSurcharge, b: TimeSurcharge) {
  return surchargeSegments(a).some(([as, ae]) =>
    surchargeSegments(b).some(([bs, be]) => as < be && bs < ae),
  );
}
/** The surcharge that applies to a visit starting at `startAt`; 0 when no band covers it. */
export function timeSurchargeAt(
  rules: { timeSurcharges?: TimeSurcharge[] } | undefined,
  startAt: number,
) {
  const minute = japanMinute(startAt);
  return (
    rules?.timeSurcharges?.find((band) =>
      surchargeSegments(band).some(([start, end]) => minute >= start && minute < end),
    )?.amount ?? 0
  );
}
const timeSurchargeInput = z
  .object({
    startMinute: z.number().int().min(0).max(1439).multipleOf(TIME_SURCHARGE_RULES.stepMinutes),
    endMinute: z.number().int().min(0).max(1439).multipleOf(TIME_SURCHARGE_RULES.stepMinutes),
    amount: z
      .number()
      .int()
      .min(TIME_SURCHARGE_RULES.minAmount)
      .max(TIME_SURCHARGE_RULES.maxAmount),
  })
  .strict()
  .refine((band) => band.startMinute !== band.endMinute);
export const timeSurchargesInput = z
  .array(timeSurchargeInput)
  .max(TIME_SURCHARGE_RULES.maxBands)
  .refine((bands) =>
    bands.every((band, i) =>
      bands.slice(i + 1).every((other) => !surchargeBandsOverlap(band, other)),
    ),
  )
  .transform((bands) => [...bands].sort((a, b) => a.startMinute - b.startMinute));
export type BookingRulesHistory = StoreBookingRules & {
  id: string;
  storeId: string;
  changedBy: string;
  changedAt: number;
};
export const customCancellationInput = z
  .object({
    freeBeforeMinutes: z.number().int().min(30).max(10080),
    lateFeeBps: z.number().int().min(0).max(9900),
    nearBeforeMinutes: z.number().int().min(0).max(10080),
    nearFeeBps: z.number().int().min(0).max(9900),
    noShowFeeBps: z.number().int().min(0).max(9900),
  })
  .strict()
  .refine(
    (p) =>
      p.nearBeforeMinutes < p.freeBeforeMinutes &&
      (p.nearBeforeMinutes === 0 || p.nearFeeBps >= p.lateFeeBps) &&
      p.noShowFeeBps >= (p.nearBeforeMinutes > 0 ? p.nearFeeBps : p.lateFeeBps),
  );
export type CustomCancellation = z.infer<typeof customCancellationInput>;
export const storeBookingRulesInput = z
  .object({
    version: z.number().int().min(0),
    nominationFee: z.number().int().min(0).max(200000),
    templateId: z.enum(['FLEXIBLE_2H', 'STANDARD_24H', 'CUSTOM']),
    customPolicy: customCancellationInput.optional(),
    /** Omitted keeps the current bands, so older clients cannot erase them by accident. */
    timeSurcharges: timeSurchargesInput.optional(),
    /** Omitted keeps the current table; {} removes it. Areas must be the shop's own. */
    areaTransportFees: areaTransportFeesInput.optional(),
    /** Omitted keeps the current hours. */
    businessHours: businessHoursInput.optional(),
  })
  .strict()
  .refine((d) => (d.templateId === 'CUSTOM' ? !!d.customPolicy : d.customPolicy === undefined));

export function makeCancellationPolicy(
  templateId: 'FLEXIBLE_2H' | 'STANDARD_24H' | 'CUSTOM',
  version: string,
  custom?: CustomCancellation,
): CancellationPolicy {
  const values: CustomCancellation =
    templateId === 'CUSTOM'
      ? customCancellationInput.parse(custom)
      : templateId === 'STANDARD_24H'
        ? {
            freeBeforeMinutes: 1440,
            lateFeeBps: 3000,
            nearBeforeMinutes: 180,
            nearFeeBps: 5000,
            noShowFeeBps: 5000,
          }
        : {
            freeBeforeMinutes: 120,
            lateFeeBps: 3000,
            nearBeforeMinutes: 0,
            nearFeeBps: 3000,
            noShowFeeBps: 3000,
          };
  return {
    version,
    freeBeforeMinutes: values.freeBeforeMinutes,
    lateFeeBps: values.lateFeeBps,
    scheduledTiers: [
      ...(values.nearBeforeMinutes > 0
        ? [{ withinMinutes: values.nearBeforeMinutes, feeBps: values.nearFeeBps }]
        : []),
      { withinMinutes: values.freeBeforeMinutes, feeBps: values.lateFeeBps },
    ],
    instantDelayGraceMinutes: 15,
    instantTravelOnly: true,
    noShow: { feeBps: values.noShowFeeBps, waitMinutes: 15, minContacts: 2, contactGapMinutes: 2 },
  };
}
export function scheduledCancellationBps(policy: CancellationPolicy, minutesBefore: number) {
  return policy.scheduledTiers
    ? (policy.scheduledTiers.find((tier) => minutesBefore < tier.withinMinutes)?.feeBps ?? 0)
    : minutesBefore < policy.freeBeforeMinutes
      ? policy.lateFeeBps
      : 0;
}
export type * from './engagement.js';
export type * from './discovery.js';
export type * from './customer-flow.js';
export type * from './coordination.js';
export type * from './subscription.js';
export type * from './invoicing.js';
export type * from './reporting.js';
export type * from './mobile.js';
export const acceptanceScopeInput = z
  .object({
    active: z.boolean(),
    instantEnabled: z.boolean(),
    offeringIds: z
      .array(z.string().min(1))
      .min(1)
      .max(100)
      .transform((ids) => [...new Set(ids)].sort()),
    listingIds: z
      .array(z.string().min(1))
      .min(1)
      .max(100)
      .transform((ids) => [...new Set(ids)].sort()),
    areas: z
      .array(z.string().min(1))
      .min(1)
      .max(100)
      .transform((ids) => [...new Set(ids)].sort()),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    minTotal: z.number().int().min(0).max(500000),
    maxTotal: z.number().int().min(0).max(500000),
    dailyLimit: z.number().int().min(1).max(1000),
  })
  .strict()
  .refine((v) => v.startHour < v.endHour && v.minTotal <= v.maxTotal);

export type AcceptanceScope = z.infer<typeof acceptanceScopeInput>;
export type AcceptanceRule = AcceptanceScope & {
  version: number;
  authorizedBy: string;
  authorizedAt: number;
};
export type AcceptanceReason =
  | 'ELIGIBLE'
  | 'MANUAL_MODE'
  | 'NO_RULE'
  | 'PAUSED'
  | 'INSTANT_DISABLED'
  | 'OFFERING'
  | 'STAFF'
  | 'AREA'
  | 'TIME'
  | 'AMOUNT'
  | 'DAILY_LIMIT';
export type AcceptanceDecision = {
  outcome: 'AUTO_ACCEPTED' | 'MANUAL_REVIEW';
  reason: AcceptanceReason;
  evaluatedAt: number;
  rule?: AcceptanceRule;
};

const dayMs = 86400000;
export const acceptanceDay = (at: number) => Math.floor((at + 9 * 3600000) / dayMs);

// The quota belongs to the service's JST start date. Cancellation does not restore it.
export function dailyAutomaticCount(bookings: Booking[], storeId: string, startAt: number) {
  return bookings.filter(
    (b) =>
      b.storeId === storeId &&
      acceptanceDay(b.quote.startAt) === acceptanceDay(startAt) &&
      (b.acceptanceDecision?.outcome === 'AUTO_ACCEPTED' ||
        (!b.acceptanceDecision && b.merchantAcceptance === 'AUTO_ACCEPTED')),
  ).length;
}

export function automaticAcceptanceReason(
  store: Pick<Store, 'acceptanceMode' | 'acceptanceRule'>,
  quote: Pick<
    Quote,
    'bookingMode' | 'offeringId' | 'area' | 'startAt' | 'endAt' | 'total' | 'fulfillmentMode'
  >,
  listingId: string,
  used: number,
): AcceptanceReason {
  // Store visits require an explicit shop acceptance until mode-scoped automation exists.
  if (quote.fulfillmentMode === 'IN_STORE') return 'MANUAL_MODE';
  if (store.acceptanceMode !== 'AUTO_PREAUTHORIZED') return 'MANUAL_MODE';
  const r = store.acceptanceRule;
  if (!r) return 'NO_RULE';
  if (!r.active) return 'PAUSED';
  if (quote.bookingMode === 'INSTANT' && !r.instantEnabled) return 'INSTANT_DISABLED';
  if (!r.offeringIds.includes(quote.offeringId)) return 'OFFERING';
  if (!r.listingIds.includes(listingId)) return 'STAFF';
  if (!r.areas.includes(quote.area)) return 'AREA';
  const midnight = acceptanceDay(quote.startAt) * dayMs - 9 * 3600000;
  if (
    quote.startAt < midnight + r.startHour * 3600000 ||
    quote.endAt > midnight + r.endHour * 3600000
  )
    return 'TIME';
  if (quote.total < r.minTotal || quote.total > r.maxTotal) return 'AMOUNT';
  if (used >= r.dailyLimit) return 'DAILY_LIMIT';
  return 'ELIGIBLE';
}

// ---- Limited-time prices (限时优惠), listing stats and coarse distance ----
const promotionDayMs = 86_400_000;
/** A shop-funded, time-limited price for one service (限时优惠). */
export type OfferingPromotion = {
  id: string;
  price: number;
  /** The shop's regular price when the promotion was saved. */
  regularPrice: number;
  startsAt: number;
  endsAt: number;
  createdAt: number;
  /**
   * Whether the regular price may be shown struck through (二重価格表示).
   * Decided when the promotion is saved; see `comparisonEligibility`.
   */
  comparisonAllowed: boolean;
  comparisonReason: 'ELIGIBLE' | 'REGULAR_PRICE_TOO_NEW' | 'TOO_MANY_PROMOTION_DAYS';
};
export type PromotionWindow = { startsAt: number; endsAt: number };

export const PROMOTION_RULES = {
  maxDays: 14,
  maxLeadDays: 30,
  minPriceRatio: 0.3,
  /** Regular price must have applied this long before a struck-through comparison. */
  regularPriceMinDays: 28,
  /** Look-back window; promotions may cover at most half of it. */
  lookbackDays: 56,
  maxPromotionDaysInLookback: 28,
} as const;

export const promotionInput = z
  .object({
    version: z.number().int().positive(),
    price: z.number().int().min(500).max(200000),
    startsAt: z.number().int().positive(),
    endsAt: z.number().int().positive(),
  })
  .strict();

export const promotionPriceFloor = (regular: number) =>
  Math.ceil(regular * PROMOTION_RULES.minPriceRatio);

/** Union elapsed intervals so edits neither erase nor double-count discounted time. */
export function mergePromotionWindows(
  windows: PromotionWindow[],
  from = -Infinity,
  to = Infinity,
): PromotionWindow[] {
  const sorted = windows
    .filter((w) => Number.isFinite(w.startsAt) && Number.isFinite(w.endsAt))
    .map((w) => ({ startsAt: Math.max(from, w.startsAt), endsAt: Math.min(to, w.endsAt) }))
    .filter((w) => w.startsAt < w.endsAt)
    .sort((a, b) => a.startsAt - b.startsAt);
  const merged: PromotionWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.startsAt <= last.endsAt) last.endsAt = Math.max(last.endsAt, window.endsAt);
    else merged.push({ ...window });
  }
  return merged;
}

/**
 * Japan's Premiums and Representations Act guidance treats a "regular price"
 * comparison as fair only when that price was genuinely charged for most of the
 * recent period. Promotions may still run when this fails; the UI then shows
 * the promotional price without a struck-through comparison.
 */
export function comparisonEligibility(
  promotion: PromotionWindow,
  priceSince: number | undefined,
  history: PromotionWindow[],
): OfferingPromotion['comparisonReason'] {
  if (
    !priceSince ||
    promotion.startsAt - priceSince < PROMOTION_RULES.regularPriceMinDays * promotionDayMs
  )
    return 'REGULAR_PRICE_TOO_NEW';
  const from = promotion.startsAt - PROMOTION_RULES.lookbackDays * promotionDayMs;
  const covered = mergePromotionWindows([...history, promotion], from, promotion.endsAt).reduce(
    (sum, w) => sum + w.endsAt - w.startsAt,
    0,
  );
  return covered > PROMOTION_RULES.maxPromotionDaysInLookback * promotionDayMs
    ? 'TOO_MANY_PROMOTION_DAYS'
    : 'ELIGIBLE';
}

type PricedOffering = { price: number; promotion?: OfferingPromotion };

/** The active promotion for an offering at `now`, if it still matches the regular price. */
export function activePromotion(offering: PricedOffering, now: number) {
  const p = offering.promotion;
  return p && p.startsAt <= now && now < p.endsAt && p.regularPrice === offering.price
    ? p
    : undefined;
}

/** Service price a customer pays at `now`, with the comparison price only when allowed. */
export function effectiveServicePrice(offering: PricedOffering, now: number) {
  const promotion = activePromotion(offering, now);
  return {
    price: promotion?.price ?? offering.price,
    promotion,
    comparePrice: promotion?.comparisonAllowed ? offering.price : undefined,
  };
}

/** Public, aggregated facts for a therapist listing. Never fabricated. */
export type ListingStats = {
  rating: number | null;
  reviewCount: number;
  completed90d: number;
  favorites: number;
};

/** Ward office coordinates for the served Tokyo areas (approximate centroids). */
export const areaCentroids: Record<string, { lat: number; lng: number }> = {
  shinjuku: { lat: 35.6938, lng: 139.7034 },
  shibuya: { lat: 35.6633, lng: 139.6977 },
  minato: { lat: 35.658, lng: 139.7515 },
  chuo: { lat: 35.6706, lng: 139.772 },
  taito: { lat: 35.7125, lng: 139.7799 },
};

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180,
    dLat = (b.lat - a.lat) * rad,
    dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Nearest served area to a point, and the distance to it. */
export function nearestArea(point: { lat: number; lng: number }, areas: string[]) {
  let best: { area: string; km: number } | undefined;
  for (const area of areas) {
    const c = areaCentroids[area];
    if (!c) continue;
    const km = distanceKm(point, c);
    if (!best || km < best.km) best = { area, km };
  }
  return best;
}

/** Distance between two served areas' centroids, used for coarse server-side ordering. */
export function areaDistanceKm(from: string, to: string[]) {
  const a = areaCentroids[from];
  if (!a) return Infinity;
  return Math.min(
    ...to.map((x) => (areaCentroids[x] ? distanceKm(a, areaCentroids[x]) : Infinity)),
  );
}

// Shared runtime lives in the package entry, matching the source-only bundler contract.
export const fulfillmentModes = ['HOME_VISIT', 'IN_STORE'] as const;
export const fulfillmentMode = (value: { fulfillmentMode?: FulfillmentMode }): FulfillmentMode =>
  value.fulfillmentMode ?? 'HOME_VISIT';
export const venueInput = z
  .object({
    version: z.number().int().min(0),
    enabled: z.boolean(),
    address: z.string().trim().min(5).max(300),
    area: z.enum(['shinjuku', 'shibuya', 'minato', 'chuo', 'taito']),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    contact: z.string().trim().min(3).max(100),
    directions: z.string().trim().max(500),
    photos: z
      .array(
        z
          .string()
          .max(500)
          // Platform images or this shop's uploads only: an external link could change after review.
          .refine((p) => /^\/images\/[\w/.-]+$/.test(p) || venuePhotoId(p) !== undefined),
      )
      .min(1)
      .max(8),
    businessHours: z
      .object({
        startMinute: z.number().int().min(0).max(1410).multipleOf(30),
        endMinute: z.number().int().min(30).max(1440).multipleOf(30),
      })
      .strict()
      .refine((h) => h.startMinute !== h.endMinute % 1440 || h.endMinute === 1440),
    turnoverMinutes: z.number().int().min(5).max(120).multipleOf(5),
    closedDates: z
      .array(
        z
          .string()
          .regex(/^20\d{2}-\d{2}-\d{2}$/)
          .refine(
            (s) =>
              Number.isFinite(Date.parse(`${s}T00:00:00Z`)) &&
              new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s,
          ),
      )
      .max(366)
      .default([]),
    closedWeekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    nominationFee: z.number().int().min(0).max(20000).default(500),
    cancellationTemplateId: z.enum(['FLEXIBLE_2H', 'STANDARD_24H']).default('FLEXIBLE_2H'),
    resources: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
            name: z.string().trim().min(1).max(60),
            active: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .refine(
    (v) => new Set(v.resources.map((r) => r.id)).size === v.resources.length,
    'Resource IDs must be unique',
  );
export const venueAvailable = (store: {
  venue?: {
    status: string;
    enabled: boolean;
    suspension?: unknown;
    capacity?: number;
    resources?: { active: boolean }[];
  };
}) =>
  store.venue?.status === 'APPROVED' &&
  store.venue.enabled &&
  !store.venue.suspension &&
  (store.venue.resources
    ? store.venue.resources.some((r) => r.active)
    : store.venue.capacity === undefined || store.venue.capacity > 0);
/** Home visits also need a real main photo, so the customer can recognize who arrives. */
export const listingSupports = (
  listing: Pick<Listing, 'fulfillmentModes' | 'photo'>,
  mode: FulfillmentMode,
) =>
  (listing.fulfillmentModes ?? ['HOME_VISIT']).includes(mode) &&
  (mode !== 'HOME_VISIT' || hasMainPhoto(listing));
/** Every minute of service must fall inside one continuous JST opening window. */
export function withinVenueHours(hours: BusinessHours, startAt: number, endAt: number) {
  if (endAt <= startAt) return false;
  if (hours.startMinute === 0 && hours.endMinute === 1440) return true;
  return openingDay(hours, startAt, endAt) !== undefined;
}
/** JST midnight (epoch ms) of the business day whose opening window holds the whole service. */
function openingDay(hours: BusinessHours, startAt: number, endAt: number) {
  const day = 86_400_000,
    midnight = Math.floor((startAt + 9 * 3_600_000) / day) * day - 9 * 3_600_000;
  for (const base of [midnight - day, midnight]) {
    const from = base + hours.startMinute * 60_000;
    const to =
      base +
      (hours.endMinute <= hours.startMinute ? hours.endMinute + 1440 : hours.endMinute) * 60_000;
    if (startAt >= from && endAt <= to) return base;
  }
  return undefined;
}
export const venueSnapshot = (venue: Venue): VenueSnapshot => {
  const {
    version,
    address,
    area,
    latitude,
    longitude,
    contact,
    directions,
    turnoverMinutes,
    businessHours,
  } = venue;
  return {
    version,
    address,
    area,
    latitude,
    longitude,
    contact,
    directions,
    turnoverMinutes,
    businessHours: { ...businessHours },
    closedDates: [...(venue.closedDates ?? [])],
    closedWeekdays: [...(venue.closedWeekdays ?? [])],
  };
};
export function venueCanServe(
  venue: Pick<Venue, 'businessHours' | 'closedDates' | 'closedWeekdays'>,
  startAt: number,
  endAt: number,
) {
  if (!withinVenueHours(venue.businessHours, startAt, endAt)) return false;
  const day = 86_400_000,
    hours = venue.businessHours;
  // `jstDay` is a JST calendar day expressed as a UTC date.
  const closed = (jstDay: number) => {
    const date = new Date(jstDay);
    return (
      !!venue.closedDates?.includes(date.toISOString().slice(0, 10)) ||
      !!venue.closedWeekdays?.includes(date.getUTCDay())
    );
  };
  // A night that runs past midnight belongs to the day it opened, so Friday 18:00-04:00 is
  // still open at 01:00 when Saturday is the closing day.
  if (hours.startMinute !== 0 || hours.endMinute !== 1440)
    return !closed(openingDay(hours, startAt, endAt)! + 9 * 3_600_000);
  for (
    let at = Math.floor((startAt + 9 * 3_600_000) / day) * day;
    at < endAt + 9 * 3_600_000;
    at += day
  )
    if (closed(at)) return false;
  return true;
}
/** Venue fields customers rely on to find the place; changing them needs platform review. */
export const VENUE_REVIEWED_FIELDS = [
  'address',
  'area',
  'latitude',
  'longitude',
  'contact',
  'directions',
  'photos',
] as const;
/**
 * The venue as the shop edits it: pending reviewed facts over the live operating settings.
 * Bookings always use `store.venue`.
 */
export function editableVenue(store: { venue?: Venue; venueDraft?: Venue }): Venue | undefined {
  const { venue, venueDraft: draft } = store;
  if (!venue || !draft) return venue ?? draft;
  const facts = Object.fromEntries(VENUE_REVIEWED_FIELDS.map((key) => [key, draft[key]]));
  return {
    ...venue,
    ...facts,
    status: draft.status,
    version: draft.version,
    reviewedBy: draft.reviewedBy,
    reviewNote: draft.reviewNote,
  };
}
const VENUE_PHOTO_PATH = /^\/v1\/public\/venue-photos\/(evidence_[0-9a-f-]{36})$/;
/** Public path of a venue photo uploaded through the platform. */
export const venuePhotoUrl = (id: string) => `/v1/public/venue-photos/${id}`;
export const venuePhotoId = (url: string) => VENUE_PHOTO_PATH.exec(url)?.[1];
/** After a shop reports an in-store no-show, the customer can reply this long before any fee. */
export const IN_STORE_NO_SHOW_REPLY_MINUTES = 30;
export const offeringSupports = (offering: Offering, mode: FulfillmentMode) =>
  fulfillmentMode(offering) === mode;

// ---- Therapist profile photos and introduction video ----
/** Photos and the short introduction video customers see on a therapist profile. */
export type ListingMediaKind = 'PHOTO' | 'VIDEO';
/**
 * PENDING_CONSENT: the shop uploaded it; the person shown has not authorized it yet.
 * PENDING_SHOP: the therapist uploaded and authorized it; the shop has not confirmed it.
 * PENDING_REVIEW: authorized and confirmed; waiting for the platform.
 * APPROVED is the only public state. WITHDRAWN (authorization withdrawn), REMOVED (taken down
 * or replaced) and REJECTED are final.
 */
export type ListingMediaStatus =
  | 'PENDING_CONSENT'
  | 'PENDING_SHOP'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'REMOVED';
export const PENDING_MEDIA: ListingMediaStatus[] = [
  'PENDING_CONSENT',
  'PENDING_SHOP',
  'PENDING_REVIEW',
];
export const LISTING_PHOTO_LIMIT = 8;
/** One introduction video is shown; a replacement may wait for review while it stays up. */
export const LISTING_VIDEO_LIMIT = 1;
export const VIDEO_MAX_SECONDS = 60;
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
/** Raw bytes per upload chunk; base64 keeps each request inside the JSON body limit. */
export const VIDEO_CHUNK_BYTES = 360_000;
export const PLACEHOLDER_PORTRAIT = '/portraits/placeholder.svg';
/** A real, consented main photo: required before a therapist can be booked for home visits. */
export const hasMainPhoto = (listing: { photo?: string }) =>
  !!listing.photo && listing.photo !== PLACEHOLDER_PORTRAIT;
export const listingMediaUrl = (id: string) => `/v1/public/listing-media/${id}`;
export const listingMediaPosterUrl = (id: string) => `/v1/public/listing-media/${id}/poster`;

/** What customers receive: approved items only, in the order the profile shows them. */
export type PublicListingMedia = {
  id: string;
  kind: ListingMediaKind;
  url: string;
  posterUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
};
/** The managed record seen by the therapist, their shop and platform reviewers. */
export type ListingMedia = PublicListingMedia & {
  listingId: string;
  storeId: string;
  status: ListingMediaStatus;
  sort: number;
  uploadedBy: 'STAFF' | 'MERCHANT';
  consentAt?: number;
  shopConfirmedAt?: number;
  reviewedAt?: number;
  /** Why it was rejected or taken down. */
  note?: string;
  /** Set on the main photo shown on cards and at the door. */
  cover?: boolean;
  reports?: number;
  version: number;
  createdAt: number;
  updatedAt: number;
};
export type ListingMediaReportReason =
  'NOT_THE_PERSON' | 'INAPPROPRIATE' | 'CONTACT_INFO' | 'OTHER';
/** Platform review queue: pending items plus approved items customers reported. */
export type ListingMediaReviewItem = ListingMedia & {
  listingName: { ja: string; en: string; 'zh-cn': string };
  storeName: { ja: string; en: string; 'zh-cn': string };
  reportReasons?: ListingMediaReportReason[];
};

const base64 = z
  .string()
  .min(8)
  .max(490_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const mediaPhotoInput = z
  .object({
    listingId: z.string().max(100).optional(),
    mime: z.enum(['image/jpeg', 'image/png']),
    data: base64,
    /** The therapist confirms they are the person shown and allow publication. */
    consent: z.boolean().optional(),
  })
  .strict();
export const mediaVideoStartInput = z
  .object({
    listingId: z.string().max(100).optional(),
    size: z.number().int().min(1000).max(VIDEO_MAX_BYTES),
    consent: z.boolean().optional(),
  })
  .strict();
export const mediaVideoChunkInput = z
  .object({ index: z.number().int().min(0).max(100), data: base64 })
  .strict();
export const mediaVideoFinishInput = z
  .object({
    /** Read by the browser; used only when the file itself does not record a duration. */
    durationSeconds: z
      .number()
      .min(1)
      .max(VIDEO_MAX_SECONDS + 1),
    poster: z.object({ mime: z.enum(['image/jpeg', 'image/png']), data: base64 }).strict(),
  })
  .strict();
export const mediaDecisionInput = z
  .object({
    version: z.number().int().positive(),
    approved: z.boolean(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export const mediaRemoveInput = z
  .object({ version: z.number().int().positive(), note: z.string().trim().min(4).max(300) })
  .strict();
export const mediaVersionInput = z.object({ version: z.number().int().positive() }).strict();
export const mediaOrderInput = z
  .object({
    ids: z
      .array(z.string().max(100))
      .min(1)
      .max(LISTING_PHOTO_LIMIT + 2),
  })
  .strict();
export const mediaReportInput = z
  .object({
    reason: z.enum(['NOT_THE_PERSON', 'INAPPROPRIATE', 'CONTACT_INFO', 'OTHER']),
    detail: z.string().trim().max(300).optional(),
  })
  .strict();

/** Brand content is reviewed independently of operational prices, venue facts and qualifications. */
export const STOREFRONT_PHOTO_LIMIT = 12;
const storefrontText = (max: number) =>
  z
    .object({
      ja: z.string().trim().max(max),
      en: z.string().trim().max(max),
      'zh-cn': z.string().trim().max(max),
    })
    .strict();
const storefrontAssetId = z.string().regex(/^brand_[0-9a-f-]{36}$/);
export const storefrontContentInput = z
  .object({
    tagline: storefrontText(90),
    about: storefrontText(1800),
    logoId: storefrontAssetId.nullable().default(null),
    coverId: storefrontAssetId.nullable().default(null),
    photoIds: z
      .array(storefrontAssetId)
      .max(STOREFRONT_PHOTO_LIMIT)
      .refine((a) => new Set(a).size === a.length),
    featuredOfferingIds: z
      .array(z.string().min(1).max(100))
      .max(6)
      .refine((a) => new Set(a).size === a.length),
    teamListingIds: z
      .array(z.string().min(1).max(100))
      .max(30)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict();
export type StorefrontContent = z.infer<typeof storefrontContentInput>;
export type StorefrontAsset = { id: string; url: string; createdAt: number };
export type PublishedStorefront = {
  version: number;
  publishedAt: number;
  tagline: Localized;
  about: Localized;
  logo?: StorefrontAsset;
  cover?: StorefrontAsset;
  photos: StorefrontAsset[];
  featuredOfferingIds: string[];
  teamListingIds: string[];
};
export type StorefrontDraft = {
  id: string;
  storeId: string;
  version: number;
  status: 'DRAFT' | 'PENDING' | 'PUBLISHED' | 'CHANGES_REQUESTED';
  content: StorefrontContent;
  submittedAt?: number;
  reviewedAt?: number;
  note?: string;
  updatedAt: number;
};
export type StorefrontWorkspace = {
  draft: StorefrontDraft;
  published?: PublishedStorefront;
  assets: StorefrontAsset[];
  store: { id: string; slug: string; name: Localized; plan: Store['plan'] };
  offerings: {
    id: string;
    name: Localized;
    durationMinutes: number;
    fulfillmentMode: FulfillmentMode;
  }[];
  team: { id: string; name: Localized; photo: string }[];
  stats: ListingStats;
};
export type StorefrontReviewItem = StorefrontDraft & {
  name: Localized;
  assets: StorefrontAsset[];
  published?: PublishedStorefront;
  offerings: StorefrontWorkspace['offerings'];
  team: StorefrontWorkspace['team'];
};
export const storefrontAssetUrl = (id: string) => `/v1/public/shop-assets/${id}`;
