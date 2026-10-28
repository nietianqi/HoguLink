import type { AdminBooking, CustomerRestriction, Role, SupportTicket } from './index.js';

export type AdminCustomerSummary = {
  id: string;
  name: string;
  email?: string;
  status: 'ACTIVE' | 'DISABLED' | 'DEMO';
  verified: boolean;
  createdAt?: number;
  orders: number;
  completed: number;
};
export type AdminCustomerSearch = {
  items: AdminCustomerSummary[];
  page: number;
  total: number;
  pageSize: number;
};
export type AdminCustomerProfile = {
  customer: AdminCustomerSummary;
  bookings: AdminBooking[];
  cases: Pick<
    SupportTicket,
    'id' | 'bookingId' | 'subject' | 'category' | 'status' | 'createdAt'
  >[];
  restriction?: CustomerRestriction;
};
export type SafetyHandling = {
  ownerId: string;
  ownerName: string;
  acknowledgedAt: number;
  followUpAt: number;
  history: {
    action: 'ACKNOWLEDGE' | 'CONTACT' | 'HANDOVER';
    actorId: string;
    at: number;
    note: string;
    ownerId: string;
    followUpAt: number;
  }[];
};
export type AuditActorRole = Role | 'SYSTEM';
