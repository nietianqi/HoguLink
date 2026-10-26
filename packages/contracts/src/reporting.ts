import type {
  BookingStatus,
  Locale,
  MoneyEntry,
  PlanInvoice,
  SettlementBatch,
  InvoiceDocument,
} from './index.js';
export type ReportQuery = { from: string; to: string; groupBy: 'day' | 'month'; storeId?: string };
export type ReportMetrics = {
  captured: number;
  refunded: number;
  platformFee: number;
  salesNet: number;
  merchantNet: number;
  knownProcessorFee: number;
  unknownProcessorRows: number;
  merchantNetAfterFees: number | null;
  capturedOrders: number;
  averageCapture: number | null;
  annualPaid: number;
  settlementRecorded: number;
  invoiceIssued: number;
  invoiceCredits: number;
  invoiceNet: number;
  invoiceCount: number;
  correctionCount: number;
  orders: number;
  completed: number;
  closed: number;
  cancelled: number;
  pending: number;
  completionBps: number | null;
};
export type ReportMoney = {
  id: string;
  storeId: string;
  bookingId: string;
  at: number;
  kind: MoneyEntry['kind'];
  captured: number;
  refunded: number;
  platformFee: number;
  merchantNet: number;
  processorFee: number | null;
  reconciliation: 'MATCHED' | 'DIFFERENCE' | 'UNMATCHED';
  held: boolean;
  settlementId?: string;
  invoiceNumbers: string[];
};
export type ReportOrder = {
  fulfillmentMode: 'HOME_VISIT' | 'IN_STORE';
  id: string;
  storeId: string;
  createdAt: number;
  startAt: number;
  mode: 'INSTANT' | 'SCHEDULED';
  serviceId: string;
  service: Record<Locale, string>;
  status: BookingStatus;
  captured: number;
  refunded: number;
};
export type ReportSettlement = {
  id: string;
  storeId: string;
  state: SettlementBatch['state'];
  createdAt: number;
  updatedAt: number;
  net: number;
  processorFee: number;
  entryCount: number;
};
export type ReportAnnual = {
  id: string;
  storeId: string;
  status: PlanInvoice['status'];
  purpose: PlanInvoice['purpose'];
  amount: number;
  createdAt: number;
  paidAt?: number;
  dueAt: number;
  invoiceNumbers: string[];
};
export type ReportInvoice = {
  id: string;
  storeId: string;
  number: string;
  kind: InvoiceDocument['kind'];
  purpose: InvoiceDocument['purpose'];
  issuedAt: number;
  rootId: string;
  revision: number;
  amount: number;
  signedAmount: number;
  correctsId?: string;
  originalNumber?: string;
};
export type ReportPoint = {
  period: string;
  captured: number;
  refunded: number;
  platformFee: number;
  salesNet: number;
  annualPaid: number;
  settlementRecorded: number;
  invoiceNet: number;
};
export type ReportGroup = {
  id: string;
  label: Record<Locale, string>;
  orders: number;
  completed: number;
  closed: number;
  completionBps: number | null;
};
export type ReportExportType =
  'summary' | 'trend' | 'money' | 'orders' | 'settlements' | 'annual' | 'invoices' | 'shops';
export type ReportExportInfo = {
  id: string;
  at: number;
  from: string;
  to: string;
  type: ReportExportType;
  rowCount: number;
  token: string;
};
export type ReportExport = ReportExportInfo & {
  definitionVersion: 'reporting-demo-v1';
  mode: 'DEMO';
  currency: 'JPY';
  timeZone: 'Asia/Tokyo';
  storeIds: string[];
  groupBy: ReportQuery['groupBy'];
  previousPeriod: { from: string; to: string };
  columns: string[];
  rows: (string | number | null)[][];
};
export type ReportWorkspace = {
  definitionVersion: 'reporting-demo-v1';
  now: number;
  mode: 'DEMO';
  currency: 'JPY';
  query: ReportQuery;
  previousPeriod: { from: string; to: string };
  token: string;
  canExport: boolean;
  stores: { id: string; name: Record<Locale, string> }[];
  selectedStoreIds: string[];
  current: ReportMetrics;
  previous: ReportMetrics;
  trend: ReportPoint[];
  services: ReportGroup[];
  modes: ReportGroup[];
  fulfillmentModes?: ReportGroup[];
  shops: {
    id: string;
    label: Record<Locale, string>;
    captured: number;
    refunded: number;
    salesNet: number;
    platformFee: number;
    annualPaid: number;
    orders: number;
    completionBps: number | null;
  }[];
  money: ReportMoney[];
  orders: ReportOrder[];
  settlements: ReportSettlement[];
  annual: ReportAnnual[];
  invoices: ReportInvoice[];
  balances: {
    openAnnual: number;
    overdueAnnual: number;
    unsettledBeforeFees: number;
    pendingSettlements: number;
    heldRows: number;
    unmatchedRows: number;
    legacyRows: number;
    legacyNet: number;
  };
  quality: { rows: number; matched: number; difference: number; unmatched: number; held: number };
  exports: ReportExportInfo[];
};
