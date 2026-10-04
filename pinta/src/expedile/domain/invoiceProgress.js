import { currentInvoices } from './invoiceDocuments.js';

/**
 * One reading of a dossier's purchase invoices, shared by every screen that
 * lists them. Invoices are ordered by arrival (createdAt, then id), only the
 * counted documents (currentInvoices: no removed copy, no replaced document,
 * rejected ones included) are numbered 1..N, and a corrected document keeps
 * the number of the invoice it replaces. Pure: no React, no I/O.
 */

const PLACEHOLDER_VENDOR = 'Document à vérifier';
export const MISSING_SUPPLIER = 'Fournisseur à identifier';

const duplicateOf = invoice => invoice?.duplicateOfId || invoice?.duplicate_of_facture_id || null;
const replacesId = invoice => invoice?.replacesFactureId || invoice?.replaces_facture_id || null;
const rejected = invoice => Boolean(invoice?.rejetMotif || invoice?.rejet_motif);
const fileOf = invoice => String(invoice?.fichier || invoice?.fichierUrl || invoice?.fichier_url || '').trim();
const amountOf = invoice => {
  const value = Number(invoice?.montant);
  return Number.isFinite(value) ? value : 0;
};
const time = invoice => {
  const value = invoice?.createdAt || invoice?.created_at;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const compareId = (a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
const roundMoney = value => Math.round(value * 100) / 100;
const realVendor = value => {
  const text = String(value || '').trim();
  return text && text !== PLACEHOLDER_VENDOR ? text : '';
};

/** Arrival order: createdAt ascending, then id; undated documents last (by id). */
export function orderInvoices(list = []) {
  return [...(list || [])].filter(Boolean).sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    if (ta === null && tb !== null) return 1;
    if (tb === null && ta !== null) return -1;
    return compareId(a, b);
  });
}

function chainRoot(invoice, byId) {
  let root = invoice;
  const seen = new Set([invoice.id]);
  for (let parent = byId.get(replacesId(root)); parent && !seen.has(parent.id); parent = byId.get(replacesId(root))) {
    seen.add(parent.id);
    root = parent;
  }
  return root;
}

/** Counted invoices in numbering order (chain root arrival, then own arrival). */
export function numberedInvoices(list = []) {
  const ordered = orderInvoices(list);
  const position = new Map(ordered.map((invoice, index) => [invoice.id, index]));
  const byId = new Map(ordered.map(invoice => [invoice.id, invoice]));
  return orderInvoices(currentInvoices(ordered))
    .map(invoice => ({ invoice, root: position.get(chainRoot(invoice, byId).id), own: position.get(invoice.id) }))
    .sort((a, b) => a.root - b.root || a.own - b.own)
    .map(item => item.invoice);
}

/**
 * Map invoice id → numbering entry:
 *  - counted:   { n, total, kind: 'counted' }
 *  - duplicate: { n: null, total, kind: 'duplicate', copyOf }  (n of its original when counted, else null
 *               and copyOfVersion: n of the invoice that replaced that original, when any)
 *  - replaced:  { n: null, total, kind: 'replaced', versionOf } (n of its current replacement, else null)
 * total is N, the number of counted invoices.
 */
export function invoiceNumbering(list = []) {
  const ordered = orderInvoices(list);
  const counted = numberedInvoices(ordered);
  const total = counted.length;
  const numbers = new Map(counted.map((invoice, index) => [invoice.id, index + 1]));
  const byId = new Map(ordered.map(invoice => [invoice.id, invoice]));
  const replacements = new Map();
  for (const invoice of ordered) {
    const parent = replacesId(invoice);
    if (parent) (replacements.get(parent) || replacements.set(parent, []).get(parent)).push(invoice);
  }
  const currentVersion = invoice => {
    const seen = new Set();
    const queue = [invoice];
    while (queue.length) {
      const item = queue.shift();
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      if (item !== invoice && numbers.has(item.id)) return numbers.get(item.id);
      queue.push(...(replacements.get(item.id) || []));
      const forward = item.replacedById || item.replaced_by_id;
      if (forward) queue.push(byId.get(forward));
    }
    return null;
  };
  const result = {};
  for (const invoice of ordered) {
    if (numbers.has(invoice.id)) result[invoice.id] = { n: numbers.get(invoice.id), total, kind: 'counted' };
    else if (duplicateOf(invoice)) {
      const copyOf = numbers.get(duplicateOf(invoice)) ?? null;
      // Original later replaced (e.g. by a client correction): name the counted
      // invoice that now stands for it, so the copy is never « facture  ».
      result[invoice.id] = copyOf !== null ? { n: null, total, kind: 'duplicate', copyOf }
        : { n: null, total, kind: 'duplicate', copyOf: null, copyOfVersion: byId.has(duplicateOf(invoice)) ? currentVersion(byId.get(duplicateOf(invoice))) : null };
    }
    else result[invoice.id] = { n: null, total, kind: 'replaced', versionOf: currentVersion(invoice) };
  }
  return result;
}

/**
 * State key of one invoice, consistent with invoiceBuckets:
 * 'duplicate' | 'replaced' | 'toCorrect' | 'missingFile' | 'verified' | 'toVerify'.
 * A rejected invoice waits on the client even if its file is gone; a validated
 * invoice without a positive amount is not counted as verified (legacy rows).
 */
export function invoiceState(invoice, list = []) {
  if (!invoice) return 'toVerify';
  if (duplicateOf(invoice)) return 'duplicate';
  if (invoice.replacedById || invoice.replaced_by_id || (list || []).some(other => other && replacesId(other) === invoice.id)) return 'replaced';
  if (rejected(invoice)) return 'toCorrect';
  if (!fileOf(invoice)) return 'missingFile';
  if (invoice.valide && amountOf(invoice) > 0) return 'verified';
  return 'toVerify';
}

const STATE_LABELS = {
  verified: 'Vérifiée',
  toVerify: 'À vérifier',
  toCorrect: 'À corriger par le client',
  missingFile: 'Document manquant',
  duplicate: 'Doublon retiré',
  replaced: 'Ancienne version',
};

export function invoiceStateLabel(invoice, list = []) {
  return STATE_LABELS[invoiceState(invoice, list)];
}

function pendingCount(value) {
  if (Array.isArray(value)) return value.length;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

/**
 * Exclusive buckets over the N counted invoices (each array in numbering order).
 * complete is today's documentsComplete rule: N ≥ 1, every counted invoice
 * validated with a file, no rejection and a positive amount, and no
 * conversation attachment left to sort. next = first toVerify (not already
 * marked validated, see reviewQueue), then missingFile, then toCorrect.
 */
export function invoiceBuckets(list = [], { pendingAttachments = 0 } = {}) {
  const ordered = orderInvoices(list);
  const counted = numberedInvoices(ordered);
  const countedIds = new Set(counted.map(invoice => invoice.id));
  const buckets = { toVerify: [], missingFile: [], toCorrect: [], verified: [] };
  for (const invoice of counted) buckets[invoiceState(invoice, ordered)].push(invoice);
  const pending = pendingCount(pendingAttachments);
  const total = counted.length;
  return {
    counted,
    total,
    ...buckets,
    duplicates: ordered.filter(invoice => !countedIds.has(invoice.id) && duplicateOf(invoice)),
    replaced: ordered.filter(invoice => !countedIds.has(invoice.id) && !duplicateOf(invoice)),
    pendingAttachments: pending,
    verifiedTotalHT: roundMoney(buckets.verified.reduce((sum, invoice) => sum + amountOf(invoice), 0)),
    complete: total >= 1 && buckets.verified.length === total && pending === 0,
    next: reviewQueue(buckets)[0] || buckets.toCorrect[0] || null,
  };
}

/**
 * Invoices a person can open and verify now, in numbering order: those to
 * verify, then those whose document is missing. A legacy row already marked
 * validated but without a positive amount still counts as « à vérifier », yet
 * is not a navigation target: its editor is closed and nothing new is expected.
 */
export function reviewQueue(buckets) {
  return [...(buckets?.toVerify || []).filter(invoice => !invoice.valide), ...(buckets?.missingFile || [])];
}

const countOf = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * The same progress wording for every screen (workspace header, dossier
 * overview): { headline, remaining[] }.
 *  - work:     « 3 sur 8 factures vérifiées » + « 3 à vérifier », « 1 à corriger par le client »…
 *  - complete: « 2 factures · toutes vérifiées » (« 1 facture · vérifiée »)
 *  - none:     « Aucune facture reçue »
 */
export function invoiceProgressSummary(buckets) {
  const total = buckets?.total || 0;
  const remaining = [
    buckets?.toVerify?.length && `${buckets.toVerify.length} à vérifier`,
    buckets?.toCorrect?.length && `${buckets.toCorrect.length} à corriger par le client`,
    buckets?.missingFile?.length && countOf(buckets.missingFile.length, 'document manquant', 'documents manquants'),
    buckets?.pendingAttachments && countOf(buckets.pendingAttachments, 'document reçu à trier', 'documents reçus à trier'),
  ].filter(Boolean);
  const headline = !total ? (buckets?.pendingAttachments ? 'Aucune facture enregistrée' : 'Aucune facture reçue')
    : buckets.complete ? `${countOf(total, 'facture', 'factures')} · ${total === 1 ? 'vérifiée' : 'toutes vérifiées'}`
    : `${buckets.verified.length} sur ${total} ${total === 1 ? 'facture vérifiée' : 'factures vérifiées'}`;
  return { headline, remaining, text: [headline, ...remaining].join(' · ') };
}

/**
 * What identifies an invoice to a person. record is the review context entry
 * ({ extraction }) when loaded; lines are the dossier's articles (sel.lignes).
 */
export function invoiceIdentity(invoice, record = null, lines = []) {
  const extraction = record?.extraction || null;
  const confirmedVendor = realVendor(invoice?.vendeur);
  const suggestedVendor = confirmedVendor ? '' : realVendor(extraction?.vendeur);
  const amount = amountOf(invoice);
  const suggestedAmount = Number(extraction?.total);
  const amountValue = amount > 0 ? amount : Number.isFinite(suggestedAmount) && suggestedAmount > 0 ? suggestedAmount : null;
  return {
    supplier: confirmedVendor || suggestedVendor || MISSING_SUPPLIER,
    supplierSuggested: Boolean(suggestedVendor),
    supplierKnown: Boolean(confirmedVendor || suggestedVendor),
    amount: amountValue,
    amountSuggested: !(amount > 0) && amountValue !== null,
    receivedAt: invoice?.createdAt || invoice?.created_at || null,
    validatedAt: invoice?.valideLe || invoice?.valide_le || null,
    fileName: invoice?.fichierNom || invoice?.fichier_nom || '',
    articles: (lines || []).filter(line => line && (line.factureId || line.facture_id) === invoice?.id).length,
  };
}

/**
 * Short advisory note on automatic reading. Empty once the invoice is
 * validated, while it waits on the client's correction, or when its document
 * is missing: proposals are not the next thing to look at in those states.
 */
export function invoiceOcrNote(invoice, record = null) {
  if (!invoice || invoice.valide || rejected(invoice) || !fileOf(invoice)) return '';
  const status = invoice.ocrStatus || invoice.ocr_status || '';
  const extraction = record?.extraction || null;
  if (status === 'pending') return 'Lecture automatique en cours';
  if ((extraction && extraction.status !== 'confirmed') || (!extraction && status === 'review')) return 'Propositions prêtes';
  if (status === 'failed') return 'Lecture automatique impossible · saisie manuelle';
  return '';
}
