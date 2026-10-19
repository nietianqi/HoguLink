'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  History,
  MailPlus,
  Pencil,
  ShieldCheck,
  UsersRound,
  KeyRound,
} from 'lucide-react';
import {
  adminRoles,
  adminRolePermissions,
  ticketTeams,
  type Actor,
  type AdminMember,
  type AdminRole,
  type Locale,
  type TicketTeam,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime } from '@/lib/i18n';
import { ht } from '@/lib/handling-i18n';
import { et, memberError, type MemberKey } from '@/lib/member-i18n';
import { MobileSheet } from './mobile-ui';
type Directory = {
  members: AdminMember[];
  activity: {
    id: string;
    memberId: string;
    actorId: string;
    action: string;
    reason: string;
    at: number;
  }[];
};
type Invitation = { member: AdminMember; token: string; expiresAt: number };
export function AdminMembers({ locale: l, actor }: { locale: Locale; actor: Actor }) {
  const [data, setData] = useState<Directory>(),
    [view, setView] = useState('members'),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<AdminMember | null>(null),
    [mode, setMode] = useState<'create' | 'edit' | 'reissue' | null>(null),
    [invitation, setInvitation] = useState<Invitation | null>(null),
    [copied, setCopied] = useState(false);
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [role, setRole] = useState<AdminRole>('SUPPORT'),
    [teams, setTeams] = useState<TicketTeam[]>(['CUSTOMER_SUPPORT']),
    [enabled, setEnabled] = useState(true),
    [reason, setReason] = useState(''),
    [limit, setLimit] = useState(10);
  const refresh = useCallback(async () => setData(await api<Directory>('admin/members')), []);
  useEffect(() => {
    let cancelled = false;
    api<Directory>('admin/members')
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(memberError(l, e instanceof ClientError ? e.code : ''));
      });
    return () => {
      cancelled = true;
    };
  }, [l]);
  const rows = (data?.members ?? []).filter(
    (m) =>
      (status === 'all' || m.status === status) &&
      `${m.name} ${m.email}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  function chooseRole(value: AdminRole) {
    setRole(value);
    setTeams(
      value === 'OWNER'
        ? [...ticketTeams]
        : value === 'TRUST_SAFETY'
          ? ['TRUST_SAFETY']
          : value === 'FINANCE' || value === 'AUDITOR'
            ? []
            : ['CUSTOMER_SUPPORT'],
    );
  }
  function open(value: typeof mode, member?: AdminMember) {
    setEditing(member ?? null);
    setMode(value);
    setName(member?.name ?? '');
    setEmail(member?.email ?? '');
    setRole(member?.adminRole ?? 'SUPPORT');
    setTeams(member?.teams ?? ['CUSTOMER_SUPPORT']);
    setEnabled(member?.status !== 'DISABLED');
    setReason('');
    setError('');
    setNotice('');
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'create') {
        setInvitation(
          await api<Invitation>('admin/members', { name, email, adminRole: role, teams }),
        );
        setCopied(false);
      } else if (mode === 'reissue' && editing) {
        setInvitation(
          await api<Invitation>(`admin/members/${editing.id}/invitation`, {
            version: editing.version,
            reason,
          }),
        );
        setCopied(false);
      } else if (editing) {
        await api(
          `admin/members/${editing.id}`,
          { version: editing.version, name, adminRole: role, teams, enabled, reason },
          'PUT',
        );
        setNotice(et(l, 'saved'));
      }
      setMode(null);
      await refresh();
    } catch (e) {
      const code = e instanceof ClientError ? e.code : '';
      setError(memberError(l, code));
      if (code === 'VERSION_CONFLICT') {
        setMode(null);
        await refresh().catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }
  const link = invitation
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/${l}/admin/activate#token=${invitation.token}`
    : '';
  const teamOptions =
    role === 'SUPPORT'
      ? ticketTeams.filter((t) => t !== 'TRUST_SAFETY')
      : role === 'TRUST_SAFETY'
        ? ticketTeams.filter((t) => t === 'TRUST_SAFETY')
        : ticketTeams;
  return (
    <div className="admin-members">
      {error && !mode && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="member-stats">
        {(
          [
            {
              label: 'activeCount',
              count: data?.members.filter((m) => m.status === 'ACTIVE').length ?? 0,
              Icon: UsersRound,
            },
            {
              label: 'pendingCount',
              count: data?.members.filter((m) => m.status === 'INVITED').length ?? 0,
              Icon: MailPlus,
            },
            { label: 'groupCount', count: ticketTeams.length, Icon: ShieldCheck },
          ] as const
        ).map((x) => (
          <div key={x.label}>
            <x.Icon size={21} />
            <span>{et(l, x.label)}</span>
            <strong>{x.count}</strong>
          </div>
        ))}
      </div>
      <div className="member-view-tabs" role="navigation" aria-label={et(l, 'title')}>
        {(['members', 'roles', 'history'] as const).map((k) => (
          <button
            type="button"
            key={k}
            aria-pressed={view === k}
            onClick={() => {
              setView(k);
              setLimit(10);
            }}
          >
            {et(l, k)}
          </button>
        ))}
      </div>
      {view === 'members' && (
        <>
          <div className="admin-toolbar">
            <input
              type="search"
              aria-label={et(l, 'search')}
              placeholder={et(l, 'search')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(10);
              }}
            />
            <select
              aria-label={et(l, 'status')}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setLimit(10);
              }}
            >
              <option value="all">{et(l, 'all')}</option>
              {(['ACTIVE', 'INVITED', 'DISABLED'] as const).map((k) => (
                <option key={k} value={k}>
                  {et(l, k)}
                </option>
              ))}
            </select>
            <button className="button" disabled={busy} onClick={() => open('create')}>
              <MailPlus size={17} />
              {et(l, 'invite')}
            </button>
          </div>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <h2>{et(l, 'members')}</h2>
              <span>{rows.length}</span>
            </div>
            <div className="member-list">
              {rows.slice(0, limit).map((m) => (
                <article className="member-row" key={m.id}>
                  <span className="member-avatar">{m.name.slice(0, 1)}</span>
                  <div className="member-person">
                    <strong>{m.name}</strong>
                    <span>{m.email}</span>
                    <small>
                      {m.status === 'INVITED'
                        ? m.inviteExpiresAt
                          ? `${et(l, m.inviteExpiresAt < Date.now() ? 'expired' : 'expires')} · ${dateTime(l, m.inviteExpiresAt)}`
                          : et(l, 'freshInvite')
                        : m.bootstrap
                          ? et(l, 'protected')
                          : m.id === actor.id
                            ? et(l, 'owner')
                            : `${et(l, 'lastLogin')} · ${m.lastLoginAt ? dateTime(l, m.lastLoginAt) : et(l, 'never')}`}
                    </small>
                  </div>
                  <div className="member-role">
                    <strong>{et(l, m.adminRole)}</strong>
                    <span>{m.teams.map((t) => ht(l, t)).join(' · ') || et(l, 'readOnly')}</span>
                  </div>
                  <span
                    className={`admin-pill ${m.status === 'INVITED' ? 'warning' : m.status === 'DISABLED' ? 'neutral' : ''}`}
                  >
                    {et(l, m.status)}
                  </span>
                  {!m.bootstrap && m.id !== actor.id && (
                    <div className="member-actions">
                      <button
                        className="admin-icon"
                        aria-label={`${et(l, 'edit')} · ${m.name}`}
                        disabled={busy}
                        onClick={() => open('edit', m)}
                      >
                        <Pencil size={16} />
                      </button>
                      {m.status !== 'DISABLED' && (
                        <button
                          className="admin-icon"
                          aria-label={`${et(l, 'reissue')} · ${m.name}`}
                          disabled={busy}
                          onClick={() => open('reissue', m)}
                        >
                          <KeyRound size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
            {!rows.length && (
              <p className="admin-empty-copy">{data ? et(l, 'empty') : et(l, 'loading')}</p>
            )}
            {rows.length > limit && (
              <button className="button secondary full" onClick={() => setLimit((n) => n + 10)}>
                {et(l, 'more')} · {limit} / {rows.length}
              </button>
            )}
          </section>
          <p className="admin-footnote">{et(l, 'impact')}</p>
        </>
      )}
      {view === 'roles' && (
        <>
          <p className="member-role-help">{et(l, 'rolesHelp')}</p>
          <div className="member-role-grid">
            {adminRoles.map((r) => (
              <section className="admin-panel member-permission-card" key={r}>
                <ShieldCheck size={22} />
                <h2>{et(l, r)}</h2>
                <ul>
                  {adminRolePermissions[r].map((p) => (
                    <li key={p}>
                      <Check size={14} />
                      {et(l, p)}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
      {view === 'history' && (
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <h2>{et(l, 'history')}</h2>
            <History size={18} />
          </div>
          {data?.activity.slice(0, limit).map((a) => (
            <article className="member-history-item" key={a.id}>
              <div>
                <strong>
                  {data.members.find((m) => m.id === a.memberId)?.name ?? a.memberId.slice(-8)}
                </strong>
                <time>{dateTime(l, a.at)}</time>
              </div>
              <span>
                {et(
                  l,
                  (a.action === 'INVITED'
                    ? 'INVITED_EVENT'
                    : a.action === 'DISABLED'
                      ? 'DISABLED_EVENT'
                      : a.action) as MemberKey,
                )}
              </span>
              {a.reason && <p>{a.reason}</p>}
            </article>
          ))}
          {!data?.activity.length && <p className="admin-empty-copy">{et(l, 'empty')}</p>}
          {(data?.activity.length ?? 0) > limit && (
            <button className="button secondary full" onClick={() => setLimit((n) => n + 10)}>
              {et(l, 'more')}
            </button>
          )}
        </section>
      )}
      <MobileSheet
        locale={l}
        open={!!mode}
        title={et(l, mode === 'create' ? 'invite' : mode === 'reissue' ? 'reissue' : 'edit')}
        onClose={() => {
          if (!busy) setMode(null);
        }}
        className="merchant-dialog member-dialog"
      >
        <form onSubmit={submit}>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <fieldset disabled={busy} className="member-form">
            {mode === 'reissue' ? (
              <>
                <p>
                  {editing?.name} · {editing?.email}
                </p>
                <p className="member-role-help">{et(l, 'reissueHelp')}</p>
              </>
            ) : (
              <>
                <label className="field">
                  {et(l, 'name')}
                  <input
                    aria-label={et(l, 'name')}
                    required
                    minLength={2}
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="field">
                  {et(l, 'email')}
                  <input
                    aria-label={et(l, 'email')}
                    type="email"
                    required
                    maxLength={254}
                    value={email}
                    readOnly={mode === 'edit'}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="field">
                  {et(l, 'role')}
                  <select
                    aria-label={et(l, 'role')}
                    value={role}
                    onChange={(e) => chooseRole(e.target.value as AdminRole)}
                  >
                    {adminRoles.map((k) => (
                      <option key={k} value={k}>
                        {et(l, k)}
                      </option>
                    ))}
                  </select>
                </label>
                {adminRolePermissions[role].includes('cases.write') && (
                  <div className="member-team-picker">
                    <span>{et(l, 'teams')}</span>
                    {teamOptions.map((team) => (
                      <label className="checkbox" key={team}>
                        <input
                          type="checkbox"
                          disabled={role === 'OWNER'}
                          checked={teams.includes(team)}
                          onChange={(e) =>
                            setTeams((previous) =>
                              e.target.checked
                                ? [...previous, team]
                                : previous.filter((t) => t !== team),
                            )
                          }
                        />
                        {ht(l, team)}
                      </label>
                    ))}
                  </div>
                )}
                {mode === 'edit' && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                    />
                    {et(l, 'enabled')}
                  </label>
                )}
              </>
            )}
            {mode !== 'create' && (
              <label className="field">
                {et(l, 'reason')}
                <textarea
                  aria-label={et(l, 'reason')}
                  required
                  minLength={10}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            )}
            <p className="member-role-help">{et(l, mode === 'create' ? 'inviteHelp' : 'impact')}</p>
            <div className="member-dialog-actions">
              <button type="button" className="button secondary" onClick={() => setMode(null)}>
                {et(l, 'cancel')}
              </button>
              <button
                className="button"
                disabled={busy || (mode !== 'create' && reason.trim().length < 10)}
              >
                {et(l, mode === 'create' ? 'invite' : mode === 'reissue' ? 'reissue' : 'save')}
              </button>
            </div>
          </fieldset>
        </form>
      </MobileSheet>
      <MobileSheet
        locale={l}
        open={!!invitation}
        title={et(l, 'inviteReady')}
        onClose={() => setInvitation(null)}
        className="merchant-dialog member-dialog"
      >
        <div className="member-invitation">
          <MailPlus size={30} />
          <strong>{invitation?.member.name}</strong>
          <p>{et(l, 'inviteHelp')}</p>
          <label className="field">
            {et(l, 'copy')}
            <input
              aria-label={et(l, 'copy')}
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <small>
            {et(l, 'expires')} · {invitation && dateTime(l, invitation.expiresAt)} JST
          </small>
          <button
            className="button full"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {et(l, copied ? 'copied' : 'copy')}
          </button>
          <button className="button secondary full" onClick={() => setInvitation(null)}>
            {et(l, 'close')}
          </button>
        </div>
      </MobileSheet>
    </div>
  );
}
