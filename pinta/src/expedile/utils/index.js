import { getDestByCP } from '../constants';

// ══════════ FORMATAGE ══════════
export function eur(n) {
  const v = Number(n);
  return (isFinite(v) ? v : 0).toFixed(2) + ' €';
}

export function uid() {
  return Math.random().toString(36).slice(2, 8);
}

// Prénom du client pour les salutations.
// - c.prenom prioritaire (champ dédié en DB, c'est le cas nominal)
// - Fallback : c.nom est construit dans mapClient() comme "NOM Prénom"
//   (supabaseData.js:76 : row.nom + ' ' + row.prenom). Donc si prenom vide mais
//   c.nom contient plusieurs mots, on suppose la convention "NOM Prénom" et on
//   renvoie tout ce qui suit le premier mot.
// - Dernier recours : c.nom en un seul mot (on n'a pas mieux, au moins on n'hallucine pas).
export function getPrenom(c) {
  if (!c) return '';
  if (c.prenom) return c.prenom;
  const parts = (c.nom || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts.slice(1).join(' ');
  return parts[0] || '';
}

const MOIS_FR = ['janv.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function fmtMembreDep(dateStr) {
  if (!dateStr) return 'Membre';
  const d = new Date(dateStr);
  return `Membre depuis ${MOIS_FR[d.getMonth()]} ${d.getFullYear()}`;
}

export function labelEnvoi(e) {
  const d = new Date(e.date + 'T00:00:00');
  const jours = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const mois = ['jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${jours[d.getDay()]} ${d.getDate()} ${mois[d.getMonth()]}`;
}

// ══════════ CALCULS ══════════
export function calcTransport(poids, tarif) {
  if (!tarif) return 0;
  return (tarif.base || 0) + poids * (tarif.parKg || 0);
}

export function getCatTaux(cat, destCode) {
  if (!cat || !cat.taux) return { om: 0, omr: 0 };
  return cat.taux[destCode] || cat.taux['974'] || { om: 0, omr: 0 };
}

export function taxLabel(dest) {
  return dest && !dest.hasOM ? 'Taxe conso' : 'OM';
}

export function getClientDest(clientId, clients) {
  const cl = clients.find((c) => c.id === clientId);
  return getDestByCP(cl ? cl.cp : null);
}

// ══════════ TRACKING HELPERS ══════════
export function hasTrack(c) {
  return c.trackings && c.trackings.length > 0 && c.trackings.some((t) => t && t !== '');
}

export function trackStr(c) {
  return c.trackings ? c.trackings.filter((t) => t).join(', ') : '';
}

export function trackCount(c) {
  return c.trackings ? c.trackings.filter((t) => t).length : 0;
}

// ══════════ HELPERS MULTI-CARTONS / MULTI-FOURNISSEURS ══════════

// Nombre réel de cartons d'un colis. On prend le max entre les 3 sources
// possibles (trackingsDetail, trackings, dimsParColis), fallback à 1.
export function nbCartons(colis) {
  if (!colis) return 1;
  const detailLen = (colis.trackingsDetail || []).length;
  const trackLen = (colis.trackings || []).filter((t) => t).length;
  const dimsLen = (colis.dimsParColis || []).length;
  return Math.max(detailLen, trackLen, dimsLen, 1);
}

// Liste unique des fournisseurs identifiés sur un colis (depuis trackingsDetail).
export function fournisseursOf(colis) {
  if (!colis?.trackingsDetail) return [];
  return [...new Set(colis.trackingsDetail.map((td) => td?.fournisseur).filter(Boolean))];
}

// Description naturelle du colis pour le corps des messages client.
// Pas d'EXP-XXX visible, on parle SES achats. Singulier/pluriel adapté.
//   "votre colis SHEIN"             (1 fournisseur, 1 carton)
//   "vos 3 cartons SHEIN"           (1 fournisseur, plusieurs cartons)
//   "votre colis SHEIN + AMAZON"    (plusieurs fournisseurs, 1 carton total — rare)
//   "votre livraison SHEIN + AMAZON" (plusieurs fournisseurs, plusieurs cartons)
//   "votre colis" / "vos cartons"   (pas d'info fournisseur — fallback)
export function describeColis(colis) {
  if (!colis) return 'votre colis';
  const n = nbCartons(colis);
  const f = fournisseursOf(colis);
  const fStr = f.join(' + ');
  if (f.length === 0) return n === 1 ? 'votre colis' : `vos ${n} cartons`;
  if (f.length === 1 && n === 1) return `votre colis ${fStr}`;
  if (f.length === 1) return `vos ${n} cartons ${fStr}`;
  if (n === 1) return `votre colis ${fStr}`;
  return `votre livraison ${fStr}`;
}

// Bloc détail des cartons groupés par fournisseur, avec ou sans mesures.
// opts.showMeasures : afficher dims + poids par carton si dimsParColis dispo
// opts.mode : 'telegram' (Markdown *bold*) ou 'email' (plain text)
export function renderCartonsDetail(colis, opts = {}) {
  const { showMeasures = false, mode = 'telegram' } = opts;
  const detail = colis?.trackingsDetail || [];
  const trackings = (colis?.trackings || []).filter((t) => t);
  const dimsPC = colis?.dimsParColis || [];
  const n = nbCartons(colis);
  if (n === 0 || (detail.length === 0 && trackings.length === 0)) return '';
  const bold = mode === 'telegram' ? '*' : '';

  // Grouper par fournisseur en préservant l'ordre d'arrivée
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const td = detail[i] || {};
    const f = td.fournisseur || 'Autre';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push({
      number: td.number || trackings[i] || '',
      dims: dimsPC[i] || null,
    });
  }

  const lines = [];
  for (const [fournisseur, cartons] of groups) {
    const lbl = cartons.length === 1 ? '1 carton' : `${cartons.length} cartons`;
    lines.push(`🛒 ${bold}${fournisseur}${bold} — ${lbl}`);
    cartons.forEach((carton, i) => {
      let line = `  ${i + 1}. Tracking : ${carton.number || '—'}`;
      if (showMeasures && carton.dims?.dimL) {
        line += `\n     📐 ${carton.dims.dimL} × ${carton.dims.dimW} × ${carton.dims.dimH} cm · ⚖️ ${carton.dims.poids} kg`;
      }
      lines.push(line);
    });
  }
  return lines.join('\n');
}

// Variante "rappel" pour le devis final : pas de tracking, juste les dims/poids
// (le client n'a plus besoin de revoir les trackings, il les a vus à la réception).
export function renderCartonsBrief(colis, opts = {}) {
  const { mode = 'telegram' } = opts;
  const detail = colis?.trackingsDetail || [];
  const dimsPC = colis?.dimsParColis || [];
  const n = nbCartons(colis);
  if (n === 0) return '';
  const bold = mode === 'telegram' ? '*' : '';

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const td = detail[i] || {};
    const f = td.fournisseur || 'Autre';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(dimsPC[i] || null);
  }

  const lines = [];
  for (const [fournisseur, dims] of groups) {
    const lbl = dims.length === 1 ? '1 carton' : `${dims.length} cartons`;
    lines.push(`🛒 ${bold}${fournisseur}${bold} — ${lbl}`);
    dims.forEach((d, i) => {
      if (d?.dimL) lines.push(`  ${i + 1}. ${d.dimL} × ${d.dimW} × ${d.dimH} cm · ${d.poids} kg`);
    });
  }
  return lines.join('\n');
}

// Date de réception formatée naturellement pour les messages clients.
// "le 22 avril" / "le 22 avril 2025" si année différente
export function fmtDateReception(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const jour = d.getDate();
  const moisStr = mois[d.getMonth()];
  const annee = d.getFullYear();
  const anneeCourante = new Date().getFullYear();
  return annee === anneeCourante ? `le ${jour} ${moisStr}` : `le ${jour} ${moisStr} ${annee}`;
}

// ══════════ RECHERCHE ══════════
export function fuzzy(haystack, needle) {
  if (!needle) return true;
  const h = (haystack || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const n = needle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terms = n.split(/\s+/).filter((t) => t);
  return terms.every((t) => h.includes(t));
}

export function searchClients(clients, q) {
  if (!q || !q.trim()) return clients;
  return clients.filter((c) => {
    const txt = `${c.nom} ${c.ville} ${c.cp} ${c.tel || ''} ${c.email || ''} ${c.type || ''}`;
    return fuzzy(txt, q);
  });
}

export function searchGlobal(clients, data, q) {
  if (!q || !q.trim()) return { clients: [], colis: [] };
  const cls = searchClients(clients, q);
  const cols = data.filter((p) => {
    const cl = clients.find((c) => c.id === p.clientId);
    const txt = `${p.ref} ${p.desc} ${cl ? cl.nom : ''} ${trackStr(p)} ${p.casier || ''}`;
    return fuzzy(txt, q);
  });
  return { clients: cls, colis: cols };
}

// ══════════ LIENS ══════════
export function telegramLink(startParam) {
  return `https://t.me/Expedilebot${startParam ? '?start=' + encodeURIComponent(startParam) : ''}`;
}

export function mailtoLink(email, msg) {
  const lines = msg.split('\n');
  const subject = lines[0].replace('Objet : ', '');
  const body = lines.slice(1).join('\n').trim();
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ══════════ VALIDATION PROFIL ══════════
export function validateProfile(d) {
  const errs = {};
  if (!d.nom || d.nom.trim().length < 2) errs.nom = 'Le nom est obligatoire (min. 2 caractères)';
  if (!d.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errs.email = 'Email invalide';
  if (d.tel && !/^\+?\d[\d\s\-]{6,18}$/.test(d.tel.replace(/\s/g, ''))) errs.tel = 'Numéro invalide (ex: +262 692 12 34 56)';
  if (!d.cp || !/^9[7-8]\d{3}$/.test(d.cp.replace(/\s/g, ''))) errs.cp = 'Code postal DOM-TOM requis (97xxx / 98xxx)';
  return errs;
}

// ══════════ FACTURE PLACEHOLDER ══════════
function faktureSvg(vendeur, montant, date) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560" viewBox="0 0 400 560">
    <rect width="400" height="560" fill="#FAFAFA" rx="8"/>
    <rect x="20" y="20" width="360" height="60" fill="#1E293B" rx="6"/>
    <text x="200" y="52" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="16" font-weight="bold">FACTURE</text>
    <text x="200" y="68" text-anchor="middle" fill="#94A3B8" font-family="Arial,sans-serif" font-size="10">${vendeur.toUpperCase()}</text>
    <line x1="20" y1="100" x2="380" y2="100" stroke="#E2E8F0" stroke-width="1"/>
    <text x="30" y="125" fill="#64748B" font-family="Arial,sans-serif" font-size="11">Date :</text>
    <text x="100" y="125" fill="#1E293B" font-family="Arial,sans-serif" font-size="11" font-weight="bold">${date}</text>
    <text x="250" y="125" fill="#64748B" font-family="Arial,sans-serif" font-size="11">Facture N° :</text>
    <text x="330" y="125" fill="#1E293B" font-family="Arial,sans-serif" font-size="11" font-weight="bold">INV-${Math.floor(Math.random() * 90000 + 10000)}</text>
    <rect x="20" y="145" width="360" height="30" fill="#F1F5F9" rx="4"/>
    <text x="30" y="164" fill="#64748B" font-family="Arial,sans-serif" font-size="10" font-weight="bold">DESCRIPTION</text>
    <text x="280" y="164" fill="#64748B" font-family="Arial,sans-serif" font-size="10" font-weight="bold">QTÉ</text>
    <text x="340" y="164" fill="#64748B" font-family="Arial,sans-serif" font-size="10" font-weight="bold">PRIX</text>
    <text x="30" y="200" fill="#334155" font-family="Arial,sans-serif" font-size="11">Article(s) ${vendeur}</text>
    <text x="285" y="200" fill="#334155" font-family="Arial,sans-serif" font-size="11">1</text>
    <text x="330" y="200" fill="#334155" font-family="Arial,sans-serif" font-size="11" font-weight="bold">${montant.toFixed(2)} €</text>
    <line x1="20" y1="220" x2="380" y2="220" stroke="#E2E8F0" stroke-width="1"/>
    <rect x="220" y="240" width="160" height="40" fill="#1E293B" rx="6"/>
    <text x="245" y="256" fill="#94A3B8" font-family="Arial,sans-serif" font-size="10">TOTAL TTC</text>
    <text x="245" y="272" fill="white" font-family="Arial,sans-serif" font-size="16" font-weight="bold">${montant.toFixed(2)} €</text>
    <rect x="20" y="480" width="360" height="60" fill="#F8FAFC" rx="6" stroke="#E2E8F0"/>
    <text x="200" y="508" text-anchor="middle" fill="#94A3B8" font-family="Arial,sans-serif" font-size="9">Ce document tient lieu de facture.</text>
    <text x="200" y="525" text-anchor="middle" fill="#94A3B8" font-family="Arial,sans-serif" font-size="9">${vendeur} — Merci pour votre achat.</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

// ══════════ DONNÉES INITIALES ══════════
export function makeData() {
  return [
    { id: 'p1', clientId: 'c1', ref: 'EXP-0001', statut: 'attente_feu_vert', trackings: ['AMZ-882939', 'AMZ-882940'], desc: 'Amazon', valeur: 89.99, dimL: 35, dimW: 25, dimH: 15, poids: 1.8, dimsParColis: [{ dimL: 35, dimW: 25, dimH: 15, poids: 1.2 }, { dimL: 22, dimW: 18, dimH: 10, poids: 0.6 }], dateReception: '2025-02-06T10:30:00.000Z', finL: null, finW: null, finH: null, finP: null, estMin: 28, estMax: 37, feuVert: 'en_attente', devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [{ id: 'f1', vendeur: 'Amazon', montant: 89.99, valide: true, fichier: faktureSvg('Amazon', 89.99, '06/02/2025'), fichierNom: 'facture-amazon-89.99.pdf' }], lignes: [{ id: 'l1', desc: 'Casque Sony WH-1000XM5', qte: 1, prix: 59.99, cat: 'c1' }, { id: 'l2', desc: 'Coque iPhone 15', qte: 1, prix: 19.99, cat: 'c4' }, { id: 'l3', desc: 'Câble USB-C', qte: 1, prix: 10.01, cat: 'c1' }], messages: [], envoi: null, casier: 'A-03' },
    { id: 'p2', clientId: 'c2', ref: 'EXP-0002', statut: 'autorise', trackings: ['UPS-773821'], desc: 'Amazon', valeur: 45, dimL: 25, dimW: 20, dimH: 25, poids: 1, dimsParColis: [], dateReception: '2025-02-05T14:15:00.000Z', finL: null, finW: null, finH: null, finP: null, estMin: 18, estMax: 25, feuVert: 'autorise', devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [{ id: 'f2', vendeur: 'Amazon', montant: 45, valide: true, fichier: faktureSvg('Amazon', 45, '04/02/2025'), fichierNom: 'facture-amazon-45.pdf' }], lignes: [{ id: 'l4', desc: 'Figurine Luffy Gear 5', qte: 1, prix: 29.99, cat: 'c6' }, { id: 'l5', desc: 'Figurine Zoro', qte: 1, prix: 15.01, cat: 'c6' }], messages: [], envoi: null, casier: 'A-07' },
    { id: 'p3', clientId: 'c3', ref: 'EXP-0003', statut: 'receptionne', trackings: ['COL-998877'], desc: 'Sephora', valeur: 65, dimL: null, dimW: null, dimH: null, poids: null, dimsParColis: [], finL: null, finW: null, finH: null, finP: null, estMin: null, estMax: null, feuVert: null, devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [], lignes: [], messages: [], envoi: null, casier: 'B-02' },
    { id: 'p4', clientId: 'c1', ref: 'EXP-0004', statut: 'receptionne', trackings: ['AMZ-556789', 'AMZ-556790', 'AMZ-556791'], desc: 'Nike', dateReception: '2025-02-08T09:00:00.000Z', valeur: 120, dimL: null, dimW: null, dimH: null, poids: null, dimsParColis: [], finL: null, finW: null, finH: null, finP: null, estMin: null, estMax: null, feuVert: null, devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [{ id: 'f3', vendeur: 'Nike', montant: 120, valide: false, fichier: faktureSvg('Nike', 120, '07/02/2025'), fichierNom: 'facture-nike-120.jpg' }], lignes: [], messages: [], envoi: null, casier: 'B-01' },
    { id: 'p5', clientId: 'c4', ref: 'EXP-0005', statut: 'paye', trackings: ['DHL-445566'], desc: 'DJI Store', dateReception: '2025-02-03T11:00:00.000Z', valeur: 299, dimL: 30, dimW: 25, dimH: 20, poids: 1.5, dimsParColis: [], finL: 28, finW: 22, finH: 18, finP: 1.3, estMin: 52, estMax: 70, feuVert: 'autorise', devisTransport: 22.18, devisOM: 28.41, devisOMR: 7.48, devisTVA: 4.93, devisTotal: 63, avantOptimTransport: 28.50, avantOptimTotal: 71.80, economie: 8.80, paiementMontant: 63, factures: [{ id: 'f4', vendeur: 'DJI Store', montant: 299, valide: true, fichier: faktureSvg('DJI Store', 299, '02/02/2025'), fichierNom: 'facture-dji-299.pdf' }], lignes: [{ id: 'l6', desc: 'DJI Mini 3 Combo', qte: 1, prix: 299, cat: 'c1' }], messages: [], envoi: 'e2', casier: 'A-12' },
    { id: 'p6', clientId: 'c5', ref: 'EXP-0006', statut: 'en_preparation', trackings: ['FDX-112233'], desc: 'BMW Parts', dateReception: '2025-02-04T16:30:00.000Z', valeur: 180, dimL: 40, dimW: 30, dimH: 20, poids: 3.5, dimsParColis: [], finL: null, finW: null, finH: null, finP: null, estMin: 35, estMax: 48, feuVert: 'autorise', devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [{ id: 'f5', vendeur: 'BMW Parts', montant: 180, valide: true, fichier: faktureSvg('BMW Parts', 180, '03/02/2025'), fichierNom: 'facture-bmw-180.pdf' }], lignes: [{ id: 'l7', desc: 'Plaquettes frein', qte: 2, prix: 45, cat: 'c7' }, { id: 'l8', desc: 'Filtre huile', qte: 1, prix: 25, cat: 'c7' }, { id: 'l9', desc: 'Courroie distrib.', qte: 1, prix: 65, cat: 'c7' }], messages: [], envoi: 'e3', casier: 'B-04' },
    { id: 'p7', clientId: 'c1', ref: 'EXP-0008', statut: 'devis_envoye', trackings: ['AMZ-112233'], desc: 'Maisons du Monde', dateReception: '2025-02-04T08:45:00.000Z', valeur: 85, dimL: 45, dimW: 35, dimH: 30, poids: 2.8, dimsParColis: [], finL: 42, finW: 32, finH: 28, finP: 2.5, estMin: 32, estMax: 43, feuVert: 'autorise', devisTransport: 37.63, devisOM: 10.63, devisOMR: 2.13, devisTVA: 4.28, devisTotal: 54.67, avantOptimTransport: 46.50, avantOptimTotal: 63.54, economie: 8.87, paiementMontant: null, factures: [{ id: 'f7', vendeur: 'Maisons du Monde', montant: 85, valide: true, fichier: faktureSvg('Maisons du Monde', 85, '03/02/2025'), fichierNom: 'facture-mdm-85.pdf' }], lignes: [{ id: 'l10', desc: 'Lampe arc design', qte: 1, prix: 55, cat: 'c5' }, { id: 'l11', desc: 'Coussins velours', qte: 2, prix: 15, cat: 'c5' }], messages: [], envoi: 'e2', casier: 'A-12' },
    { id: 'p8', clientId: 'c6', ref: 'EXP-0009', statut: 'receptionne', trackings: ['AMZ-667788'], desc: 'Samsung', dateReception: '2025-02-09T15:20:00.000Z', valeur: 350, dimL: null, dimW: null, dimH: null, poids: null, dimsParColis: [], finL: null, finW: null, finH: null, finP: null, estMin: null, estMax: null, feuVert: null, devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [{ id: 'f8', vendeur: 'Samsung', montant: 350, valide: true, fichier: faktureSvg('Samsung', 350, '08/02/2025'), fichierNom: 'facture-samsung-350.pdf' }], lignes: [{ id: 'l12', desc: 'Galaxy Tab S9', qte: 1, prix: 320, cat: 'c1' }, { id: 'l13', desc: 'Coque protection', qte: 1, prix: 30, cat: 'c4' }], messages: [], envoi: null, casier: 'C-01' },
  ];
}
