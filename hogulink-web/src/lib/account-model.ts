import type { CustomerOverview, Locale } from '@hogulink/contracts';
import { at } from './account-i18n';
import { japanDay } from './desktop-model';

export type AccountBooking = CustomerOverview['recent'][number];

export function accountBookingAction(booking: AccountBooking & { requiresConsent?: boolean }) {
  if (booking.requiresConsent) return { label: 'consent', help: 'consentHelp' } as const;
  if (booking.status === 'AWAITING_COMPLETION')
    return { label: 'completion', help: 'completionHelp' } as const;
  if (['REQUESTED', 'ACCEPTED'].includes(booking.status))
    return { label: 'details', help: 'waitingHelp' } as const;
  if (booking.status === 'IN_SERVICE') return { label: 'details', help: 'liveHelp' } as const;
  if (booking.status === 'ARRIVED')
    return {
      label: 'details',
      help: booking.fulfillmentMode === 'IN_STORE' ? 'checkedInHelp' : 'arrivedHelp',
    } as const;
  if (booking.status === 'EN_ROUTE') return { label: 'details', help: 'onWayHelp' } as const;
  return {
    label: 'details',
    help: booking.fulfillmentMode === 'IN_STORE' ? 'storeHelp' : 'homeHelp',
  } as const;
}

export function accountStartTime(locale: Locale, startAt: number, now: number) {
  const day = japanDay(startAt),
    today = japanDay(now),
    tomorrow = japanDay(now + 86400000);
  const date =
    day === today
      ? at(locale, 'today')
      : day === tomorrow
        ? at(locale, 'tomorrow')
        : new Intl.DateTimeFormat(locale, {
            timeZone: 'Asia/Tokyo',
            month: 'short',
            day: 'numeric',
          }).format(startAt);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(startAt);
  return `${date} ${time} · JST`;
}

export function accountCountdown(locale: Locale, startAt: number, now: number) {
  const minutes = Math.ceil((startAt - now) / 60000);
  if (minutes <= 0) return at(locale, 'due');
  if (minutes <= 1) return at(locale, 'soon');
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60),
      rest = minutes % 60;
    return `${hours} ${at(locale, 'hourUnit')}${rest ? ` ${rest} ${at(locale, 'minuteUnit')}` : ''} ${at(locale, 'startsIn')}`;
  }
  return `${minutes} ${at(locale, 'minutes')}`;
}

/** Focus has its own card; history does not show the same order a second time. */
export function accountRecent(overview: CustomerOverview) {
  return overview.recent.filter((b) => b.id !== overview.focus?.id).slice(0, 3);
}

export type Rebooking = {
  fulfillmentMode?: 'HOME_VISIT' | 'IN_STORE';
  listingSlug: string;
  offeringId: string;
  nominationType: string;
  bookingMode: string;
  area: string;
  language?: string;
};
export function rebookingHref(locale: Locale, booking: Rebooking) {
  const query = new URLSearchParams({
    fulfillmentMode: booking.fulfillmentMode ?? 'HOME_VISIT',
    offering: booking.offeringId,
    nomination: booking.nominationType,
    mode: booking.bookingMode,
    area: booking.area,
    rebook: '1',
  });
  if (booking.language) query.set('language', booking.language);
  return `/${locale}/book/${encodeURIComponent(booking.listingSlug)}?${query}`;
}
