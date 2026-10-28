// Message amounts keep the format of the Edge renderer (_shared/messageTemplate.ts):
// the preview must stay identical to the delivered text.
import { messageEur as eur, getPrenom } from '../utils';
import { receptionCartonManifest, hasCompleteReceptionMeasurements } from '../domain/reception';
import { measureShipment, volumetricDivisor } from '../domain/quote';
import { invoiceRequestText } from '../domain/invoiceRequest';
import { importTaxMessage } from '../domain/importTaxes';

// {{nb_colis_recus}} and {{liste_colis_recus}} (arrival notice, 2026-10-28): the cartons of one validated reception,
// numbered in the order given, written like {{liste_cartons}}, with French numbers (« 35,5 × 28 × 18 cm — 2,45 kg »).
// Same text as the Edge renderer.
const trimmed = (value) => String(value ?? '').trim();
const positiveMeasure = (value) => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) > 0;
// Decimal comma, two decimals at most (the reception records two at most), no thousands separator, never a false zero.
const frenchNumber = (value) => {
  const rounded = Number(Number(value).toFixed(2));
  return rounded === 0 ? '< 0,01' : String(rounded).replace('.', ',');
};
function receivedCartonLine(carton, index) {
  const item = carton || {};
  const size = ['dimL', 'dimW', 'dimH'].every((key) => positiveMeasure(item[key]))
    ? `${frenchNumber(item.dimL)} × ${frenchNumber(item.dimW)} × ${frenchNumber(item.dimH)} cm`
    : 'dimensions à mesurer';
  const weight = positiveMeasure(item.poids) ? `${frenchNumber(item.poids)} kg` : 'poids à peser';
  const vendor = trimmed(item.fournisseur) || trimmed(item.vendeur);
  const tracking = trimmed(item.number) || trimmed(item.tracking) || trimmed(item.numero) || 'Sans numéro de suivi';
  return `${index + 1}. ${[vendor, tracking, size, weight].filter(Boolean).join(' — ')}`;
}

/** The saved body is the actual body used by preview and delivery. Unknown variables fail visibly.
 * `reception` ({ cartons: [{ number, fournisseur, dimL, dimW, dimH, poids }] }, in the order of the reception) feeds
 * {{nb_colis_recus}} and {{liste_colis_recus}}; without it both are empty. */
export function renderTemplate(body, { client, colis = {}, destination = {}, settings = {}, reception: receptionContext = null }) {
  const divisor = volumetricDivisor(settings);
  const volume = (l, w, h) =>
    l && w && h ? `${((l * w * h) / divisor).toFixed(2)} kg` : 'À mesurer';
  const manifest = receptionCartonManifest(colis);
  const reception = hasCompleteReceptionMeasurements(colis) ? measureShipment(manifest.dimsParColis, divisor) : null;
  const receivedDimensions = reception ? manifest.dimsParColis.map((box, index) => `${manifest.nbColis > 1 ? `Carton ${index + 1} : ` : ''}${box.dimL}×${box.dimW}×${box.dimH} cm`).join('\n') : 'À mesurer';
  const list = manifest.trackingsDetail
    .map(
      (item, i) =>
        `${i + 1}. ${typeof item === 'string' ? item : [item.fournisseur || item.vendeur, item.number || item.tracking || item.numero || 'Sans numéro de suivi'].filter(Boolean).join(' — ')}`,
    )
    .join('\n');
  const received = Array.isArray(receptionContext?.cartons) ? receptionContext.cartons : [];
  const vars = {
    prenom: getPrenom(client),
    nom_complet: client.nom,
    destination_flag: destination.flag || '',
    destination: destination.label || destination.nom || '',
    lien_paiement:
      colis.payplugPaymentUrl || 'Consultez votre espace client pour les modalités de règlement.',
    modalite_paiement:
      {
        virement: 'par virement bancaire',
        especes: 'en espèces',
        '30_jours': 'à 30 jours',
        fin_de_mois: 'en fin de mois',
      }[colis.modePaiementPro] || 'à convenir avec votre interlocuteur',
    documents_attendus: invoiceRequestText(colis),
    lien_espace:
      typeof window !== 'undefined' ? `${window.location.origin}/colis/${colis.id || ''}` : '',
    ref: colis.ref || '',
    desc: colis.desc || '',
    casier: colis.casier || '',
    nb_cartons: manifest.nbColis,
    liste_cartons: list,
    nb_colis_recus: received.length ? `${received.length} colis` : '',
    liste_colis_recus: received.map(receivedCartonLine).join('\n'),
    dims_brutes: receivedDimensions,
    poids_brut: reception ? `${reception.realWeight} kg` : 'À peser',
    poids_vol_avant: reception ? `${reception.volumetricWeight.toFixed(2)} kg` : 'À mesurer',
    dims_finales: [colis.finL, colis.finW, colis.finH].every(Boolean)
      ? `${colis.finL}×${colis.finW}×${colis.finH} cm`
      : 'À mesurer',
    poids_vol_apres: volume(colis.finL, colis.finW, colis.finH),
    poids_facturable: colis.poidsFact ? `${colis.poidsFact} kg` : 'À calculer',
    transport: eur(colis.devisTransport || 0),
    om: eur(colis.devisOM || 0),
    omr: eur(colis.devisOMR || 0),
    taxes: eur((colis.devisOM || 0) + (colis.devisOMR || 0)),
    tva: eur(colis.devisTVA || 0),
    taux_tva: client.type === 'pro' ? '0%' : `${destination.tva ?? 0}%`,
    total: eur(colis.devisTotal || 0),
    // The estimate of the import taxes, as the quote presents it to the client (domain/importTaxes.js);
    // {{om}}, {{omr}}, {{taxes}}, {{tva}} and {{taux_tva}} stay for the templates saved before it.
    estimation_taxes: importTaxMessage(
      { om: colis.devisOM, omr: colis.devisOMR, tva: colis.devisTVA, total: colis.devisTotal },
      destination,
      { professional: client.type === 'pro', money: eur },
    ),
    economie: eur(colis.economie || 0),
    frais_divers: (colis.fraisDivers || [])
      .map((f) => `${f.label || f.libelle || 'Frais'} : ${eur(f.montant)}`)
      .join('\n'),
    contenu_declare: (colis.lignes || [])
      .map((l) => `${l.desc} × ${l.qte} — ${eur(l.qte * l.prix)}`)
      .join('\n'),
    date_expedition: colis.dateExpedition
      ? new Date(colis.dateExpedition).toLocaleDateString('fr-FR')
      : 'Voir le suivi',
    motif_rejet: colis.factures?.find((f) => f.rejetMotif)?.rejetMotif || 'Document à vérifier',
  };
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Variable de message inconnue : ${key}`);
    return String(vars[key] ?? '');
  });
}
