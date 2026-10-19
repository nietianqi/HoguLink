import type { Actor, Locale } from './index.js';
export type InvoiceRecipient = { name: string; address: string; email: string; taxId: string };
export type InvoiceProfile = InvoiceRecipient & { id: string; version: number; updatedAt: number };
export type InvoiceSourceKind = 'PLATFORM_FEE' | 'ANNUAL_FEE' | 'CREDIT_NOTE' | 'CORRECTION';
export type InvoiceLine = {
  id: string;
  amount: number;
  at: number;
  kind: 'SERVICE_FEE' | 'FEE_REVERSAL' | 'ANNUAL_PLAN_FEE';
  bookingId?: string;
};
export type InvoiceSource = {
  key: string;
  kind: InvoiceSourceKind;
  sourceId: string;
  month?: string;
  originalDocumentId?: string;
  amount: number;
  taxBasis: 'UNASSESSED' | 'EXCLUSIVE_UNASSESSED';
  token: string;
  lines: InvoiceLine[];
  blockedReason?: string;
};
export type InvoiceSignoff = {
  id: string;
  name: string;
  adminRole?: Actor['adminRole'];
  sessionVersion?: number;
  at: number;
};
export type InvoiceRequest = {
  id: string;
  storeId: string;
  version: number;
  kind: InvoiceSourceKind;
  state:
    | 'SUBMITTED'
    | 'CHANGES_REQUESTED'
    | 'REVIEWED'
    | 'APPROVED'
    | 'ISSUED'
    | 'REJECTED'
    | 'WITHDRAWN';
  source: InvoiceSource;
  recipient: InvoiceRecipient;
  createdAt: number;
  updatedAt: number;
  reviewer?: InvoiceSignoff;
  approver?: InvoiceSignoff;
  documentId?: string;
  attempts: { at: number; operator: string; outcome: 'FAILED' | 'SUCCEEDED' }[];
};
export type InvoiceEvent = {
  id: string;
  storeId: string;
  requestId: string;
  action: string;
  role: 'MERCHANT' | 'ADMIN';
  operator: string;
  at: number;
  note: string;
};
export type InvoiceDocument = {
  id: string;
  requestId: string;
  storeId: string;
  rootId: string;
  revision: number;
  correctsId?: string;
  originalInvoiceRootId?: string;
  number: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  purpose: InvoiceSourceKind;
  issuedAt: number;
  issuer: { name: string; registrationNumber: null; verified: false };
  recipient: InvoiceRecipient;
  amount: number;
  currency: 'JPY';
  taxBasis: InvoiceSource['taxBasis'];
  taxAmount: null;
  mode: 'DEMO';
  lines: InvoiceLine[];
  sourceKey: string;
  reviewer: InvoiceSignoff;
  approver: InvoiceSignoff;
  issuedBy: InvoiceSignoff;
};
export type InvoiceRequestView = InvoiceRequest & {
  currentSource?: InvoiceSource;
  stale: boolean;
  blockedReason?: string;
  canReview: boolean;
  canApprove: boolean;
  canIssue: boolean;
  canResubmit: boolean;
  canWithdraw: boolean;
  canReturn: boolean;
};
export type InvoicingWorkspace = {
  now: number;
  mode: 'DEMO';
  storeId: string;
  profile: InvoiceProfile;
  stores: { id: string; name: Record<Locale, string> }[];
  sources: InvoiceSource[];
  requests: InvoiceRequestView[];
  documents: InvoiceDocument[];
  history: InvoiceEvent[];
  totals: { pending: number; approved: number; issued: number; adjustments: number };
};
