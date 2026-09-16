import test from 'node:test';
import assert from 'node:assert/strict';
import { currentInvoices, excludedInvoiceIds } from './invoiceDocuments.js';
import { invoicesAwaitingReview } from './invoiceReview.js';
import { calculateQuote } from './quote.js';
import { needsDocuments, nextAction } from './workQueues.js';
import { clientWorkState } from './clientJourney.js';

const invoice = { id: 'source', fichier: 'parcel/source.pdf', montant: 100, valide: true };
const copy = { id: 'duplicate', fichier: 'parcel/copy.pdf', montant: 100, valide: false, duplicateOfId: invoice.id };
const dossier = { id: 'parcel', statut: 'en_preparation', factures: [invoice, copy] };

test('classified copies stay in the source data but leave pending review and staff work', () => {
  const before = structuredClone(dossier);
  assert.deepEqual(currentInvoices(dossier.factures), [invoice]);
  assert.deepEqual(invoicesAwaitingReview(dossier), []);
  assert.equal(needsDocuments(dossier, { type: 'particulier' }), false);
  assert.equal(nextAction(dossier, { type: 'particulier' }), 'Finaliser le devis');
  assert.deepEqual(dossier, before);
});

test('restoring a copy to review makes it actionable again without losing its document', () => {
  const restored = { ...copy, duplicateOfId: null };
  const value = { ...dossier, factures: [invoice, restored] };
  assert.deepEqual(invoicesAwaitingReview(value), [restored]);
  assert.equal(needsDocuments(value, { type: 'particulier' }), true);
});

test('both mapped and raw duplicate metadata are understood', () => {
  const raw = { ...copy, duplicateOfId: undefined, duplicate_of_facture_id: invoice.id };
  assert.deepEqual(currentInvoices([invoice, raw]), [invoice]);
  assert.deepEqual([...excludedInvoiceIds([invoice, raw])], [raw.id]);
});

test('a replacement chain leaves only its latest document active even with legacy validation', () => {
  const corrected = { ...invoice, id: 'corrected', replacesFactureId: invoice.id };
  const latest = { ...invoice, id: 'latest', replacesFactureId: corrected.id };
  assert.deepEqual(currentInvoices([invoice, corrected, latest]), [latest]);
  assert.deepEqual([...excludedInvoiceIds([invoice, corrected, latest])], [invoice.id, corrected.id]);
  assert.deepEqual(currentInvoices([invoice, { ...corrected, duplicateOfId: 'another-document' }]), [], 'Classifying a replacement must not silently reactivate its historical source.');
});

test('rejected duplicates or replaced documents never request another client correction', () => {
  assert.equal(clientWorkState({ ...dossier, factures: [invoice, { ...copy, rejetMotif: 'Ancienne demande' }] }).section, 'team');
  const correction = { ...invoice, id: 'corrected', replacesFactureId: invoice.id };
  assert.equal(clientWorkState({ ...dossier, factures: [{ ...invoice, rejetMotif: 'Ancienne demande' }, correction] }).section, 'team');
  assert.equal(clientWorkState({ ...dossier, factures: [{ ...invoice, rejetMotif: 'Page manquante' }] }).action, 'Corriger une facture');
});

test('duplicate and replaced source articles do not inflate the quote, while manual lines remain', () => {
  const replacement = { ...invoice, id: 'replacement', replacesFactureId: invoice.id, montant: 100 };
  const input = {
    colis: { ...dossier, finL: 40, finW: 30, finH: 20, finP: 3,
      factures: [invoice, copy, replacement],
      lignes: [
        { id: 'old', desc: 'Ancien document', qte: 1, prix: 100, cat: 'cat', factureId: invoice.id },
        { id: 'double', desc: 'Copie', qte: 1, prix: 100, cat: 'cat', factureId: copy.id },
        { id: 'current', desc: 'Document actuel', qte: 1, prix: 100, cat: 'cat', factureId: replacement.id },
        { id: 'manual', desc: 'Article à rapprocher', qte: 1, prix: 12, cat: 'cat' },
      ] },
    client: { type: 'particulier' }, destination: { code: '974', tva: 8.5 },
    tarif: { base: 10, parKg: 5 }, categories: [{ id: 'cat', label: 'Divers', taux: { '974': { om: 10, omr: 2.5 } } }],
  };
  const result = calculateQuote(input);
  assert.equal(result.ok, true);
  assert.equal(result.amounts.merchandiseValue, 112);
  assert.deepEqual(result.snapshot.inputs.invoices.map(item => item.id), ['replacement']);
  assert.deepEqual(result.snapshot.inputs.lines.map(item => item.id), ['current', 'manual']);
  assert.ok(result.warnings.some(warning => warning.includes('provenance')));
  assert.equal(input.colis.lignes.length, 4, 'Historical rows are preserved for review, never deleted implicitly.');
});

test('having only an excluded document cannot satisfy the invoice requirement', () => {
  const value = { ...dossier, factures: [copy] };
  assert.equal(needsDocuments(value, { type: 'particulier' }), true);
  assert.deepEqual(invoicesAwaitingReview(value), []);
});
