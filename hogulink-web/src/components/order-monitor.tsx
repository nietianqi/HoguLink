'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowUpRight, BellRing, RefreshCw } from 'lucide-react';
import {
  canAdmin,
  type Actor,
  type Locale,
  type OrderAlert,
  type OrderMonitor as Monitor,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, errorText } from '@/lib/i18n';
import { gt, isGovernanceKey } from '@/lib/governance-i18n';
import { MobileSheet } from './mobile-ui';
export function governanceError(l: Locale, e: unknown) {
  const code = e instanceof ClientError ? e.code : '';
  return isGovernanceKey(code) ? gt(l, code) : errorText(l, code);
}
export function OrderMonitor({
  locale: l,
  actor,
  storeName,
}: {
  locale: Locale;
  actor: Actor;
  storeName: (id: string) => string;
}) {
  const [data, setData] = useState<Monitor>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState('active'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<OrderAlert | null>(null),
    [note, setNote] = useState(''),
    [minutes, setMinutes] = useState(30);
  const gen = useRef(0),
    lock = useRef(false);
  const load = useCallback(async () => {
    const n = ++gen.current;
    try {
      const r = await api<Monitor>('admin/order-monitor');
      if (n === gen.current) {
        setData(r);
        setError('');
      }
    } catch (e) {
      if (n === gen.current) {
        setData(undefined);
        setError(governanceError(l, e));
      }
    }
  }, [l, actor.id, actor.adminSessionVersion]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !lock.current) void load();
    }, 15000);
    const focus = () => {
      if (!lock.current) void load();
    };
    window.addEventListener('focus', focus);
    return () => {
      gen.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [load]);
  const alerts = data?.alerts ?? [],
    now = data?.now ?? Date.now(),
    active = alerts.filter((a) => a.state !== 'RESOLVED');
  const counts = {
    active: active.length,
    high: active.filter((a) => a.severity === 'HIGH').length,
    mine: active.filter((a) => a.ownerId === actor.id).length,
    overdue: active.filter((a) => a.followUpAt && a.followUpAt <= now).length,
  };
  const matching = alerts.filter(
    (a) =>
      (filter === 'resolved'
        ? a.state === 'RESOLVED'
        : a.state !== 'RESOLVED' &&
          (filter === 'high'
            ? a.severity === 'HIGH'
            : filter === 'mine'
              ? a.ownerId === actor.id
              : filter === 'overdue'
                ? !!a.followUpAt && a.followUpAt <= now
                : true)) &&
      `${a.bookingId ?? ''} ${a.storeId ? storeName(a.storeId) : ''} ${gt(l, a.kind)}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(matching.length / 6)),
    currentPage = Math.min(page, pages);
  async function save(action: 'WATCH' | 'RELEASE') {
    if (!selected || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api(`admin/order-alerts/${selected.id}/follow-up`, {
        version: selected.version,
        action,
        followUpAt: Date.now() + minutes * 60000,
        note,
      });
      setSelected(null);
      setNote('');
      await load();
    } catch (e) {
      setError(governanceError(l, e));
      setSelected(null);
      await load();
      setError(governanceError(l, e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="order-monitor admin-panel" aria-label={gt(l, 'monitor')}>
      <div className="governance-heading">
        <div>
          <span className="eyebrow">OPERATIONS / LIVE</span>
          <h2>
            <Activity size={21} />
            {gt(l, 'monitor')}
          </h2>
        </div>
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() => void load()}
          aria-label={gt(l, 'refresh')}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <p className="governance-muted">{gt(l, 'monitorHelp')}</p>
      <div className="monitor-metrics">
        {(['active', 'high', 'mine', 'overdue'] as const).map((k) => (
          <button
            key={k}
            className={filter === k ? 'selected' : ''}
            onClick={() => {
              setFilter(k);
              setPage(1);
            }}
          >
            <span>{gt(l, k)}</span>
            <strong>{data ? counts[k] : '—'}</strong>
          </button>
        ))}
      </div>
      <div className="monitor-toolbar">
        <label className="sr-only" htmlFor="monitor-search">
          {gt(l, 'search')}
        </label>
        <input
          id="monitor-search"
          placeholder={gt(l, 'search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={filter}
          aria-label={gt(l, 'monitor')}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          {(['active', 'high', 'mine', 'overdue', 'resolved'] as const).map((k) => (
            <option key={k} value={k}>
              {gt(l, k)}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="quality-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">{gt(l, 'loading')}</p>}
      {data && matching.length === 0 && (
        <div className="monitor-empty">
          <BellRing size={25} />
          <p>{gt(l, 'empty')}</p>
        </div>
      )}
      <div className="monitor-queue">
        {matching.slice((currentPage - 1) * 6, currentPage * 6).map((a) => (
          <article key={a.id} className={`monitor-alert ${a.severity === 'HIGH' ? 'high' : ''}`}>
            <div className="monitor-alert-main">
              <div className="governance-heading">
                <h3>{gt(l, a.kind)}</h3>
                <span className="admin-pill">{gt(l, a.state)}</span>
              </div>
              <p>
                {a.severity === 'HIGH' && (
                  <span className="monitor-severity">{gt(l, 'high')} · </span>
                )}
                {a.storeId ? storeName(a.storeId) : 'HoguLink'}
                {a.bookingId && <> · #{a.bookingId.slice(-8).toUpperCase()}</>}
              </p>
              <small>
                {gt(l, 'source')} · {dateTime(l, a.dueAt)}
              </small>
              {a.followUpAt && a.state !== 'RESOLVED' && (
                <p className={a.followUpAt <= now ? 'monitor-late' : 'governance-muted'}>
                  {gt(l, 'followUp')} · {dateTime(l, a.followUpAt)}
                </p>
              )}
              {a.ownerId && a.state !== 'RESOLVED' && (
                <p>{gt(l, a.ownerId === actor.id ? 'mine' : 'colleague')}</p>
              )}
              {a.note && (
                <details>
                  <summary>{gt(l, 'note')}</summary>
                  <p className="governance-pre">{a.note}</p>
                </details>
              )}
            </div>
            <div className="monitor-actions">
              {a.bookingId && (
                <Link
                  href={`/${l}/admin?tab=orders&booking=${encodeURIComponent(a.bookingId)}#admin-order-detail`}
                  className="governance-link"
                >
                  {gt(l, 'order')}
                  <ArrowUpRight size={14} />
                </Link>
              )}
              {a.ticketId && (
                <Link
                  href={`/${l}/admin/support?case=${encodeURIComponent(a.ticketId)}`}
                  className="governance-link"
                >
                  {gt(l, 'case')}
                  <ArrowUpRight size={14} />
                </Link>
              )}
              {a.kind === 'SAFETY_OPEN' && canAdmin(actor, 'safety.write') && (
                <Link
                  className="governance-link"
                  href={`/${l}/admin?tab=safety&booking=${encodeURIComponent(a.bookingId ?? '')}`}
                >
                  {gt(l, 'SAFETY_OPEN')}
                </Link>
              )}
              {a.state !== 'RESOLVED' && canAdmin(actor, 'cases.write') && (
                <button
                  className="button secondary small"
                  disabled={
                    !!a.ownerId && a.ownerId !== actor.id && !canAdmin(actor, 'cases.assign')
                  }
                  title={
                    a.ownerId && a.ownerId !== actor.id && !canAdmin(actor, 'cases.assign')
                      ? gt(l, 'colleague')
                      : undefined
                  }
                  onClick={() => {
                    setSelected(a);
                    setNote('');
                    setMinutes(30);
                  }}
                >
                  {gt(l, 'watch')}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {matching.length > 6 && (
        <div className="monitor-pagination">
          <button
            className="button secondary small"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            {gt(l, 'previous')}
          </button>
          <span>
            {currentPage} / {pages}
          </span>
          <button
            className="button secondary small"
            disabled={currentPage === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            {gt(l, 'next')}
          </button>
        </div>
      )}
      {data && <p className="governance-stamp">{dateTime(l, data.now)} JST · 15s</p>}
      <MobileSheet
        open={!!selected}
        onClose={() => {
          if (!busy) setSelected(null);
        }}
        title={gt(l, 'watch')}
        locale={l}
      >
        <form
          className="governance-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save('WATCH');
          }}
        >
          <p>{selected && gt(l, selected.kind)}</p>
          <p className="governance-muted">{gt(l, 'internal')}</p>
          <fieldset disabled={busy}>
            <label>
              {gt(l, 'followUp')}
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[15, 30, 60, 120, 240, 1440].map((n) => (
                  <option key={n} value={n}>
                    {n} {gt(l, 'minutes')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {gt(l, 'note')}
              <textarea
                required
                minLength={10}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="flow-actions">
              {selected?.ownerId && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={note.trim().length < 10}
                  onClick={() => void save('RELEASE')}
                >
                  {gt(l, 'release')}
                </button>
              )}
              <button className="button" disabled={note.trim().length < 10}>
                {gt(l, 'save')}
              </button>
            </div>
          </fieldset>
        </form>
      </MobileSheet>
    </section>
  );
}
