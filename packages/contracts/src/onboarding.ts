import type { Localized, Listing, Offering } from './index.js';

export type ApplicationStatus =
  'DRAFT' | 'SUBMITTED' | 'CHANGES_REQUIRED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'EXPIRED';
export type EvidenceKind = 'IDENTITY' | 'BUSINESS' | 'QUALIFICATION' | 'PORTRAIT';
export type EvidenceInfo = {
  id: string;
  name: string;
  mime: string;
  kind: EvidenceKind;
  size: number;
  hash: string;
  createdAt: number;
};
export type PartnerDraft = {
  legalName: string;
  displayName: Localized;
  description: Localized;
  contact: string;
  legalAddress: string;
  emergencyContact: string;
  businessType: 'COMPANY' | 'SOLE_PROPRIETOR';
  category: 'RELAXATION' | 'LICENSED';
  serviceScope: string;
  areas: string[];
  languages: string[];
  evidenceIds: string[];
  portraitId: string;
  offeringIds: string[];
  serviceName: Localized;
  durationMinutes: number;
  price: number;
  transportFee: number;
  termsAccepted: boolean;
  antisocialDeclaration: boolean;
};
export type PartnerApplication = {
  id: string;
  type: 'MERCHANT' | 'STAFF';
  ownerId: string;
  storeId: string;
  staffId?: string;
  listingId?: string;
  status: ApplicationStatus;
  version: number;
  revision: number;
  draft: PartnerDraft;
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
  reviewedAt?: number;
  validUntil?: number;
  feedback?: string;
  merchantContentHash?: string;
  contentHash: string;
};
export type PartnerInvitation = {
  id: string;
  storeId: string;
  email: string;
  name: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED' | 'DECLINED';
  version: number;
  createdAt: number;
  expiresAt: number;
  acceptedAt?: number;
  applicationId?: string;
};
export type PortraitConsent = {
  id: string;
  listingId: string;
  staffId: string;
  storeId: string;
  version: number;
  termsVersion: string;
  contentHash: string;
  status: 'GRANTED' | 'REVOKED' | 'EXPIRED';
  startsAt: number;
  endsAt: number;
  grantedAt: number;
  revokedAt?: number;
};
export type ApplicationHistory = {
  id: string;
  applicationId: string;
  action: string;
  revision: number;
  at: number;
  actorId: string;
  feedback?: string;
};
export type PartnerSnapshot = {
  application?: PartnerApplication;
  evidence: EvidenceInfo[];
  history: ApplicationHistory[];
  consent?: PortraitConsent;
  consentTermsVersion: string;
  legacy: boolean;
  invitations: PartnerInvitation[];
  members: {
    applicationId?: string;
    listing: Listing;
    profile?: Pick<
      PartnerDraft,
      'displayName' | 'description' | 'languages' | 'offeringIds' | 'portraitId'
    >;
    status?: ApplicationStatus;
    version?: number;
    merchantApproved: boolean;
    consent?: PortraitConsent;
    openBookings: string[];
  }[];
  offerings: Offering[];
  storeName?: Localized;
};
export type ApplicationReviewItem = {
  application: PartnerApplication;
  evidence: EvidenceInfo[];
  consent?: PortraitConsent;
  merchantApproved: boolean;
  history: ApplicationHistory[];
};
