'use client';
import Link from 'next/link';
import type { Booking, Locale } from '@hogulink/contracts';
import { ArrowRight } from 'lucide-react';
import { customerTaskKind, groupCustomerBookings } from '@/lib/account-model';
import { pa } from '@/lib/pc-account-i18n';
import { at } from '@/lib/account-i18n';
import { money, statusText, t } from '@/lib/i18n';
import { visitTimeRange } from '@/lib/booking-presentation';
import { sv } from '@/lib/service-mode-i18n';
import { AccountRebook } from './pc-account-hub';
import type { BookingFilter } from '@/lib/desktop-model';

export function PcCustomerBookingRows({
  locale: l,
  bookings,
  reviewIds,
  now,
  catalog,
  status = 'all',
}: {
  locale: Locale;
  bookings: Booking[];
  reviewIds: readonly string[];
  now?: number;
  status?: BookingFilter;
  catalog?: {
    stores: { id: string; name: import('@hogulink/contracts').Localized }[];
    listings: import('@hogulink/contracts').Listing[];
  };
}) {
  const groups = ['completed', 'closed', 'review'].includes(status)
    ? { [status]: bookings }
    : groupCustomerBookings(bookings, reviewIds, now);
  return (
    <div className="pc-customer-booking-groups">
      {Object.entries(groups)
        .filter(([, items]) => items.length)
        .map(([key, items]) => (
          <section
            key={key}
            aria-label={
              key === 'completed' || key === 'review'
                ? at(l, key)
                : pa(
                    l,
                    key === 'attention'
                      ? 'attention'
                      : key === 'upcoming'
                        ? 'upcomingGroup'
                        : 'closed',
                  )
            }
          >
            <h3>
              {key === 'completed' || key === 'review'
                ? at(l, key)
                : pa(
                    l,
                    key === 'attention'
                      ? 'attention'
                      : key === 'upcoming'
                        ? 'upcomingGroup'
                        : 'closed',
                  )}
            </h3>
            {items.map((b) => {
              const task = customerTaskKind(b, reviewIds, now);
              const href = `/${l}/account/bookings/${b.id}`;
              const staff = catalog?.listings.find(
                (x) => x.id === (b.assignedListingId ?? b.selectedStaffListingId),
              );
              return (
                <article
                  key={b.id}
                  className={`pc-customer-booking-row ${key === 'closed' ? 'is-closed' : ''}`}
                >
                  <time className="pc-booking-row-date">
                    <strong>
                      {new Intl.DateTimeFormat(l, {
                        month: 'short',
                        day: 'numeric',
                        timeZone: 'Asia/Tokyo',
                      }).format(b.quote.startAt)}
                    </strong>
                    <span>
                      {new Intl.DateTimeFormat(l, {
                        hour: '2-digit',
                        minute: '2-digit',
                        hourCycle: 'h23',
                        timeZone: 'Asia/Tokyo',
                      }).format(b.quote.startAt)}{' '}
                      JST
                    </span>
                  </time>
                  <div className="pc-booking-row-body">
                    <div>
                      <Link href={href}>
                        <strong>
                          {b.quote.serviceName?.[l] ??
                            `${(b.quote.endAt - b.quote.startAt) / 60000} ${t(l, 'minutes')}`}
                        </strong>
                      </Link>
                      <span className={`status-badge status-${b.status.toLowerCase()}`}>
                        {statusText(l, b.status)}
                      </span>
                    </div>
                    <p>
                      {catalog?.stores.find((x) => x.id === b.storeId)?.name[l] ??
                        b.legalNameSnapshot}{' '}
                      ·{' '}
                      {staff?.name[l] ??
                        (b.assignedListingId || b.selectedStaffListingId
                          ? pa(l, 'therapistDetails')
                          : t(l, 'unassigned'))}{' '}
                      · {sv(l, b.quote.fulfillmentMode ?? 'HOME_VISIT')}
                    </p>
                    <time>{visitTimeRange(l, b.quote.startAt, b.quote.endAt)}</time>
                    <small>{b.id.slice(-8).toUpperCase()}</small>
                  </div>
                  <div className="pc-booking-row-actions">
                    <strong>{money(l, b.quote.total)}</strong>
                    <Link
                      className={task ? 'quality-button' : 'quality-link'}
                      href={`${href}${task === 'review' ? `#customer-review-${b.id}` : ''}`}
                    >
                      {task
                        ? task === 'review'
                          ? pa(l, 'goReview')
                          : task === 'payment'
                            ? pa(l, 'goPayment')
                            : at(l, task)
                        : at(l, 'details')}
                      <ArrowRight size={15} />
                    </Link>
                    {b.status === 'COMPLETED' && <AccountRebook locale={l} bookingId={b.id} />}
                  </div>
                </article>
              );
            })}
          </section>
        ))}
    </div>
  );
}
