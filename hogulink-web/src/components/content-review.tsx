'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Locale } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime } from '@/lib/i18n';
import { rt } from '@/lib/runtime-i18n';
type Row = { id: string; bookingId: string; status: string; createdAt: number };
type Detail = Row & { text: string; note?: string; decision?: string };
export function ContentReview({ locale: l }: { locale: Locale }) {
  const [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState<Detail>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function load() {
    try {
      setRows(await api<Row[]>('admin/content-reviews'));
    } catch (e) {
      setError(rt(l, e instanceof ClientError && e.code === 'FORBIDDEN' ? 'permission' : 'error'));
    }
  }
  useEffect(() => {
    void load();
  }, [l]);
  async function view(id: string) {
    setError('');
    setSelected(undefined);
    setBusy(true);
    try {
      setSelected(await api<Detail>(`admin/content-reviews/${id}`));
    } catch {
      setError(rt(l, 'error'));
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await api(`admin/content-reviews/${selected.id}`, {
        decision: data.get('decision'),
        note: data.get('note'),
      });
      await load();
      setSelected(undefined);
    } catch {
      setError(rt(l, 'error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="workspace-shell">
      <div className="quality-content">
        <section className="quality-card runtime-panel">
          <h1>{rt(l, 'review')}</h1>
          <p>{rt(l, 'reviewHelp')}</p>
          <div className="customer-auth-links">
            <Link href={`/${l}/admin`}>{rt(l, 'back')}</Link>
            <Link href={`/${l}/admin/login`}>{rt(l, 'login')}</Link>
          </div>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="runtime-jobs">
            {rows.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{rt(l, row.status === 'PENDING' ? 'PENDING_REVIEW' : 'REVIEWED')}</strong>
                  <small>{dateTime(l, row.createdAt)}</small>
                </div>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => void view(row.id)}
                >
                  {rt(l, 'view')}
                </button>
              </article>
            ))}
          </div>
          {!rows.length && !error && <p>{rt(l, 'empty')}</p>}
          {selected && (
            <section className="runtime-review-detail">
              <p className="runtime-message">{selected.text}</p>
              {selected.status === 'PENDING' ? (
                <form className="customer-auth-fields" onSubmit={submit}>
                  <label htmlFor="review-decision">
                    {rt(l, 'status')}
                    <select id="review-decision" name="decision">
                      <option value="POLICY_CONFIRMED">{rt(l, 'POLICY_CONFIRMED')}</option>
                      <option value="FALSE_POSITIVE">{rt(l, 'FALSE_POSITIVE')}</option>
                    </select>
                  </label>
                  <label htmlFor="review-note">
                    {rt(l, 'note')}
                    <textarea
                      id="review-note"
                      name="note"
                      required
                      minLength={10}
                      maxLength={500}
                    />
                  </label>
                  <button className="button" disabled={busy}>
                    {rt(l, 'save')}
                  </button>
                </form>
              ) : (
                <>
                  <p>{rt(l, selected.decision || 'REVIEWED')}</p>
                  <p>{selected.note}</p>
                </>
              )}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
