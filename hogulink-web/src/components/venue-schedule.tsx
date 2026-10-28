'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Locale, VenueCalendar } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, errorText, statusText, t } from '@/lib/i18n';
import { japanDay } from '@/lib/desktop-model';
import { sv, serviceModeError } from '@/lib/service-mode-i18n';

export function VenueSchedule({
  locale: l,
  date,
  onDateChange,
}: {
  locale: Locale;
  date: string;
  onDateChange: (day: string) => void;
}) {
  const [data, setData] = useState<VenueCalendar>(),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return;
    let live = true;
    setData(undefined);
    setError('');
    api<VenueCalendar>(`merchant/venue/calendar?${new URLSearchParams({ date })}`)
      .then((value) => {
        if (live) setData(value);
      })
      .catch((e) => {
        if (live) {
          const code = e instanceof ClientError ? e.code : undefined;
          setError(serviceModeError(l, code) ?? errorText(l, code));
        }
      });
    return () => {
      live = false;
    };
  }, [date, retry, l]);
  const step = (days: number) =>
    onDateChange(japanDay(Date.parse(`${date}T12:00:00+09:00`) + days * 86400000));
  return (
    <section className="merchant-panel venue-schedule">
      <h2>{sv(l, 'calendar')}</h2>
      <div className="booking-actions">
        <button type="button" className="button secondary small" onClick={() => step(-1)}>
          {sv(l, 'previousDay')}
        </button>
        <label className="field">
          <span className="sr-only">{sv(l, 'calendar')}</span>
          <input
            type="date"
            value={date}
            required
            onChange={(e) => {
              if (e.target.value) onDateChange(e.target.value);
            }}
          />
        </label>
        <button type="button" className="button secondary small" onClick={() => step(1)}>
          {sv(l, 'nextDay')}
        </button>
        <button type="button" className="text-button" onClick={() => setRetry((n) => n + 1)}>
          {sv(l, 'retry')}
        </button>
      </div>
      {error ? (
        <p role="alert" className="error-message">
          {error}
        </p>
      ) : !data ? (
        <p role="status">{t(l, 'waiting')}</p>
      ) : (
        <div className="venue-schedule-grid">
          {data.resources.map((resource) => (
            <section className="exception-panel" key={resource.id}>
              <h3>{resource.name}</h3>
              {!data.entries.some((row) => row.resourceId === resource.id) && (
                <p className="flow-muted">{sv(l, 'noReservations')}</p>
              )}
              {data.entries
                .filter((row) => row.resourceId === resource.id)
                .map((row) => (
                  <article className="venue-schedule-entry" key={row.id}>
                    <strong>
                      {row.phase === 'CHECKOUT_HOLD'
                        ? sv(l, 'temporaryHold')
                        : row.phase === 'CLEANING'
                          ? sv(l, 'cleaning')
                          : row.phase === 'CHECKED_IN'
                            ? sv(l, 'checkedIn')
                            : statusText(l, row.phase)}
                    </strong>
                    <p>
                      {dateTime(l, row.startAt)} –{' '}
                      {row.ongoing ? statusText(l, 'IN_SERVICE') : dateTime(l, row.endAt)} · JST
                    </p>
                    {row.serviceName && (
                      <p>
                        {row.serviceName[l]}
                        {row.staffName ? ` · ${row.staffName[l]}` : ''}
                      </p>
                    )}
                    {row.bookingId && (
                      <Link
                        className="text-button"
                        href={`/${l}/merchant?tab=bookings&booking=${encodeURIComponent(row.bookingId)}`}
                      >
                        {t(l, 'booking')} ↗
                      </Link>
                    )}
                  </article>
                ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
