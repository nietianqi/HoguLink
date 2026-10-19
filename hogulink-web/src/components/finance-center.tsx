'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Download, RefreshCw, ReceiptText, Scale, FileCheck2 } from 'lucide-react';
import {
  canAdmin,
  type Actor,
  type FinanceRow,
  type FinanceWorkspace,
  type Locale,
  type SettlementBatch,
  type BillStatement,
  type ReportQuery,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, errorText, money } from '@/lib/i18n';
import { bt, isFinanceKey, type FinanceKey } from '@/lib/finance-i18n';
import { csvCell } from '@/lib/desktop-model';
import { MobileSheet } from './mobile-ui';
import { SubscriptionCenter } from './subscription-center';
import { InvoicingCenter } from './invoicing-center';
import { it } from '@/lib/invoicing-i18n';
import { ReportingCenter } from './reporting-center';
import { rt } from '@/lib/reporting-i18n';
import { pt, planLabel } from '@/lib/subscription-i18n';
const monthNow = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
const entryNet = (e: FinanceRow) => e.captured - e.refunded - e.platformFee;
export function FinanceCenter({
  locale: l,
  actor,
  initialStoreId = '',
  initialBookingId = '',
  initialMonth,
  initialSection,
  initialInvoiceSource = '',
}: {
  locale: Locale;
  actor: Actor;
  initialStoreId?: string;
  initialBookingId?: string;
  initialMonth?: string;
  initialSection?: string;
  initialInvoiceSource?: string;
}) {
  const admin = actor.role === 'ADMIN',
    writable = admin && canAdmin(actor, 'finance.write');
  const [data, setData] = useState<FinanceWorkspace>(),
    [storeId, setStoreId] = useState(initialStoreId),
    [month, setMonth] = useState(
      initialMonth && /^20\d{2}-(0[1-9]|1[0-2])$/.test(initialMonth) ? initialMonth : monthNow,
    ),
    [tab, setTab] = useState<
      'activity' | 'statements' | 'settlements' | 'plans' | 'invoices' | 'reports'
    >(
      initialSection === 'plans' || initialSection === 'invoices' || initialSection === 'reports'
        ? initialSection
        : 'activity',
    ),
    [reportQuery, setReportQuery] = useState<ReportQuery>(),
    [invoiceNumber, setInvoiceNumber] = useState(''),
    [invoiceSource, setInvoiceSource] = useState(initialInvoiceSource),
    [search, setSearch] = useState(initialBookingId),
    [filter, setFilter] = useState('all'),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [row, setRow] = useState<FinanceRow | null>(null),
    [editing, setEditing] = useState(false),
    [action, setAction] = useState<string | null>(null),
    [batchId, setBatchId] = useState(''),
    [note, setNote] = useState(''),
    [reference, setReference] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [values, setValues] = useState({
      captured: '0',
      refunded: '0',
      platformFee: '0',
      processorFee: '0',
      net: '0',
    });
  const gen = useRef(0),
    lock = useRef(false),
    retry = useRef({ body: '', key: '' }),
    snapshot = useRef<{
      token: string;
      storeId: string;
      month: string;
      version: number;
      batchId?: string;
    }>({ token: '', storeId: '', month: '', version: 0 });
  const fail = (e: unknown) => {
    const code = e instanceof ClientError ? e.code : '';
    return isFinanceKey(code) ? bt(l, code) : errorText(l, code);
  };
  const load = useCallback(async () => {
    const n = ++gen.current;
    try {
      const d = await api<FinanceWorkspace>(
        `${admin ? 'admin/finance' : 'merchant/billing'}?month=${month}${storeId ? '&storeId=' + encodeURIComponent(storeId) : ''}`,
      );
      if (n === gen.current) {
        setData(d);
        setError('');
      }
    } catch (e) {
      if (n === gen.current) {
        setData(undefined);
        setError(fail(e));
      }
    }
  }, [actor.id, actor.adminSessionVersion, admin, storeId, month, l]);
  useEffect(() => {
    setData(undefined);
    setRow(null);
    setAction(null);
    setNote('');
    setReference('');
    setPage(1);
    void load();
    const timer = window.setInterval(() => {
      if (!lock.current && document.visibilityState === 'visible') void load();
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
  const rows = (data?.rows ?? []).filter(
      (e) =>
        (!search || e.bookingId.toLowerCase().includes(search.trim().toLowerCase())) &&
        (filter === 'all' ||
          (filter === 'open' && !e.recordedBatchId) ||
          (filter === 'difference' && e.report?.status === 'DIFFERENCE') ||
          (filter === 'unmatched' && !e.report) ||
          (filter === 'held' && e.hold)),
    ),
    pages = Math.max(1, Math.ceil(rows.length / 8)),
    currentPage = Math.min(page, pages);
  const batches = data?.batches ?? [],
    batch =
      batches.find((b) => b.id === batchId) ??
      batches.find((b) => !['VOID', 'RECORDED'].includes(b.state)) ??
      batches[0];
  function begin(a: string) {
    if (!data) return;
    snapshot.current = {
      token: data.token,
      storeId: data.storeId,
      month: data.month,
      version: batch?.version ?? 0,
      batchId: batch?.id,
    };
    setAction(a);
    setNote('');
    setReference('');
    setConfirmed(false);
    setError('');
  }
  async function mutate(path: string, body: unknown, method = 'POST') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const json = JSON.stringify([path, body]);
    if (retry.current.body !== json) retry.current = { body: json, key: crypto.randomUUID() };
    try {
      await api(path, body, method, retry.current.key);
      setAction(null);
      setRow(null);
      setEditing(false);
      await load();
      setNotice(bt(l, 'saved'));
    } catch (e) {
      await load();
      setError(fail(e));
      setAction(null);
      setRow(null);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function csv(lines: string[][], file: string) {
    const blob = new Blob(['\ufeff' + lines.map((r) => r.map(csvCell).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8;',
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = file;
    a.click();
    URL.revokeObjectURL(url);
  }
  function exportLines(lines: FinanceWorkspace['rows'] | BillStatement['lines'], file: string) {
    csv(
      [
        [
          bt(l, 'time'),
          bt(l, 'order'),
          bt(l, 'activity'),
          bt(l, 'captured'),
          bt(l, 'refunded'),
          bt(l, 'platformFee'),
          bt(l, 'net'),
        ],
        ...lines.map((e) => [
          dateTime(l, e.at),
          e.bookingId,
          bt(l, e.kind),
          String(e.captured),
          String(e.refunded),
          String(e.platformFee),
          String(e.captured - e.refunded - e.platformFee),
        ]),
      ],
      file,
    );
  }
  function selectRow(e: FinanceRow) {
    setRow(e);
    setEditing(false);
    setError('');
    setNote('');
    setReference(e.report?.reference ?? 'demo_' + e.id.replaceAll('-', '_').slice(-35));
    setValues({
      captured: String(e.report?.captured ?? e.captured),
      refunded: String(e.report?.refunded ?? e.refunded),
      platformFee: String(e.report?.platformFee ?? e.platformFee),
      processorFee: String(e.report?.processorFee ?? 0),
      net: String(e.report?.net ?? entryNet(e)),
    });
  }
  const label = (a: string) =>
    bt(
      l,
      (a === 'VOID'
        ? 'VOID_ACTION'
        : a === 'PREPARE'
          ? 'prepare'
          : a === 'STATEMENT'
            ? 'generate'
            : a) as FinanceKey,
    );
  return (
    <section className="finance-center" aria-label={bt(l, 'title')}>
      <div className="finance-heading">
        <div>
          <span className="eyebrow">FINANCE / JPY</span>
          <h2>
            <ReceiptText size={22} />
            {bt(l, 'title')}
          </h2>
        </div>
        <button
          className="button secondary small"
          disabled={busy}
          aria-label={bt(l, 'refresh')}
          onClick={() => void load()}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="finance-muted">{bt(l, 'intro')}</p>
      <p className="finance-demo">{bt(l, 'demo')}</p>
      <div className="finance-controls">
        {admin && tab !== 'reports' && (
          <label>
            {bt(l, 'shop')}
            <select
              value={storeId || data?.storeId || ''}
              onChange={(e) => setStoreId(e.target.value)}
            >
              {data?.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name[l]}
                </option>
              ))}
            </select>
          </label>
        )}
        {!['plans', 'invoices', 'reports'].includes(tab) && (
          <label>
            {bt(l, 'month')}
            <input
              type="month"
              min="2000-01"
              max="2099-12"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
          </label>
        )}
      </div>
      {error && (
        <p className="quality-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!data && !error && <p role="status">{bt(l, 'loading')}</p>}
      {data && (
        <>
          {data.rows.some((row) => row.source === 'LEGACY') && (
            <p className="finance-demo">{bt(l, 'legacy')}</p>
          )}
          {!['plans', 'invoices', 'reports'].includes(tab) && (
            <>
              <div className="finance-metrics">
                {(['captured', 'refunded', 'platformFee', 'net'] as const).map((k) => (
                  <div key={k}>
                    <span>{bt(l, k)}</span>
                    <strong>{money(l, data.totals[k])}</strong>
                    <small>{data.month} · JPY</small>
                  </div>
                ))}
              </div>
              <p className="finance-muted">{bt(l, 'preFees')}</p>
              {data.billing && (
                <div
                  className={`finance-billing-link ${data.billing.newBookingsBlocked ? 'restricted' : ''}`}
                >
                  <div>
                    <strong>
                      {planLabel(l, data.billing.status)} ·{' '}
                      {pt(l, data.billing.newBookingsBlocked ? 'restricted' : 'permitted')}
                    </strong>
                    <p>
                      {pt(l, 'due')} {money(l, data.billing.openAnnualAmount)} ·{' '}
                      {pt(l, 'separated')}
                    </p>
                  </div>
                  <button className="button secondary small" onClick={() => setTab('plans')}>
                    {pt(l, 'title')}
                  </button>
                </div>
              )}
            </>
          )}
          <nav className="finance-tabs" aria-label={bt(l, 'title')}>
            {(
              ['activity', 'statements', 'settlements', 'plans', 'invoices', 'reports'] as const
            ).map((k) => (
              <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>
                {k === 'activity' ? <Scale size={16} /> : <FileCheck2 size={16} />}{' '}
                {k === 'plans'
                  ? pt(l, 'title')
                  : k === 'invoices'
                    ? it(l, 'title')
                    : k === 'reports'
                      ? rt(l, 'title')
                      : bt(l, k)}
              </button>
            ))}
          </nav>
          {tab === 'reports' && (
            <ReportingCenter
              key={`${actor.id}:${actor.adminSessionVersion}`}
              locale={l}
              actor={actor}
              initialQuery={reportQuery}
              initialStoreId={initialStoreId}
              onQueryChange={setReportQuery}
              onOpenFinance={(destination) => {
                setStoreId(destination.storeId);
                if (destination.month) setMonth(destination.month);
                setSearch(destination.bookingId ?? '');
                setFilter('all');
                if (destination.settlementId) setBatchId(destination.settlementId);
                setInvoiceNumber(destination.invoiceNumber ?? '');
                setTab(destination.section);
              }}
            />
          )}
          {tab === 'invoices' && (
            <InvoicingCenter
              key={`${actor.id}:${data.storeId}`}
              locale={l}
              actor={actor}
              storeId={data.storeId}
              initialSource={invoiceSource}
              initialNumber={invoiceNumber}
              onOpenFinance={(view, source) => {
                if (source?.month) setMonth(source.month);
                else if (source?.lines[0])
                  setMonth(new Date(source.lines[0].at + 9 * 3600000).toISOString().slice(0, 7));
                setSearch(source?.lines.find((line) => line.bookingId)?.bookingId ?? '');
                setFilter('all');
                setTab(view);
              }}
            />
          )}
          {tab === 'plans' && (
            <SubscriptionCenter
              key={`${actor.id}:${data.storeId}`}
              locale={l}
              actor={actor}
              storeId={data.storeId}
              onChanged={() => void load()}
              onSelectStore={setStoreId}
              onOpenInvoices={(sourceKey) => {
                setInvoiceSource(sourceKey);
                setTab('invoices');
              }}
            />
          )}
          {tab === 'activity' && (
            <div className="finance-panel">
              <div className="finance-toolbar">
                <input
                  aria-label={bt(l, 'search')}
                  placeholder={bt(l, 'search')}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
                <select
                  aria-label={bt(l, 'activity')}
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  {(['all', 'open', 'difference', 'unmatched', 'held'] as const).map((k) => (
                    <option key={k} value={k}>
                      {bt(l, k)}
                    </option>
                  ))}
                </select>
                <button
                  className="button secondary small"
                  onClick={() => exportLines(rows, `hogulink-${data.month}.csv`)}
                  disabled={!rows.length}
                >
                  <Download size={15} />
                  {bt(l, 'export')}
                </button>
              </div>
              <div className="finance-ledger">
                {rows.slice((currentPage - 1) * 8, currentPage * 8).map((e) => (
                  <article key={e.id}>
                    <div>
                      <span className="finance-reference">
                        #{e.bookingId.slice(-8).toUpperCase()} · {bt(l, e.kind)}
                      </span>
                      <small>
                        {dateTime(l, e.at)} JST{e.source === 'LEGACY' && ' · ' + bt(l, 'OPENING')}
                      </small>
                      <span
                        className={`finance-status ${e.report?.status === 'DIFFERENCE' ? 'warning' : ''}`}
                      >
                        {bt(
                          l,
                          e.recordedBatchId
                            ? 'recorded'
                            : e.report?.status === 'MATCHED'
                              ? 'matched'
                              : e.report
                                ? 'difference'
                                : 'unmatched',
                        )}
                        {e.hold ? ' · ' + bt(l, e.holdReason ?? 'AFTERCARE') : ''}
                      </span>
                    </div>
                    <dl>
                      {(['captured', 'refunded', 'platformFee'] as const).map((k) => (
                        <div key={k}>
                          <dt>{bt(l, k)}</dt>
                          <dd>{money(l, e[k])}</dd>
                        </div>
                      ))}
                    </dl>
                    <button className="button secondary small" onClick={() => selectRow(e)}>
                      {bt(l, 'details')}
                      <ArrowUpRight size={14} />
                    </button>
                  </article>
                ))}
              </div>
              {!rows.length && <p className="finance-empty">{bt(l, 'empty')}</p>}
              {rows.length > 8 && (
                <div className="finance-pager">
                  <button
                    className="button secondary small"
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    {bt(l, 'previous')}
                  </button>
                  {currentPage}/{pages}
                  <button
                    className="button secondary small"
                    disabled={currentPage === pages}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    {bt(l, 'next')}
                  </button>
                </div>
              )}
            </div>
          )}
          {tab === 'statements' && (
            <div className="finance-panel">
              <div className="finance-heading">
                <h3>{bt(l, 'statements')}</h3>
                {(!admin || writable) && (
                  <button
                    className="button secondary"
                    disabled={!data.rows.length || busy}
                    onClick={() => begin('STATEMENT')}
                  >
                    {bt(l, 'generate')}
                  </button>
                )}
              </div>
              <p className="finance-muted">{bt(l, 'billHelp')}</p>
              {data.statements[0] &&
                (data.statements[0].lines.length !== data.rows.length ||
                  data.rows.some(
                    (e) => !data.statements[0].lines.some((line) => line.id === e.id),
                  )) && <p className="notice">{bt(l, 'billChanged')}</p>}
              {!data.statements.length && <p className="finance-empty">{bt(l, 'noBills')}</p>}
              {data.statements.map((s) => (
                <article className="finance-statement" key={s.id}>
                  <div>
                    <strong>
                      {s.month} · {bt(l, 'revision')} {s.revision}
                    </strong>
                    <small>
                      {dateTime(l, s.at)} JST · {s.lines.length} {bt(l, 'count')}
                    </small>
                  </div>
                  <div>
                    <span>{bt(l, 'platformFee')}</span>
                    <strong>{money(l, s.platformFee)}</strong>
                  </div>
                  <button
                    className="button secondary small"
                    onClick={() =>
                      exportLines(s.lines, `hogulink-statement-${s.month}-v${s.revision}.csv`)
                    }
                  >
                    <Download size={15} />
                    {bt(l, 'download')}
                  </button>
                  <button
                    className="button secondary small"
                    onClick={() => {
                      setInvoiceSource(`MONTH:${s.month}`);
                      setTab('invoices');
                    }}
                  >
                    {it(l, 'apply')}
                  </button>
                </article>
              ))}
            </div>
          )}
          {tab === 'settlements' && (
            <div className="finance-panel">
              <div className="finance-heading">
                <h3>{bt(l, 'settlements')}</h3>
                {writable && (
                  <button
                    className="button"
                    disabled={!data.canPrepare || busy}
                    onClick={() => begin('PREPARE')}
                  >
                    {bt(l, 'prepare')}
                  </button>
                )}
              </div>
              <p className="finance-muted">{bt(l, 'prepareHelp')}</p>
              <div className="finance-reconciliation">
                <div>
                  <span>{bt(l, 'unmatched')}</span>
                  <strong>{data.totals.unmatched}</strong>
                </div>
                <div>
                  <span>{bt(l, 'held')}</span>
                  <strong>{data.totals.held}</strong>
                </div>
                <div>
                  <span>{bt(l, 'balance')}</span>
                  <strong>{money(l, data.totals.unsettled)}</strong>
                </div>
              </div>
              <p className="finance-muted">
                {data.totals.unsettled < 0 ? bt(l, 'carry') : bt(l, 'pendingHelp')}
              </p>
              {data.openRows.length > 0 && (
                <details className="finance-open-lines">
                  <summary>
                    {bt(l, 'open')} · {data.openRows.length}
                  </summary>
                  {data.openRows.map((e) => (
                    <div key={e.id}>
                      <button className="finance-text-button" onClick={() => selectRow(e)}>
                        #{e.bookingId.slice(-8).toUpperCase()} · {bt(l, e.kind)}
                      </button>
                      <span>{money(l, entryNet(e) - (e.report?.processorFee ?? 0))}</span>
                      <small>
                        {bt(
                          l,
                          e.hold
                            ? (e.holdReason ?? 'AFTERCARE')
                            : e.report?.status === 'MATCHED'
                              ? 'matched'
                              : e.report
                                ? 'difference'
                                : 'unmatched',
                        )}
                      </small>
                    </div>
                  ))}
                </details>
              )}
              {!batch ? (
                <p className="finance-empty">{bt(l, 'noBatch')}</p>
              ) : (
                <>
                  <label className="finance-batch-select">
                    {bt(l, 'chooseBatch')}
                    <select value={batch.id} onChange={(e) => setBatchId(e.target.value)}>
                      {batches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {dateTime(l, b.createdAt)} · {bt(l, b.state)} · {money(l, b.net)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="finance-batch">
                    <div className="finance-heading">
                      <strong>
                        #{batch.id.slice(-8).toUpperCase()} · v{batch.version}
                      </strong>
                      <span className="finance-status">{bt(l, batch.state)}</span>
                    </div>
                    <dl>
                      <div>
                        <dt>{bt(l, 'channelNet')}</dt>
                        <dd>{money(l, batch.net)}</dd>
                      </div>
                      <div>
                        <dt>{bt(l, 'processorFee')}</dt>
                        <dd>{money(l, batch.processorFee)}</dd>
                      </div>
                      <div>
                        <dt>{bt(l, 'count')}</dt>
                        <dd>{batch.entryIds.length}</dd>
                      </div>
                    </dl>
                    {batch.reference && (
                      <p>
                        {bt(l, 'reference')} · {batch.reference}
                      </p>
                    )}
                    <div className="finance-actions">
                      {!admin && ['DRAFT', 'SHOP_CONFIRMED'].includes(batch.state) && (
                        <>
                          {batch.state === 'DRAFT' && (
                            <button className="button" onClick={() => begin('CONFIRM')}>
                              {bt(l, 'CONFIRM')}
                            </button>
                          )}
                          <button className="button secondary" onClick={() => begin('DISPUTE')}>
                            {bt(l, 'DISPUTE')}
                          </button>
                        </>
                      )}
                      {writable &&
                        (['RECORD', 'FAIL', 'RESPOND', 'RETRY', 'VOID'] as const)
                          .filter((a) =>
                            a === 'VOID'
                              ? !['VOID', 'RECORDED'].includes(batch.state)
                              : a === 'RESPOND'
                                ? batch.state === 'DISPUTED'
                                : a === 'RETRY'
                                  ? batch.state === 'FAILED'
                                  : batch.state === 'SHOP_CONFIRMED',
                          )
                          .map((a) => (
                            <button
                              key={a}
                              className={`button ${a === 'RECORD' ? '' : 'secondary'}`}
                              onClick={() => begin(a)}
                            >
                              {label(a)}
                            </button>
                          ))}
                    </div>
                    <ol className="finance-notes">
                      {batch.notes.map((n, i) => (
                        <li key={i}>
                          <small>
                            {n.role === 'ADMIN'
                              ? 'HoguLink'
                              : data.stores.find((s) => s.id === data.storeId)?.name[l]}{' '}
                            · {dateTime(l, n.at)}
                          </small>
                          <p>{n.text}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                </>
              )}
              <p className="finance-muted">{bt(l, 'settlementHelp')}</p>
            </div>
          )}
          <MobileSheet
            open={!!row}
            onClose={() => {
              if (!busy) setRow(null);
            }}
            title={bt(l, editing ? 'report' : 'details')}
            locale={l}
            className="finance-sheet"
          >
            {row && (
              <div className="finance-modal">
                <p>
                  #{row.bookingId.slice(-8).toUpperCase()} · {bt(l, row.kind)}
                </p>
                <p className="finance-demo">{bt(l, 'demo')}</p>
                {row.source === 'LEGACY' && <p className="finance-muted">{bt(l, 'legacy')}</p>}
                <Link
                  className="finance-order-link"
                  href={`/${l}/${admin ? 'admin?tab=orders&booking=' : 'merchant?tab=bookings&booking='}${encodeURIComponent(row.bookingId)}`}
                >
                  {bt(l, 'order')}
                  <ArrowUpRight size={14} />
                </Link>
                <dl className="finance-compare">
                  {(['captured', 'refunded', 'platformFee'] as const).map((k) => (
                    <div key={k}>
                      <dt>{bt(l, k)}</dt>
                      <dd>
                        {money(l, row[k])}
                        <small>{bt(l, 'expected')}</small>
                      </dd>
                      <dd>
                        {row.report ? money(l, row.report[k]) : '—'}
                        <small>{bt(l, 'observed')}</small>
                      </dd>
                    </div>
                  ))}
                </dl>
                {writable && !row.recordedBatchId && !editing && (
                  <button className="button secondary" onClick={() => setEditing(true)}>
                    {bt(l, 'report')}
                  </button>
                )}
                {editing && (
                  <form
                    className="finance-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void mutate(`admin/finance/${data.storeId}/entries/${row.id}/report`, {
                        version: row.report?.version ?? 0,
                        reference,
                        ...Object.fromEntries(
                          Object.entries(values).map(([k, v]) => [k, Number(v)]),
                        ),
                        note,
                      });
                    }}
                  >
                    <fieldset disabled={busy}>
                      <label>
                        {bt(l, 'reference')}
                        <input
                          required
                          pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{5,99}"
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          maxLength={100}
                        />
                      </label>
                      <div className="finance-form-grid">
                        {(
                          ['captured', 'refunded', 'platformFee', 'processorFee', 'net'] as const
                        ).map((k) => (
                          <label key={k}>
                            {bt(l, k === 'net' ? 'channelNet' : k)}
                            <input
                              type="number"
                              inputMode={k === 'captured' || k === 'refunded' ? 'numeric' : 'text'}
                              required
                              min={k === 'captured' || k === 'refunded' ? 0 : -1000000000}
                              max={1000000000}
                              step={1}
                              value={values[k]}
                              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                            />
                          </label>
                        ))}
                      </div>
                      <label>
                        {bt(l, 'note')}
                        <textarea
                          required
                          minLength={10}
                          maxLength={1500}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                        />
                      </label>
                      <button className="button full" disabled={note.trim().length < 10}>
                        {bt(l, 'save')}
                      </button>
                    </fieldset>
                  </form>
                )}
                {row.history.length > 0 && (
                  <details className="finance-history">
                    <summary>
                      {bt(l, 'history')} · {row.history.length}
                    </summary>
                    {row.history.map((r) => (
                      <article key={r.version}>
                        <strong>
                          v{r.version} · {r.reference} ·{' '}
                          {bt(l, r.status === 'MATCHED' ? 'matched' : 'difference')}
                        </strong>
                        <p>
                          {bt(l, 'channelNet')} {money(l, r.net)} · {bt(l, 'processorFee')}{' '}
                          {money(l, r.processorFee)}
                        </p>
                        <p>{r.note}</p>
                        <small>{dateTime(l, r.at)}</small>
                      </article>
                    ))}
                  </details>
                )}
              </div>
            )}
          </MobileSheet>
          <MobileSheet
            open={!!action}
            onClose={() => {
              if (!busy) setAction(null);
            }}
            title={action ? label(action) : ''}
            locale={l}
          >
            <form
              className="finance-form finance-modal"
              onSubmit={(e) => {
                e.preventDefault();
                if (!confirmed) return;
                const s = snapshot.current;
                if (action === 'STATEMENT')
                  void mutate(
                    `${admin ? 'admin/finance' : 'merchant/billing'}/${s.storeId}/statements`,
                    { month: s.month, token: s.token },
                  );
                else if (action === 'PREPARE')
                  void mutate(`admin/finance/${s.storeId}/settlements`, { token: s.token, note });
                else
                  void mutate(`finance/settlements/${s.batchId}/actions`, {
                    version: s.version,
                    action,
                    note,
                    ...(action === 'RECORD' ? { reference } : {}),
                  });
              }}
            >
              <p>{bt(l, action === 'STATEMENT' ? 'billHelp' : 'settlementHelp')}</p>
              <fieldset disabled={busy}>
                {action !== 'STATEMENT' && (
                  <label>
                    {bt(l, 'note')}
                    <textarea
                      required
                      minLength={10}
                      maxLength={1500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                )}
                {action === 'RECORD' && (
                  <label>
                    {bt(l, 'reference')}
                    <input
                      required
                      pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{5,99}"
                      maxLength={100}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </label>
                )}
                <label className="finance-confirm">
                  <input
                    type="checkbox"
                    required
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span>{bt(l, 'confirm')}</span>
                </label>
                <button
                  className="button full"
                  disabled={!confirmed || (action !== 'STATEMENT' && note.trim().length < 10)}
                >
                  {action && label(action)}
                </button>
              </fieldset>
            </form>
          </MobileSheet>
        </>
      )}
    </section>
  );
}
