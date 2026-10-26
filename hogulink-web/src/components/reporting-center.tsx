'use client';
import { sv } from '@/lib/service-mode-i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BarChart3,
  Download,
  History,
  RefreshCw,
  ShieldCheck,
  FileSpreadsheet,
} from 'lucide-react';
import type {
  Actor,
  Locale,
  ReportWorkspace,
  ReportQuery,
  ReportMetrics,
  ReportExportType,
  ReportExport,
  ReportPoint,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { money, errorText, statusText } from '@/lib/i18n';
import { invoiceDate } from '@/lib/invoice-model';
import { rt, reportLabel, isReportKey, type ReportKey } from '@/lib/reporting-i18n';
import {
  reportCsv,
  reportDelta,
  metricValue,
  reportPreset,
  reportRate,
  japanDate,
} from '@/lib/reporting-model';
import { bt, isFinanceKey } from '@/lib/finance-i18n';
import { invoiceLabel } from '@/lib/invoicing-i18n';
import { planLabel } from '@/lib/subscription-i18n';
import { MobileSheet } from './mobile-ui';
export type ReportDestination = {
  section: 'activity' | 'settlements' | 'plans' | 'invoices';
  storeId: string;
  month?: string;
  bookingId?: string;
  settlementId?: string;
  invoiceNumber?: string;
};
type Card = {
  id: string;
  storeId: string;
  at: number;
  title: string;
  status: string;
  amount: number;
  amountLabel: string;
  invoiceNumbers?: string[];
  pairs: [string, string][];
  destination: ReportDestination;
  orderHref?: string;
};
type Sheet =
  | { kind: 'export'; snapshot: ReportWorkspace; type: ReportExportType }
  | { kind: 'history' }
  | { kind: 'definitions' }
  | { kind: 'source'; card: Card }
  | { kind: 'point'; point: ReportPoint; snapshot: ReportWorkspace };
export function ReportingCenter({
  locale: l,
  actor,
  initialQuery,
  initialStoreId = '',
  onQueryChange,
  onOpenFinance,
}: {
  locale: Locale;
  actor: Actor;
  initialQuery?: ReportQuery;
  initialStoreId?: string;
  onQueryChange: (q: ReportQuery) => void;
  onOpenFinance: (destination: ReportDestination) => void;
}) {
  const admin = actor.role === 'ADMIN';
  const [query, setQuery] = useState<ReportQuery>(
      () =>
        initialQuery ?? {
          ...reportPreset(0),
          ...(admin && initialStoreId ? { storeId: initialStoreId } : {}),
        },
    ),
    [draft, setDraft] = useState(() => ({
      from: initialQuery?.from ?? reportPreset(0).from,
      to: initialQuery?.to ?? reportPreset(0).to,
    })),
    [data, setData] = useState<ReportWorkspace>(),
    [view, setView] = useState<'overview' | 'operations' | 'details'>('overview'),
    [type, setType] = useState<ReportExportType>('money'),
    [metric, setMetric] = useState<'salesNet' | 'captured' | 'refunded' | 'platformFee'>(
      'salesNet',
    ),
    [page, setPage] = useState(1),
    [sheet, setSheet] = useState<Sheet | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const generation = useRef(0),
    lock = useRef(false),
    retry = useRef({ body: '', key: '' });
  const fail = (e: unknown) =>
    e instanceof ClientError && isReportKey(e.code)
      ? rt(l, e.code)
      : errorText(l, e instanceof ClientError ? e.code : undefined);
  const load = useCallback(async () => {
    const n = ++generation.current;
    try {
      const p = new URLSearchParams({ ...query });
      const w = await api<ReportWorkspace>(`${admin ? 'admin' : 'merchant'}/reports?${p}`);
      if (n === generation.current) {
        setData(w);
        setError('');
      }
    } catch (e) {
      if (n === generation.current) {
        setData(undefined);
        setError(fail(e));
      }
    }
  }, [query, admin, actor.id, actor.adminSessionVersion, l]);
  useEffect(() => {
    setData(undefined);
    setSheet(null);
    setPage(1);
    setError('');
    void load();
    const timer = window.setInterval(() => {
      if (!lock.current && document.visibilityState === 'visible') void load();
    }, 15000);
    const focus = () => {
      if (!lock.current) void load();
    };
    window.addEventListener('focus', focus);
    return () => {
      generation.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [load]);
  function change(next: ReportQuery) {
    setQuery(next);
    setDraft({ from: next.from, to: next.to });
    setPage(1);
    setNotice('');
    onQueryChange(next);
  }
  const label = (s: string) => {
    if (['MATCHED', 'DIFFERENCE', 'UNMATCHED'].includes(s))
      return rt(l, s.toLowerCase() as 'matched' | 'difference' | 'unmatched');
    if (isReportKey(s)) return rt(l, s);
    if (isFinanceKey(s)) return bt(l, s);
    const i = invoiceLabel(l, s);
    if (i !== s) return i;
    const p = planLabel(l, s);
    return p !== s ? p : statusText(l, s);
  };
  const shopName = (id: string, w = data) => w?.stores.find((s) => s.id === id)?.name[l] ?? id;
  function open(s: Sheet) {
    setSheet(s);
    setConfirmed(false);
    setError('');
    setNotice('');
  }
  function save(d: ReportExport) {
    const blob = new Blob([reportCsv(d, l)], { type: 'text/csv;charset=utf-8;' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `hogulink-${d.type}-${d.from}-${d.to}-${d.id.slice(-8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function exportNow() {
    if (sheet?.kind !== 'export' || !confirmed || lock.current) return;
    const body = { query: sheet.snapshot.query, token: sheet.snapshot.token, type: sheet.type },
      fingerprint = JSON.stringify(body),
      n = generation.current;
    if (retry.current.body !== fingerprint)
      retry.current = { body: fingerprint, key: crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const d = await api<ReportExport>(
        `${admin ? 'admin' : 'merchant'}/reports/export`,
        body,
        'POST',
        retry.current.key,
      );
      if (n !== generation.current) return;
      save(d);
      retry.current = { body: '', key: '' };
      setSheet(null);
      await load();
      setNotice(rt(l, 'exportReady'));
    } catch (e) {
      if (n === generation.current) {
        if (e instanceof ClientError && e.code === 'REPORT_CHANGED') {
          setSheet(null);
          await load();
        }
        setError(fail(e));
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function download(id: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const n = generation.current;
    try {
      const d = await api<ReportExport>(`${admin ? 'admin' : 'merchant'}/reports/exports/${id}`);
      if (n === generation.current) save(d);
    } catch (e) {
      if (n === generation.current) setError(fail(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const orderHref = (id: string) =>
    `/${l}/${admin ? 'admin?tab=orders' : 'merchant?tab=bookings'}&booking=${encodeURIComponent(id)}`;
  function cards(w: ReportWorkspace, t: ReportExportType): Card[] {
    if (t === 'money')
      return w.money.map((r) => ({
        id: r.id,
        storeId: r.storeId,
        at: r.at,
        title: '#' + r.bookingId.slice(-8).toUpperCase(),
        status: r.kind,
        amount: r.merchantNet,
        amountLabel: rt(l, 'merchantNet'),
        invoiceNumbers: r.invoiceNumbers,
        pairs: [
          [rt(l, 'captured'), money(l, r.captured)],
          [rt(l, 'refunded'), money(l, r.refunded)],
          [rt(l, 'platformFee'), money(l, r.platformFee)],
          [
            rt(l, 'processorFee'),
            r.processorFee === null ? rt(l, 'unverified') : money(l, r.processorFee),
          ],
          [
            rt(l, 'reconciliation'),
            label(r.reconciliation) + (r.held ? ' · ' + rt(l, 'held') : ''),
          ],
          [rt(l, 'invoiceNumbers'), r.invoiceNumbers.join(' · ') || '—'],
        ],
        destination: {
          section: 'activity',
          storeId: r.storeId,
          bookingId: r.bookingId,
          month: japanDate(r.at).slice(0, 7),
        },
        orderHref: orderHref(r.bookingId),
      }));
    if (t === 'orders')
      return w.orders.map((r) => ({
        id: r.id,
        storeId: r.storeId,
        at: r.createdAt,
        title: r.service[l],
        status: r.status,
        amount: r.captured - r.refunded,
        amountLabel: rt(l, 'lifetimeNet'),
        pairs: [
          [rt(l, 'bookingId'), '#' + r.id.slice(-8).toUpperCase()],
          [rt(l, 'mode'), label(r.mode)],
          [rt(l, 'startJst'), invoiceDate(l, r.startAt)],
          [rt(l, 'lifetimeCaptured'), money(l, r.captured)],
          [rt(l, 'lifetimeRefunded'), money(l, r.refunded)],
        ],
        destination: {
          section: 'activity',
          storeId: r.storeId,
          bookingId: r.id,
          month: japanDate(r.createdAt).slice(0, 7),
        },
        orderHref: orderHref(r.id),
      }));
    if (t === 'settlements')
      return w.settlements.map((r) => ({
        id: r.id,
        storeId: r.storeId,
        at: r.state === 'RECORDED' ? r.updatedAt : r.createdAt,
        title: '#' + r.id.slice(-10).toUpperCase(),
        status: r.state,
        amount: r.net,
        amountLabel: rt(l, 'net'),
        pairs: [
          [rt(l, 'entryCount'), String(r.entryCount)],
          [rt(l, 'processorFee'), money(l, r.processorFee)],
          [rt(l, 'createdJst'), invoiceDate(l, r.createdAt)],
          [rt(l, 'updatedJst'), invoiceDate(l, r.updatedAt)],
        ],
        destination: { section: 'settlements', storeId: r.storeId, settlementId: r.id },
      }));
    if (t === 'annual')
      return w.annual.map((r) => ({
        id: r.id,
        storeId: r.storeId,
        at: r.paidAt ?? r.createdAt,
        title: label(r.purpose),
        status: r.status,
        amount: r.amount,
        amountLabel: rt(l, r.status === 'PAID' ? 'annualPaid' : 'amount'),
        invoiceNumbers: r.invoiceNumbers,
        pairs: [
          [rt(l, 'annualId'), '#' + r.id.slice(-12).toUpperCase()],
          [rt(l, 'paidJst'), r.paidAt ? invoiceDate(l, r.paidAt) : '—'],
          [rt(l, 'dueJst'), invoiceDate(l, r.dueAt)],
          [rt(l, 'invoiceNumbers'), r.invoiceNumbers.join(' · ') || '—'],
        ],
        destination: { section: 'plans', storeId: r.storeId },
      }));
    return w.invoices.map((r) => ({
      id: r.id,
      storeId: r.storeId,
      at: r.issuedAt,
      title: r.number,
      status: r.kind,
      amount: r.signedAmount,
      amountLabel: rt(l, 'signedAmount'),
      pairs: [
        [rt(l, 'purpose'), label(r.purpose)],
        [rt(l, 'revision'), String(r.revision)],
        [rt(l, 'originalNumber'), r.originalNumber ?? '—'],
        [rt(l, 'sourceTiming'), rt(l, 'invoiceTiming')],
      ],
      destination: { section: 'invoices', storeId: r.storeId, invoiceNumber: r.number },
    }));
  }
  const records = data ? cards(data, type) : [],
    pages = Math.max(1, Math.ceil(records.length / 8)),
    currentPage = Math.min(page, pages);
  const timing =
    type === 'money'
      ? 'moneyTiming'
      : type === 'orders'
        ? 'cohortHelp'
        : type === 'settlements'
          ? 'settlementTiming'
          : type === 'annual'
            ? 'annualTiming'
            : 'invoiceTiming';
  const exportType: ReportExportType =
    view === 'overview' ? 'summary' : view === 'operations' ? 'orders' : type;
  const exportCount = (w: ReportWorkspace, t: ReportExportType) =>
    t === 'summary'
      ? Object.keys(w.current).length +
        Object.keys(w.balances).length +
        Object.keys(w.quality).length
      : t === 'trend'
        ? w.trend.length
        : w[t].length;
  const navigate = (d: ReportDestination) => {
    setSheet(null);
    onOpenFinance(d);
  };
  const pointItems =
    sheet?.kind === 'point'
      ? sheet.snapshot.money.filter((r) => japanDate(r.at).startsWith(sheet.point.period))
      : [];
  const sourceDetails = (c: Card) => (
    <>
      <span className="eyebrow">{c.title}</span>
      <div className="report-record-meta">
        {shopName(c.storeId)} · {invoiceDate(l, c.at)}
      </div>
      <span className="invoice-state">{label(c.status)}</span>
      <p className="report-modal-amount">
        <small>{c.amountLabel}</small>
        {money(l, c.amount)}
      </p>
      <dl className="report-definition-list">
        {c.pairs.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="report-modal-actions">
        {c.invoiceNumbers?.map((number) => (
          <button
            className="button secondary"
            key={number}
            onClick={() =>
              navigate({ section: 'invoices', storeId: c.storeId, invoiceNumber: number })
            }
          >
            {rt(l, 'openInvoice')} · {number}
            <ArrowUpRight size={15} />
          </button>
        ))}
        {c.orderHref && (
          <Link className="button secondary" href={c.orderHref}>
            {rt(l, 'openOrder')}
            <ArrowUpRight size={15} />
          </Link>
        )}
        <button className="button" onClick={() => navigate(c.destination)}>
          {rt(
            l,
            c.destination.section === 'activity'
              ? 'openLedger'
              : c.destination.section === 'settlements'
                ? 'openSettlement'
                : c.destination.section === 'plans'
                  ? 'openPlans'
                  : 'openInvoice',
          )}
          <ArrowUpRight size={15} />
        </button>
      </div>
    </>
  );
  const tiles = (keys: (keyof ReportMetrics)[]) => (
    <div className="finance-metrics report-metrics">
      {keys.map((k) => {
        const c = data!.current[k],
          p = data!.previous[k],
          delta = c === null || p === null ? null : reportDelta(c, p);
        return (
          <div key={k}>
            <span>{rt(l, k)}</span>
            <strong>{metricValue(l, k, c)}</strong>
            <small>
              {rt(l, 'previous')}: {metricValue(l, k, p)}
              {k !== 'completionBps' && (
                <em>
                  {delta === null
                    ? rt(l, 'noBaseline')
                    : delta === 0
                      ? rt(l, 'unchanged')
                      : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`}
                </em>
              )}
            </small>
          </div>
        );
      })}
    </div>
  );
  return (
    <section className="reporting-center" aria-label={rt(l, 'title')}>
      <div className="finance-heading">
        <div>
          <span className="eyebrow">REPORTS / BUSINESS INTELLIGENCE</span>
          <h3>
            <BarChart3 size={21} />
            {rt(l, 'title')}
          </h3>
        </div>
        <button
          className="button secondary small"
          aria-label={rt(l, 'refresh')}
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="finance-muted">{rt(l, 'intro')}</p>
      <p className="finance-demo">{rt(l, 'demo')}</p>
      <form
        className="report-controls"
        onSubmit={(e) => {
          e.preventDefault();
          change({ ...query, ...draft });
        }}
      >
        {admin && (
          <label>
            {rt(l, 'scope')}
            <select
              aria-label={rt(l, 'scope')}
              value={query.storeId ?? ''}
              onChange={(e) => {
                const { storeId: _id, ...rest } = query;
                change({ ...rest, ...(e.target.value ? { storeId: e.target.value } : {}) });
              }}
            >
              <option value="">{rt(l, 'allShops')}</option>
              {data?.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name[l]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {rt(l, 'from')}
          <input
            type="date"
            aria-label={rt(l, 'from')}
            min="2000-01-01"
            max={japanDate()}
            required
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label>
          {rt(l, 'to')}
          <input
            type="date"
            aria-label={rt(l, 'to')}
            min={draft.from}
            max={japanDate()}
            required
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <button className="button" disabled={busy}>
          {rt(l, 'apply')}
        </button>
      </form>
      <div className="report-presets">
        {(
          [
            ['today', 1],
            ['week', 7],
            ['thirty', 30],
            ['month', 0],
          ] as const
        ).map(([key, days]) => (
          <button
            key={key}
            className="button secondary small"
            onClick={() => change({ ...query, ...reportPreset(days) })}
          >
            {rt(l, key)}
          </button>
        ))}
        <button className="report-text-button" onClick={() => open({ kind: 'definitions' })}>
          {rt(l, 'definitions')}
        </button>
      </div>
      {error && !sheet && (
        <p className="quality-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!data && !error && <p role="status">{rt(l, 'loading')}</p>}
      {data && (
        <>
          <div className="report-period">
            <span>
              {data.query.from} — {data.query.to} · JST
            </span>
            <small>
              {rt(l, 'previousPeriod')}: {data.previousPeriod.from} — {data.previousPeriod.to}
            </small>
            <small>
              {rt(l, 'asOf')}: {invoiceDate(l, data.now)}
            </small>
          </div>
          <div className="report-viewbar">
            <nav className="invoice-tabs" aria-label={rt(l, 'title')}>
              {(['overview', 'operations', 'details'] as const).map((v) => (
                <button
                  key={v}
                  aria-pressed={view === v}
                  onClick={() => {
                    setView(v);
                    setPage(1);
                  }}
                >
                  {rt(l, v)}
                </button>
              ))}
            </nav>
            <div>
              <button className="button secondary small" onClick={() => open({ kind: 'history' })}>
                <History size={16} />
                {rt(l, 'history')}
              </button>
              {data.canExport && (
                <button
                  className="button small"
                  disabled={busy || !exportCount(data, exportType)}
                  onClick={() => open({ kind: 'export', snapshot: data, type: exportType })}
                >
                  <Download size={16} />
                  {rt(l, 'export')}
                </button>
              )}
            </div>
          </div>
          {!data.canExport && <p className="finance-muted">{rt(l, 'readOnly')}</p>}
          {view === 'overview' && (
            <>
              {tiles(['captured', 'refunded', 'salesNet', 'merchantNet'])}
              <div className="finance-panel report-chart-panel">
                <div className="finance-heading">
                  <h4>{rt(l, 'trend')}</h4>
                  <div className="report-chart-controls">
                    <select
                      aria-label={rt(l, 'metric')}
                      value={metric}
                      onChange={(e) => setMetric(e.target.value as typeof metric)}
                    >
                      {(['salesNet', 'captured', 'refunded', 'platformFee'] as const).map((k) => (
                        <option key={k} value={k}>
                          {rt(l, k)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={rt(l, 'groupBy')}
                      value={query.groupBy}
                      onChange={(e) =>
                        change({ ...query, groupBy: e.target.value as 'day' | 'month' })
                      }
                    >
                      <option value="day">{rt(l, 'day')}</option>
                      <option value="month">{rt(l, 'monthly')}</option>
                    </select>
                  </div>
                </div>
                <ReportChart
                  locale={l}
                  points={data.trend}
                  metric={metric}
                  onPoint={(point) => open({ kind: 'point', point, snapshot: data })}
                />
                <p className="finance-muted">{rt(l, 'moneyTiming')}</p>
                {data.canExport && (
                  <button
                    className="report-text-button"
                    onClick={() => open({ kind: 'export', snapshot: data, type: 'trend' })}
                  >
                    {rt(l, 'export')} · {rt(l, 'trend')}
                  </button>
                )}
              </div>
              <div className="report-two-columns">
                <div className="finance-panel">
                  <h4>{rt(l, 'bridge')}</h4>
                  <p className="finance-muted">{rt(l, 'bridgeHelp')}</p>
                  <dl className="report-financial-lines">
                    {(
                      [
                        'platformFee',
                        'knownProcessorFee',
                        'merchantNetAfterFees',
                        'annualPaid',
                        'settlementRecorded',
                        'invoiceNet',
                      ] as const
                    ).map((k) => (
                      <div key={k}>
                        <dt>{rt(l, k)}</dt>
                        <dd>{metricValue(l, k, data.current[k])}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="finance-panel">
                  <h4>
                    <ShieldCheck size={18} />
                    {rt(l, 'quality')}
                  </h4>
                  <div className="report-quality">
                    {(['rows', 'matched', 'difference', 'unmatched', 'held'] as const).map((k) => (
                      <div key={k}>
                        <span>{rt(l, k)}</span>
                        <strong>{data.quality[k]}</strong>
                      </div>
                    ))}
                  </div>
                  <p className="finance-muted">{rt(l, 'qualityHelp')}</p>
                </div>
              </div>
              <div className="finance-panel">
                <h4>{rt(l, 'balances')}</h4>
                <dl className="report-balances">
                  {Object.entries(data.balances).map(([key, value]) => (
                    <div key={key}>
                      <dt>{reportLabel(l, key)}</dt>
                      <dd>
                        {['heldRows', 'unmatchedRows', 'legacyRows'].includes(key)
                          ? value
                          : money(l, value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </>
          )}
          {view === 'operations' && (
            <>
              {tiles(['orders', 'completed', 'pending', 'completionBps'])}
              <p className="report-method">{rt(l, 'cohortHelp')}</p>
              <div className="report-two-columns">
                {(['services', 'modes', 'fulfillmentModes'] as const).map((group) => (
                  <div className="finance-panel" key={group}>
                    <h4>
                      {group === 'fulfillmentModes'
                        ? sv(l, 'mode')
                        : rt(l, group === 'services' ? 'byService' : 'byMode')}
                    </h4>
                    {!(data[group] ?? []).length && (
                      <p className="finance-muted">{rt(l, 'noData')}</p>
                    )}
                    {(data[group] ?? []).map((g) => (
                      <article className="report-rank" key={g.id}>
                        <strong>{g.label[l]}</strong>
                        <div>
                          <span>
                            {rt(l, 'orders')}: {g.orders}
                          </span>
                          <span>
                            {rt(l, 'completed')}: {g.completed}
                          </span>
                          <span>
                            {rt(l, 'completionBps')}: {reportRate(g.completionBps)}
                          </span>
                        </div>
                        <progress
                          aria-label={`${g.label[l]} · ${rt(l, 'orders')}`}
                          max={Math.max(1, data.current.orders)}
                          value={g.orders}
                        />
                      </article>
                    ))}
                  </div>
                ))}
              </div>
              {admin && (
                <div className="finance-panel">
                  <div className="finance-heading">
                    <h4>{rt(l, 'shops')}</h4>
                    {data.canExport && (
                      <button
                        className="button secondary small"
                        onClick={() => open({ kind: 'export', snapshot: data, type: 'shops' })}
                      >
                        {rt(l, 'export')}
                      </button>
                    )}
                  </div>
                  <div className="report-shop-grid">
                    {data.shops.map((s) => (
                      <article key={s.id}>
                        <h4>{s.label[l]}</h4>
                        <dl className="report-financial-lines">
                          {(
                            [
                              'salesNet',
                              'refunded',
                              'annualPaid',
                              'orders',
                              'completionBps',
                            ] as const
                          ).map((k) => (
                            <div key={k}>
                              <dt>{rt(l, k)}</dt>
                              <dd>{metricValue(l, k, s[k])}</dd>
                            </div>
                          ))}
                        </dl>
                        <button
                          className="button secondary small"
                          onClick={() => change({ ...query, storeId: s.id })}
                        >
                          {rt(l, 'viewShop')}
                          <ArrowUpRight size={14} />
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              )}
              <div className="finance-panel report-operation-counts">
                {(['closed', 'cancelled', 'capturedOrders', 'averageCapture'] as const).map((k) => (
                  <div key={k}>
                    <span>{rt(l, k)}</span>
                    <strong>{metricValue(l, k, data.current[k])}</strong>
                  </div>
                ))}
              </div>
            </>
          )}
          {view === 'details' && (
            <div className="finance-panel report-details">
              <div className="report-detail-toolbar">
                <label>
                  {rt(l, 'details')}
                  <select
                    aria-label={rt(l, 'details')}
                    value={type}
                    onChange={(e) => {
                      setType(e.target.value as ReportExportType);
                      setPage(1);
                    }}
                  >
                    {(['money', 'orders', 'settlements', 'annual', 'invoices'] as const).map(
                      (t) => (
                        <option key={t} value={t}>
                          {rt(l, t)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <span>
                  {records.length} {rt(l, 'count')}
                </span>
              </div>
              <p className="report-method">
                {rt(l, timing)}
                {type === 'orders' && (
                  <>
                    <br />
                    {rt(l, 'lifetimeHelp')}
                  </>
                )}
              </p>
              {!records.length && (
                <div className="invoice-empty">
                  <FileSpreadsheet size={24} />
                  <p>{rt(l, 'noData')}</p>
                </div>
              )}
              {records.slice((currentPage - 1) * 8, currentPage * 8).map((c) => (
                <article className="report-record" key={c.id}>
                  <div>
                    <span className="invoice-state">{label(c.status)}</span>
                    <h4>{c.title}</h4>
                    <p>
                      {shopName(c.storeId)} · {invoiceDate(l, c.at)}
                    </p>
                  </div>
                  <div>
                    <strong>{money(l, c.amount)}</strong>
                    <small className="report-amount-label">{c.amountLabel}</small>
                    <button
                      className="button secondary small"
                      onClick={() => open({ kind: 'source', card: c })}
                    >
                      {rt(l, 'inspect')}
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                </article>
              ))}
              {pages > 1 && (
                <div className="invoice-pagination">
                  <button
                    className="button secondary small"
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    {rt(l, 'pagePrevious')}
                  </button>
                  <span>
                    {currentPage} / {pages}
                  </span>
                  <button
                    className="button secondary small"
                    disabled={currentPage === pages}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    {rt(l, 'pageNext')}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <MobileSheet
        key={sheet?.kind ?? 'closed'}
        open={!!sheet}
        onClose={() => {
          if (!busy) setSheet(null);
        }}
        title={rt(
          l,
          sheet?.kind === 'export'
            ? 'exportConfirm'
            : sheet?.kind === 'history'
              ? 'history'
              : sheet?.kind === 'definitions'
                ? 'definitions'
                : sheet?.kind === 'point'
                  ? 'viewPoint'
                  : 'inspect',
        )}
        locale={l}
        className="report-sheet"
      >
        {sheet && (
          <div className="report-modal">
            <p className="finance-demo">{rt(l, 'demo')}</p>
            {sheet.kind === 'source' && sourceDetails(sheet.card)}
            {sheet.kind === 'definitions' && (
              <>
                <h4>{rt(l, 'money')}</h4>
                <p>{rt(l, 'moneyTiming')}</p>
                <p>{rt(l, 'qualityHelp')}</p>
                <h4>{rt(l, 'operations')}</h4>
                <p>{rt(l, 'cohortHelp')}</p>
                <p>{rt(l, 'lifetimeHelp')}</p>
                <h4>{rt(l, 'settlements')}</h4>
                <p>{rt(l, 'settlementTiming')}</p>
                <h4>{rt(l, 'annual')}</h4>
                <p>{rt(l, 'annualTiming')}</p>
                <h4>{rt(l, 'invoices')}</h4>
                <p>{rt(l, 'invoiceTiming')}</p>
                <h4>{rt(l, 'balances')}</h4>
                <p>{rt(l, 'bridgeHelp')}</p>
                <p>{rt(l, 'legacyNet')}</p>
              </>
            )}
            {sheet.kind === 'point' && (
              <>
                <h3>{sheet.point.period}</h3>
                <dl className="report-definition-list">
                  {(['captured', 'refunded', 'salesNet', 'platformFee'] as const).map((k) => (
                    <div key={k}>
                      <dt>{rt(l, k)}</dt>
                      <dd>{money(l, sheet.point[k])}</dd>
                    </div>
                  ))}
                </dl>
                {!pointItems.length && <p>{rt(l, 'noData')}</p>}
                {pointItems.map((r) => (
                  <button
                    className="report-point-row"
                    key={r.id}
                    onClick={() =>
                      open({
                        kind: 'source',
                        card: cards(sheet.snapshot, 'money').find((c) => c.id === r.id)!,
                      })
                    }
                  >
                    <span>
                      #{r.bookingId.slice(-8).toUpperCase()} · {label(r.kind)}
                      <small>
                        {shopName(r.storeId, sheet.snapshot)} · {invoiceDate(l, r.at)}
                      </small>
                    </span>
                    <strong>{money(l, r.captured - r.refunded)}</strong>
                  </button>
                ))}
              </>
            )}
            {sheet.kind === 'export' && (
              <>
                <p>{rt(l, 'exportHelp')}</p>
                <dl className="report-definition-list">
                  <div>
                    <dt>{rt(l, 'scope')}</dt>
                    <dd>
                      {sheet.snapshot.selectedStoreIds
                        .map((id) => shopName(id, sheet.snapshot))
                        .join(' / ')}
                    </dd>
                  </div>
                  <div>
                    <dt>{rt(l, 'period')}</dt>
                    <dd>
                      {sheet.snapshot.query.from} — {sheet.snapshot.query.to} · JST
                    </dd>
                  </div>
                  <div>
                    <dt>{rt(l, 'details')}</dt>
                    <dd>{rt(l, sheet.type)}</dd>
                  </div>
                  <div>
                    <dt>{rt(l, 'rows')}</dt>
                    <dd>
                      {exportCount(sheet.snapshot, sheet.type)} · {rt(l, 'allPages')}
                    </dd>
                  </div>
                </dl>
                <label className="report-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span>{rt(l, 'confirm')}</span>
                </label>
                {error && (
                  <p role="alert" className="quality-error">
                    {error}
                  </p>
                )}
                <button
                  className="button full"
                  disabled={busy || !confirmed}
                  onClick={() => void exportNow()}
                >
                  <Download size={16} />
                  {rt(l, 'exportNow')}
                </button>
              </>
            )}
            {sheet.kind === 'history' && (
              <>
                {!data?.exports.length && <p>{rt(l, 'emptyHistory')}</p>}
                {data?.exports.map((e) => (
                  <article className="report-export-record" key={e.id}>
                    <span className="eyebrow">{e.id.slice(-12).toUpperCase()} / CSV</span>
                    <h4>{rt(l, e.type)}</h4>
                    <p>
                      {e.from} — {e.to} · {e.rowCount} {rt(l, 'count')}
                    </p>
                    <small>
                      {invoiceDate(l, e.at)} · {rt(l, 'snapshot')}
                    </small>
                    {data.canExport && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void download(e.id)}
                      >
                        {rt(l, 'download')}
                      </button>
                    )}
                  </article>
                ))}
                {error && (
                  <p className="quality-error" role="alert">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </MobileSheet>
    </section>
  );
}
function ReportChart({
  locale: l,
  points,
  metric,
  onPoint,
}: {
  locale: Locale;
  points: ReportPoint[];
  metric: 'salesNet' | 'captured' | 'refunded' | 'platformFee';
  onPoint: (p: ReportPoint) => void;
}) {
  const values = points.map((p) => p[metric]),
    lo = Math.min(0, ...values),
    hi = Math.max(0, ...values),
    y = (n: number) => 170 - ((n - lo) / (hi - lo || 1)) * 140,
    zero = y(0),
    step = 720 / Math.max(1, points.length),
    width = Math.max(1, Math.min(24, step * 0.6));
  return (
    <div className="report-chart">
      <div className="report-chart-range">
        {rt(l, 'chartRange')}: {money(l, lo)} — {money(l, hi)}
      </div>
      <svg
        viewBox="0 0 760 190"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${rt(l, 'trend')} · ${rt(l, metric)}`}
      >
        <line x1="20" x2="740" y1={zero} y2={zero} stroke="#bdc9bb" />
        {points.map((p, i) => {
          const value = p[metric],
            top = Math.min(zero, y(value)),
            height = Math.max(value === 0 ? 1 : 2, Math.abs(zero - y(value)));
          return (
            <g key={p.period}>
              <rect
                x={20 + i * step + (step - width) / 2}
                y={top}
                width={width}
                height={height}
                fill={value < 0 ? '#a57849' : '#315d49'}
                rx="2"
              />
              <title>
                {p.period} · {money(l, value)}
              </title>
            </g>
          );
        })}
      </svg>
      <div className="report-chart-dates">
        {[...new Set([0, Math.floor(points.length / 2), points.length - 1])]
          .filter((i) => i >= 0 && points[i])
          .map((i) => (
            <span key={i}>{points[i].period.slice(5)}</span>
          ))}
      </div>
      <div className="report-chart-access">
        <label>
          {rt(l, 'viewPoint')}
          <select
            aria-label={rt(l, 'viewPoint')}
            defaultValue=""
            onChange={(e) => {
              const p = points.find((p) => p.period === e.target.value);
              if (p) onPoint(p);
              e.target.value = '';
            }}
          >
            <option value="">{rt(l, 'period')}</option>
            {points.map((p) => (
              <option key={p.period} value={p.period}>
                {p.period} · {money(l, p[metric])}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
