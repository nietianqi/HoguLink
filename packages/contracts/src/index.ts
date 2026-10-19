import { z } from 'zod';

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
  id: string;
  merchantId: string;
  slug: string;
  name: Localized;
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
};
export type Offering = {
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
};
export type PublicStore = Pick<
  Store,
  | 'id'
  | 'slug'
  | 'name'
  | 'legalName'
  | 'legalAddress'
  | 'contact'
  | 'acceptanceMode'
  | 'active'
  | 'approved'
  | 'areas'
> & {
  bookingRules?: Pick<
    StoreBookingRules,
    'version' | 'nominationFee' | 'templateId' | 'cancellationPolicy'
  >;
};
export type Listing = {
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
  photo: string;
};
export type Quote = {
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
  nominationFee: number;
  transportFee: number;
  total: number;
  cancellationPolicy: CancellationPolicy;
};
export type Hold = {
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
  acceptanceDecision?: AcceptanceDecision;
  replacementConsent: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'DECLINED' | 'EXPIRED';
  proposedListingId?: string;
  replacementDeadline?: number;
  cancelReason?: string;
  quote: Quote;
  address?: Address;
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
  action: string;
  at: number;
  detail: string;
};
export type SafetyEvent = {
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
  'address' | 'customerId' | 'paymentId' | 'holdId' | 'quote'
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
    listingId: z.string().min(1),
    offeringId: z.string().min(1),
    bookingMode: z.enum(['INSTANT', 'SCHEDULED']),
    nominationType: z.enum(['NOMINATED', 'FREE']),
    startAt: z.number().int().positive(),
    area: z.enum(['shinjuku', 'shibuya', 'minato', 'chuo', 'taito']),
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
    address: addressInput,
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
export type StoreBookingRules = {
  version: number;
  nominationFee: number;
  templateId: 'LEGACY' | 'FLEXIBLE_2H' | 'STANDARD_24H' | 'CUSTOM';
  cancellationPolicy: CancellationPolicy;
};
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
export type * from './customer-flow.js';
export type * from './coordination.js';
export type * from './subscription.js';
export type * from './invoicing.js';
export type * from './reporting.js';
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
  quote: Pick<Quote, 'bookingMode' | 'offeringId' | 'area' | 'startAt' | 'endAt' | 'total'>,
  listingId: string,
  used: number,
): AcceptanceReason {
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
