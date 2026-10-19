'use client';
import { useCallback, useEffect, useState } from 'react';
import { LockKeyhole, RefreshCw } from 'lucide-react';
import {
  ticketHandlingStates,
  ticketTeams,
  canAdmin,
  type Actor,
  type Locale,
  type SupportTicket,
  type TicketHandling,
  type TicketHandlingDetail,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime } from '@/lib/i18n';
import { handlingDateInput, handlingDateValue, ht, isHandlingKey } from '@/lib/handling-i18n';
import { et } from '@/lib/member-i18n';

export function TicketHandlingPanel({
  locale: l,
  ticket,
  actor,
  onConflict,
}: {
  locale: Locale;
  ticket: SupportTicket;
  actor: Actor;
  onConflict: () => Promise<void>;
}) {
  const [data, setData] = useState<TicketHandlingDetail>();
  const [team, setTeam] = useState<TicketHandling['team']>('CUSTOMER_SUPPORT');
  const [state, setState] = useState('TRIAGE'),
    [ownership, setOwnership] = useState('CLAIM');
  const [followUp, setFollowUp] = useState(''),
    [note, setNote] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [limit, setLimit] = useState(5);
  const ended = ['RESOLVED', 'CLOSED'].includes(ticket.status);
  const path = `admin/support-tickets/${encodeURIComponent(ticket.id)}/handling`;
  const apply = useCallback((next: TicketHandlingDetail) => {
    setData(next);
    setTeam(next.handling.team);
    setState(next.handling.state === 'DONE' ? 'TRIAGE' : next.handling.state);
    setOwnership(next.handling.ownerId ? 'KEEP' : 'CLAIM');
    setAssigneeId(next.handling.ownerId ?? '');
    setFollowUp(handlingDateInput(Math.max(next.handling.followUpAt, Date.now() + 3600000)));
  }, []);
  useEffect(() => {
    let cancelled = false;
    api<TicketHandlingDetail>(path)
      .then((next) => {
        if (!cancelled) apply(next);
      })
      .catch(() => {
        if (!cancelled) setError(ht(l, 'error'));
      });
    return () => {
      cancelled = true;
    };
  }, [path, ticket.version, l, apply]);
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      await onConflict();
      apply(await api<TicketHandlingDetail>(path));
    } catch {
      setError(ht(l, 'error'));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      apply(
        await api<TicketHandlingDetail>(
          path,
          {
            ticketVersion: ticket.version,
            version: data.handling.version,
            team,
            state,
            ownership,
            ...(ownership === 'ASSIGN' ? { assigneeId } : {}),
            followUpAt: handlingDateValue(followUp),
            note,
          },
          'PUT',
        ),
      );
      setNote('');
      setNotice(ht(l, 'saved'));
    } catch (e) {
      const code = e instanceof ClientError ? e.code : '';
      setError(isHandlingKey(code) ? ht(l, code) : ht(l, 'error'));
      if (['VERSION_CONFLICT', 'INVALID_STATE'].includes(code)) {
        try {
          await onConflict();
          apply(await api<TicketHandlingDetail>(path));
        } catch {
          /* Keep the original actionable error. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ticket-handling" aria-label={ht(l, 'title')}>
      <div className="handling-heading">
        <div>
          <h3>{ht(l, 'title')}</h3>
          <p>
            <LockKeyhole size={13} />
            {ht(l, 'private')}
          </p>
        </div>
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={() => void refresh()}
          aria-label={ht(l, 'refresh')}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!data ? (
        !error && <p>{ht(l, 'loading')}</p>
      ) : (
        <>
          <div className="handling-summary">
            <span className="admin-pill">{ht(l, data.handling.state)}</span>
            <span>
              {ht(l, 'owner')} ·{' '}
              {data.people?.find((m) => m.id === data.handling.ownerId)?.name ??
                ht(
                  l,
                  !data.handling.ownerId
                    ? 'unassigned'
                    : data.handling.ownerId === actor.id
                      ? 'mine'
                      : 'assigned',
                )}
            </span>
            <span>
              {ht(l, 'target')} · {dateTime(l, data.handling.followUpAt)} JST
            </span>
          </div>
          {ended ||
          (!canAdmin(actor, 'cases.assign') &&
            !!data.handling.ownerId &&
            data.handling.ownerId !== actor.id) ? (
            <p className="muted">{ended ? ht(l, 'finished') : et(l, 'denied')}</p>
          ) : (
            <form onSubmit={save}>
              <fieldset disabled={busy} className="handling-fields">
                <label className="field">
                  {ht(l, 'team')}
                  <select
                    aria-label={ht(l, 'team')}
                    value={team}
                    onChange={(e) => {
                      setTeam(e.target.value as TicketHandling['team']);
                      if (e.target.value !== data.handling.team && ownership === 'KEEP') {
                        setOwnership('RELEASE');
                        setState('TRIAGE');
                      }
                    }}
                  >
                    {ticketTeams
                      .filter(
                        (k) =>
                          (actor.adminRole ?? 'OWNER') === 'OWNER' || actor.adminTeams?.includes(k),
                      )
                      .map((k) => (
                        <option key={k} value={k}>
                          {ht(l, k)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  {ht(l, 'state')}
                  <select
                    aria-label={ht(l, 'state')}
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  >
                    {ticketHandlingStates
                      .filter(
                        (k) =>
                          k !== 'WAITING_MERCHANT' || ticket.visibility === 'SHOP_AND_CUSTOMER',
                      )
                      .map((k) => (
                        <option key={k} value={k}>
                          {ht(l, k)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  {ht(l, 'ownership')}
                  <select
                    aria-label={ht(l, 'ownership')}
                    value={ownership}
                    onChange={(e) => {
                      setOwnership(e.target.value);
                      if (e.target.value === 'RELEASE') setState('TRIAGE');
                    }}
                  >
                    {(['KEEP', 'CLAIM', 'RELEASE'] as const).map((k) => (
                      <option key={k} value={k}>
                        {ht(l, k)}
                      </option>
                    ))}
                    {canAdmin(actor, 'cases.assign') && (
                      <option value="ASSIGN">{et(l, 'assignedTo')}</option>
                    )}
                  </select>
                </label>
                {ownership === 'ASSIGN' && (
                  <label className="field">
                    {et(l, 'assignee')}
                    <select
                      aria-label={et(l, 'assignee')}
                      required
                      value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}
                    >
                      <option value="">{et(l, 'chooseAssignee')}</option>
                      {data.assignees
                        ?.filter((m) => m.teams.includes(team))
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} · {m.openCases} {et(l, 'workload')}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label className="field handling-date">
                  {ht(l, 'followUp')}
                  <input
                    aria-label={ht(l, 'followUp')}
                    type="datetime-local"
                    required
                    value={followUp}
                    min={handlingDateInput(Date.now() + 60000)}
                    max={handlingDateInput(Date.now() + 7 * 86400000)}
                    onChange={(e) => setFollowUp(e.target.value)}
                  />
                </label>
                <label className="field handling-note">
                  {ht(l, 'note')}
                  <textarea
                    aria-label={ht(l, 'note')}
                    required
                    minLength={10}
                    maxLength={3000}
                    value={note}
                    placeholder={ht(l, 'notePlaceholder')}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <p className="handling-help">{ht(l, 'claimHelp')}</p>
                <button className="button" disabled={note.trim().length < 10}>
                  {ht(l, 'save')}
                </button>
              </fieldset>
              <p className="handling-help">{ht(l, 'help')}</p>
            </form>
          )}
          <details className="handling-history" open>
            <summary>
              {ht(l, 'history')} · {data.history.length}
            </summary>
            {data.history.slice(0, limit).map((h) => (
              <article key={h.id}>
                <div>
                  <strong>{h.kind === 'OWNER_UNAVAILABLE' ? et(l, h.kind) : ht(l, h.kind)}</strong>
                  <time>{dateTime(l, h.updatedAt)}</time>
                </div>
                <small>
                  {ht(l, h.team)} · {ht(l, h.state)}
                </small>
                <small>
                  {et(l, 'operator')} ·{' '}
                  {data.people?.find((m) => m.id === h.actorId)?.name ??
                    (h.actorId === actor.id ? actor.displayName : undefined) ??
                    ht(l, h.actorId === 'system' ? 'system' : 'reporter')}{' '}
                  · {ht(l, 'owner')} ·{' '}
                  {data.people?.find((m) => m.id === h.ownerId)?.name ??
                    ht(l, h.ownerId ? 'assigned' : 'unassigned')}
                </small>
                {h.note && <p>{h.note}</p>}
              </article>
            ))}
            {!data.history.length && <p className="muted">{ht(l, 'noHistory')}</p>}
            {data.history.length > limit && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => setLimit((n) => n + 10)}
              >
                {ht(l, 'more')}
              </button>
            )}
          </details>
        </>
      )}
    </section>
  );
}
