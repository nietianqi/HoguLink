import type { Locale, Store } from './index.js';
export type MerchantSubscription = {
  id: string;
  version: number;
  status:
    | 'WAITING_PUBLICATION'
    | 'TRIALING'
    | 'STANDARD'
    | 'ANNUAL_ACTIVE'
    | 'GRACE_PERIOD'
    | 'SUSPENDED';
  trialStartedAt?: number;
  trialEndsAt?: number;
  annualStartedAt?: number;
  annualEndsAt?: number;
  renewal: 'ANNUAL' | 'STANDARD';
  overdueAction: 'DOWNGRADE' | 'SUSPEND';
  legacy: boolean;
  createdAt: number;
  updatedAt: number;
};
export type PlanInvoice = {
  id: string;
  storeId: string;
  version: number;
  kind: 'ANNUAL_PLAN_FEE';
  purpose: 'START' | 'RENEWAL';
  amount: number;
  currency: 'JPY';
  taxMode: 'EXCLUSIVE_UNASSESSED';
  status: 'OPEN' | 'PAID' | 'VOID';
  createdAt: number;
  updatedAt: number;
  dueAt: number;
  graceEndsAt: number;
  coverageStartAt?: number;
  coverageEndAt?: number;
  paidAt?: number;
  reference?: string;
  attempts: {
    at: number;
    outcome: 'SUCCEEDED' | 'FAILED';
    role: 'MERCHANT' | 'ADMIN';
    reference?: string;
  }[];
};
export type SubscriptionEvent = {
  id: string;
  storeId: string;
  action: string;
  role: 'MERCHANT' | 'ADMIN' | 'SYSTEM';
  at: number;
  invoiceId?: string;
  note?: string;
};
export type BillingStanding = {
  plan: Store['plan'];
  status: MerchantSubscription['status'];
  newBookingsBlocked: boolean;
  feeDiscrepancy: boolean;
  openAnnualAmount: number;
  trialEndsAt?: number;
  annualEndsAt?: number;
};
export type SubscriptionWorkspace = {
  now: number;
  mode: 'DEMO';
  storeId: string;
  stores: {
    id: string;
    name: Record<Locale, string>;
    status: MerchantSubscription['status'];
    blocked: boolean;
    due: number;
  }[];
  subscription: MerchantSubscription;
  standing: BillingStanding;
  invoices: PlanInvoice[];
  history: SubscriptionEvent[];
  rates: { TRIAL: number; STANDARD: number; ANNUAL: number };
  annualPrice: number;
  graceDays: number;
  trialDays: number;
  recommendation: {
    orders: number;
    feeBase: number;
    annualSaving: number;
    suggested: 'STANDARD' | 'ANNUAL' | null;
  };
};
