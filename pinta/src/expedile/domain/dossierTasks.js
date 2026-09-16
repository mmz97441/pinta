import { needsQuoteRecalculation } from './clientJourney.js';
import { currentInvoices } from './invoiceDocuments.js';
import { measureShipment } from './quote.js';

export const DOSSIER_TASKS = {
  reception: { label: 'Réception', title: 'Vérifier la réception', backLabel: 'Revenir à la réception' },
  accord: { label: 'Accord client', title: 'Suivre l’accord du client', backLabel: 'Revenir à l’accord client' },
  preparation: { label: 'Préparation', title: 'Préparer les colis', backLabel: 'Revenir à la préparation' },
  documents: { label: 'Factures', title: 'Vérifier les factures', backLabel: 'Revenir aux factures' },
  devis: { label: 'Devis', title: 'Établir le devis', backLabel: 'Revenir au devis' },
  paiement: { label: 'Paiement', title: 'Suivre le paiement', backLabel: 'Revenir au paiement' },
  expedition: { label: 'Expédition', title: 'Suivre l’expédition', backLabel: 'Revenir à l’expédition' },
  livraison: { label: 'Livraison', title: 'Suivre la livraison', backLabel: 'Revenir à la livraison' },
};

const DOCUMENT_PERMISSIONS = ['perm_factures_voir', 'perm_factures_ajouter', 'perm_factures_valider', 'perm_factures_refuser', 'perm_factures_ocr', 'perm_factures_modifier_articles'];
const QUOTE_PERMISSIONS = ['perm_colis_calculer_devis', 'perm_colis_envoyer_devis', 'perm_finances_voir_total'];

/** Previous screen in the dossier's operational order. This is navigation,
 * never a business-state rollback, and inaccessible tasks are skipped. */
export function previousDossierTask(task, can = () => true) {
  const tasks = Object.keys(DOSSIER_TASKS).filter(key => key === task
    || (key !== 'documents' || DOCUMENT_PERMISSIONS.some(can))
    && (key !== 'devis' || QUOTE_PERMISSIONS.some(can)));
  return tasks[tasks.indexOf(task) - 1] || null;
}

function afterPreparation(dossier, can) {
  const boxes = dossier.finalPackages?.length ? dossier.finalPackages : [{ dimL: dossier.finL, dimW: dossier.finW, dimH: dossier.finH, poids: dossier.finP }];
  const measured = dossier.preparationCompositionVersion != null
    && dossier.finalMeasurementsVersion === dossier.preparationCompositionVersion
    && Boolean(measureShipment(boxes));
  if (!measured) return 'preparation';
  const invoices = currentInvoices(dossier.factures);
  const documentsNeeded = !invoices.length || invoices.some(invoice => !invoice.valide || invoice.rejetMotif || invoice.rejet_motif);
  if (documentsNeeded && (!can || DOCUMENT_PERMISSIONS.some(can))) return 'documents';
  if (!can || QUOTE_PERMISSIONS.some(can)) return 'devis';
  if (DOCUMENT_PERMISSIONS.some(can)) return 'documents';
  return 'preparation';
}

/** An explicit task remains stable while colleagues update the dossier. Only
 * legacy document actions used an incorrect section=devis hint. */
export function resolveDossierTask(dossier = {}, search = '', workActions = [], can) {
  const params = new URLSearchParams(search);
  if (params.get('invoice')) return 'documents';
  const action = workActions.find(item => item.id === params.get('action') && (item.colis_id || item.colisId) === dossier.id);
  const section = params.get('section');
  if (section === 'devis' && action?.kind === 'documents') return 'documents';
  if (Object.hasOwn(DOSSIER_TASKS, section)) return section;
  const actionTask = { documents: 'documents', quote: 'devis', preparation: 'preparation', departure: 'expedition' }[action?.kind];
  if (actionTask) return actionTask;
  if (action?.kind === 'reception') return dossier.statut === 'receptionne' ? 'reception' : 'accord';
  if (needsQuoteRecalculation(dossier) || dossier.statut === 'en_preparation') return afterPreparation(dossier, can);
  return {
    receptionne: 'reception', mesure: 'accord', attente_feu_vert: 'accord', refuse_client: 'accord',
    autorise: 'preparation', pret: 'devis', devis_envoye: 'paiement', attente_paiement: 'paiement',
    paye: 'expedition', expedie: 'expedition', transit: 'expedition', dedouanement: 'expedition',
    arrive: 'livraison', livraison: 'livraison', livre: 'livraison', annule: 'reception',
  }[dossier.statut] || 'reception';
}

/** Keep the caller's return path and unrelated view state; never carry an old
 * action or invoice into a different task. No navigation mutates business data. */
export function dossierTaskUrl(dossierId, task, search = '', options = {}) {
  const params = new URLSearchParams(search);
  params.delete('invoice'); params.delete('action');
  const section = options.invoiceId ? 'documents' : Object.hasOwn(DOSSIER_TASKS, task) ? task : 'reception';
  params.set('section', section);
  if (options.invoiceId) params.set('invoice', options.invoiceId);
  const hash = options.hash ? `#${String(options.hash).replace(/^#/, '')}` : '';
  return `/colis/${encodeURIComponent(dossierId)}?${params}${hash}`;
}
