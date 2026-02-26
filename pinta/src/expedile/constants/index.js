// ══════════ BRAND COLORS ══════════
export const BRAND = {
  navy: '#1B3A4B',
  navyL: '#24506A',
  navyD: '#122A36',
  gold: '#E8B84B',
  goldL: '#F5D98A',
  goldD: '#C99A2E',
};

// ══════════ STATUTS COLIS ══════════
export const STATUTS = {
  annonce:            { label: 'Annoncé par le client',       labelClient: 'Pré-annoncé',                   couleur: 'bg-slate-200 text-slate-700',    phase: 1, actionStaff: 'Réceptionner ce colis',          actionClient: null },
  receptionne:        { label: 'Réceptionné',                 labelClient: null,                            couleur: 'bg-amber-200 text-amber-800',    phase: 1, actionStaff: 'Mesurer ce colis',               actionClient: null },
  mesure:             { label: 'Mesuré à réception',          labelClient: 'Mesuré',                        couleur: 'bg-yellow-200 text-yellow-800',  phase: 1, actionStaff: 'Demander le feu vert',            actionClient: null },
  attente_feu_vert:   { label: "En attente d'accord client",  labelClient: 'Votre accord est attendu',      couleur: 'bg-orange-200 text-orange-800',  phase: 2, actionStaff: 'En attente du client',            actionClient: 'Donner votre accord' },
  autorise:           { label: 'Autorisation reçue',          labelClient: 'Accord donné',                  couleur: 'bg-green-200 text-green-800',    phase: 2, actionStaff: 'Préparer ce colis',               actionClient: null },
  refuse_client:      { label: 'Refusé par le client',        labelClient: 'Refusé',                        couleur: 'bg-red-200 text-red-700',        phase: 2, actionStaff: 'Traiter le refus',                actionClient: null },
  en_preparation:     { label: 'En cours de préparation',     labelClient: null,                            couleur: 'bg-blue-200 text-blue-800',      phase: 3, actionStaff: 'Finaliser et envoyer le devis',   actionClient: null },
  devis_envoye:       { label: 'Devis envoyé',                labelClient: 'Devis reçu',                    couleur: 'bg-amber-200 text-amber-900',    phase: 4, actionStaff: 'En attente validation client',    actionClient: 'Valider le devis' },
  attente_paiement:   { label: 'En attente de paiement',      labelClient: 'En attente de votre paiement',  couleur: 'bg-amber-200 text-amber-900',    phase: 4, actionStaff: 'En attente paiement',             actionClient: 'Payer' },
  paye:               { label: 'Payé',                        labelClient: null,                            couleur: 'bg-emerald-200 text-emerald-800',phase: 4, actionStaff: 'Expédier ce colis',               actionClient: null },
  expedie:            { label: 'Expédié',                     labelClient: null,                            couleur: 'bg-cyan-200 text-cyan-800',      phase: 5, actionStaff: 'Marquer en transit',              actionClient: null },
  transit:            { label: 'En vol',                      labelClient: null,                            couleur: 'bg-sky-200 text-sky-800',        phase: 5, actionStaff: "Confirmer arrivée",               actionClient: null },
  arrive:             { label: 'Arrivé destination',          labelClient: null,                            couleur: 'bg-teal-200 text-teal-800',      phase: 5, actionStaff: 'Lancer la livraison',             actionClient: null },
  livraison:          { label: 'En cours de livraison',       labelClient: null,                            couleur: 'bg-lime-200 text-lime-800',      phase: 5, actionStaff: 'Confirmer livraison',             actionClient: null },
  livre:              { label: 'Livré ✓',                     labelClient: null,                            couleur: 'bg-green-300 text-green-900',    phase: 5, actionStaff: null,                              actionClient: null },
  annule:             { label: 'Annulé',                      labelClient: null,                            couleur: 'bg-gray-200 text-gray-500',      phase: 0, actionStaff: null,                              actionClient: null },
};

export const TRANSITIONS = {
  annonce: ['receptionne'],
  receptionne: ['mesure'],
  mesure: ['attente_feu_vert'],
  attente_feu_vert: ['autorise', 'refuse_client'],
  autorise: ['en_preparation'],
  refuse_client: ['annule'],
  en_preparation: ['devis_envoye'],
  devis_envoye: ['attente_paiement'],
  attente_paiement: ['paye'],
  paye: ['expedie'],
  expedie: ['transit'],
  transit: ['arrive'],
  arrive: ['livraison'],
  livraison: ['livre'],
  livre: [],
  annule: [],
};

export const PREV_STATUT = {
  receptionne: 'annonce',
  mesure: 'receptionne',
  attente_feu_vert: 'mesure',
  autorise: 'attente_feu_vert',
  en_preparation: 'autorise',
  devis_envoye: 'en_preparation',
  attente_paiement: 'devis_envoye',
  paye: 'attente_paiement',
};

// ══════════ DESTINATIONS DOM-TOM ══════════
export const DESTINATIONS = {
  '974': { code: '974', nom: 'La Réunion',   flag: '🇷🇪', hasOM: true,  tva: 8.5, label: 'Réunion' },
  '976': { code: '976', nom: 'Mayotte',      flag: '🇾🇹', hasOM: false, taxeConso: 5, tva: 10, label: 'Mayotte' },
  '971': { code: '971', nom: 'Guadeloupe',   flag: '🇬🇵', hasOM: true,  tva: 8.5, label: 'Guadeloupe' },
  '972': { code: '972', nom: 'Martinique',   flag: '🇲🇶', hasOM: true,  tva: 8.5, label: 'Martinique' },
};

export function getDestByCP(cp) {
  if (!cp) return DESTINATIONS['974'];
  const prefix = String(cp).slice(0, 3);
  return DESTINATIONS[prefix] || DESTINATIONS['974'];
}

// ══════════ TARIFS TRANSPORT ══════════
export const TARIFS_DEFAUT = {
  '974': { base: 25, parKg: 5 },
  '976': { base: 35, parKg: 15 },
  '971': { base: 30, parKg: 8 },
  '972': { base: 30, parKg: 8 },
};

// ══════════ CATEGORIES PRODUITS ══════════
export const CATEGORIES_INIT = [
  { id: 'c1', label: 'Électronique',    custom: false, taux: { '974': { om: 9.5, omr: 2.5 }, '976': { om: 5, omr: 0 }, '971': { om: 8, omr: 2 },   '972': { om: 8, omr: 2 } } },
  { id: 'c2', label: 'Vêtements',       custom: false, taux: { '974': { om: 0,   omr: 0 },   '976': { om: 5, omr: 0 }, '971': { om: 0, omr: 0 },   '972': { om: 0, omr: 0 } } },
  { id: 'c3', label: 'Cosmétique',      custom: false, taux: { '974': { om: 6.5, omr: 2.5 }, '976': { om: 10, omr: 0 },'971': { om: 6.5, omr: 2.5 },'972': { om: 6.5, omr: 2.5 } } },
  { id: 'c4', label: 'Accessoires',     custom: false, taux: { '974': { om: 6.5, omr: 2.5 }, '976': { om: 5, omr: 0 }, '971': { om: 6, omr: 2 },   '972': { om: 6, omr: 2 } } },
  { id: 'c5', label: 'Maison / Déco',   custom: false, taux: { '974': { om: 12.5, omr: 2.5 },'976': { om: 10, omr: 0 },'971': { om: 12, omr: 2.5 },'972': { om: 12, omr: 2.5 } } },
  { id: 'c6', label: 'Jouets / Loisirs',custom: false, taux: { '974': { om: 15, omr: 2.5 }, '976': { om: 10, omr: 0 },'971': { om: 14, omr: 2.5 },'972': { om: 14, omr: 2.5 } } },
  { id: 'c7', label: 'Auto / Moto',     custom: false, taux: { '974': { om: 7,  omr: 2.5 }, '976': { om: 5, omr: 0 }, '971': { om: 7, omr: 2 },   '972': { om: 7, omr: 2 } } },
];

// ══════════ STAFF ══════════
export const STAFF = [
  { id: 'u1', nom: 'Marie Dupont', role: 'Directrice' },
  { id: 'u2', nom: 'Sophie Martin', role: 'Logisticienne' },
];

// ══════════ CLIENTS INITIAUX ══════════
export const CLIENTS_INIT = [
  { id: 'c1', nom: 'Flavie FONTAINE',  ville: 'Saint-Denis',  cp: '97400', tel: '+262692123456', email: 'flavie.f@gmail.com',      canal: 'whatsapp', type: 'particulier', created: '2024-11-15', points: 120, onboarded: true },
  { id: 'c2', nom: 'Guillaume NICE',   ville: 'Sainte-Marie', cp: '97438', tel: '+262692595378', email: 'guillaume.n@outlook.com',  canal: 'whatsapp', type: 'particulier', created: '2025-01-08', points: 45, onboarded: true },
  { id: 'c3', nom: 'Ophélie ABAR',     ville: 'Saint-Leu',    cp: '97436', tel: '+262694111222', email: 'ophelie.a@gmail.com',      canal: 'whatsapp', type: 'particulier', created: '2025-02-01', points: 10 },
  { id: 'c4', nom: 'Stessy SINAMA',    ville: 'Le Tampon',    cp: '97430', tel: '+262692789012', email: 'stessy.s@live.fr',         canal: 'whatsapp', type: 'particulier', created: '2024-09-20', points: 210, onboarded: true },
  { id: 'c5', nom: 'E-Concept Auto',   ville: 'Saint-Paul',   cp: '97460', tel: '+262692555888', email: 'contact@econcept-auto.re', canal: 'email',    type: 'pro',         created: '2024-06-10', points: 580, onboarded: true },
  { id: 'c6', nom: 'Ibrahim COMBO',    ville: 'Mamoudzou',    cp: '97600', tel: '+262639123456', email: 'ibrahim.c@gmail.com',      canal: 'whatsapp', type: 'particulier', created: '2025-01-25', points: 30 },
];

// ══════════ ENVOIS ══════════
export function initEnvois() {
  return [
    { id: 'e1', date: '2025-02-07', statut: 'parti' },
    { id: 'e2', date: '2025-02-14', statut: 'en_cours' },
    { id: 'e3', date: '2025-02-21', statut: 'prochain' },
    { id: 'e4', date: '2025-02-28', statut: 'planifie' },
    { id: 'e5', date: '2025-03-07', statut: 'planifie' },
  ];
}

export const STATUT_ENVOI = {
  parti: 'Parti',
  en_cours: 'En cours',
  prochain: 'Prochain',
  planifie: 'Planifié',
};

// ══════════ PHASES CLIENT (timeline) ══════════
export const PHASES_CLIENT = [
  { key: 'annonce',     label: 'Pré-annoncé',       statuts: ['annonce'] },
  { key: 'reception',   label: 'Réceptionné',       statuts: ['receptionne', 'mesure'] },
  { key: 'feu_vert',    label: 'Votre accord',      statuts: ['attente_feu_vert', 'autorise'] },
  { key: 'preparation', label: 'Préparation',       statuts: ['en_preparation'] },
  { key: 'devis',       label: 'Devis & Paiement',  statuts: ['devis_envoye', 'attente_paiement', 'litige_devis', 'paye'] },
  { key: 'expedition',  label: 'Expédition',        statuts: ['expedie', 'transit'] },
  { key: 'livraison',   label: 'Livraison',         statuts: ['arrive', 'livraison', 'livre'] },
];

export function getPhaseIndex(statut) {
  for (let i = 0; i < PHASES_CLIENT.length; i++) {
    if (PHASES_CLIENT[i].statuts.includes(statut)) return i;
  }
  return 0;
}

// ══════════ CUTOFF DÉPARTS ══════════
export const CUTOFF_DEFAULT = { day: 3, hour: 17 }; // mercredi 17h
export const JOURS_SEMAINE = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// ══════════ PRODUITS INTERDITS ══════════
export const PRODUITS_INTERDITS = [
  'Batteries lithium',
  'Liquides > 100ml',
  'Matières inflammables',
  'Aérosols',
  'Produits périssables',
  'Contrefaçons',
];
