import { eur, getPrenom } from '../utils';
import { receptionCartonManifest, hasCompleteReceptionMeasurements } from '../domain/reception';
import { measureShipment, volumetricDivisor } from '../domain/quote';

/** The saved body is the actual body used by preview and delivery. Unknown variables fail visibly. */
export function renderTemplate(body, { client, colis = {}, destination = {}, settings = {} }) {
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
    documents_attendus:
      client.type === 'pro'
        ? 'Les documents de douane restent nécessaires à l’expédition.'
        : colis.factures?.some((f) => f.valide)
          ? 'Facture reçue et vérifiée.'
          : 'Merci de joindre la facture d’achat (photo lisible ou PDF) pour établir le devis final.',
    lien_espace:
      typeof window !== 'undefined' ? `${window.location.origin}/colis/${colis.id || ''}` : '',
    ref: colis.ref || '',
    desc: colis.desc || '',
    casier: colis.casier || '',
    nb_cartons: manifest.nbColis,
    liste_cartons: list,
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
