import { STATUTS } from '../constants/index.js';
import { DOSSIER_TASKS, dossierNextTask } from './dossierTasks.js';
import { receptionCartonManifest, receptionDateSummary, RECEPTION_MEASURES } from './reception.js';
import { hasCurrentPreparation } from './preparationReadiness.js';
import { currentInvoices, pendingInvoiceAttachments } from './invoiceDocuments.js';
import { invoiceBuckets, invoiceProgressSummary } from './invoiceProgress.js';
import { buildDossierTableModel, formatDossierTableDate } from './dossierTable.js';

const DOCUMENT_PERMISSIONS = ['perm_factures_voir', 'perm_factures_ajouter', 'perm_factures_valider', 'perm_factures_refuser', 'perm_factures_ocr', 'perm_factures_modifier_articles'];
const FINANCE_PERMISSIONS = ['perm_finances_voir_total', 'perm_colis_calculer_devis', 'perm_colis_envoyer_devis', 'perm_colis_confirmer_paiement'];
const BEFORE_APPROVAL = new Set(['receptionne', 'mesure', 'attente_feu_vert', 'refuse_client']);
const AFTER_PREPARATION = new Set(['devis_envoye', 'attente_paiement', 'paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre']);
const AFTER_DEPARTURE = new Set(['expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre']);
const positive = value => value != null && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const count = value => Number.isInteger(positive(value)) ? Number(value) : null;
const savedDate = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now ? value : null;
const text = value => typeof value === 'string' ? value.trim() : '';
const totalWeight = boxes => boxes.length && boxes.every(box => box.poids !== null) ? Math.round(boxes.reduce((sum, box) => sum + box.poids, 0) * 100) / 100 : null;
const measureBox = (box, index, detail = {}) => {
  const dimensions = Object.fromEntries(RECEPTION_MEASURES.map(({ key }) => [key, positive(box?.[key])]));
  return { number: index + 1, tracking: text(detail.number) || null, supplier: text(detail.fournisseur) || null, ...dimensions,
    complete: Object.values(dimensions).every(value => value !== null) };
};
const filePresent = invoice => Boolean(text(invoice.fichier || invoice.fichierUrl || invoice.fichier_url || invoice.storagePath));

/** A permanent read-only overview: each completed milestone needs its own
 * evidence. A payment/delivery status never certifies earlier physical work.
 * Selected screen, task ownership and commands deliberately stay outside it. */
export function buildDossierOverview(dossier = {}, { client = {}, envois = [], can = () => false, now = Date.now() } = {}) {
  const documentsVisible = DOCUMENT_PERMISSIONS.some(can);
  const financeVisible = FINANCE_PERMISSIONS.some(can);
  const knownStatus = Object.hasOwn(STATUTS, dossier.statut);
  const closed = dossier.archive || ['annule', 'livre'].includes(dossier.statut);
  const stopped = dossier.archive || dossier.statut === 'annule';
  const stoppedSummary = dossier.archive ? 'Dossier archivé · aucune action attendue' : 'Dossier annulé · aucune action attendue';
  const table = buildDossierTableModel(dossier, { client, envois, can, now });
  const financialFacts = table.payment;
  const fullyPaid = financialFacts.requested !== null && financialFacts.paid > 0 && financialFacts.remaining === 0;
  const currentTask = knownStatus && !closed ? dossierNextTask({ ...dossier,
    paiementDate: fullyPaid ? dossier.paiementDate : null,
    ...(financialFacts.requested === 0 ? { quoteNeedsReview: false } : {}),
  }, () => true, client) : null;

  // Do not manufacture the helper's default "one carton" for an empty record.
  const receiptData = { ...dossier, nbColis: count(dossier.nbColis),
    trackings: Array.isArray(dossier.trackings) ? dossier.trackings : [],
    trackingsDetail: Array.isArray(dossier.trackingsDetail) ? dossier.trackingsDetail.map(detail => detail || {}) : [],
    dimsParColis: Array.isArray(dossier.dimsParColis) ? dossier.dimsParColis : [],
  };
  const receiptKnown = Boolean(receiptData.nbColis || receiptData.trackings.length || receiptData.trackingsDetail.length || receiptData.dimsParColis.length);
  const manifest = receiptKnown ? receptionCartonManifest(receiptData) : null;
  const receptionDates = receptionDateSummary(receiptData, { now });
  const receiptBoxes = manifest ? manifest.dimsParColis.map((box, index) => ({
    ...measureBox(box, index, manifest.trackingsDetail[index]),
    receivedAt: receptionDates.dates[index]?.receivedAt || null,
    receivedAtSource: receptionDates.dates[index]?.source || null,
  })) : [];
  const receiptComplete = receiptBoxes.length > 0 && receiptBoxes.every(box => box.complete);
  const receptionDate = savedDate(dossier.dateReception, now);
  const received = {
    count: manifest?.nbColis ?? null, complete: receiptComplete, totalWeight: totalWeight(receiptBoxes), boxes: receiptBoxes,
    date: receptionDate, latestDate: receptionDates.lastReceivedAt, datesComplete: receptionDates.complete, datedCount: receptionDates.knownCount, datesError: receptionDates.error,
    summary: !receiptKnown ? 'Réception à vérifier' : receiptComplete ? `${manifest.nbColis} carton(s) reçu(s) et mesuré(s)` : `${manifest.nbColis} carton(s) reçu(s) · mesures à compléter`,
  };

  const rawFinal = Array.isArray(dossier.finalPackages) ? dossier.finalPackages
    : dossier.finalPackages == null && [dossier.finL, dossier.finW, dossier.finH, dossier.finP].some(value => positive(value) !== null)
      ? [{ dimL: dossier.finL, dimW: dossier.finW, dimH: dossier.finH, poids: dossier.finP }] : [];
  const finalBoxes = rawFinal.map((box, index) => measureBox(box, index));
  const finalCurrent = hasCurrentPreparation(dossier);
  const finalDraft = finalBoxes.some(box => RECEPTION_MEASURES.some(({ key }) => box[key] !== null));
  const invalidated = finalDraft && dossier.preparationCompositionVersion != null
    && (dossier.finalMeasurementsVersion != null && dossier.finalMeasurementsVersion !== dossier.preparationCompositionVersion
      || dossier.finalMeasurementsVersion == null && dossier.preparationCompositionVersion > 0);
  const optimizationState = finalCurrent ? 'done' : finalDraft ? 'review' : AFTER_PREPARATION.has(dossier.statut) ? 'unknown' : currentTask === 'preparation' ? 'current' : 'upcoming';
  const optimization = {
    current: finalCurrent, state: optimizationState, count: finalCurrent ? dossier.outgoingParcelCount : finalBoxes.length || null,
    totalWeight: totalWeight(finalBoxes), boxes: finalBoxes, savedAt: savedDate(dossier.finalMeasurementsAt, now),
    summary: finalCurrent ? `${dossier.outgoingParcelCount} colis après optimisation · mesures confirmées`
      : invalidated ? 'Anciennes mesures conservées · à vérifier pour les cartons actuels'
      : finalDraft ? 'Mesures enregistrées · validation à vérifier'
      : AFTER_PREPARATION.has(dossier.statut) ? 'Mesures après optimisation non confirmées' : 'Mesures après optimisation à enregistrer',
  };

  const invoiceRows = Array.isArray(dossier.factures) ? dossier.factures : null;
  const activeInvoices = currentInvoices(invoiceRows || []);
  const receivedInvoices = activeInvoices.filter(filePresent);
  const rejectedInvoices = activeInvoices.filter(invoice => text(invoice.rejetMotif || invoice.rejet_motif));
  const validatedInvoices = receivedInvoices.filter(invoice => invoice.valide === true && !text(invoice.rejetMotif || invoice.rejet_motif));
  const reviewInvoices = receivedInvoices.filter(invoice => invoice.valide !== true && !text(invoice.rejetMotif || invoice.rejet_motif));
  const missingFileCount = activeInvoices.filter(invoice => !filePresent(invoice)).length;
  // Same counting and wording as the invoice workspace shown right below
  // (domain/invoiceProgress): « 3 sur 8 factures vérifiées · 3 à vérifier… ».
  // Conversation attachments left to sort count too, exactly as in the
  // workspace: the overview never says « toutes vérifiées » above a workspace
  // that still asks to sort received documents.
  const invoiceBucketsNow = invoiceBuckets(invoiceRows || [], { pendingAttachments: pendingInvoiceAttachments(dossier) });
  const invoicesDone = invoiceRows !== null && invoiceBucketsNow.complete;
  const invoicesOptional = invoiceRows !== null && client.type === 'pro' && activeInvoices.length === 0;
  const invoiceSummary = invoiceRows === null ? 'Factures à actualiser'
    : activeInvoices.length ? invoiceProgressSummary(invoiceBucketsNow).text
    : invoicesOptional ? 'Factures non nécessaires pour ce client professionnel' : 'Aucune facture reçue';
  const invoices = {
    visible: documentsVisible,
    receivedCount: documentsVisible && invoiceRows !== null ? receivedInvoices.length : null,
    validatedCount: documentsVisible && invoiceRows !== null ? validatedInvoices.length : null,
    reviewCount: documentsVisible && invoiceRows !== null ? reviewInvoices.length : null,
    rejectedCount: documentsVisible && invoiceRows !== null ? rejectedInvoices.length : null,
    excludedCount: documentsVisible && invoiceRows !== null ? invoiceRows.length - activeInvoices.length : null,
    missingFileCount: documentsVisible && invoiceRows !== null ? missingFileCount : null,
    summary: documentsVisible ? invoiceSummary : 'Accès réservé aux factures',
  };

  const payment = financeVisible ? { visible: true, ...financialFacts }
    : { visible: false, requested: null, paid: null, remaining: null, sentAt: null, stateLabel: 'Accès réservé aux paiements' };
  const envoi = envois.find(item => item.id === (dossier.envoi || dossier.envoiId));
  const confirmedAt = savedDate(dossier.dateExpedition, now) || savedDate(envoi?.departedAt, now);
  const departureConfirmed = Boolean(confirmedAt || envoi?.manifestVersion > 0);
  const plannedDate = typeof envoi?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(envoi.date)
    && Number.isFinite(Date.parse(`${envoi.date}T00:00:00Z`)) && new Date(`${envoi.date}T00:00:00Z`).toISOString().slice(0, 10) === envoi.date ? envoi.date : null;
  const departure = {
    ...table.departure, date: plannedDate, confirmedAt,
    // A date in planning, an arrival status and a tracking number do not prove
    // this dossier was actually included in a confirmed departure.
    label: departureConfirmed ? 'Départ confirmé' : envoi ? table.departure.label === 'Départ confirmé' ? 'Départ à vérifier' : table.departure.label : dossier.envoi || dossier.envoiId ? 'Départ à vérifier' : 'À planifier',
    readinessLabel: !departureConfirmed && table.departure.readinessLabel === 'Expédition enregistrée' ? 'Départ à vérifier' : table.departure.readinessLabel,
  };
  const deliveryDate = savedDate(dossier.dateLivraison, now);
  const delivery = {
    state: deliveryDate ? 'done' : dossier.statut === 'livre' ? 'unknown' : stopped ? 'not_required' : ['arrive', 'livraison'].includes(dossier.statut) ? 'current' : 'upcoming',
    date: deliveryDate,
    summary: deliveryDate ? 'Livraison confirmée' : dossier.statut === 'livre' ? 'Statut livré · confirmation de livraison à vérifier'
      : stopped ? stoppedSummary : dossier.statut === 'livraison' ? 'Livraison en cours · date à confirmer' : dossier.statut === 'arrive' ? 'Arrivé à destination · livraison à organiser' : 'La date de livraison sera confirmée par l’équipe',
  };

  const consentDate = savedDate(dossier.feuVertDate, now);
  const requestDate = savedDate(dossier.demandeFeuVertEnvoyeeAt, now);
  const oldConsent = dossier.feuVert === 'autorise' && (BEFORE_APPROVAL.has(dossier.statut)
    || consentDate && requestDate && Date.parse(consentDate) < Date.parse(requestDate));
  const approved = dossier.feuVert === 'autorise' && !oldConsent;
  const refused = dossier.feuVert === 'refuse' || dossier.statut === 'refuse_client';
  const waitingDate = savedDate(dossier.attenteClientDate, now);
  const voluntaryWait = dossier.statut === 'attente_feu_vert' && Boolean(waitingDate);
  const consentState = refused || oldConsent ? 'review' : approved ? 'done' : dossier.statut === 'attente_feu_vert' ? 'waiting'
    : currentTask === 'accord' ? 'current' : BEFORE_APPROVAL.has(dossier.statut) ? 'upcoming' : 'unknown';
  const consentSummary = refused ? 'Le client a refusé la préparation' : oldConsent ? 'Accord précédent à renouveler' : approved ? 'Accord du client enregistré'
    : voluntaryWait ? `Le client attend d’autres cartons${dossier.attenteClientUntil && Number.isFinite(Date.parse(dossier.attenteClientUntil)) ? ` · à revoir le ${formatDossierTableDate(dossier.attenteClientUntil)}` : ''}`
    : dossier.statut === 'attente_feu_vert' ? requestDate ? 'Demande enregistrée · réponse du client attendue' : 'Accord attendu · demande à vérifier'
    : dossier.consentRequestVersion > 0 ? 'Nouvelle demande d’accord à préparer' : BEFORE_APPROVAL.has(dossier.statut) ? 'Accord du client à demander' : 'Accord du client non retrouvé';
  const quoteRecorded = financialFacts.requested !== null;
  const quoteSent = quoteRecorded && Boolean(financialFacts.sentAt);
  const quoteHistory = Boolean(dossier.devisEnvoyeLe || dossier.quoteNeedsReview === true);
  const quoteRevised = !quoteRecorded && quoteHistory;
  const quoteDraft = positive(dossier.devisTotal) !== null || Boolean(dossier.devisSnapshot);
  const quoteState = quoteSent ? 'done' : quoteRecorded ? 'unknown' : quoteRevised ? 'review' : quoteDraft || currentTask === 'devis' ? 'current' : AFTER_PREPARATION.has(dossier.statut) ? 'unknown' : 'upcoming';
  const quoteSummary = quoteSent ? 'Devis courant transmis' : quoteRecorded ? 'Devis enregistré · envoi à vérifier' : quoteRevised ? 'Ancien devis retiré · à recalculer et vérifier'
    : quoteDraft ? 'Devis enregistré · à vérifier et envoyer' : AFTER_PREPARATION.has(dossier.statut) ? 'Devis courant à retrouver' : 'Devis à établir après optimisation et vérification des factures';
  const paymentState = financialFacts.stateLabel === 'Payé' ? 'done' : financialFacts.stateLabel.includes('vérifier') ? 'review'
    : financialFacts.requested !== null ? financialFacts.requested === 0 ? 'review' : 'waiting' : currentTask === 'paiement' ? 'unknown' : 'upcoming';

  const facts = {
    reception: { state: receiptComplete ? 'done' : currentTask === 'reception' ? 'current' : receiptKnown && BEFORE_APPROVAL.has(dossier.statut) ? 'current' : 'unknown', summary: received.summary, date: receptionDate },
    accord: { state: consentState, summary: consentSummary, date: approved || refused ? consentDate : voluntaryWait ? waitingDate : requestDate },
    preparation: { state: optimization.state, summary: optimization.summary, date: optimization.savedAt },
    documents: { state: !documentsVisible ? 'restricted' : invoicesDone ? 'done' : invoicesOptional ? 'not_required' : invoiceRows === null || missingFileCount ? 'unknown'
      : rejectedInvoices.length ? 'review' : reviewInvoices.length ? 'current' : invoiceBucketsNow.pendingAttachments ? 'unknown' : AFTER_PREPARATION.has(dossier.statut) ? 'unknown' : 'waiting', summary: invoices.summary, date: null },
    devis: { state: financeVisible ? quoteState : 'restricted', summary: financeVisible ? quoteSummary : 'Accès réservé au devis', date: financeVisible ? financialFacts.sentAt || (quoteRevised ? savedDate(dossier.devisEnvoyeLe, now) : null) : null },
    paiement: { state: financeVisible ? paymentState : 'restricted', summary: payment.stateLabel, date: financeVisible ? savedDate(dossier.paiementDate, now) : null },
    expedition: { state: departureConfirmed ? 'done' : AFTER_DEPARTURE.has(dossier.statut) || (dossier.envoi || dossier.envoiId) && !envoi ? 'unknown'
      : envoi?.statut === 'annule' || envoi?.statut === 'archive' || plannedDate && plannedDate < new Date(now).toISOString().slice(0, 10) ? 'review' : currentTask === 'expedition' || envoi ? 'current' : 'upcoming',
      summary: departureConfirmed ? 'Départ enregistré' : AFTER_DEPARTURE.has(dossier.statut) ? 'Départ annoncé · confirmation à vérifier' : departure.label, date: confirmedAt || plannedDate },
    livraison: { state: delivery.state, summary: delivery.summary, date: delivery.date },
  };
  if (stopped) for (const fact of Object.values(facts)) {
    if (['current', 'waiting', 'upcoming'].includes(fact.state)) {
      fact.state = 'not_required'; fact.summary = stoppedSummary;
    }
  }
  const steps = Object.entries(DOSSIER_TASKS).map(([id, task]) => ({ id, label: task.label, ...facts[id],
    canOpen: id === 'documents' ? documentsVisible : ['devis', 'paiement'].includes(id) ? financeVisible : true,
    current: id === currentTask,
  }));
  const alerts = [];
  if (!knownStatus) alerts.push({ code: 'unknown-status', task: null, message: 'L’état du dossier est à vérifier avant de poursuivre.' });
  if (AFTER_PREPARATION.has(dossier.statut) && !finalCurrent) alerts.push({ code: 'preparation-unconfirmed', task: 'preparation', message: 'Les mesures après optimisation restent à vérifier.' });
  if (financeVisible && dossier.statut === 'paye' && !fullyPaid) alerts.push({ code: 'payment-unconfirmed', task: 'paiement', message: 'Le statut indique payé, mais le règlement complet doit être vérifié.' });
  return {
    reference: text(dossier.ref) || 'Référence à préciser', casier: text(dossier.casier) || null,
    currentTask, statusLabel: knownStatus ? `${STATUTS[dossier.statut].label}${dossier.archive ? ' · Archivé' : ''}` : 'État à vérifier',
    steps, received, optimization, invoices, payment, departure, delivery, alerts: alerts.slice(0, 2),
  };
}
