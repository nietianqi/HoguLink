'use client';
import { useEffect, useState } from 'react';
import type { EmergencyLocation, Locale, SafetyEvent, SafetyLocation } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, errorText } from '@/lib/i18n';
import { ct } from '@/lib/care-i18n';

const mapUrl = (p: SafetyLocation) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.latitude},${p.longitude}`)}`;

export function SharedLocation({
  locale: l,
  location,
}: {
  locale: Locale;
  location: SafetyLocation;
}) {
  return (
    <a className="text-button" href={mapUrl(location)} target="_blank" rel="noopener noreferrer">
      {ct(l, 'viewLocation')} · ±{Math.round(location.accuracy)} m ·{' '}
      {dateTime(l, location.sharedAt)} ↗
    </a>
  );
}

/** After an SOS: emergency numbers, the shop's emergency contact and a one-time location share. */
export function SafetyHelp({
  locale: l,
  bookingId,
  refreshKey,
}: {
  locale: Locale;
  bookingId: string;
  refreshKey: unknown;
}) {
  const [event, setEvent] = useState<SafetyEvent>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api<SafetyEvent[]>('safety-events')
      .then((all) => {
        if (live) setEvent(all.find((x) => x.bookingId === bookingId && x.status === 'OPEN'));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [bookingId, refreshKey]);
  if (!event) return null;
  const open = event;
  async function share() {
    setBusy(true);
    setError('');
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation
          ? navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
            })
          : reject(new Error('Location unavailable')),
      );
      setEvent(
        await api<SafetyEvent>(`staff/safety-events/${open.id}/location`, {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy),
        }),
      );
    } catch (e) {
      setError(e instanceof ClientError ? errorText(l, e.code) : ct(l, 'locationUnavailable'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="exception-panel safety-help" role="alert">
      <h3>{ct(l, 'helpSent')}</h3>
      <p>
        <strong>{ct(l, 'emergencyCall')}</strong>
      </p>
      <div className="button-row">
        <a className="button danger-button small" href="tel:110">
          110
        </a>
        <a className="button danger-button small" href="tel:119">
          119
        </a>
        {open.emergencyContact && (
          <a className="button secondary small" href={`tel:${open.emergencyContact}`}>
            {ct(l, 'shopEmergency')} · {open.emergencyContact}
          </a>
        )}
      </div>
      {open.location ? (
        <p className="quality-note">
          {ct(l, 'locationShared')} · {dateTime(l, open.location.sharedAt)}
        </p>
      ) : (
        <>
          <p className="flow-muted">{ct(l, 'shareLocationHelp')}</p>
          <button className="button small" disabled={busy} onClick={() => void share()}>
            {ct(l, 'shareLocation')}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}

/** Safety team only: reveals the visit place of an open event after a recorded reason. */
export function EmergencyLookup({ locale: l, eventId }: { locale: Locale; eventId: string }) {
  const [reason, setReason] = useState(''),
    [result, setResult] = useState<EmergencyLocation>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="emergency-lookup"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          setResult(
            await api<EmergencyLocation>(`admin/safety-events/${eventId}/emergency-location`, {
              reason: reason.trim(),
            }),
          );
        } catch (e) {
          setError(errorText(l, e instanceof ClientError ? e.code : undefined));
        } finally {
          setBusy(false);
        }
      }}
    >
      <strong>{ct(l, 'emergencyAccess')}</strong>
      <p className="flow-muted">{ct(l, 'emergencyHelp')}</p>
      {result ? (
        <dl className="exception-facts">
          <div>
            <dt>{ct(l, 'visitPlace')}</dt>
            <dd>
              {result.address ?? '—'}
              {result.place ? ` · ${result.place}` : ''}
            </dd>
          </div>
          <div>
            <dt>{ct(l, 'shopEmergency')}</dt>
            <dd>
              <a href={`tel:${result.storeEmergencyContact}`}>{result.storeEmergencyContact}</a>
            </dd>
          </div>
          {result.location && (
            <div>
              <dt>{ct(l, 'viewLocation')}</dt>
              <dd>
                <SharedLocation locale={l} location={result.location} />
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <>
          <label className="field">
            {ct(l, 'emergencyReason')}
            <textarea
              value={reason}
              required
              minLength={10}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button className="button danger-button small" disabled={busy}>
            {ct(l, 'emergencyShow')}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </form>
  );
}
