import type { Address, SupportTicket, SupportTicketStatus } from './index.js';
// Room numbers and per-visit hotel permission are intentionally never stored in the address book.
export type SavedAddress = {
  id: string;
  label: string;
  address: Omit<Address, 'room' | 'hotelPermission'>;
  updatedAt: number;
};
export type AddressBook = { version: number; defaultId: string | null; items: SavedAddress[] };
export type RefundRequestStatus =
  'PENDING' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED' | 'WITHDRAWN';
export type RefundRequest = {
  id: string;
  ticketId: string;
  bookingId: string;
  customerId: string;
  storeId: string;
  amount: number;
  reason: string;
  status: RefundRequestStatus;
  version: number;
  createdAt: number;
  updatedAt: number;
  approvedAmount?: number;
  decision?: string;
};
export type RefundRequestView = Omit<RefundRequest, 'customerId' | 'storeId'>;
export type RefundCase = { request: RefundRequestView; remaining: number; bookingVersion: number };
export type OrderCare = {
  captured: number;
  refunded: number;
  remaining: number;
  canRequest: boolean;
  requests: RefundRequestView[];
  cases: Pick<SupportTicket, 'id' | 'subject' | 'status' | 'updatedAt'>[];
};
