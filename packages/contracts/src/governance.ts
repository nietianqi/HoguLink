export type AlertKind =
  | 'RESPONSE_DUE'
  | 'ASSIGNMENT_BLOCKED'
  | 'CONSENT_DUE'
  | 'LATE_ARRIVAL'
  | 'SERVICE_OVERRUN'
  | 'COMPLETION_REVIEW'
  | 'NO_SHOW_REVIEW'
  | 'PAYMENT_REVIEW'
  | 'SAFETY_OPEN'
  | 'CASE_OVERDUE'
  | 'FOLLOW_UP_DUE'
  | 'REFUND_OVERDUE'
  | 'DECISION_REVIEW';
export type OrderAlert = {
  id: string;
  kind: AlertKind;
  sourceId: string;
  bookingId?: string;
  ticketId?: string;
  storeId?: string;
  severity: 'HIGH' | 'NORMAL';
  state: 'OPEN' | 'WATCHING' | 'RESOLVED';
  version: number;
  generation: number;
  sourceVersion: string;
  dueAt: number;
  firstSeenAt: number;
  lastSeenAt: number;
  resolvedAt?: number;
  ownerId?: string;
  followUpAt?: number;
  note?: string;
};
export type OrderMonitor = {
  now: number;
  alerts: OrderAlert[];
  rules: {
    responseLeadMinutes: number;
    scheduledDelayMinutes: number;
    serviceOverrunMinutes: number;
    refundHours: number;
  };
};
export type CaseDecision = {
  id: string;
  ticketId: string;
  version: number;
  ticketVersion: number;
  bookingVersion: number;
  refundVersion: number;
  refundRequestId?: string;
  outcome: 'REFUND' | 'NO_REFUND' | 'FOLLOW_UP';
  amount: number;
  summary: string;
  reason: string;
  evidenceIds: string[];
  merchantUnreachable: boolean;
  createdAt: number;
  reopenCount: number;
  refundedBefore: number;
};
export type DecisionState = 'AWAITING_SHOP' | 'READY_TO_CLOSE' | 'NEEDS_REVIEW';
export type CaseDecisionDetail = {
  current: CaseDecision | null;
  history: CaseDecision[];
  state: DecisionState | null;
  bookingVersion: number;
  refundVersion: number;
  remaining: number;
  receipt: { text: string; at: number } | null;
};
