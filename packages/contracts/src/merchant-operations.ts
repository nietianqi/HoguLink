import type { FulfillmentMode, Localized } from './index.js';

export type ServiceProposal = {
  id: string;
  storeId: string;
  version: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  name: Localized;
  durationMinutes: number;
  fulfillmentMode: FulfillmentMode;
  price: number;
  transportFee: number;
  listingIds: string[];
  createdAt: number;
  reviewedAt?: number;
  feedback?: string;
  offeringId?: string;
};
export type ServiceProposalReview = ServiceProposal & {
  storeName: Localized;
  staffNames: Localized[];
};
