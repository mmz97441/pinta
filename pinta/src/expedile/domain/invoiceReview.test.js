import test from 'node:test';
import assert from 'node:assert/strict';
import { invoicesAwaitingReview, invoiceReviewLabel, invoiceReviewUrl } from './invoiceReview.js';

const pending = { id: 'invoice-new', fichier: 'dossier/achat.pdf', valide: false };
const dossier = { id: 'dossier', ref: 'EXP-TEST', statut: 'autorise', factures: [pending] };

test('an invoice stays pending after the message is read or the conversation is treated', () => {
  for (const lu of [false, true]) for (const conversationStatut of ['a_traiter', 'termine']) {
    assert.deepEqual(invoicesAwaitingReview({ ...dossier, conversationStatut, messages: [{ type: 'client', lu }] }), [pending]);
  }
});

test('received invoices exclude missing files, rejected and validated documents', () => {
  const factures = [pending, { ...pending, id: 'approved', valide: true }, { ...pending, id: 'rejected', rejetMotif: 'Illisible' }, { id: 'empty', fichier: '  ' }];
  assert.deepEqual(invoicesAwaitingReview({ ...dossier, factures }), [pending]);
  assert.deepEqual(invoicesAwaitingReview({ ...dossier, factures: [{ ...pending, valide: true }] }), []);
  assert.deepEqual(invoicesAwaitingReview({ ...dossier, factures: [], messages: [{ attachmentPath: 'unknown.pdf' }] }), []);
});

test('a corrected invoice replaces the previous document in the review count', () => {
  const correction = { ...pending, id: 'correction', fichier: 'dossier/corrige.pdf', replacesFactureId: pending.id };
  assert.deepEqual(invoicesAwaitingReview({ ...dossier, factures: [pending, correction] }), [correction]);
  assert.deepEqual(invoicesAwaitingReview({ ...dossier, factures: [pending, { ...correction, valide: true }] }), []);
});

test('paid, archived and completed dossiers do not ask for an unavailable review', () => {
  for (const changes of [{ archive: true }, { paiementDate: '2026-09-14' }, ...['paye', 'expedie', 'livre', 'annule'].map(statut => ({ statut }))]) {
    assert.deepEqual(invoicesAwaitingReview({ ...dossier, ...changes }), []);
  }
});

test('indicator links target the pending invoice and preserve the work filters', () => {
  const value = { ...dossier, factures: [{ ...pending, id: 'approved', valide: true }, pending] };
  const url = new URL(invoiceReviewUrl(value, '/?mission=documents&section=pool'), 'https://example.test');
  assert.equal(url.pathname, '/colis/dossier');
  assert.equal(url.searchParams.get('invoice'), pending.id);
  assert.equal(url.searchParams.get('returnTo'), '/?mission=documents&section=pool');
  assert.equal(url.hash, '#quote-documents');
  assert.equal(invoiceReviewUrl({ ...dossier, factures: [] }), null);
  assert.equal(new URL(invoiceReviewUrl(value, '//untrusted.test'), url.origin).searchParams.get('returnTo'), '/colis');
  assert.equal(invoiceReviewLabel(1), 'Facture reçue · À vérifier');
  assert.equal(invoiceReviewLabel(2), '2 factures reçues · À vérifier');
});

test('the indicator link targets the workspace’s next invoice, in arrival order, not in id order', async () => {
  const { invoiceBuckets, invoiceNumbering } = await import('./invoiceProgress.js');
  // Fetched in id order (fetchAllRows); arrival order differs.
  const factures = [
    { id: 'a1', createdAt: '2026-09-12T09:00:00Z', fichier: 'd/a1.pdf', valide: false },
    { id: 'b2', createdAt: '2026-09-09T09:00:00Z', fichier: 'd/b2.pdf', valide: true, montant: 12 },
    { id: 'c3', createdAt: '2026-09-10T09:00:00Z', fichier: 'd/c3.pdf', valide: false },
  ];
  const value = { ...dossier, factures };
  assert.deepEqual(invoicesAwaitingReview(value).map(invoice => invoice.id), ['c3', 'a1']);
  const target = new URL(invoiceReviewUrl(value), 'https://example.test').searchParams.get('invoice');
  assert.equal(target, invoiceBuckets(factures).next.id);
  assert.equal(invoiceNumbering(factures)[target].n, 2);
});
