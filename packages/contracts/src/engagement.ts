import type { BookingStatus, Localized, Store, PublicStore, SupportTicketStatus } from './index.js';

export type StoreFavoriteRecord = {
  id: string;
  customerId: string;
  storeId: string;
  active: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
};
export type StoreFavoriteItem = {
  storeId: string;
  version: number;
  available: boolean;
  store: PublicStore | null;
};
export type InboxItem = {
  id: string;
  kind: 'BOOKING' | 'SUPPORT';
  targetId: string;
  title: Localized;
  status: BookingStatus | SupportTicketStatus;
  updatedAt: number;
  token: string;
  unread: boolean;
  replies: number;
};
export type CustomerInbox = {
  items: InboxItem[];
  unreadCount: number;
  nextCursor: string | null;
};
export type InboxFilter = 'all' | 'unread' | 'bookings' | 'support';
export type DiscoveryArticle = {
  slug: string;
  category: 'planning' | 'safety';
  title: Localized;
  summary: Localized;
  sections: { heading: Localized; text: Localized }[];
};
