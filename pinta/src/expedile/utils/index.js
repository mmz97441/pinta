import { getDestByCP } from '../constants';

// ══════════ FORMATAGE ══════════
export function eur(n) {
  return (n || 0).toFixed(2) + ' €';
}

export function uid() {
  return Math.random().toString(36).slice(2, 8);
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
  return tarif.base + poids * tarif.parKg;
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
export function waLink(tel, msg) {
  return `https://wa.me/${tel.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`;
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

// ══════════ DONNÉES INITIALES ══════════
export function makeData() {
  return [
    { id: 'p1', clientId: 'c1', ref: 'EXP-0001', statut: 'attente_feu_vert', trackings: ['AMZ-882939', 'AMZ-882940'], desc: 'Casque Sony + Coque iPhone', valeur: 89.99, dimL: 35, dimW: 25, dimH: 15, poids: 1.8, dimsParColis: [{ dimL: 35, dimW: 25, dimH: 15, poids: 1.2 }, { dimL: 22, dimW: 18, dimH: 10, poids: 0.6 }], finL: null, finW: null, finH: null, finP: null, estMin: 28, estMax: 37, feuVert: 'en_attente', devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [{ id: 'f1', vendeur: 'Amazon', montant: 89.99, valide: true }], lignes: [{ id: 'l1', desc: 'Casque Sony WH-1000XM5', qte: 1, prix: 59.99, cat: 'c1' }, { id: 'l2', desc: 'Coque iPhone 15', qte: 1, prix: 19.99, cat: 'c4' }, { id: 'l3', desc: 'Câble USB-C', qte: 1, prix: 10.01, cat: 'c1' }], messages: [], envoi: null, casier: 'A-03' },
    { id: 'p2', clientId: 'c2', ref: 'EXP-0002', statut: 'autorise', trackings: ['UPS-773821'], desc: 'Figurines manga One Piece', valeur: 45, dimL: 25, dimW: 20, dimH: 25, poids: 1, dimsParColis: [], finL: null, finW: null, finH: null, finP: null, estMin: 18, estMax: 25, feuVert: 'autorise', devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [{ id: 'f2', vendeur: 'Amazon', montant: 45, valide: true }], lignes: [{ id: 'l4', desc: 'Figurine Luffy Gear 5', qte: 1, prix: 29.99, cat: 'c6' }, { id: 'l5', desc: 'Figurine Zoro', qte: 1, prix: 15.01, cat: 'c6' }], messages: [], envoi: null, casier: 'A-07' },
    { id: 'p3', clientId: 'c3', ref: 'EXP-0003', statut: 'annonce', trackings: ['COL-998877'], desc: 'Cosmétiques Sephora', valeur: 65, dimL: null, dimW: null, dimH: null, poids: null, dimsParColis: [], finL: null, finW: null, finH: null, finP: null, estMin: null, estMax: null, feuVert: null, devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [], lignes: [], messages: [], envoi: null, casier: null },
    { id: 'p4', clientId: 'c1', ref: 'EXP-0004', statut: 'receptionne', trackings: ['AMZ-556789', 'AMZ-556790', 'AMZ-556791'], desc: 'Vêtements Nike', valeur: 120, dimL: null, dimW: null, dimH: null, poids: null, dimsParColis: [], finL: null, finW: null, finH: null, finP: null, estMin: null, estMax: null, feuVert: null, devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [{ id: 'f3', vendeur: 'Nike', montant: 120, valide: false }], lignes: [], messages: [], envoi: null, casier: 'B-01' },
    { id: 'p5', clientId: 'c4', ref: 'EXP-0005', statut: 'paye', trackings: ['DHL-445566'], desc: 'Drone DJI Mini 3', valeur: 299, dimL: 30, dimW: 25, dimH: 20, poids: 1.5, dimsParColis: [], finL: 28, finW: 22, finH: 18, finP: 1.3, estMin: 52, estMax: 70, feuVert: 'autorise', devisTransport: 22.18, devisOM: 28.41, devisOMR: 7.48, devisTVA: 4.93, devisTotal: 63, avantOptimTransport: 28.50, avantOptimTotal: 71.80, economie: 8.80, paiementMontant: 63, factures: [{ id: 'f4', vendeur: 'DJI Store', montant: 299, valide: true }], lignes: [{ id: 'l6', desc: 'DJI Mini 3 Combo', qte: 1, prix: 299, cat: 'c1' }], messages: [], envoi: 'e2', casier: 'A-12' },
    { id: 'p6', clientId: 'c5', ref: 'EXP-0006', statut: 'en_preparation', trackings: ['FDX-112233'], desc: 'Pièces auto BMW', valeur: 180, dimL: 40, dimW: 30, dimH: 20, poids: 3.5, dimsParColis: [], finL: null, finW: null, finH: null, finP: null, estMin: 35, estMax: 48, feuVert: 'autorise', devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [{ id: 'f5', vendeur: 'BMW Parts', montant: 180, valide: true }], lignes: [{ id: 'l7', desc: 'Plaquettes frein', qte: 2, prix: 45, cat: 'c7' }, { id: 'l8', desc: 'Filtre huile', qte: 1, prix: 25, cat: 'c7' }, { id: 'l9', desc: 'Courroie distrib.', qte: 1, prix: 65, cat: 'c7' }], messages: [], envoi: 'e3', casier: 'B-04' },
    { id: 'p7', clientId: 'c1', ref: 'EXP-0008', statut: 'attente_paiement', trackings: ['AMZ-112233'], desc: 'Lampe + coussins déco', valeur: 85, dimL: 45, dimW: 35, dimH: 30, poids: 2.8, dimsParColis: [], finL: 42, finW: 32, finH: 28, finP: 2.5, estMin: 32, estMax: 43, feuVert: 'autorise', devisTransport: 37.63, devisOM: 10.63, devisOMR: 2.13, devisTVA: 4.28, devisTotal: 54.67, avantOptimTransport: 46.50, avantOptimTotal: 63.54, economie: 8.87, paiementMontant: null, factures: [{ id: 'f7', vendeur: 'Maisons du Monde', montant: 85, valide: true }], lignes: [{ id: 'l10', desc: 'Lampe arc design', qte: 1, prix: 55, cat: 'c5' }, { id: 'l11', desc: 'Coussins velours', qte: 2, prix: 15, cat: 'c5' }], messages: [], envoi: 'e2', casier: 'A-12' },
    { id: 'p8', clientId: 'c6', ref: 'EXP-0009', statut: 'receptionne', trackings: ['AMZ-667788'], desc: 'Tablette Samsung + Coque', valeur: 350, dimL: null, dimW: null, dimH: null, poids: null, dimsParColis: [], finL: null, finW: null, finH: null, finP: null, estMin: null, estMax: null, feuVert: null, devisTransport: null, devisOM: null, devisOMR: null, devisTVA: null, devisTotal: null, paiementMontant: null, factures: [{ id: 'f8', vendeur: 'Samsung', montant: 350, valide: true }], lignes: [{ id: 'l12', desc: 'Galaxy Tab S9', qte: 1, prix: 320, cat: 'c1' }, { id: 'l13', desc: 'Coque protection', qte: 1, prix: 30, cat: 'c4' }], messages: [], envoi: null, casier: 'C-01' },
  ];
}
