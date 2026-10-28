import type {
  Listing,
  Localized,
  Offering,
  Store,
  PublicStore,
  SafetyEvent,
  BookingStatus,
  FulfillmentMode,
} from './index.js';
export type CustomerOverview = {
  counts: {
    checkout: number;
    active: number;
    review: number;
    support: number;
    favorites: number;
    closed: number;
    completed: number;
  };
  resumeCheckout?: { holdId: string; expiresAt: number; total: number };
  reviewBookingId?: string;
  /** All owned visits for which the customer can still submit or revise a review. */
  reviewBookingIds: string[];
  focus?: CustomerOverview['recent'][number] & { requiresConsent: boolean };
  recent: {
    id: string;
    status: BookingStatus;
    startAt: number;
    total: number;
    serviceName: Localized;
    endAt: number;
    fulfillmentMode: FulfillmentMode;
    storeName: Localized;
    therapistName: Localized;
    therapistPhoto?: string;
    /** Area only: private visit addresses and contact information stay on the order. */
    area: string;
  }[];
  now: number;
};
export type ExperienceScores = {
  punctuality: number;
  communication: number;
  explanation: number;
  cleanliness: number;
  overall: number;
};
export type ExperienceReview = {
  id: string;
  bookingId: string;
  customerId: string;
  merchantId: string;
  storeId: string;
  listingId: string;
  staffId: string;
  serviceName: Localized;
  scores: ExperienceScores;
  text: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'REMOVED';
  version: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  feedback?: string;
};
export type ExperienceReply = {
  id: string;
  reviewId: string;
  reviewRevision: number;
  storeId: string;
  text: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  version: number;
  createdAt: number;
  updatedAt: number;
  feedback?: string;
};
export type ExperienceAppeal = {
  id: string;
  reviewId: string;
  reviewRevision: number;
  storeId: string;
  reason: string;
  status: 'OPEN' | 'UPHELD' | 'REMOVED' | 'STALE';
  version: number;
  createdAt: number;
  resolvedAt?: number;
  feedback?: string;
};
export type PublicExperience = {
  id: string;
  storeId: string;
  listingId?: string;
  serviceName: Localized;
  scores: ExperienceScores;
  text: string;
  createdAt: number;
  reply?: { text: string; at: number };
};
export type ExperienceSummary = {
  count: number;
  average: number | null;
  dimensions: Record<keyof ExperienceScores, number | null>;
};
export type PublicExperiencePage = {
  items: PublicExperience[];
  summary: ExperienceSummary;
  nextCursor: string | null;
};
export type CustomerExperience = {
  eligible: boolean;
  review?: Omit<ExperienceReview, 'customerId' | 'merchantId' | 'staffId'>;
  reply?: { text: string; at: number };
  listingId: string | null;
  canFavorite: boolean;
};
export type FavoriteRecord = {
  id: string;
  customerId: string;
  listingId: string;
  storeId: string;
  active: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
};
export type FavoriteItem = {
  listingId: string;
  version: number;
  available: boolean;
  createdAt: number;
  listing: Listing | null;
  store: PublicStore | null;
  offerings: Offering[];
};
export type MerchantExperienceRow = {
  review: PublicExperience;
  version: number;
  revision: number;
  reply?: ExperienceReply;
  appeal?: ExperienceAppeal;
};
export type ExperienceModerationItem = {
  type: 'REVIEW' | 'REPLY' | 'APPEAL';
  id: string;
  version: number;
  reviewId: string;
  text: string;
  scores: ExperienceScores;
  serviceName: Localized;
  storeName: Localized;
  status: string;
  createdAt: number;
  reviewText?: string;
};
export type ExperienceModerationLog = {
  id: string;
  targetType: string;
  targetId: string;
  actorId: string;
  decision: string;
  reason: string;
  at: number;
};
export type SafetyCheckIn = {
  id: string;
  bookingId: string;
  storeId: string;
  staffId: string;
  listingId: string;
  status: 'WAITING' | 'SAFE' | 'ESCALATED' | 'CLOSED';
  version: number;
  round: number;
  dueAt: number;
  escalateAt: number;
  safeAt?: number;
  eventId?: string;
  merchantContact?: { at: number; actorId: string; note: string };
};
export type SafetyCheckInView = Omit<SafetyCheckIn, 'merchantContact'> & {
  merchantContact?: { at: number; note?: string };
};
export type SafetyDesk = {
  checks: SafetyCheckInView[];
  events: SafetyEvent[];
  now: number;
  delivery: 'DEMO_LOCAL_ONLY';
};
