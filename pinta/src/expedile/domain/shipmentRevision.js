import { receptionCartonManifest, RECEPTION_MEASURES } from './reception.js';

const value = input => input === '' || input == null ? null : Number(String(input).trim().replace(',', '.'));
const measurement = box => Object.fromEntries(RECEPTION_MEASURES.map(({ key }) => [key, box?.[key] ?? '']));

/** Receipt boxes and prepared packages are two independent measurements. */
export function shipmentRevisionBoxes(colis, phase) {
  if (phase === 'reception') return receptionCartonManifest(colis).dimsParColis.map(measurement);
  if (phase === 'preparation') return (colis.finalPackages?.length ? colis.finalPackages : [{ dimL: colis.finL, dimW: colis.finW, dimH: colis.finH, poids: colis.finP }]).map(measurement);
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
  if (['expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre'].includes(colis.statut)) return 'Le transport a commencé. Les mesures sont en lecture seule.';
  if (colis.paiementDate || colis.statut === 'paye') return 'Le paiement est enregistré. Les mesures sont en lecture seule.';
  if (phase === 'preparation' && colis.produitInterdit) return 'Un produit interdit est signalé. Faites régulariser le dossier avant de modifier les mesures après optimisation.';
  if (phase === 'preparation' && colis.feuVert !== 'autorise') return 'L’accord du client est nécessaire avant de modifier les mesures après optimisation.';
  return '';
}

export function revisionHasQuote(colis) {
  return Boolean(colis.devisSnapshot || colis.devisTotal != null || colis.devisBrouillon || colis.payplugPaymentId || colis.payplugPaymentUrl || ['devis_envoye', 'attente_paiement'].includes(colis.statut));
}
