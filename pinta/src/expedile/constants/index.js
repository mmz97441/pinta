// ══════════ BRAND COLORS ══════════
// Workshop-calm palette: designed for 8h+ work sessions without eye fatigue.
// Light mode CSS variables are defined in brand.css; this object mirrors them
// for inline-style usage (style={{ color: BRAND.navy }}, etc.).
export const BRAND = {
  // Core identity (unchanged — load-bearing for visual recognition)
  navy: '#1B3A4B',
  navyL: '#24506A',
  navyD: '#122A36',
  gold: '#D8AA42',   // was #E8B84B — desaturated ~5% for long-session comfort
  goldL: '#E8C779',
  goldD: '#B8902F',

  // Backgrounds (light mode) — no more pure white
  bgCanvas:    '#FAFAF6',  // warm paper, replaces bg-white globally
  bgSurface:   '#F4F0E6',  // cards on canvas
  bgElevated:  '#FDFBF5',  // floating cards / modals
  borderSubtle:'#E5E0D3',

  // Text (light mode) — softened contrast
  textPrimary:  '#2A2826',  // 12:1 instead of slate-900's 19:1
  textSecondary:'#605C56',
  textMuted:    '#8A857B',

  // Semantic — desaturated, "earthy" palette
  success: '#5C9970',   // sage green (was Tailwind green-500)
  warning: '#C29243',   // soft amber (was amber-500)
  danger:  '#B85454',   // brick red (was red-500)
  info:    '#5577A3',   // slate blue (was blue-500)

  // Pipeline phase gradient (replaces the 6-color rainbow)
  phase1: '#DBC68A',
  phase2: '#C9A368',
  phase3: '#91A584',
};

// ══════════ STATUTS COLIS ══════════
export const STATUTS = {
  receptionne:        { label: 'Réceptionné',                 labelClient: null,                            couleur: 'bg-orange-50 text-orange-700',   phase: 1, actionStaff: 'Mesurer ce colis',               actionClient: null },
  mesure:             { label: 'Mesuré à réception',          labelClient: 'Mesuré',                        couleur: 'bg-amber-100 text-amber-800',    phase: 1, actionStaff: 'Demander le feu vert',            actionClient: null },
  attente_feu_vert:   { label: "En attente d'accord client",  labelClient: 'Votre accord est attendu',      couleur: 'bg-orange-100 text-orange-800',  phase: 2, actionStaff: 'En attente du client',            actionClient: 'Donner votre accord' },
  autorise:           { label: 'Autorisation reçue',          labelClient: 'Accord donné',                  couleur: 'bg-green-100 text-green-800',    phase: 2, actionStaff: 'Préparer ce colis',               actionClient: null },
  refuse_client:      { label: 'Refusé par le client',        labelClient: 'Refusé',                        couleur: 'bg-red-100 text-red-700',        phase: 2, actionStaff: 'Traiter le refus',                actionClient: null },
  en_preparation:     { label: 'En cours de préparation',     labelClient: null,                            couleur: 'bg-blue-100 text-blue-800',      phase: 3, actionStaff: 'Finaliser et envoyer le devis',   actionClient: null },
  devis_envoye:       { label: 'Devis envoyé',                labelClient: 'Devis reçu — en attente de paiement', couleur: 'bg-amber-100 text-amber-800',    phase: 4, actionStaff: 'En attente paiement',              actionClient: 'Payer' },
  paye:               { label: 'Payé',                        labelClient: null,                            couleur: 'bg-emerald-100 text-emerald-800',phase: 4, actionStaff: 'Expédier ce colis',               actionClient: null },
  expedie:            { label: 'Expédié',                     labelClient: null,                            couleur: 'bg-cyan-100 text-cyan-800',      phase: 5, actionStaff: 'Marquer en transit',              actionClient: null },
  transit:            { label: 'En vol',                      labelClient: null,                            couleur: 'bg-sky-100 text-sky-800',        phase: 5, actionStaff: 'Dédouanement ou arrivée',       actionClient: null },
  dedouanement:       { label: 'En dédouanement',              labelClient: 'En cours de dédouanement',      couleur: 'bg-slate-100 text-slate-700',    phase: 6, actionStaff: 'Confirmer arrivée',              actionClient: null },
  arrive:             { label: 'Arrivé destination',          labelClient: null,                            couleur: 'bg-teal-100 text-teal-800',      phase: 7, actionStaff: 'Lancer la livraison',             actionClient: null },
  livraison:          { label: 'En cours de livraison',       labelClient: null,                            couleur: 'bg-lime-100 text-lime-800',      phase: 8, actionStaff: 'Confirmer livraison',             actionClient: null },
  livre:              { label: 'Livré',                       labelClient: null,                            couleur: 'bg-green-200 text-green-900',    phase: 8, actionStaff: null,                              actionClient: null },
  annule:             { label: 'Annulé',                      labelClient: null,                            couleur: 'bg-gray-100 text-gray-500',      phase: 0, actionStaff: null,                              actionClient: null },
};

export const TRANSITIONS = {
  receptionne: ['mesure'],
  mesure: ['attente_feu_vert'],
  attente_feu_vert: ['autorise', 'refuse_client'],
  autorise: ['en_preparation'],
  refuse_client: ['annule'],
  en_preparation: ['devis_envoye'],
  devis_envoye: ['paye'],
  paye: ['expedie'],
  expedie: ['transit'],
  transit: ['dedouanement', 'arrive'],
  dedouanement: ['arrive'],
  arrive: ['livraison'],
  livraison: ['livre'],
  livre: [],
  annule: [],
};

export const PREV_STATUT = {
  mesure: 'receptionne',
  attente_feu_vert: 'mesure',
  autorise: 'attente_feu_vert',
  en_preparation: 'autorise',
  devis_envoye: 'en_preparation',
  paye: 'devis_envoye',
  expedie: 'paye',
  transit: 'expedie',
  dedouanement: 'transit',
  arrive: 'dedouanement',
  livraison: 'arrive',
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

// ══════════ SECTEURS LIVRAISON LA RÉUNION ══════════
const SECTEURS_REUNION = {
  '97400': 'NORD', '97417': 'NORD', '97438': 'NORD', '97490': 'NORD',
  '97412': 'EST', '97431': 'EST', '97433': 'EST', '97437': 'EST',
  '97439': 'EST', '97440': 'EST', '97441': 'EST', '97470': 'EST',
  '97411': 'OUEST', '97416': 'OUEST', '97419': 'OUEST', '97420': 'OUEST',
  '97422': 'OUEST', '97423': 'OUEST', '97424': 'OUEST', '97426': 'OUEST',
  '97434': 'OUEST', '97435': 'OUEST', '97436': 'OUEST', '97460': 'OUEST',
  '97410': 'SUD', '97413': 'SUD', '97414': 'SUD', '97418': 'SUD',
  '97421': 'SUD', '97425': 'SUD', '97427': 'SUD', '97429': 'SUD',
  '97430': 'SUD', '97432': 'SUD', '97442': 'SUD', '97450': 'SUD', '97480': 'SUD',
};

const SECTEUR_COLORS = {
  NORD: '#2563EB', EST: '#059669', OUEST: '#D97706', SUD: '#DC2626',
};

export function getSecteurByCP(cp) {
  if (!cp) return null;
  const code = String(cp).replace(/\s/g, '').slice(0, 5);
  return SECTEURS_REUNION[code] || null;
}

export function getSecteurColor(secteur) {
  return SECTEUR_COLORS[secteur] || '#6B7280';
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
  { id: 'u1', nom: 'Marie Dupont', role: 'directeur' },
  { id: 'u2', nom: 'Sophie Martin', role: 'logisticien' },
];

// ══════════ CLIENTS INITIAUX ══════════
export const CLIENTS_INIT = [
  { id: 'c1', nom: 'Flavie FONTAINE',  ville: 'Saint-Denis',  cp: '97400', tel: '+262692123456', email: 'flavie.f@gmail.com',      canal: 'telegram', type: 'particulier', created: '2024-11-15', points: 120, onboarded: true, abonnement: 'premium_annuel', abonnementDebut: '2025-03-01', abonnementFin: '2026-03-01' },
  { id: 'c2', nom: 'Guillaume NICE',   ville: 'Sainte-Marie', cp: '97438', tel: '+262692595378', email: 'guillaume.n@outlook.com',  canal: 'telegram', type: 'particulier', created: '2025-01-08', points: 45, onboarded: true, abonnement: 'freemium' },
  { id: 'c3', nom: 'Ophélie ABAR',     ville: 'Saint-Leu',    cp: '97436', tel: '+262694111222', email: 'ophelie.a@gmail.com',      canal: 'telegram', type: 'particulier', created: '2025-02-01', points: 10, abonnement: 'premium_mensuel', abonnementDebut: '2026-03-01', abonnementFin: '2026-04-01' },
  { id: 'c4', nom: 'Stessy SINAMA',    ville: 'Le Tampon',    cp: '97430', tel: '+262692789012', email: 'stessy.s@live.fr',         canal: 'telegram', type: 'particulier', created: '2024-09-20', points: 210, onboarded: true, abonnement: 'vip', abonnementDebut: '2025-06-01', abonnementFin: '2026-06-01' },
  { id: 'c5', nom: 'E-Concept Auto',   ville: 'Saint-Paul',   cp: '97460', tel: '+262692555888', email: 'contact@econcept-auto.re', canal: 'email',    type: 'pro',         created: '2024-06-10', points: 580, onboarded: true, abonnement: 'premium_annuel', abonnementDebut: '2025-09-01', abonnementFin: '2026-09-01' },
  { id: 'c6', nom: 'Ibrahim COMBO',    ville: 'Mamoudzou',    cp: '97600', tel: '+262639123456', email: 'ibrahim.c@gmail.com',      canal: 'telegram', type: 'particulier', created: '2025-01-25', points: 30, abonnement: 'freemium' },
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
  arrive: 'Arrivé',
  archive: 'Archivé',
};

// ══════════ PHASES CLIENT (timeline) ══════════
export const PHASES_CLIENT = [
  { key: 'reception',    label: 'Réception',      statuts: ['receptionne', 'mesure'] },
  { key: 'accord',       label: 'Votre accord',   statuts: ['attente_feu_vert', 'autorise'] },
  { key: 'preparation',  label: 'Préparation',    statuts: ['en_preparation'] },
  { key: 'paiement',     label: 'Paiement',       statuts: ['devis_envoye', 'paye'] },
  { key: 'vol',          label: 'En vol',         statuts: ['expedie', 'transit'] },
  { key: 'dedouanement', label: 'Dédouanement',   statuts: ['dedouanement'] },
  { key: 'depot',        label: 'Au dépôt',       statuts: ['arrive'] },
  { key: 'livraison',    label: 'Livraison',      statuts: ['livraison', 'livre'] },
];

export function getPhaseIndex(statut) {
  for (let i = 0; i < PHASES_CLIENT.length; i++) {
    if (PHASES_CLIENT[i].statuts.includes(statut)) return i;
  }
  return 0;
}

// ══════════ ABONNEMENTS ══════════
export const ABONNEMENTS = {
  freemium:         { label: 'Freemium',          prix: 0,    periode: null,    couleur: 'bg-gray-200 text-gray-700',      icon: '🆓' },
  premium_mensuel:  { label: 'Premium Mensuel',   prix: 13,   periode: 'mois',  couleur: 'bg-blue-200 text-blue-800',      icon: '🚀' },
  premium_annuel:   { label: 'Premium Annuel',    prix: 69,   periode: 'an',    couleur: 'bg-indigo-200 text-indigo-800',  icon: '🚀' },
  vip:              { label: 'VIP Annuel',         prix: 149,  periode: 'an',    couleur: 'bg-amber-200 text-amber-800',    icon: '👑' },
};

// ══════════ TAGS PRÉPARATION ══════════
export const TAGS_PREPARATION = [
  'Fragile',
  'Batterie lithium',
  'Liquide',
  'Volumineux',
  'Valeur élevée',
  'Sur-emballage requis',
  'Hors gabarit',
];

// ══════════ PRODUITS INTERDITS ══════════
export const PRODUITS_INTERDITS = [
  'Batteries lithium',
  'Liquides > 100ml',
  'Matières inflammables',
  'Aérosols',
  'Produits périssables',
  'Contrefaçons',
];
