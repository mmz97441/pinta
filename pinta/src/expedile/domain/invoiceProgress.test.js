import test from 'node:test';
import assert from 'node:assert/strict';
import { currentInvoices } from './invoiceDocuments.js';
import {
  orderInvoices, numberedInvoices, invoiceNumbering, invoiceBuckets, invoiceState,
  invoiceIdentity, invoiceStateLabel, invoiceOcrNote, MISSING_SUPPLIER,
  invoiceProgressSummary, reviewQueue,
} from './invoiceProgress.js';

// UUIDs deliberately sort in the reverse of arrival (created_at) order.
const first = { id: 'f3c0a7e2-0000-4000-8000-000000000003', createdAt: '2026-09-01T08:00:00+00:00', fichier: 'p/a.pdf', fichierNom: 'achat-verifie.pdf', vendeur: 'Boulanger', montant: 20.8, valide: true };
const second = { id: 'b71d9f10-0000-4000-8000-000000000002', createdAt: '2026-09-02T08:00:00Z', fichier: 'p/b.pdf', fichierNom: 'deuxieme.pdf', vendeur: 'Fnac', montant: 10, valide: true };
const copy = { id: '0a11ce00-0000-4000-8000-000000000001', createdAt: '2026-09-03T08:00:00Z', fichier: 'p/c.pdf', fichierNom: '4_5855.pdf', vendeur: 'Document à vérifier', montant: 0, valide: false, duplicateOfId: first.id };

const shuffle = list => [...list].sort((a, b) => a.id.localeCompare(b.id));
const reversed = list => [...list].reverse();
const oldDocumentsComplete = (invoices, pendingAttachments = 0) => {
  const activeInvoices = currentInvoices(invoices);
  return activeInvoices.length > 0 && activeInvoices.every(invoice => invoice.valide && !invoice.rejetMotif && invoice.fichier && invoice.montant > 0) && !pendingAttachments;
};
const numbers = (numbering, ids) => ids.map(id => numbering[id]);

test('orderInvoices follows arrival, then id, with undated documents last', () => {
  const undatedB = { id: 'b-undated' };
  const undatedA = { id: 'a-undated' };
  const sameTimeZ = { id: 'zz', createdAt: '2026-09-01T08:00:00Z' };
  const input = [undatedB, copy, sameTimeZ, second, undatedA, first];
  const ordered = orderInvoices(input).map(invoice => invoice.id);
  assert.deepEqual(ordered, [first.id, 'zz', second.id, copy.id, 'a-undated', 'b-undated'], 'Equal instants with different offsets tie-break by id.');
  assert.deepEqual(input[0], undatedB, 'The input array is not reordered in place.');
  assert.deepEqual(orderInvoices(null), []);
  assert.deepEqual(orderInvoices([{ id: 'x', created_at: '2026-09-02' }, { id: 'y', created_at: '2026-09-01' }]).map(item => item.id), ['y', 'x'], 'Raw rows are understood.');
});

test('UUID-shuffled input gives the same numbering as arrival order', () => {
  const arrival = [first, second, copy];
  const expected = invoiceNumbering(arrival);
  assert.notDeepEqual(shuffle(arrival).map(item => item.id), arrival.map(item => item.id), 'The fixture UUID order differs from arrival order.');
  assert.deepEqual(invoiceNumbering(shuffle(arrival)), expected);
  assert.deepEqual(invoiceNumbering(reversed(arrival)), expected);
  assert.deepEqual(numbers(expected, [first.id, second.id]), [{ n: 1, total: 2, kind: 'counted' }, { n: 2, total: 2, kind: 'counted' }]);
  assert.deepEqual(numberedInvoices(shuffle(arrival)).map(item => item.id), [first.id, second.id]);
});

test('duplicates and replaced documents never shift n or N', () => {
  const base = invoiceNumbering([first, second]);
  const replaced = { id: '00-old', createdAt: '2026-08-31T08:00:00Z', fichier: 'p/old.pdf', fichierNom: 'ancienne.pdf', valide: false };
  const replacement = { id: 'ff-new', createdAt: '2026-09-05T08:00:00Z', fichier: 'p/new.pdf', fichierNom: 'nouvelle.pdf', valide: false, replacesFactureId: replaced.id };
  const earlyCopy = { ...copy, id: '00-copy', createdAt: '2026-08-01T08:00:00Z', duplicateOfId: second.id };
  const numbering = invoiceNumbering(shuffle([first, second, copy, earlyCopy, replaced, replacement]));
  assert.equal(numbering[first.id].n, base[first.id].n + 1, 'Only the replacement chain (arrived first) moves the others.');
  assert.equal(numbering[replacement.id].n, 1);
  assert.equal(numbering[first.id].total, 3);
  const withoutChain = invoiceNumbering(shuffle([first, second, copy, earlyCopy]));
  assert.deepEqual(numbers(withoutChain, [first.id, second.id]), numbers(base, [first.id, second.id]), 'Copies arriving earlier never take a number.');
  assert.deepEqual(withoutChain[copy.id], { n: null, total: 2, kind: 'duplicate', copyOf: 1 });
  assert.deepEqual(withoutChain[earlyCopy.id], { n: null, total: 2, kind: 'duplicate', copyOf: 2 });
  assert.deepEqual(numbering[replaced.id], { n: null, total: 3, kind: 'replaced', versionOf: 1 });
});

test('a replacement keeps the number of its chain root', () => {
  const root = { id: 'zz-root', createdAt: '2026-09-01T07:00:00Z', fichier: 'p/r.pdf', rejetMotif: 'Page manquante' };
  const middle = { id: 'aa-middle', createdAt: '2026-09-04T07:00:00Z', fichier: 'p/m.pdf', replacesFactureId: root.id };
  const latest = { id: 'mm-latest', createdAt: '2026-09-06T07:00:00Z', fichier: 'p/l.pdf', replacesFactureId: middle.id };
  const other = { ...second, createdAt: '2026-09-03T07:00:00Z' };
  const numbering = invoiceNumbering(shuffle([latest, other, middle, root]));
  assert.deepEqual(numbering[latest.id], { n: 1, total: 2, kind: 'counted' }, 'The latest version keeps the root number although it arrived last.');
  assert.deepEqual(numbering[other.id], { n: 2, total: 2, kind: 'counted' });
  assert.deepEqual(numbering[root.id], { n: null, total: 2, kind: 'replaced', versionOf: 1 });
  assert.deepEqual(numbering[middle.id], { n: null, total: 2, kind: 'replaced', versionOf: 1 });
  const replacedCopy = { ...copy, id: 'copy-of-replaced', duplicateOfId: root.id };
  assert.equal(invoiceNumbering([root, middle, latest, replacedCopy])[replacedCopy.id].copyOf, null, 'A copy of a document no longer counted has no number to point to.');
  const cyclic = [{ id: 'x', replacesFactureId: 'y', fichier: 'f' }, { id: 'y', replacesFactureId: 'x', fichier: 'f' }];
  assert.doesNotThrow(() => invoiceNumbering(cyclic), 'Corrupt chains never loop.');
  const withdrawn = { ...latest, duplicateOfId: other.id };
  assert.equal(invoiceNumbering([root, middle, withdrawn, other])[middle.id].versionOf, null, 'A chain ending on a removed copy has no current version.');
});

test('rejected invoices count in N and in toCorrect, never in the verified total', () => {
  const rejected = { id: 'rej', createdAt: '2026-09-02T09:00:00Z', fichier: 'p/r.pdf', fichierNom: 'refusee.pdf', vendeur: 'Darty', montant: 99, valide: false, rejetMotif: 'Illisible' };
  const legacyRejected = { ...rejected, id: 'rej-legacy', createdAt: '2026-09-02T10:00:00Z', valide: true, montant: 50 };
  const unverified = { id: 'todo', createdAt: '2026-09-02T11:00:00Z', fichier: 'p/t.pdf', montant: 70, valide: false };
  const buckets = invoiceBuckets(shuffle([first, second, copy, rejected, legacyRejected, unverified]));
  assert.equal(buckets.total, 5);
  assert.equal(invoiceNumbering([first, rejected])[rejected.id].n, 2);
  assert.deepEqual(buckets.toCorrect.map(item => item.id), ['rej', 'rej-legacy']);
  assert.deepEqual(buckets.verified.map(item => item.id), [first.id, second.id]);
  assert.deepEqual(buckets.toVerify.map(item => item.id), ['todo']);
  assert.equal(buckets.verifiedTotalHT, 30.8);
  assert.deepEqual(buckets.duplicates.map(item => item.id), [copy.id]);
  assert.deepEqual(buckets.replaced, []);
  assert.equal(buckets.complete, false);
  const all = [...buckets.toVerify, ...buckets.missingFile, ...buckets.toCorrect, ...buckets.verified];
  assert.equal(new Set(all.map(item => item.id)).size, buckets.total, 'Buckets are exclusive and cover every counted invoice.');
});

test('complete matches the previous documentsComplete rule on every fixture', () => {
  const noFileValid = { ...second, id: 'nofile', fichier: null };
  const zeroAmountValid = { ...second, id: 'zero', montant: 0 };
  const rejectedValid = { ...second, id: 'rejected', rejetMotif: 'Mauvais document' };
  const pendingReview = { ...second, id: 'pending', valide: false, montant: 0 };
  const replacedRoot = { ...second, id: 'root', valide: false, montant: 0 };
  const validReplacement = { ...first, id: 'replacement', replacesFactureId: 'root' };
  const fixtures = [
    [[]],
    [[copy]],
    [[first]],
    [[first, second]],
    [[first, copy]],
    [[first, second, copy]],
    [[first, second], 1],
    [[first, second], ['message']],
    [[first, noFileValid]],
    [[first, zeroAmountValid]],
    [[first, rejectedValid]],
    [[first, pendingReview]],
    [[replacedRoot, validReplacement]],
    [[{ ...replacedRoot, duplicateOfId: first.id }, first]],
    [[{ id: 'source', fichier: 'parcel/source.pdf', montant: 100, valide: true }, { id: 'duplicate', fichier: 'parcel/copy.pdf', montant: 100, valide: false, duplicateOfId: 'source' }]],
  ];
  for (const [invoices, pending = 0] of fixtures) {
    const count = Array.isArray(pending) ? pending.length : pending;
    assert.equal(invoiceBuckets(shuffle(invoices), { pendingAttachments: pending }).complete, oldDocumentsComplete(invoices, count), JSON.stringify(invoices.map(item => item.id)) + ` pending=${count}`);
  }
  assert.equal(invoiceBuckets([first, second]).complete, true);
  assert.equal(invoiceBuckets([]).complete, false);
  assert.equal(invoiceBuckets([first], { pendingAttachments: 2 }).pendingAttachments, 2);
});

test('next follows toVerify, then missingFile, then toCorrect, in numbering order', () => {
  const waiting = { id: 'w', createdAt: '2026-09-01T00:00:00Z', fichier: 'p/w.pdf', rejetMotif: 'Floue' };
  const missing = { id: 'm', createdAt: '2026-09-02T00:00:00Z', fichier: '' };
  const todoLate = { id: 'a', createdAt: '2026-09-04T00:00:00Z', fichier: 'p/a.pdf' };
  const todoEarly = { id: 'z', createdAt: '2026-09-03T00:00:00Z', fichier: 'p/z.pdf' };
  assert.equal(invoiceBuckets(shuffle([waiting, missing, todoLate, todoEarly, first])).next.id, 'z');
  assert.equal(invoiceBuckets([waiting, missing, first]).next.id, 'm');
  assert.equal(invoiceBuckets([waiting, first]).next.id, 'w');
  assert.equal(invoiceBuckets([first, second, copy]).next, null);
  const missingRejected = { ...waiting, fichier: null };
  assert.equal(invoiceState(missingRejected), 'toCorrect', 'A correction asked from the client stays with the client.');
  assert.deepEqual(invoiceBuckets([missing]).missingFile.map(item => item.id), ['m']);
});

test('identity prefers validated data, then labelled suggestions, never the upload placeholder', () => {
  const lines = [{ id: 'l1', factureId: first.id }, { id: 'l2', factureId: first.id }, { id: 'l3', factureId: null }, { id: 'l4', facture_id: second.id }];
  assert.deepEqual(invoiceIdentity({ ...first, valideLe: '2026-09-04T10:00:00Z' }, null, lines), {
    supplier: 'Boulanger', supplierSuggested: false, supplierKnown: true, amount: 20.8, amountSuggested: false,
    receivedAt: first.createdAt, validatedAt: '2026-09-04T10:00:00Z', fileName: 'achat-verifie.pdf', articles: 2,
  });
  const record = { extraction: { id: 'e', status: 'review', vendeur: 'Leroy Merlin', total: 42.5, lines: [] } };
  const suggested = invoiceIdentity(copy, record);
  assert.equal(suggested.supplier, 'Leroy Merlin');
  assert.equal(suggested.supplierSuggested, true);
  assert.equal(suggested.amount, 42.5);
  assert.equal(suggested.amountSuggested, true);
  assert.equal(suggested.articles, 0);
  const unknown = invoiceIdentity(copy, { extraction: { vendeur: 'Document à vérifier', total: 0 } });
  assert.equal(unknown.supplier, MISSING_SUPPLIER);
  assert.equal(unknown.supplier, 'Fournisseur à identifier');
  assert.equal(unknown.supplierKnown, false);
  assert.equal(unknown.supplierSuggested, false);
  assert.equal(unknown.amount, null);
  assert.equal(unknown.amountSuggested, false);
  assert.equal(invoiceIdentity({ id: 'x', vendeur: '  ' }).supplier, 'Fournisseur à identifier');
  assert.equal(invoiceIdentity({ id: 'x', vendeur: 'Document à vérifier', montant: 12 }).amount, 12);
  assert.equal(invoiceIdentity({ id: 'x' }).fileName, '');
  assert.equal(invoiceIdentity({ id: 'x' }).receivedAt, null);
  assert.equal(invoiceIdentity(second, null, lines).articles, 1, 'Raw article rows are understood.');
});

test('D1: a validated invoice ignores any extraction, even a legacy validation without vendor or total', () => {
  const record = { extraction: { id: 'e', status: 'review', vendeur: 'Leroy Merlin', total: 42.5, lines: [] } };
  const legacy = { ...copy, valide: true };
  const identity = invoiceIdentity(legacy, record);
  assert.equal(identity.supplierSuggested, false);
  assert.equal(identity.amountSuggested, false);
  assert.notEqual(identity.supplier, 'Leroy Merlin');
  assert.equal(identity.amount, null);
  assert.deepEqual(invoiceIdentity(legacy, record), invoiceIdentity(legacy, null), 'The extraction changes nothing once validated.');
  assert.equal(invoiceIdentity({ ...copy, valide: false }, record).supplierSuggested, true, 'An unvalidated invoice keeps its proposals.');
});

test('state labels name every case in plain French', () => {
  const replacement = { ...second, id: 'second-v2', replacesFactureId: second.id, valide: false, montant: 0 };
  const list = [first, second, copy, replacement];
  assert.equal(invoiceStateLabel(first, list), 'Vérifiée');
  assert.equal(invoiceStateLabel(replacement, list), 'À vérifier');
  assert.equal(invoiceStateLabel({ ...first, rejetMotif: 'Floue' }, list), 'À corriger par le client');
  assert.equal(invoiceStateLabel({ id: 'nf', fichier: null }, list), 'Document manquant');
  assert.equal(invoiceStateLabel(copy, list), 'Doublon retiré');
  assert.equal(invoiceStateLabel(second, list), 'Ancienne version');
  assert.equal(invoiceStateLabel({ ...first, montant: 0 }, list), 'À vérifier', 'A legacy validation without amount is not shown as verified.');
  assert.equal(invoiceStateLabel({ id: 'r', fichier: 'f', replacedById: 'other' }), 'Ancienne version');
});

test('OCR notes are advisory and silent once the invoice is validated', () => {
  const todo = { id: 't', fichier: 'p/t.pdf', valide: false };
  assert.equal(invoiceOcrNote({ ...todo, ocrStatus: 'pending' }), 'Lecture automatique en cours');
  assert.equal(invoiceOcrNote({ ...todo, ocrStatus: 'review' }, { extraction: { status: 'review' } }), 'Propositions prêtes');
  assert.equal(invoiceOcrNote({ ...todo, ocrStatus: 'review' }), 'Propositions prêtes');
  assert.equal(invoiceOcrNote({ ...todo, ocrStatus: 'failed' }), 'Lecture automatique impossible · saisie manuelle');
  assert.equal(invoiceOcrNote({ ...todo, ocrStatus: 'confirmed' }), '');
  assert.equal(invoiceOcrNote(todo, { extraction: null }), '');
  assert.equal(invoiceOcrNote({ ...first, ocrStatus: 'failed' }, { extraction: { status: 'review' } }), '');
  assert.equal(invoiceOcrNote(null), '');
  assert.equal(invoiceOcrNote({ ...todo, ocrStatus: 'pending' }, { analysisAllowed: false, analysisBlockedReason: 'frozen', extraction: null }), '', 'A frozen dossier never says the reading is in progress');
  assert.equal(invoiceOcrNote({ ...todo, ocrStatus: 'review' }, { analysisAllowed: false, extraction: null }), '');
});

test('no « Propositions prêtes » beside a client correction or a missing document', () => {
  const extraction = { extraction: { status: 'review', vendeur: 'Boutique C', total: 12 } };
  const rejectedInvoice = { id: 'r', fichier: 'p/r.pdf', valide: false, ocrStatus: 'review', rejetMotif: 'Document illisible' };
  assert.equal(invoiceStateLabel(rejectedInvoice), 'À corriger par le client');
  assert.equal(invoiceOcrNote(rejectedInvoice, extraction), '', 'The pill says the client must act; the row must not say proposals are ready.');
  assert.equal(invoiceOcrNote({ ...rejectedInvoice, rejetMotif: null, rejet_motif: 'Floue' }, extraction), '');
  const noFile = { id: 'n', fichier: null, valide: false, ocrStatus: 'review' };
  assert.equal(invoiceStateLabel(noFile), 'Document manquant');
  assert.equal(invoiceOcrNote(noFile, extraction), '');
  assert.equal(invoiceOcrNote({ ...noFile, ocrStatus: 'pending' }), '');
});

test('a validated legacy row without amount counts as « à vérifier » but is never a navigation target', () => {
  const legacy = { id: 'legacy', createdAt: '2026-09-01T00:00:00Z', fichier: 'p/l.pdf', valide: true, montant: 0 };
  const todo = { id: 'todo', createdAt: '2026-09-02T00:00:00Z', fichier: 'p/t.pdf', valide: false };
  const buckets = invoiceBuckets([legacy, todo]);
  assert.deepEqual(buckets.toVerify.map(item => item.id), ['legacy', 'todo'], 'Still not counted as verified.');
  assert.equal(buckets.complete, false);
  assert.equal(buckets.next.id, 'todo', 'The next step skips a row whose editor is closed.');
  assert.deepEqual(reviewQueue(buckets).map(item => item.id), ['todo']);
  assert.equal(invoiceBuckets([legacy]).next, null);
  assert.deepEqual(reviewQueue(invoiceBuckets([legacy, { id: 'nofile', createdAt: '2026-09-03T00:00:00Z' }])).map(item => item.id), ['nofile']);
});

test('a copy whose original was replaced names the invoice that replaced it', () => {
  const original = { id: 'a', createdAt: '2026-09-01T00:00:00Z', fichier: 'p/a.pdf', valide: true, montant: 10 };
  const replacement = { id: 'b', createdAt: '2026-09-02T00:00:00Z', fichier: 'p/b.pdf', valide: false, replacesFactureId: 'a' };
  const duplicate = { id: 'd', createdAt: '2026-09-03T00:00:00Z', fichier: 'p/d.pdf', valide: false, duplicateOfId: 'a' };
  const numbering = invoiceNumbering([duplicate, replacement, original]);
  assert.deepEqual(numbering.d, { n: null, total: 1, kind: 'duplicate', copyOf: null, copyOfVersion: 1 });
  assert.deepEqual(invoiceNumbering([{ ...duplicate, duplicateOfId: 'gone' }]).d, { n: null, total: 0, kind: 'duplicate', copyOf: null, copyOfVersion: null });
});

test('one progress wording for the workspace and the dossier overview', () => {
  const todo = { id: 't', createdAt: '2026-09-03T00:00:00Z', fichier: 'p/t.pdf', valide: false };
  const rejected = { id: 'r', createdAt: '2026-09-04T00:00:00Z', fichier: 'p/r.pdf', valide: false, rejetMotif: 'Floue' };
  const missing = { id: 'm', createdAt: '2026-09-05T00:00:00Z' };
  assert.deepEqual(invoiceProgressSummary(invoiceBuckets([first, second, todo, rejected, missing, copy])), {
    headline: '2 sur 5 factures vérifiées', remaining: ['1 à vérifier', '1 à corriger par le client', '1 document manquant'],
    text: '2 sur 5 factures vérifiées · 1 à vérifier · 1 à corriger par le client · 1 document manquant',
  });
  assert.equal(invoiceProgressSummary(invoiceBuckets([first, second, copy])).text, '2 factures · toutes vérifiées');
  assert.equal(invoiceProgressSummary(invoiceBuckets([first])).text, '1 facture · vérifiée');
  assert.equal(invoiceProgressSummary(invoiceBuckets([todo])).text, '0 sur 1 facture vérifiée · 1 à vérifier');
  assert.equal(invoiceProgressSummary(invoiceBuckets([])).text, 'Aucune facture reçue');
  assert.equal(invoiceProgressSummary(invoiceBuckets([], { pendingAttachments: 2 })).text, 'Aucune facture enregistrée · 2 documents reçus à trier');
  assert.equal(invoiceProgressSummary(invoiceBuckets([first], { pendingAttachments: 1 })).text, '1 sur 1 facture vérifiée · 1 document reçu à trier');
});
