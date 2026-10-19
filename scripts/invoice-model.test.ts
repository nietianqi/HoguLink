import test from 'node:test';
import assert from 'node:assert/strict';
import type { InvoiceDocument } from '@hogulink/contracts';
import { escapeInvoiceHtml, invoiceDate, invoiceHtml } from '../hogulink-web/src/lib/invoice-model';
const sign = { id: 'qa', name: 'Finance QA', at: Date.UTC(2026, 9, 17, 15) };
const d: InvoiceDocument = {
  id: 'doc',
  requestId: 'req',
  storeId: 'store',
  rootId: 'doc',
  revision: 1,
  number: 'DEMO-INV-202610-000001',
  kind: 'INVOICE',
  purpose: 'PLATFORM_FEE',
  issuedAt: sign.at,
  issuer: { name: 'HoguLink Demo', registrationNumber: null, verified: false },
  recipient: {
    name: 'QA <script>alert(1)</script>',
    address: 'Tokyo & QA',
    email: 'qa@example.test',
    taxId: '',
  },
  amount: 200,
  currency: 'JPY',
  taxBasis: 'UNASSESSED',
  taxAmount: null,
  mode: 'DEMO',
  lines: [{ id: 'line', amount: 200, at: sign.at, kind: 'SERVICE_FEE' }],
  sourceKey: 'MONTH:2026-10',
  reviewer: sign,
  approver: { ...sign, id: 'owner' },
  issuedBy: sign,
};
test('invoice HTML escapes all recipient and reference content without executable dependencies', () => {
  const html = invoiceHtml(d, 'zh-cn', '<img src=x onerror=alert(1)>');
  assert(!html.includes('<script'));
  assert(!html.includes('<img'));
  assert(!html.includes('https://'));
  assert(html.includes('&lt;script&gt;'));
  assert(html.includes('Tokyo &amp; QA'));
  assert(html.includes('&lt;img'));
  assert.equal(escapeInvoiceHtml('"\'&<>'), '&quot;&#39;&amp;&lt;&gt;');
});
test('all languages disclose demo and unassessed tax without fabricated registration', () => {
  for (const l of ['ja', 'en', 'zh-cn'] as const) {
    const html = invoiceHtml(d, l);
    assert(html.includes('DEMO'));
    assert(html.includes(d.number));
    assert(!html.includes('T123'));
    assert(html.includes('@media print'));
  }
  assert(invoiceHtml(d, 'en').includes('Tax basis unassessed'));
  assert(invoiceHtml(d, 'zh-cn').includes('开票主体'));
});
test('credit exports identify original invoice and preserve signed fee reversal', () => {
  const html = invoiceHtml(
    {
      ...d,
      kind: 'CREDIT_NOTE',
      purpose: 'CREDIT_NOTE',
      number: 'DEMO-CRN-202610-000001',
      lines: [{ ...d.lines[0], amount: -200, kind: 'FEE_REVERSAL' }],
    },
    'en',
    d.number,
  );
  assert(html.includes(d.number));
  assert(html.includes('-¥200'));
  assert(html.includes('Platform fee reversal'));
});
test('invoice timestamps use the Japan calendar boundary', () => {
  assert(invoiceDate('en', Date.UTC(2026, 9, 17, 15)).includes('10/18/2026'));
  assert(invoiceDate('ja', Date.UTC(2026, 9, 17, 15)).includes('2026/10/18'));
});
