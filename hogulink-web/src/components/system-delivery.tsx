'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { canAdmin, type Actor, type Locale } from '@hogulink/contracts';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/i18n';
import { rt } from '@/lib/runtime-i18n';
type Snapshot = {
  configured: boolean;
  counts: Record<string, number>;
  jobs: { id: string; type: string; status: string; createdAt: number }[];
};
export function SystemDelivery({ locale: l, actor }: { locale: Locale; actor: Actor }) {
  const [data, setData] = useState<Snapshot>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [all, setAll] = useState(false);
  // Deliveries that need action come first; the rest is history, shown on request.
  const problem = (status: string) => ['FAILED', 'BLOCKED', 'RETRY'].includes(status);
  const ordered = data
    ? [
        ...data.jobs.filter((j) => problem(j.status)),
        ...data.jobs.filter((j) => !problem(j.status)),
      ]
    : [];
  const shown = all ? ordered : ordered.slice(0, 10);
  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api<Snapshot>('admin/notifications'));
    } catch {
      setError(rt(l, 'error'));
    }
  }, [l]);
  useEffect(() => {
    void load();
  }, [load]);
  async function retry(id: string) {
    setBusy(true);
    try {
      await api(`admin/notifications/${id}/retry`, {});
      await load();
    } catch {
      setError(rt(l, 'error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-panel runtime-panel">
      <div className="admin-panel-heading">
        <h2>{rt(l, 'title')}</h2>
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={() => void load()}
        >
          {rt(l, 'refresh')}
        </button>
      </div>
      <p role="status">{data && rt(l, data.configured ? 'configured' : 'disabled')}</p>
      <p className="runtime-help">{rt(l, 'help')}</p>
      {data && (
        <div className="runtime-counts">
          {['PENDING', 'RETRY', 'SENT', 'FAILED', 'BLOCKED'].map((status) => (
            <span key={status}>
              {rt(l, status)} <strong>{data.counts[status] ?? 0}</strong>
            </span>
          ))}
        </div>
      )}
      <div className="runtime-jobs">
        {shown.map((job) => (
          <article key={job.id}>
            <div>
              <strong>
                {rt(
                  l,
                  job.type === 'CUSTOMER_VERIFY'
                    ? 'verify'
                    : job.type === 'CUSTOMER_RESET'
                      ? 'reset'
                      : 'update',
                )}
              </strong>
              <small>{dateTime(l, job.createdAt)}</small>
            </div>
            <span>{rt(l, job.status)}</span>
            {canAdmin(actor, 'members.manage') && data?.configured && problem(job.status) && (
              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                onClick={() => void retry(job.id)}
              >
                {rt(l, 'retry')}
              </button>
            )}
          </article>
        ))}
      </div>
      {ordered.length > 10 && (
        <button type="button" className="text-button" onClick={() => setAll((x) => !x)}>
          {all ? rt(l, 'showLess') : `${rt(l, 'showAll')} · ${ordered.length}`}
        </button>
      )}
      {data && !data.jobs.length && <p>{rt(l, 'empty')}</p>}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {canAdmin(actor, 'safety.write') && (
        <Link className="quality-link" href={`/${l}/admin/safety-review`}>
          {rt(l, 'review')}
        </Link>
      )}
    </section>
  );
}
