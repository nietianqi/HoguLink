'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, LockKeyhole } from 'lucide-react';
import {
  ticketTeams,
  type AdminAssignee,
  type Locale,
  type TicketHandling,
} from '@hogulink/contracts';
import { activeCase, filterCaseWork, type AdminCase } from '@/lib/admin-model';
import { dateTime } from '@/lib/i18n';
import { at } from '@/lib/admin-i18n';
import { caseStatus, categoryLabel } from '@/lib/care-i18n';
import { ht } from '@/lib/handling-i18n';

export function AdminCaseQueue({
  locale: l,
  cases,
  handling,
  actorId,
  shopName,
  assignees,
}: {
  locale: Locale;
  cases: AdminCase[];
  handling: TicketHandling[];
  actorId: string;
  shopName: (id: string) => string;
  assignees: AdminAssignee[];
}) {
  const [team, setTeam] = useState(''),
    [filter, setFilter] = useState('all'),
    [limit, setLimit] = useState(10);
  const work = new Map(handling.map((h) => [h.id, h])),
    now = Date.now();
  const rows = filterCaseWork(cases, handling, { team, filter, actorId, now });
  return (
    <section className="admin-panel admin-case-queue" aria-label={ht(l, 'queue')}>
      <div className="admin-panel-heading">
        <h2>{ht(l, 'queue')}</h2>
        <span>
          {rows.length} / {cases.length}
        </span>
      </div>
      <div className="handling-queue-filters">
        <select
          aria-label={ht(l, 'team')}
          value={team}
          onChange={(e) => {
            setTeam(e.target.value);
            setLimit(10);
          }}
        >
          <option value="">{ht(l, 'allTeams')}</option>
          {ticketTeams.map((k) => (
            <option key={k} value={k}>
              {ht(l, k)}
            </option>
          ))}
        </select>
      </div>
      <div className="handling-queue-counts">
        {(['all', 'unassigned', 'mine', 'followUpDue', 'due'] as const).map((k) => (
          <button
            type="button"
            key={k}
            aria-pressed={filter === k}
            className={filter === k ? 'selected' : ''}
            onClick={() => {
              setFilter(k);
              setLimit(10);
            }}
          >
            <span>{ht(l, k)}</span>
            <strong>
              {filterCaseWork(cases, handling, { team, filter: k, actorId, now }).length}
            </strong>
          </button>
        ))}
      </div>
      {rows.slice(0, limit).map((c) => {
        const h = work.get(c.id);
        return (
          <Link
            className="admin-case-item"
            href={`/${l}/admin/support?case=${encodeURIComponent(c.id)}`}
            key={c.id}
          >
            <div>
              <span className={`admin-pill ${c.priority === 'HIGH' ? 'warning' : ''}`}>
                {categoryLabel(l, c.category)}
              </span>
              <span className="admin-case-visibility">
                <LockKeyhole size={12} />
                {at(l, c.visibility === 'PLATFORM_ONLY' ? 'private' : 'shopShared')}
              </span>
            </div>
            <h3>{c.subject}</h3>
            <p>
              {caseStatus(l, c.status)} · {c.storeId ? shopName(c.storeId) : at(l, 'platform')}
            </p>
            {h && (
              <p className="handling-queue-state">
                {ht(l, h.team)} · {ht(l, h.state)} ·{' '}
                {assignees.find((m) => m.id === h.ownerId)?.name ??
                  ht(l, !h.ownerId ? 'unassigned' : h.ownerId === actorId ? 'mine' : 'assigned')}
              </p>
            )}
            <small className={activeCase(c) && c.dueAt <= now ? 'admin-overdue' : ''}>
              {at(l, 'due')} · {dateTime(l, c.dueAt)}
            </small>
            {h && activeCase(c) && (
              <small className={h.followUpAt <= now ? 'admin-overdue' : ''}>
                {ht(l, h.followUpAt <= now ? 'followUpDue' : 'target')} ·{' '}
                {dateTime(l, h.followUpAt)}
              </small>
            )}
            <span>
              {at(l, 'openCase')}
              <ArrowUpRight size={15} />
            </span>
          </Link>
        );
      })}
      {!rows.length && <p className="admin-empty-copy">{ht(l, 'empty')}</p>}
      {rows.length > limit && (
        <button
          className="button secondary full"
          type="button"
          onClick={() => setLimit((n) => n + 10)}
        >
          {ht(l, 'more')} · {Math.min(limit, rows.length)} / {rows.length}
        </button>
      )}
    </section>
  );
}
