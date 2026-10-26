'use client';
import { useState } from 'react';
import { fulfillmentMode, type Booking, type Locale, type Role } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { errorText, t } from '@/lib/i18n';
import { sv, serviceModeError } from '@/lib/service-mode-i18n';
import { VenueInfo } from './service-mode';

export function InStoreOrder({
  locale: l,
  booking: b,
  role,
  onUpdated,
}: {
  locale: Locale;
  booking: Booking;
  role: Role;
  onUpdated: () => Promise<unknown> | void;
}) {
  const [code, setCode] = useState(''),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  if (fulfillmentMode(b.quote) !== 'IN_STORE' || !b.quote.venue) return null;
  const active = !['CANCELLED', 'REJECTED', 'EXPIRED', 'COMPLETED'].includes(b.status);
  return (
    <section className="in-store-order">
      {role !== 'CUSTOMER' && b.resourceId && (
        <p>
          {sv(l, 'resourceAssigned')}: <strong>{b.resourceName ?? b.resourceId}</strong>
        </p>
      )}
      <span className="status-badge">{sv(l, 'IN_STORE')}</span>
      <VenueInfo locale={l} venue={b.quote.venue} />
      {b.contact && (
        <p>
          {sv(l, 'contact')}: {b.contact.name} ·{' '}
          <a href={`tel:${b.contact.phone}`}>{b.contact.phone}</a>
        </p>
      )}
      {b.status === 'CANCELLED' && b.cancelReason === 'CUSTOMER_LATE_ARRIVAL' && (
        <p className="quality-note">{sv(l, 'CUSTOMER_LATE_ARRIVAL')}</p>
      )}
      {role === 'MERCHANT' &&
        b.status === 'CONFIRMED' &&
        b.checkIn &&
        b.startedAt === undefined &&
        b.checkIn.at > b.quote.startAt && (
          <form
            className="exception-panel"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api(`merchant/bookings/${b.id}/late-arrival`, {
                  version: b.version,
                  note: note.trim(),
                });
                setNote('');
                await onUpdated();
              } catch (e) {
                const value = e instanceof ClientError ? e.code : undefined;
                setError(serviceModeError(l, value) ?? errorText(l, value));
                if (value === 'VERSION_CONFLICT') await onUpdated();
              } finally {
                setBusy(false);
              }
            }}
          >
            <strong>{sv(l, 'lateArrival')}</strong>
            <p>{sv(l, 'lateArrivalHelp')}</p>
            <label className="field">
              {sv(l, 'lateArrivalNote')}
              <textarea
                value={note}
                required
                minLength={10}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button className="button secondary small" disabled={busy}>
              {sv(l, 'lateArrival')}
            </button>
          </form>
        )}
      {b.checkIn ? (
        <p className="quality-note">{sv(l, 'checkedIn')}</p>
      ) : (
        active && (
          <>
            {role === 'CUSTOMER' && b.checkInCode && (
              <div className="exception-panel">
                <strong>{sv(l, 'checkInCode')}</strong>
                <p className="venue-check-in-code">{b.checkInCode}</p>
                <p>{sv(l, 'checkInHelp')}</p>
              </div>
            )}
            {role === 'STAFF' && <p>{sv(l, 'waitCheckIn')}</p>}
            {role === 'MERCHANT' &&
              b.status === 'CONFIRMED' &&
              b.staffTaskStatus === 'ACKNOWLEDGED' &&
              b.replacementConsent !== 'PENDING' && (
                <form
                  className="venue-check-in-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError('');
                    try {
                      await api(`merchant/bookings/${b.id}/check-in`, {
                        version: b.version,
                        code: code.trim().toUpperCase(),
                      });
                      setCode('');
                      await onUpdated();
                    } catch (e) {
                      const value = e instanceof ClientError ? e.code : undefined;
                      setError(serviceModeError(l, value) ?? errorText(l, value));
                      if (value === 'VERSION_CONFLICT') await onUpdated();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label className="field">
                    {sv(l, 'checkInCode')}
                    <input
                      value={code}
                      required
                      minLength={12}
                      maxLength={12}
                      autoComplete="off"
                      pattern="[a-fA-F0-9]{12}"
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                  <button className="button small" disabled={busy}>
                    {sv(l, 'checkIn')}
                  </button>
                </form>
              )}
          </>
        )
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
