import { receptionCartonManifest, RECEPTION_MEASURES } from './reception.js';

const value = input => input === '' || input == null ? null : Number(String(input).trim().replace(',', '.'));
const measurement = box => Object.fromEntries(RECEPTION_MEASURES.map(({ key }) => [key, box?.[key] ?? '']));
const OPEN_STATES = new Set(['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'refuse_client', 'en_preparation', 'devis_envoye', 'attente_paiement']);
const PREPARATION_STATES = new Set(['autorise', 'en_preparation', 'devis_envoye', 'attente_paiement']);

/** Receipt boxes and prepared packages are two independent measurements. */
export function shipmentRevisionBoxes(colis, phase) {
  if (phase === 'reception') return receptionCartonManifest(colis).dimsParColis.map(measurement);
  if (phase === 'preparation') {
    // NULL is the legacy scalar format. An explicit [] records no outgoing
    // packages; it must never revive measurements from a previous preparation.
    const boxes = colis.finalPackages == null ? [{ dimL: colis.finL, dimW: colis.finW, dimH: colis.finH, poids: colis.finP }] : colis.finalPackages;
    return Array.isArray(boxes) ? boxes.map(measurement) : [];
  }
  return [];
}

export function sameRevisionBoxes(left = [], right = []) {
  return left.length === right.length && left.every((box, index) => RECEPTION_MEASURES.every(({ key }) => Object.is(value(box[key]), value(right[index]?.[key]))));
}

export function revisionMeasurementIssues(boxes, phase, receiptCount) {
  if (!Array.isArray(boxes) || !boxes.length || boxes.length > 100) return [{ message: 'Renseignez entre 1 et 100 colis.' }];
  if (phase === 'reception' && boxes.length !== receiptCount) return [{ message: 'Le nombre de cartons reçus a changé. Rechargez les mesures avant de les corriger.' }];
  return boxes.flatMap((box, index) => RECEPTION_MEASURES.flatMap(({ key, label, unit }) => {
    const number = value(box[key]);
    return Number.isFinite(number) && number > 0 ? [] : [{ index, key, message: `${phase === 'reception' ? 'Carton' : 'Colis préparé'} ${index + 1} : renseignez ${key === 'poids' ? 'le' : 'la'} ${label.toLocaleLowerCase('fr')} en ${unit}, avec une valeur supérieure à zéro.` }];
  }));
}

export function normalizedRevisionBoxes(boxes) {
  return boxes.map(box => Object.fromEntries(RECEPTION_MEASURES.map(({ key }) => [key, value(box[key])])));
}

/** Server permissions and its optimistic lock remain the final authority. */
export function revisionLockedReason(colis, phase) {
  if (!['reception', 'preparation'].includes(phase)) return 'Ces mesures ne peuvent pas être corrigées ici.';
  if (colis.archive) return 'Ce dossier est archivé. Ses mesures restent consultables.';
  if (colis.statut === 'annule') return 'Cette expédition est annulée. Ses mesures restent consultables.';
  if (colis.dateExpedition || ['expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre'].includes(colis.statut)) return 'Le transport a commencé. Les mesures sont en lecture seule.';
  if (colis.paiementDate || colis.paiementMontant != null || colis.statut === 'paye') return 'Un paiement est enregistré. Les mesures sont en lecture seule.';
  if (!OPEN_STATES.has(colis.statut)) return 'L’état du dossier doit être vérifié avant de modifier ses mesures.';
  if (phase === 'preparation' && colis.produitInterdit) return 'Un produit interdit est signalé. Faites régulariser le dossier avant de modifier les mesures après optimisation.';
  if (phase === 'preparation' && colis.feuVert !== 'autorise') return 'L’accord du client est nécessaire avant de modifier les mesures après optimisation.';
  if (phase === 'preparation' && !PREPARATION_STATES.has(colis.statut)) return 'L’étape de préparation doit être autorisée avant de modifier les mesures après optimisation.';
  return '';
}

export function revisionHasQuote(colis) {
  const total = value(colis.devisTotal);
  const snapshot = colis.devisSnapshot;
  // Saving measurements also sets devisBrouillon=true. That flag, an initial
  // zero or a retired quote's version stamp alone does not prove a draft quote.
  return Boolean(Number.isFinite(total) && (total > 0 || total === 0 && Number(colis.quoteVersion) > 0)
    || snapshot && (Object.prototype.hasOwnProperty.call(snapshot, 'inputs') || Object.prototype.hasOwnProperty.call(snapshot, 'amounts'))
    || colis.payplugPaymentId || colis.payplugPaymentUrl || ['devis_envoye', 'attente_paiement'].includes(colis.statut));
}
