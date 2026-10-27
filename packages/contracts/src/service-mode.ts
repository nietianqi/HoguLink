import type {
  BusinessHours,
  CancellationPolicy,
  TimeSurcharge,
  BookingStatus,
  Localized,
} from './index.js';

export type VenueCalendar = {
  date: string;
  serverNow: number;
  resources: { id: string; name: string; active: boolean }[];
  entries: {
    id: string;
    bookingId?: string;
    resourceId: string;
    phase: BookingStatus | 'CHECKOUT_HOLD' | 'CHECKED_IN' | 'CLEANING';
    startAt: number;
    endAt: number;
    ongoing?: boolean;
    serviceName?: Localized;
    staffName?: Localized;
  }[];
};
export type FulfillmentMode = 'HOME_VISIT' | 'IN_STORE';
export type Venue = {
  version: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  enabled: boolean;
  address: string;
  area: string;
  latitude: number;
  longitude: number;
  contact: string;
  directions: string;
  photos: string[];
  businessHours: BusinessHours;
  closedDates?: string[];
  closedWeekdays?: number[];
  turnoverMinutes: number;
  nominationFee: number;
  timeSurcharges?: TimeSurcharge[];
  resources: { id: string; name: string; active: boolean }[];
  cancellationPolicy?: CancellationPolicy;
  cancellationTemplateId?: 'FLEXIBLE_2H' | 'STANDARD_24H';
  reviewedBy?: string;
  reviewNote?: string;
  /** Set by the platform: no new in-store bookings while present; existing ones continue. */
  suspension?: { at: number; by: string; note: string };
};
export type PublicVenue = Omit<Venue, 'resources' | 'reviewedBy' | 'reviewNote' | 'suspension'> & {
  capacity: number;
};
export type VenueSnapshot = Pick<
  Venue,
  | 'version'
  | 'address'
  | 'area'
  | 'latitude'
  | 'longitude'
  | 'contact'
  | 'directions'
  | 'turnoverMinutes'
  | 'businessHours'
  | 'closedDates'
  | 'closedWeekdays'
>;
