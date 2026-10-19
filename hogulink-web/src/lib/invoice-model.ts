import type { InvoiceDocument, Locale } from '@hogulink/contracts';
import { it, invoiceLabel } from './invoicing-i18n';
export const invoiceDate = (l: Locale, at: number) =>
  new Intl.DateTimeFormat(l === 'zh-cn' ? 'zh-CN' : l, {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at) + ' JST';
export const escapeInvoiceHtml = (s: unknown) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
export function invoiceHtml(d: InvoiceDocument, l: Locale, related = '') {
  const esc = escapeInvoiceHtml,
    amount = (n: number) =>
      new Intl.NumberFormat(l === 'zh-cn' ? 'zh-CN' : l, {
        style: 'currency',
        currency: 'JPY',
        maximumFractionDigits: 0,
      }).format(n);
  return `<!doctype html><html lang="${l === 'zh-cn' ? 'zh-CN' : l}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.number)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f6f2;color:#202b27;font:15px/1.8 system-ui,sans-serif}.paper{max-width:860px;margin:40px auto;background:#fff;border:1px solid #e1e4dd;padding:48px}header{border-bottom:2px solid #183e34;padding-bottom:25px;color:#183e34}h1{font-size:28px;margin:12px 0}.demo{border-left:3px solid #a28352;padding:10px 16px;color:#6a624e;margin:24px 0}.amount{font-size:32px;color:#183e34}dl{display:grid;grid-template-columns:180px 1fr;gap:10px 20px}dt{color:#66716b}dd{margin:0;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:25px 0}td,th{text-align:left;border-bottom:1px solid #e1e4dd;padding:12px 8px;font-size:13px;overflow-wrap:anywhere}footer{margin-top:35px;color:#66716b;font-size:12px}@media(max-width:600px){.paper{margin:0;padding:24px}dl{grid-template-columns:1fr;gap:5px}dd{margin-bottom:12px}}@media print{body{background:#fff}.paper{border:0;margin:0;max-width:none;padding:15mm}}</style><main class="paper"><header><strong>HoguLink / DEMO</strong><h1>${esc(invoiceLabel(l, d.kind))}</h1><div>${esc(d.number)} · ${esc(it(l, 'revision'))} ${d.revision}</div></header><p class="demo">${esc(it(l, 'demo'))}</p><p class="amount">${esc(amount(d.kind === 'CREDIT_NOTE' ? -d.amount : d.amount))}</p><dl><dt>${esc(it(l, 'issuedAt'))}</dt><dd>${esc(invoiceDate(l, d.issuedAt))}</dd><dt>${esc(it(l, 'issuerEntity'))}</dt><dd>${esc(d.issuer.name)} / ${esc(it(l, 'unassessed'))}</dd><dt>${esc(it(l, 'name'))}</dt><dd>${esc(d.recipient.name)}</dd><dt>${esc(it(l, 'address'))}</dt><dd>${esc(d.recipient.address)}</dd><dt>${esc(it(l, 'email'))}</dt><dd>${esc(d.recipient.email)}</dd><dt>${esc(it(l, 'taxId'))}</dt><dd>${esc(d.recipient.taxId || '—')}</dd><dt>${esc(it(l, 'amount'))}</dt><dd>${esc(amount(d.amount))} / ${esc(invoiceLabel(l, d.taxBasis))}</dd>${related ? `<dt>${esc(it(l, 'original'))}</dt><dd>${esc(related)}</dd>` : ''}</dl><h2>${esc(it(l, 'lines'))}</h2><table><thead><tr><th>${esc(it(l, 'sourceId'))}</th><th>${esc(it(l, 'sources'))}</th><th>JPY</th></tr></thead><tbody>${d.lines.map((x) => `<tr><td>${esc(x.id)}</td><td>${esc(invoiceLabel(l, x.kind))}<br>${esc(invoiceDate(l, x.at))}</td><td>${esc(amount(x.amount))}</td></tr>`).join('')}</tbody></table><dl><dt>${esc(it(l, 'reviewer'))}</dt><dd>${esc(d.reviewer.name)}</dd><dt>${esc(it(l, 'approver'))}</dt><dd>${esc(d.approver.name)}</dd><dt>${esc(it(l, 'issuer'))}</dt><dd>${esc(d.issuedBy.name)}</dd></dl><footer>${esc(it(l, 'scope'))}<br>${esc(it(l, 'demo'))}</footer></main></html>`;
}
