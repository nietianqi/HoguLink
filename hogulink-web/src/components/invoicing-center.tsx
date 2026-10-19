'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileCheck2, FileText, RefreshCw, ShieldCheck, ArrowUpRight } from 'lucide-react';
import {
  canAdmin,
  type Actor,
  type InvoicingWorkspace,
  type InvoiceSource,
  type InvoiceRequestView,
  type InvoiceDocument,
  type InvoiceProfile,
  type InvoiceRecipient,
  type Locale,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { errorText, money } from '@/lib/i18n';
import { it, invoiceLabel, isInvoiceKey, type InvoiceKey } from '@/lib/invoicing-i18n';
import { invoiceDate, invoiceHtml } from '@/lib/invoice-model';
import { csvCell } from '@/lib/desktop-model';
import { MobileSheet } from './mobile-ui';
type Sheet =
  | { kind: 'profile'; profile: InvoiceProfile }
  | { kind: 'apply'; source: InvoiceSource; profile: InvoiceProfile; recipient: InvoiceRecipient }
  | { kind: 'request'; request: InvoiceRequestView }
  | { kind: 'action'; request: InvoiceRequestView; action: string; profile: InvoiceProfile }
  | { kind: 'document'; document: InvoiceDocument };
export function InvoicingCenter({
  locale: l,
  actor,
  storeId,
  initialSource = '',
  initialNumber = '',
  onOpenFinance,
}: {
  locale: Locale;
  actor: Actor;
  storeId: string;
  initialSource?: string;
  initialNumber?: string;
  onOpenFinance: (view: 'activity' | 'statements' | 'plans', source?: InvoiceSource) => void;
}) {
  const admin = actor.role === 'ADMIN',
    writable = admin && canAdmin(actor, 'finance.write');
  const [data, setData] = useState<InvoicingWorkspace>(),
    [view, setView] = useState<'sources' | 'requests' | 'documents'>(
      initialNumber ? 'documents' : 'sources',
    ),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState(initialNumber),
    [page, setPage] = useState(1),
    [sheet, setSheet] = useState<Sheet | null>(null),
    [draft, setDraft] = useState<InvoiceRecipient>({ name: '', address: '', email: '', taxId: '' }),
    [note, setNote] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [attested, setAttested] = useState({
      source: false,
      recipient: false,
      history: false,
      demo: false,
    }),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    lock = useRef(false),
    retry = useRef({ body: '', key: '' });
  const fail = (e: unknown) =>
    e instanceof ClientError && isInvoiceKey(e.code)
      ? it(l, e.code)
      : errorText(l, e instanceof ClientError ? e.code : undefined);
  const load = useCallback(async () => {
    const n = ++generation.current;
    try {
      const w = await api<InvoicingWorkspace>(
        `${admin ? 'admin' : 'merchant'}/invoicing?storeId=${encodeURIComponent(storeId)}`,
      );
      if (n === generation.current) setData(w);
    } catch (e) {
      if (n === generation.current) {
        setData(undefined);
        setError(fail(e));
      }
    }
  }, [admin, actor.id, actor.adminSessionVersion, storeId, l]);
  useEffect(() => {
    setData(undefined);
    setSheet(null);
    setError('');
    setNotice('');
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
      generation.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [load]);
  useEffect(() => setPage(1), [view, filter, search]);
  function begin(s: Sheet) {
    setError('');
    setNotice('');
    setNote('');
    setConfirmed(false);
    setAttested({ source: false, recipient: false, history: false, demo: false });
    if (s.kind === 'profile')
      setDraft({
        name: s.profile.name,
        address: s.profile.address,
        email: s.profile.email,
        taxId: s.profile.taxId,
      });
    setSheet(s);
  }
  function apply(s: InvoiceSource) {
    if (!data) return;
    const original = data.documents.find((d) => d.id === s.originalDocumentId);
    begin({
      kind: 'apply',
      source: s,
      profile: data.profile,
      recipient: s.kind === 'CREDIT_NOTE' ? original!.recipient : data.profile,
    });
  }
  function file(contents: string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([contents], { type })),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  function download(d: InvoiceDocument) {
    const original = data?.documents.find(
      (x) =>
        x.rootId ===
          (d.originalInvoiceRootId ?? data.documents.find((t) => t.id === d.correctsId)?.rootId) &&
        x.revision === 1,
    );
    file(invoiceHtml(d, l, original?.number), d.number + '.html', 'text/html;charset=utf-8;');
  }
  function csv(d: InvoiceDocument) {
    file(
      '\ufeff' +
        [
          [
            'document_number',
            'kind',
            'revision',
            'issued_jst',
            'fee_amount_jpy_tax_unassessed',
            'source_reference',
            'fee_component',
            'line_amount_jpy',
          ],
          ...d.lines.map((x) => [
            d.number,
            d.kind,
            String(d.revision),
            invoiceDate(l, d.issuedAt),
            String(d.amount),
            x.id,
            x.kind,
            String(x.amount),
          ]),
        ]
          .map((r) => r.map(csvCell).join(','))
          .join('\r\n'),
      d.number + '.csv',
      'text/csv;charset=utf-8;',
    );
  }
  async function send() {
    if (!sheet || !data || lock.current) return;
    let path = '',
      body: unknown;
    if (sheet.kind === 'profile') {
      path = `merchant/invoicing/${storeId}/profile`;
      body = { version: sheet.profile.version, recipient: draft };
    } else if (sheet.kind === 'apply') {
      path = `${admin ? 'admin' : 'merchant'}/invoicing/${storeId}/requests`;
      body = {
        sourceKey: sheet.source.key,
        sourceToken: sheet.source.token,
        ...(sheet.source.kind === 'CREDIT_NOTE' ? {} : { profileVersion: sheet.profile.version }),
        note,
      };
    } else if (sheet.kind === 'action') {
      const { request: r, action } = sheet;
      path = `billing/invoice-requests/${r.id}/actions`;
      body = {
        version: r.version,
        action,
        note,
        ...(action === 'RESUBMIT'
          ? {
              sourceToken: r.currentSource?.token,
              ...(r.kind === 'CREDIT_NOTE' ? {} : { profileVersion: sheet.profile.version }),
            }
          : {}),
        ...(['REVIEW', 'APPROVE', 'ISSUE', 'ISSUE_FAILED'].includes(action)
          ? { checks: attested }
          : {}),
      };
    } else return;
    const fingerprint = JSON.stringify([path, body]);
    if (retry.current.body !== fingerprint)
      retry.current = { body: fingerprint, key: crypto.randomUUID() };
    const n = generation.current;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api(path, body, 'POST', retry.current.key);
      if (n !== generation.current) return;
      setSheet(null);
      await load();
      setNotice(it(l, 'saved'));
      if (path.endsWith('/requests')) {
        setView('requests');
        setFilter('all');
      }
    } catch (e) {
      if (n === generation.current) {
        if (
          e instanceof ClientError &&
          [
            'VERSION_CONFLICT',
            'INVOICE_SOURCE_CHANGED',
            'INVOICE_SOURCE_UNAVAILABLE',
            'INVOICE_FINAL',
          ].includes(e.code)
        ) {
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
  const sourceList = (data?.sources ?? [])
    .filter((s) => filter === 'all' || s.kind === filter)
    .sort((a, b) =>
      a.key === initialSource
        ? -1
        : b.key === initialSource
          ? 1
          : a.kind === 'CREDIT_NOTE' && b.kind !== 'CREDIT_NOTE'
            ? -1
            : 0,
    );
  const requestList = (data?.requests ?? []).filter(
    (r) =>
      (filter === 'all' || r.state === filter) &&
      (!search ||
        [r.id, r.recipient.name].some((t) => t.toLowerCase().includes(search.toLowerCase()))),
  );
  const documentList = (data?.documents ?? []).filter(
    (d) =>
      (filter === 'all' || d.kind === filter) &&
      (!search ||
        [d.number, d.recipient.name].some((t) => t.toLowerCase().includes(search.toLowerCase()))),
  );
  const count =
      view === 'sources'
        ? sourceList.length
        : view === 'requests'
          ? requestList.length
          : documentList.length,
    pages = Math.max(1, Math.ceil(count / 6)),
    currentPage = Math.min(page, pages),
    slice = <T,>(items: T[]) => items.slice((currentPage - 1) * 6, currentPage * 6);
  const sheetTitle =
    sheet?.kind === 'profile'
      ? it(l, 'editProfile')
      : sheet?.kind === 'apply'
        ? it(l, 'apply')
        : sheet?.kind === 'action'
          ? invoiceLabel(l, sheet.action)
          : sheet?.kind === 'document'
            ? it(l, 'documents')
            : it(l, 'details');
  const recipientBlock = (r: InvoiceRecipient) => (
    <dl className="invoice-recipient">
      <div>
        <dt>{it(l, 'name')}</dt>
        <dd>{r.name}</dd>
      </div>
      <div>
        <dt>{it(l, 'address')}</dt>
        <dd>{r.address}</dd>
      </div>
      <div>
        <dt>{it(l, 'email')}</dt>
        <dd>{r.email}</dd>
      </div>
      {r.taxId && (
        <div>
          <dt>{it(l, 'taxId')}</dt>
          <dd>{r.taxId}</dd>
        </div>
      )}
    </dl>
  );
  function sourceBlock(s: InvoiceSource) {
    const original = data?.documents.find((d) => d.id === s.originalDocumentId);
    return (
      <>
        <div className="invoice-amount">
          <small>{it(l, s.kind === 'CREDIT_NOTE' ? 'creditAmount' : 'amount')}</small>
          <strong>{money(l, s.amount)}</strong>
          <span>{invoiceLabel(l, s.taxBasis)}</span>
        </div>
        <dl className="invoice-recipient">
          <div>
            <dt>{it(l, 'sources')}</dt>
            <dd>
              {invoiceLabel(l, s.kind)} {s.month ?? ''}
            </dd>
          </div>
          {original && (
            <div>
              <dt>{it(l, 'original')}</dt>
              <dd>{original.number}</dd>
            </div>
          )}
        </dl>
        <details className="invoice-source-lines">
          <summary>
            {it(l, 'lines')} · {s.lines.length}
          </summary>
          <div className="invoice-lines">
            {s.lines.map((line) => (
              <div key={line.id}>
                <span>
                  {invoiceLabel(l, line.kind)}
                  <small>
                    {line.bookingId
                      ? '#' + line.bookingId.slice(-8).toUpperCase()
                      : s.sourceId.slice(-12).toUpperCase()}{' '}
                    · {invoiceDate(l, line.at)}
                  </small>
                </span>
                <strong>{money(l, line.amount)}</strong>
              </div>
            ))}
          </div>
        </details>
      </>
    );
  }
  const requestActions = (r: InvoiceRequestView) => [
    ...(r.canReview ? ['REVIEW'] : []),
    ...(r.canApprove ? ['APPROVE'] : []),
    ...(r.canIssue ? ['ISSUE', 'ISSUE_FAILED'] : []),
    ...(r.canReturn ? ['RETURN', 'REJECT'] : []),
    ...(r.canResubmit ? ['RESUBMIT'] : []),
    ...(r.canWithdraw ? ['WITHDRAW'] : []),
  ];
  return (
    <section className="invoicing-center" aria-label={it(l, 'title')}>
      <div className="finance-heading">
        <div>
          <span className="eyebrow">INVOICE / REVIEW & RECORDS</span>
          <h3>
            <FileCheck2 size={21} />
            {it(l, 'title')}
          </h3>
        </div>
        <button
          className="button secondary small"
          disabled={busy}
          aria-label={it(l, 'refresh')}
          onClick={() => {
            setError('');
            void load();
          }}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="finance-muted">{it(l, 'intro')}</p>
      <p className="finance-demo">{it(l, 'demo')}</p>
      <div className="invoice-rule">
        <ShieldCheck size={20} />
        <div>
          <strong>{it(l, 'separation')}</strong>
          <p>{it(l, 'scope')}</p>
        </div>
      </div>
      {error && !sheet && (
        <p role="alert" className="quality-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {!data && !error && <p role="status">{it(l, 'loading')}</p>}
      {data && (
        <>
          <div className="finance-metrics invoice-metrics">
            {(['pending', 'approved', 'issued', 'adjustments'] as const).map((k) => (
              <div key={k}>
                <span>{it(l, k)}</span>
                <strong>{data.totals[k]}</strong>
                <small>{it(l, 'title')}</small>
              </div>
            ))}
          </div>
          <div className="invoice-profile-card">
            <div>
              <span>{it(l, 'profile')}</span>
              <strong>{data.profile.name}</strong>
              <small>{data.profile.email || '—'}</small>
            </div>
            {!admin && (
              <button
                className="button secondary"
                onClick={() => begin({ kind: 'profile', profile: data.profile })}
              >
                {it(l, 'editProfile')}
              </button>
            )}
            {admin && !writable && <span>{it(l, 'readOnly')}</span>}
          </div>
          <nav className="invoice-tabs" aria-label={it(l, 'title')}>
            {(['sources', 'requests', 'documents'] as const).map((v) => (
              <button
                key={v}
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  setFilter('all');
                  setSearch('');
                }}
              >
                {it(l, v)}
              </button>
            ))}
          </nav>
          <div className="finance-panel invoice-list">
            <div className="invoice-toolbar">
              {view !== 'sources' && (
                <input
                  type="search"
                  value={search}
                  aria-label={it(l, 'search')}
                  placeholder={it(l, 'search')}
                  onChange={(e) => setSearch(e.target.value)}
                />
              )}
              <select
                aria-label={it(l, view)}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">{it(l, 'all')}</option>
                {(view === 'sources'
                  ? ['PLATFORM_FEE', 'ANNUAL_FEE', 'CREDIT_NOTE', 'CORRECTION']
                  : view === 'requests'
                    ? [
                        'SUBMITTED',
                        'CHANGES_REQUESTED',
                        'REVIEWED',
                        'APPROVED',
                        'ISSUED',
                        'REJECTED',
                        'WITHDRAWN',
                      ]
                    : ['INVOICE', 'CREDIT_NOTE']
                ).map((k) => (
                  <option key={k} value={k}>
                    {invoiceLabel(l, k)}
                  </option>
                ))}
              </select>
              <span>{count}</span>
            </div>
            {count === 0 && (
              <div className="invoice-empty">
                <FileText size={27} />
                <p>{it(l, view === 'sources' ? 'noSources' : 'empty')}</p>
                {view === 'sources' && (
                  <div>
                    <button
                      className="button secondary"
                      onClick={() => onOpenFinance('statements')}
                    >
                      {it(l, 'fixStatement')}
                    </button>
                    <button className="button secondary" onClick={() => onOpenFinance('plans')}>
                      {it(l, 'viewPlans')}
                    </button>
                  </div>
                )}
              </div>
            )}
            {view === 'sources' &&
              slice(sourceList).map((s) => (
                <article
                  key={s.key}
                  className={`invoice-source ${s.key === initialSource ? 'highlight' : ''}`}
                >
                  <div>
                    <span className={`invoice-kind ${s.kind === 'CREDIT_NOTE' ? 'credit' : ''}`}>
                      {invoiceLabel(l, s.kind)}
                    </span>
                    <h4>
                      {s.month ??
                        data.documents.find((d) => d.id === s.originalDocumentId)?.number ??
                        s.sourceId.slice(-12).toUpperCase()}
                    </h4>
                    <p>
                      {s.kind === 'CORRECTION'
                        ? it(l, 'correctionHelp')
                        : s.kind === 'CREDIT_NOTE'
                          ? it(l, 'creditRecipient')
                          : it(l, 'scope')}
                    </p>
                    {s.blockedReason && (
                      <p className="invoice-blocked">{invoiceLabel(l, s.blockedReason)}</p>
                    )}
                  </div>
                  <div className="invoice-card-actions">
                    <strong>{money(l, s.amount)}</strong>
                    <small>{invoiceLabel(l, s.taxBasis)}</small>
                    {!admin || s.kind === 'CREDIT_NOTE' ? (
                      <button
                        className="button small"
                        disabled={!!s.blockedReason || busy}
                        onClick={() => apply(s)}
                      >
                        {it(l, admin ? 'adminApply' : 'apply')}
                      </button>
                    ) : (
                      <span className="finance-muted">{it(l, 'merchantOnly')}</span>
                    )}
                    {s.blockedReason === 'INVOICE_STATEMENT_REQUIRED' && (
                      <button
                        className="button secondary small"
                        onClick={() => onOpenFinance('statements', s)}
                      >
                        {it(l, 'fixStatement')}
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                    {['INVOICE_RECONCILIATION_REQUIRED', 'INVOICE_BUSINESS_PENDING'].includes(
                      s.blockedReason ?? '',
                    ) && (
                      <button
                        className="button secondary small"
                        onClick={() => onOpenFinance('activity', s)}
                      >
                        {it(l, 'fixReconciliation')}
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            {view === 'requests' &&
              slice(requestList).map((r) => (
                <article key={r.id} className="invoice-request">
                  <div>
                    <span className={'invoice-state ' + r.state.toLowerCase()}>
                      {invoiceLabel(l, r.state)}
                    </span>
                    <h4>{r.recipient.name}</h4>
                    <p>
                      {invoiceLabel(l, r.kind)} · #{r.id.slice(-10).toUpperCase()} ·{' '}
                      {invoiceDate(l, r.createdAt)}
                    </p>
                    {r.stale && <p className="invoice-blocked">{it(l, 'stale')}</p>}
                    {r.blockedReason && (
                      <p className="invoice-blocked">{invoiceLabel(l, r.blockedReason)}</p>
                    )}
                  </div>
                  <div className="invoice-card-actions">
                    <strong>{money(l, r.source.amount)}</strong>
                    <button
                      className="button secondary small"
                      onClick={() => begin({ kind: 'request', request: r })}
                    >
                      {it(l, 'details')}
                    </button>
                    {requestActions(r)
                      .slice(0, 1)
                      .map((action) => (
                        <button
                          className="button small"
                          key={action}
                          disabled={busy}
                          onClick={() =>
                            begin({ kind: 'action', request: r, action, profile: data.profile })
                          }
                        >
                          {invoiceLabel(l, action)}
                        </button>
                      ))}
                  </div>
                </article>
              ))}
            {view === 'documents' &&
              slice(documentList).map((d) => {
                const superseded = data.documents.some((x) => x.correctsId === d.id);
                return (
                  <article key={d.id} className="invoice-record">
                    <div>
                      <span className="invoice-state issued">{invoiceLabel(l, d.kind)}</span>
                      <h4>{d.number}</h4>
                      <p>
                        {d.recipient.name} · {invoiceDate(l, d.issuedAt)} · {it(l, 'revision')}{' '}
                        {d.revision}
                      </p>
                      {superseded && <small>{it(l, 'superseded')}</small>}
                    </div>
                    <div className="invoice-card-actions">
                      <strong>{money(l, d.kind === 'CREDIT_NOTE' ? -d.amount : d.amount)}</strong>
                      <button
                        className="button secondary small"
                        onClick={() => begin({ kind: 'document', document: d })}
                      >
                        {it(l, 'details')}
                      </button>
                      <button className="button secondary small" onClick={() => download(d)}>
                        <Download size={14} />
                        {it(l, 'download')}
                      </button>
                    </div>
                  </article>
                );
              })}
            {pages > 1 && (
              <div className="invoice-pagination">
                <button
                  className="button secondary small"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  {it(l, 'previous')}
                </button>
                <span>
                  {currentPage} / {pages}
                </span>
                <button
                  className="button secondary small"
                  disabled={currentPage === pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  {it(l, 'next')}
                </button>
              </div>
            )}
          </div>
        </>
      )}
      <MobileSheet
        key={sheet?.kind ?? 'closed'}
        open={!!sheet}
        onClose={() => {
          if (!busy) setSheet(null);
        }}
        title={sheetTitle}
        locale={l}
        className="invoice-sheet"
      >
        {sheet && (
          <div className="invoice-modal">
            <p className="finance-demo">{it(l, 'demo')}</p>
            {sheet.kind === 'profile' && (
              <form
                className="invoice-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                {(['name', 'address', 'email', 'taxId'] as const).map((k) => (
                  <label key={k}>
                    {it(l, k)}
                    {k === 'address' ? (
                      <textarea
                        aria-label={it(l, k)}
                        value={draft[k]}
                        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                        required
                        minLength={5}
                        maxLength={300}
                        rows={2}
                      />
                    ) : (
                      <input
                        aria-label={it(l, k)}
                        type={k === 'email' ? 'email' : 'text'}
                        value={draft[k]}
                        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                        required={k !== 'taxId'}
                        minLength={k === 'name' ? 2 : undefined}
                        maxLength={k === 'name' ? 160 : k === 'email' ? 254 : 50}
                      />
                    )}
                  </label>
                ))}
                {error && (
                  <p role="alert" className="quality-error">
                    {error}
                  </p>
                )}
                <button className="button full" disabled={busy}>
                  {it(l, 'saveProfile')}
                </button>
              </form>
            )}
            {sheet.kind === 'request' && (
              <>
                {sourceBlock(sheet.request.source)}
                <span className={'invoice-state ' + sheet.request.state.toLowerCase()}>
                  {invoiceLabel(l, sheet.request.state)}
                </span>
                {sheet.request.stale && <p className="invoice-blocked">{it(l, 'stale')}</p>}
                {sheet.request.blockedReason && (
                  <p className="invoice-blocked">{invoiceLabel(l, sheet.request.blockedReason)}</p>
                )}
                <h4>{it(l, 'recipientSnapshot')}</h4>
                {recipientBlock(sheet.request.recipient)}
                <dl className="invoice-recipient">
                  {(['reviewer', 'approver'] as const).map(
                    (k) =>
                      sheet.request[k] && (
                        <div key={k}>
                          <dt>{it(l, k)}</dt>
                          <dd>
                            {sheet.request[k]!.name} · {invoiceDate(l, sheet.request[k]!.at)}
                          </dd>
                        </div>
                      ),
                  )}
                </dl>
                <h4>{it(l, 'attempts')}</h4>
                {!sheet.request.attempts.length && <p>—</p>}
                {sheet.request.attempts.map((a, i) => (
                  <p key={i}>
                    {invoiceDate(l, a.at)} · {invoiceLabel(l, a.outcome)} · {a.operator}
                  </p>
                ))}
                <div className="invoice-modal-actions">
                  {requestActions(sheet.request).map((action) => (
                    <button
                      key={action}
                      className={
                        ['REVIEW', 'APPROVE', 'ISSUE', 'RESUBMIT'].includes(action)
                          ? 'button'
                          : 'button secondary'
                      }
                      onClick={() =>
                        begin({
                          kind: 'action',
                          request: sheet.request,
                          action,
                          profile: data!.profile,
                        })
                      }
                    >
                      {invoiceLabel(l, action)}
                    </button>
                  ))}
                  {sheet.request.documentId && (
                    <button
                      className="button"
                      onClick={() =>
                        begin({
                          kind: 'document',
                          document: data!.documents.find((d) => d.id === sheet.request.documentId)!,
                        })
                      }
                    >
                      {it(l, 'documents')}
                    </button>
                  )}
                </div>
                <h4>{it(l, 'history')}</h4>
                {data?.history
                  .filter((h) => h.requestId === sheet.request.id)
                  .map((h) => (
                    <article className="invoice-history" key={h.id}>
                      <strong>{invoiceLabel(l, h.action)}</strong>
                      <small>
                        {invoiceDate(l, h.at)} · {h.operator}
                      </small>
                      <p>{h.note}</p>
                    </article>
                  ))}
              </>
            )}
            {(sheet.kind === 'apply' || sheet.kind === 'action') && (
              <form
                className="invoice-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                {sheet.kind === 'apply' ? (
                  <>
                    {sourceBlock(sheet.source)}
                    <h4>
                      {it(
                        l,
                        sheet.source.kind === 'CREDIT_NOTE'
                          ? 'recipientSnapshot'
                          : 'profileSnapshot',
                      )}
                    </h4>
                    {recipientBlock(sheet.recipient)}
                    {sheet.source.kind === 'CORRECTION' && <p>{it(l, 'correctionHelp')}</p>}
                  </>
                ) : (
                  <>
                    {sourceBlock(
                      sheet.action === 'RESUBMIT' && sheet.request.currentSource
                        ? sheet.request.currentSource
                        : sheet.request.source,
                    )}
                    {sheet.action === 'RESUBMIT' &&
                      sheet.request.currentSource?.amount !== sheet.request.source.amount && (
                        <p className="invoice-blocked">
                          {it(l, 'frozen')} {money(l, sheet.request.source.amount)} →{' '}
                          {it(l, 'currentAmount')} {money(l, sheet.request.currentSource!.amount)}
                        </p>
                      )}
                    <h4>{it(l, 'recipientSnapshot')}</h4>
                    {recipientBlock(
                      sheet.action === 'RESUBMIT' && sheet.request.kind !== 'CREDIT_NOTE'
                        ? sheet.profile
                        : sheet.request.recipient,
                    )}
                  </>
                )}
                <p className="finance-muted">{it(l, 'separation')}</p>
                <label>
                  {it(l, 'note')}
                  <textarea
                    value={note}
                    required
                    rows={3}
                    minLength={10}
                    maxLength={1500}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                {sheet.kind === 'action' &&
                ['REVIEW', 'APPROVE', 'ISSUE', 'ISSUE_FAILED'].includes(sheet.action) ? (
                  <div className="invoice-checks">
                    {(['source', 'recipient', 'history', 'demo'] as const).map((k, i) => (
                      <label className="invoice-check" key={k}>
                        <input
                          type="checkbox"
                          required
                          checked={attested[k]}
                          onChange={(e) => setAttested({ ...attested, [k]: e.target.checked })}
                        />
                        <span>
                          {it(
                            l,
                            (
                              [
                                'checkSource',
                                'checkRecipient',
                                'checkHistory',
                                'checkDemo',
                              ] as const
                            )[i],
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <label className="invoice-check">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    <span>{it(l, 'confirm')}</span>
                  </label>
                )}
                {error && (
                  <p role="alert" className="quality-error">
                    {error}
                  </p>
                )}
                <button className="button full" disabled={busy || note.trim().length < 10}>
                  {it(l, 'submit')}
                </button>
              </form>
            )}
            {sheet.kind === 'document' && (
              <>
                <span className="eyebrow">{sheet.document.number}</span>
                <h3>
                  {invoiceLabel(l, sheet.document.kind)} · {it(l, 'revision')}{' '}
                  {sheet.document.revision}
                </h3>
                <div className="invoice-amount">
                  <strong>
                    {money(
                      l,
                      sheet.document.kind === 'CREDIT_NOTE'
                        ? -sheet.document.amount
                        : sheet.document.amount,
                    )}
                  </strong>
                  <span>{invoiceLabel(l, sheet.document.taxBasis)}</span>
                </div>
                <p>
                  {it(l, 'issuedAt')} · {invoiceDate(l, sheet.document.issuedAt)}
                </p>
                {recipientBlock(sheet.document.recipient)}
                {sheet.document.originalInvoiceRootId && (
                  <p>
                    {it(l, 'original')} ·{' '}
                    {
                      data?.documents.find(
                        (d) =>
                          d.rootId === sheet.document.originalInvoiceRootId && d.revision === 1,
                      )?.number
                    }
                  </p>
                )}
                <dl className="invoice-recipient">
                  {(['reviewer', 'approver', 'issuedBy'] as const).map((k) => (
                    <div key={k}>
                      <dt>{it(l, k === 'issuedBy' ? 'issuer' : k)}</dt>
                      <dd>
                        {sheet.document[k].name} · {invoiceDate(l, sheet.document[k].at)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="invoice-lines">
                  {sheet.document.lines.map((line) => (
                    <div key={line.id}>
                      <span>
                        {invoiceLabel(l, line.kind)}
                        <small>{invoiceDate(l, line.at)}</small>
                      </span>
                      <strong>{money(l, line.amount)}</strong>
                    </div>
                  ))}
                </div>
                <div className="invoice-modal-actions">
                  <button className="button" onClick={() => download(sheet.document)}>
                    <Download size={16} />
                    {it(l, 'download')}
                  </button>
                  <small className="finance-muted">{it(l, 'downloadHelp')}</small>
                  <button className="button secondary" onClick={() => csv(sheet.document)}>
                    {it(l, 'export')}
                  </button>
                  {!admin &&
                    (() => {
                      const s = data?.sources.find(
                        (s) => s.key === `CORRECTION:${sheet.document.rootId}`,
                      );
                      return s && !s.blockedReason && s.originalDocumentId === sheet.document.id ? (
                        <button className="button secondary" onClick={() => apply(s)}>
                          {it(l, 'correction')}
                        </button>
                      ) : null;
                    })()}
                  {data?.documents.some((d) => d.correctsId === sheet.document.id) && (
                    <button
                      className="button secondary"
                      onClick={() =>
                        begin({
                          kind: 'document',
                          document: [...data.documents]
                            .filter((d) => d.rootId === sheet.document.rootId)
                            .sort((a, b) => b.revision - a.revision)[0],
                        })
                      }
                    >
                      {it(l, 'latest')}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </MobileSheet>
    </section>
  );
}
