import type { Listing, ListingStats, Offering, PublicStore } from './index.js';

export type MobileBootstrap = {
  version: 1;
  currency: 'JPY';
  demo: boolean;
  serviceAreas: string[];
  features: {
    coupons: false;
    storedValue: false;
    nativeApp: false;
    /** Device-side distance from consented location; coordinates never leave the device. */
    gpsDistance: boolean;
    promotions: boolean;
  };
};
export type MobileTherapist = {
  modePrices?: { mode: 'HOME_VISIT' | 'IN_STORE'; total: number; durationMinutes: number }[];
  listing: Listing;
  store: PublicStore;
  offering: Offering;
  nominationFee: number;
  /** Travel fee for the chosen area (the shop's area table), else the menu's own fee. */
  transportFee: number;
  /** What the customer pays now (promotion price applied when active). */
  total: number;
  /** Regular total, only present when a fair struck-through comparison is allowed. */
  compareTotal?: number;
  /** Ends at, when the shown service price is a shop promotion. */
  promotionEndsAt?: number;
  /** Included in `total` when the shop's time-band surcharge applies at `earliestAt`. */
  timeSurcharge?: number;
  earliestAt: number | null;
  stats: ListingStats;
  badges: { freeTravel: boolean; instantNow: boolean };
};
export type MobileTherapists = {
  items: MobileTherapist[];
  total: number;
  nextCursor: string | null;
  checkedAt: number;
};
