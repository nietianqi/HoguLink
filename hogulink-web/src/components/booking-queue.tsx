'use client';
import { pc } from '@/lib/pc-consumer-i18n';
import { useEffect, useState } from 'react';
import {
  Search,
  List,
  CalendarDays,
  Download,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  SlidersHorizontal,
} from 'lucide-react';
import type { Booking, Locale, Role } from '@hogulink/contracts';
import type { Catalog } from '@/lib/api';
import { dt } from '@/lib/desktop-i18n';
import { ut } from '@/lib/consumer-i18n';
import { csvCell, japanDay, needsAttention, type BookingFilter } from '@/lib/desktop-model';
import { dateTime, money, statusText, t } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sv } from '@/lib/service-mode-i18n';
import { withServiceMode } from '@/lib/visit-model';
import { at } from '@/lib/account-i18n';
import { merchantBookingStatus } from '@/lib/merchant-model';
import { mo } from '@/lib/merchant-operations-i18n';

export function BookingQueue({
  locale: l,
  role,
  bookings,
  allBookings,
  reviewBookingIds = [],
  reviewUnavailable = false,
  catalog,
  selectedId,
  onSelect,
  search,
  onSearch,
  status,
  onStatus,
  period,
  onPeriod,
}: {
  locale: Locale;
  role: Role;
  bookings: Booking[];
  allBookings: Booking[];
  reviewBookingIds?: readonly string[];
  reviewUnavailable?: boolean;
  catalog?: {
    stores: Pick<import('@hogulink/contracts').PublicStore, 'id' | 'name'>[];
    listings: import('@hogulink/contracts').Listing[];
  };
  selectedId?: string;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (v: string) => void;
  status: BookingFilter;
  onStatus: (v: BookingFilter) => void;
  period: string;
  onPeriod: (v: string) => void;
}) {
  const [view, setView] = useState('queue');
  const router = useRouter();
  const [mobileFilters, setMobileFilters] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [search, status, period]);
  const pageCount = Math.max(1, Math.ceil(bookings.length / 8));
  const safePage = Math.min(page, pageCount - 1);
  const rows = bookings.slice(safePage * 8, (safePage + 1) * 8);
  const reviewFailed = role === 'CUSTOMER' && status === 'review' && reviewUnavailable;
  const shop = (b: Booking) =>
    catalog?.stores.find((s) => s.id === b.storeId)?.name[l] ?? b.legalNameSnapshot;
  const staff = (b: Booking) =>
    catalog?.listings.find((x) => x.id === (b.assignedListingId ?? b.selectedStaffListingId))?.name[
      l
    ] ?? t(l, 'unassigned');
  function select(id: string) {
    if (role === 'MERCHANT') {
      router.push(`/${l}/merchant?tab=bookings&booking=${encodeURIComponent(id)}`);
      return;
    }
    if (role === 'CUSTOMER') {
      router.push(
        withServiceMode(
          `/${l}/account/bookings/${id}`,
          bookings.find((b) => b.id === id)?.quote.fulfillmentMode,
        ),
      );
      return;
    }
    onSelect(id);
    document.getElementById('booking-detail')?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }
  function exportCsv() {
    const columns = [
      dt(l, 'reference'),
      t(l, 'shop'),
      dt(l, 'therapist'),
      dt(l, 'scheduled'),
      t(l, 'status'),
      dt(l, 'quotedTotal'),
      dt(l, 'netCaptured'),
    ];
    const content = [
      columns,
      ...bookings.map((b) => [
        b.id,
        shop(b),
        staff(b),
        new Date(b.quote.startAt + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') +
          ' JST',
        role === 'MERCHANT' ? merchantBookingStatus(l, b) : statusText(l, b.status),
        b.quote.total,
        b.capturedAmount - b.refundedAmount,
      ]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(
      new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `HoguLink-${role.toLowerCase()}-${japanDay(Date.now())}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const tabs: BookingFilter[] =
    role === 'CUSTOMER'
      ? ['all', 'attention', 'active', 'review', 'completed', 'closed']
      : ['all', 'attention', 'active', 'completed', 'closed'];
  const grouped = new Map<string, Booking[]>();
  for (const b of [...rows].sort((a, b) => a.quote.startAt - b.quote.startAt)) {
    const key = japanDay(b.quote.startAt);
    grouped.set(key, [...(grouped.get(key) ?? []), b]);
  }
  return (
    <section
      className="queue-panel"
      data-role={role}
      aria-label={role === 'CUSTOMER' ? ht(l, 'bookingRecords') : dt(l, 'worklist')}
      id="worklist"
    >
      <div className="queue-heading">
        <div>
          {role !== 'CUSTOMER' && <span className="eyebrow small">DAILY OPERATIONS</span>}
          <h2>{role === 'CUSTOMER' ? ht(l, 'bookingRecords') : dt(l, 'worklist')}</h2>
        </div>
        {role === 'CUSTOMER' ? (
          <details className="consumer-queue-tools">
            <summary>{pc(l, 'moreTools')}</summary>{' '}
            <button
              className="button secondary small"
              onClick={exportCsv}
              disabled={!bookings.length}
            >
              <Download size={15} />
              {dt(l, 'export')}
            </button>
          </details>
        ) : (
          <button
            className="button secondary small"
            onClick={exportCsv}
            disabled={!bookings.length}
          >
            <Download size={15} />
            {dt(l, 'export')}
          </button>
        )}
      </div>
      <div className="queue-tabs" aria-label={t(l, 'status')}>
        {tabs.map((tab) => (
          <button key={tab} aria-pressed={tab === status} onClick={() => onStatus(tab)}>
            {tab === 'review'
              ? at(l, 'review')
              : role === 'CUSTOMER' && tab === 'active'
                ? ut(l, 'active')
                : role === 'MERCHANT' && tab === 'active'
                  ? mo(l, 'active')
                  : dt(l, tab)}
            <span>
              {tab === 'all'
                ? allBookings.length
                : tab === 'review'
                  ? reviewUnavailable
                    ? '—'
                    : allBookings.filter(
                        (b) => b.status === 'COMPLETED' && reviewBookingIds.includes(b.id),
                      ).length
                  : tab === 'attention'
                    ? allBookings.filter((b) => needsAttention(b, role)).length
                    : tab === 'active'
                      ? allBookings.filter(
                          (b) =>
                            !(
                              role === 'MERCHANT'
                                ? [
                                    'REQUESTED',
                                    'ACCEPTED',
                                    'COMPLETED',
                                    'CANCELLED',
                                    'EXPIRED',
                                    'REJECTED',
                                  ]
                                : ['COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED']
                            ).includes(b.status),
                        ).length
                      : tab === 'completed'
                        ? allBookings.filter((b) => b.status === 'COMPLETED').length
                        : allBookings.filter((b) =>
                            ['CANCELLED', 'EXPIRED', 'REJECTED'].includes(b.status),
                          ).length}
            </span>
          </button>
        ))}
      </div>
      {role === 'CUSTOMER' && (
        <button
          type="button"
          className="h5-order-filter-toggle"
          aria-label={ht(l, 'filters')}
          aria-expanded={mobileFilters}
          aria-controls="h5-customer-order-filters"
          onClick={() => setMobileFilters(!mobileFilters)}
        >
          <SlidersHorizontal size={20} />
        </button>
      )}
      <div
        id={role === 'CUSTOMER' ? 'h5-customer-order-filters' : undefined}
        className={`queue-toolbar ${role === 'CUSTOMER' ? `h5-customer-order-filters ${mobileFilters ? 'is-open' : ''}` : ''}`}
      >
        <label className="queue-search">
          <Search size={17} />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={dt(l, 'searchOrders')}
            aria-label={dt(l, 'searchOrders')}
          />
        </label>
        <select
          aria-label={dt(l, 'anyDate')}
          value={period}
          onChange={(e) => onPeriod(e.target.value)}
        >
          <option value="all">{dt(l, 'anyDate')}</option>
          <option value="today">{dt(l, 'today')}</option>
          <option value="upcoming">{dt(l, 'upcoming')}</option>
        </select>
        <div className="view-toggle">
          <button
            aria-label={dt(l, 'queue')}
            aria-pressed={view === 'queue'}
            onClick={() => setView('queue')}
          >
            <List size={18} />
          </button>
          <button
            aria-label={dt(l, 'agenda')}
            aria-pressed={view === 'agenda'}
            onClick={() => setView('agenda')}
          >
            <CalendarDays size={18} />
          </button>
        </div>
      </div>
      {!reviewFailed && (
        <>
          {view === 'queue' ? (
            <>
              <div className="mobile-booking-queue">
                {rows.map((b) => (
                  <button
                    type="button"
                    className="mobile-booking-row"
                    key={b.id}
                    aria-pressed={role === 'CUSTOMER' ? undefined : b.id === selectedId}
                    onClick={() => select(b.id)}
                  >
                    <span className="mobile-booking-top">
                      <span className={`status-badge status-${b.status.toLowerCase()}`}>
                        {role === 'MERCHANT'
                          ? merchantBookingStatus(l, b)
                          : statusText(l, b.status)}
                      </span>
                      <small>{b.id.slice(-8).toUpperCase()}</small>
                    </span>
                    <strong>{staff(b)}</strong>
                    <span>
                      {sv(l, b.quote.fulfillmentMode ?? 'HOME_VISIT')} · {shop(b)} ·{' '}
                      {(b.quote.endAt - b.quote.startAt) / 60000} {t(l, 'minutes')}
                    </span>
                    <time>
                      <CalendarDays size={15} />
                      {dateTime(l, b.quote.startAt)} JST
                    </time>
                    <span className="mobile-booking-bottom">
                      <strong>{money(l, b.quote.total)}</strong>
                      <span>
                        {dt(l, needsAttention(b, role) ? 'attention' : 'details')}
                        <ArrowUpRight size={16} />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="data-table queue-table">
                <table>
                  <thead>
                    <tr>
                      <th>{dt(l, 'reference')}</th>
                      <th>{dt(l, 'session')}</th>
                      <th>{dt(l, 'scheduled')}</th>
                      <th>{t(l, 'status')}</th>
                      <th>{t(l, 'total')}</th>
                      <th>
                        <span className="sr-only">{dt(l, 'view')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.id} data-selected={b.id === selectedId}>
                        <td>
                          <button
                            className="reference-button"
                            onClick={() => select(b.id)}
                            aria-label={`${dt(l, 'view')} ${b.id.slice(-8).toUpperCase()}`}
                          >
                            {b.id.slice(-8).toUpperCase()}
                          </button>
                          <small>
                            {t(l, b.quote.bookingMode === 'INSTANT' ? 'instant' : 'scheduled')}
                          </small>
                        </td>
                        <td>
                          <strong>{staff(b)}</strong>
                          <small>
                            {sv(l, b.quote.fulfillmentMode ?? 'HOME_VISIT')} · {shop(b)} ·{' '}
                            {(b.quote.endAt - b.quote.startAt) / 60000} {t(l, 'minutes')}
                          </small>
                        </td>
                        <td>
                          {dateTime(l, b.quote.startAt)}
                          <small>JST</small>
                        </td>
                        <td>
                          <span className={`status-badge status-${b.status.toLowerCase()}`}>
                            {role === 'MERCHANT'
                              ? merchantBookingStatus(l, b)
                              : statusText(l, b.status)}
                          </span>
                          {needsAttention(b, role) && (
                            <small className="attention-label">{dt(l, 'attention')}</small>
                          )}
                        </td>
                        <td>
                          <strong>{money(l, b.quote.total)}</strong>
                        </td>
                        <td>
                          <button
                            className="queue-open"
                            onClick={() => select(b.id)}
                            aria-label={`${dt(l, 'details')} ${b.id.slice(-8).toUpperCase()}`}
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="agenda-list">
              {[...grouped].map(([day, items]) => (
                <div className="agenda-day" key={day}>
                  <time>
                    {day}
                    <small>JST</small>
                  </time>
                  <div>
                    {items.map((b) => (
                      <button
                        key={b.id}
                        className={b.id === selectedId ? 'selected' : ''}
                        onClick={() => select(b.id)}
                      >
                        <Clock3 size={16} />
                        <time>
                          {new Intl.DateTimeFormat(l, {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Tokyo',
                            hourCycle: 'h23',
                          }).format(b.quote.startAt)}
                        </time>
                        <span>
                          <strong>{staff(b)}</strong>
                          <small>
                            {shop(b)} · {b.id.slice(-8).toUpperCase()}
                          </small>
                        </span>
                        <span className={`status-badge status-${b.status.toLowerCase()}`}>
                          {role === 'MERCHANT'
                            ? merchantBookingStatus(l, b)
                            : statusText(l, b.status)}
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!bookings.length && (
            <div className="queue-empty">
              <Search size={25} />
              <p>
                {role === 'CUSTOMER' && status === 'review'
                  ? at(l, 'noReviews')
                  : role === 'CUSTOMER' && !allBookings.length
                    ? ht(l, 'emptyBookings')
                    : dt(l, 'noMatches')}
              </p>
              {role === 'CUSTOMER' && !allBookings.length ? (
                <Link className="button" href={`/${l}/therapists`}>
                  {ht(l, 'reserve')}
                </Link>
              ) : (
                <button
                  className="text-button"
                  onClick={() => {
                    onSearch('');
                    onStatus('all');
                    onPeriod('all');
                  }}
                >
                  {dt(l, 'reset')}
                </button>
              )}
            </div>
          )}
          <div className="queue-footer">
            <span>
              {bookings.length} {dt(l, 'matches')}
              <small>{dt(l, 'timezone')}</small>
            </span>
            <div>
              <button
                className="queue-open"
                aria-label={l === 'zh-cn' ? '上一页' : l === 'ja' ? '前のページ' : 'Previous page'}
                disabled={safePage === 0}
                onClick={() => {
                  setPage(safePage - 1);
                  onSelect(bookings[(safePage - 1) * 8].id);
                }}
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                {safePage + 1} / {pageCount}
              </span>
              <button
                className="queue-open"
                aria-label={l === 'zh-cn' ? '下一页' : l === 'ja' ? '次のページ' : 'Next page'}
                disabled={safePage >= pageCount - 1}
                onClick={() => {
                  setPage(safePage + 1);
                  onSelect(bookings[(safePage + 1) * 8].id);
                }}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <p className="queue-help">{dt(l, 'bookingHelp')}</p>
        </>
      )}
    </section>
  );
}
