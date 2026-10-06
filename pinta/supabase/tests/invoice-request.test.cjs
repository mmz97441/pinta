// « Facture encore demandée » on the server (_shared/invoiceRequest.ts): the rule of queue_message's invoice_requested
// (20260920000001) and of register_telegram_document's confirmation case (20261006000002, consent-reply.sql), and the
// same answer as the front rule invoiceRequestState().requested on stored rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('../../node_modules/esbuild');

let loaded;
async function rules() {
  if (loaded) return loaded;
  const output = await esbuild.build({ stdin: { contents: "export { currentInvoices, invoiceRequested } from './supabase/functions/_shared/invoiceRequest.ts'; export { invoiceRequestState } from './src/expedile/domain/invoiceRequest.js';",
    resolveDir: path.resolve(__dirname, '../..'), loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' });
  const module = { exports: {} };
  vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports });
  loaded = module.exports;
  return loaded;
}
const row = (id, values = {}) => ({ id, duplicate_of_facture_id: null, replaces_facture_id: null, rejet_motif: null, valide: false, ...values });
// Stored factures rows of one dossier and the expected answer of queue_message's invoice_requested.
const CASES = [
  ['no invoice yet', [], true],
  ['an invoice received, still to verify', [row('a')], false],
  ['a validated invoice', [row('a', { valide: true })], false],
  ['the only invoice is rejected', [row('a', { rejet_motif: 'Illisible' })], true],
  ['a rejected invoice next to a validated one', [row('a', { valide: true }), row('b', { rejet_motif: 'Page manquante' })], true],
  ['a rejected invoice replaced by its correction', [row('a', { rejet_motif: 'Illisible' }), row('b', { replaces_facture_id: 'a' })], false],
  ['a correction that is itself rejected', [row('a', { rejet_motif: 'Illisible' }), row('b', { replaces_facture_id: 'a', rejet_motif: 'Encore illisible' })], true],
  ['a retired rejected copy of a valid invoice', [row('a', { valide: true }), row('b', { duplicate_of_facture_id: 'a', rejet_motif: 'Copie' })], false],
  ['only a retired copy', [row('b', { duplicate_of_facture_id: 'a' })], true],
  ['an invoice replaced by a retired copy', [row('a'), row('b', { duplicate_of_facture_id: 'a', replaces_facture_id: 'a' })], true],
];

test('the server rule answers like queue_message’s invoice_requested', async () => {
  const { invoiceRequested } = await rules();
  for (const [label, rows, expected] of CASES) assert.equal(invoiceRequested(rows), expected, label);
  assert.equal(invoiceRequested(null), true, 'no rows: the invoice is requested');
  assert.equal(invoiceRequested(undefined), true, 'no rows: the invoice is requested');
  // SQL « rejet_motif IS NOT NULL »: an empty motive is still a rejection; only null or absent is not.
  assert.equal(invoiceRequested([row('a', { rejet_motif: '' })]), true, 'an empty rejection motive is a rejection, as in SQL');
  assert.equal(invoiceRequested([{ id: 'a' }]), false, 'absent columns read as SQL NULL');
});

test('current invoices exclude retired copies and replaced invoices, in their order', async () => {
  const { currentInvoices } = await rules();
  const rows = [row('a', { rejet_motif: 'Illisible' }), row('b', { replaces_facture_id: 'a' }), row('c'), row('d', { duplicate_of_facture_id: 'c' })];
  assert.deepEqual(currentInvoices(rows).map(invoice => invoice.id), ['b', 'c']);
  assert.deepEqual(currentInvoices([null, row('e')]).map(invoice => invoice.id), ['e'], 'missing rows are ignored');
  assert.deepEqual([...currentInvoices('not a list')], [], 'anything but a list reads as no invoice');
});

test('the server rule and the portal rule agree on stored rows', async () => {
  const { invoiceRequested, invoiceRequestState } = await rules();
  for (const [label, rows] of CASES) assert.equal(invoiceRequestState({ factures: rows }).requested, invoiceRequested(rows), label);
});
