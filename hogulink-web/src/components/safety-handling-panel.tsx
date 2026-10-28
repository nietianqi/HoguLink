'use client';
import { useState } from 'react';
import type { Actor, AdminAssignee, Locale, SafetyEvent } from '@hogulink/contracts';
import { canAdmin } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, errorText } from '@/lib/i18n';
import { ot } from '@/lib/admin-operations-i18n';
import { ht, isHandlingKey } from '@/lib/handling-i18n';
export function SafetyHandlingPanel({
  locale: l,
  actor,
  event,
  assignees,
  onChanged,
}: {
  locale: Locale;
  actor: Actor | null;
  event: SafetyEvent;
  assignees: AdminAssignee[];
  onChanged: () => Promise<void>;
}) {
  const [action, setAction] = useState<'ACKNOWLEDGE' | 'CONTACT' | 'HANDOVER'>('CONTACT');
  const [ownerId, setOwnerId] = useState(''),
    [note, setNote] = useState(''),
    [minutes, setMinutes] = useState(15),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const handling = event.handling;
  const canUpdate =
    !handling || handling.ownerId === actor?.id || (actor?.adminRole ?? 'OWNER') === 'OWNER';
  return (
    <div className="admin-safety-handling">
      <p>
        <strong>{ot(l, 'owner')}</strong> · {handling?.ownerName ?? ot(l, 'unassigned')}
      </p>
      {handling && (
        <p
          className={
            handling.followUpAt <= Date.now() && event.status === 'OPEN' ? 'error-message' : ''
          }
        >
          {ot(l, 'nextFollowUp')} · {dateTime(l, handling.followUpAt)} JST{' '}
          {handling.followUpAt <= Date.now() && event.status === 'OPEN'
            ? `· ${ot(l, 'overdue')}`
            : ''}
        </p>
      )}
      {handling && (
        <details>
          <summary>
            {ot(l, 'internal')} · {handling.history.length}
          </summary>
          {handling.history
            .slice()
            .reverse()
            .map((h, i) => (
              <article key={`${h.at}:${i}`}>
                <strong>
                  {ot(
                    l,
                    h.action === 'ACKNOWLEDGE'
                      ? 'safetyAck'
                      : h.action === 'CONTACT'
                        ? 'safetyContact'
                        : 'safetyHandover',
                  )}
                </strong>
                <time>{dateTime(l, h.at)}</time>
                <p>{h.note}</p>
              </article>
            ))}
        </details>
      )}
      {event.status === 'OPEN' && canUpdate && (
        <details>
          <summary>{ot(l, handling ? 'handling' : 'acknowledge')}</summary>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api(`admin/safety-events/${event.id}/handling`, {
                  version: event.version ?? 1,
                  action: handling ? action : 'ACKNOWLEDGE',
                  note,
                  followUpAt: Date.now() + minutes * 60000,
                  ...(handling && action === 'HANDOVER' ? { ownerId } : {}),
                });
                setNote('');
                await onChanged();
              } catch (e) {
                const code = e instanceof ClientError ? e.code : '';
                setError(isHandlingKey(code) ? ht(l, code) : errorText(l, code));
                if (code === 'VERSION_CONFLICT') await onChanged();
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              {handling && (
                <label>
                  {ot(l, 'handling')}
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value as typeof action)}
                  >
                    <option value="CONTACT">{ot(l, 'contact')}</option>
                    <option value="HANDOVER">{ot(l, 'handover')}</option>
                  </select>
                </label>
              )}
              {handling && action === 'HANDOVER' && (
                <label>
                  {ot(l, 'owner')}
                  <select required value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                    <option value="">—</option>
                    {assignees
                      .filter(
                        (a) =>
                          a.id !== handling.ownerId &&
                          canAdmin(
                            {
                              id: a.id,
                              role: 'ADMIN',
                              verificationLevel: 3,
                              adminRole: a.adminRole,
                            },
                            'safety.write',
                          ),
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                {ot(l, 'followMinutes')}
                <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {[5, 15, 30, 60].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {ot(l, 'note')}
                <textarea
                  required
                  minLength={10}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p className="admin-footnote">{ot(l, 'internal')}</p>
              {error && (
                <p role="alert" className="error-message">
                  {error}
                </p>
              )}
              <button className="button secondary" disabled={busy || note.trim().length < 10}>
                {ot(l, handling ? (action === 'HANDOVER' ? 'handover' : 'contact') : 'acknowledge')}
              </button>
            </fieldset>
          </form>
        </details>
      )}
    </div>
  );
}
