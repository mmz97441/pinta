// ══════════════════════════════════════════════════════════════════════
// Service layer : queries Supabase → format app (camelCase)
// ══════════════════════════════════════════════════════════════════════
import { supabase } from './supabase';

// ── Helpers de mapping ──────────────────────────────────────────────

// Map colis row from Supabase (snake_case) to app format (camelCase)
function mapColis(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    ref: row.ref,
    statut: row.statut,
    desc: row.desc_contenu || '',
    valeur: row.valeur_declaree,
    trackings: row.trackings || [],
    trackingsDetail: row.trackings_detail || [],
    casier: row.casier,
    dateReception: row.date_reception,
    dimL: row.dim_l ? +row.dim_l : null,
    dimW: row.dim_w ? +row.dim_w : null,
    dimH: row.dim_h ? +row.dim_h : null,
    poids: row.poids ? +row.poids : null,
    nbColis: row.nb_colis || 1,
    dimsParColis: row.dims_par_colis || [],
    finL: row.fin_l ? +row.fin_l : null,
    finW: row.fin_w ? +row.fin_w : null,
    finH: row.fin_h ? +row.fin_h : null,
    finP: row.fin_p ? +row.fin_p : null,
    poidsFact: row.poids_facturable ? +row.poids_facturable : null,
    feuVert: row.feu_vert,
    feuVertDate: row.feu_vert_date,
    estMin: row.est_min ? +row.est_min : null,
    estMax: row.est_max ? +row.est_max : null,
    devisBrouillon: row.devis_brouillon || false,
    devisTransport: row.devis_transport ? +row.devis_transport : null,
    devisOM: row.devis_om ? +row.devis_om : null,
    devisOMR: row.devis_omr ? +row.devis_omr : null,
    devisTVA: row.devis_tva ? +row.devis_tva : null,
    devisTotal: row.devis_total ? +row.devis_total : null,
    avantOptimTransport: row.avant_optim_transport ? +row.avant_optim_transport : null,
    avantOptimTotal: row.avant_optim_total ? +row.avant_optim_total : null,
    economie: row.economie ? +row.economie : 0,
    paiementMontant: row.paiement_montant ? +row.paiement_montant : null,
    paiementDate: row.paiement_date,
    envoi: row.envoi_id,
    urgence: row.urgence || false,
    notesInternes: row.notes_internes,
    produitInterdit: row.produit_interdit || false,
    checkInterdits: row.check_interdits || [],
    casierHistorique: row.casier_historique || [],
    tagsPreparation: row.tags_preparation || [],
    notesReception: row.notes_reception || null,
    commentairePreparation: row.commentaire_preparation || null,
    createdAt: row.created_at,
    // Relations (loaded separately or joined)
    factures: row._factures || [],
    lignes: row._lignes || [],
    messages: row._messages || [],
  };
}

function mapClient(row) {
  return {
    id: row.id,
    userId: row.user_id,
    nom: row.nom + (row.prenom ? ' ' + row.prenom : ''),
    ville: row.ville,
    cp: row.cp,
    tel: row.tel,
    email: row.email,
    canal: row.canal,
    type: row.type,
    points: row.points || 0,
    notes: row.notes,
    onboarded: row.onboarded || false,
    created: row.created_at,
    abonnement: row.abonnement || 'freemium',
    abonnementDebut: row.abonnement_debut,
    abonnementFin: row.abonnement_fin,
    methode_paiement: row.methode_paiement,
  };
}

function mapEnvoi(row) {
  return {
    id: row.id,
    ref: row.ref,
    date: row.date_depart,
    statut: row.statut,
    destinationCode: row.destination_code,
    transporteur: row.transporteur,
    trackingPrincipal: row.tracking_principal,
    nbColis: row.nb_colis || 0,
    poidsTotal: row.poids_total ? +row.poids_total : 0,
    volumeTotal: row.volume_total ? +row.volume_total : 0,
    notes: row.notes,
  };
}

function mapCategorie(row, tauxRows) {
  const taux = {};
  tauxRows
    .filter((t) => t.categorie_id === row.id)
    .forEach((t) => {
      taux[t.destination_code] = { om: +t.om, omr: +t.omr };
    });
  return {
    id: row.id,
    label: row.label,
    custom: row.custom,
    codeHs: row.code_hs || '',
    taux,
  };
}

function mapFact(row) {
  return {
    id: row.id,
    vendeur: row.vendeur,
    montant: row.montant ? +row.montant : 0,
    valide: row.valide || false,
    fichier: row.fichier_url,
    fichierNom: row.fichier_nom,
  };
}

function mapLigne(row) {
  return {
    id: row.id,
    desc: row.description,
    qte: row.qte,
    prix: row.prix_unitaire ? +row.prix_unitaire : 0,
    cat: row.categorie_id,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    type: row.type,
    auteur: row.auteur_nom || 'Système',
    texte: row.texte,
    heure: row.created_at
      ? new Date(row.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '',
    statut: row.statut,
    msgId: row.msg_id || row.wa_id,
  };
}

// ── Fetch functions ─────────────────────────────────────────────────

export async function fetchClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(mapClient);
}

export async function fetchColis() {
  // Fetch colis + relations in parallel
  const [colisRes, factRes, lignesRes, msgRes] = await Promise.all([
    supabase.from('colis').select('*').order('created_at', { ascending: false }),
    supabase.from('factures').select('*'),
    supabase.from('lignes').select('*'),
    supabase.from('messages').select('*').order('created_at', { ascending: true }),
  ]);

  if (colisRes.error) throw colisRes.error;

  const facsByColisId = {};
  (factRes.data || []).forEach((f) => {
    if (!facsByColisId[f.colis_id]) facsByColisId[f.colis_id] = [];
    facsByColisId[f.colis_id].push(mapFact(f));
  });

  const lignesByColisId = {};
  (lignesRes.data || []).forEach((l) => {
    if (!lignesByColisId[l.colis_id]) lignesByColisId[l.colis_id] = [];
    lignesByColisId[l.colis_id].push(mapLigne(l));
  });

  const msgsByColisId = {};
  (msgRes.data || []).forEach((m) => {
    if (!msgsByColisId[m.colis_id]) msgsByColisId[m.colis_id] = [];
    msgsByColisId[m.colis_id].push(mapMessage(m));
  });

  return colisRes.data.map((row) => mapColis({
    ...row,
    _factures: facsByColisId[row.id] || [],
    _lignes: lignesByColisId[row.id] || [],
    _messages: msgsByColisId[row.id] || [],
  }));
}

export async function fetchEnvois() {
  const { data, error } = await supabase
    .from('envois')
    .select('*')
    .order('date_depart', { ascending: true });
  if (error) throw error;
  return data.map(mapEnvoi);
}

export async function fetchCategories() {
  const [catRes, tauxRes] = await Promise.all([
    supabase.from('categories').select('*').order('position'),
    supabase.from('taux_categories').select('*'),
  ]);
  if (catRes.error) throw catRes.error;
  return catRes.data.map((c) => mapCategorie(c, tauxRes.data || []));
}

export async function fetchTarifs() {
  const { data, error } = await supabase
    .from('tarifs')
    .select('*')
    .eq('actif', true);
  if (error) throw error;
  const obj = {};
  data.forEach((t) => {
    obj[t.destination_code] = { base: +t.base, parKg: +t.par_kg };
  });
  return obj;
}

export async function fetchNotifications(userId) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data.map((n) => ({
    id: n.id,
    date: new Date(n.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    titre: n.titre,
    msg: n.msg,
    lu: n.lu,
    colisId: n.colis_id,
  }));
}

// ── Mutations ───────────────────────────────────────────────────────

export async function updateColis(id, changes) {
  // Convert camelCase to snake_case
  const snakeChanges = {};
  const map = {
    statut: 'statut', desc: 'desc_contenu', casier: 'casier',
    dimL: 'dim_l', dimW: 'dim_w', dimH: 'dim_h', poids: 'poids',
    finL: 'fin_l', finW: 'fin_w', finH: 'fin_h', finP: 'fin_p',
    feuVert: 'feu_vert', feuVertDate: 'feu_vert_date',
    devisBrouillon: 'devis_brouillon',
    devisTransport: 'devis_transport', devisOM: 'devis_om',
    devisOMR: 'devis_omr', devisTVA: 'devis_tva', devisTotal: 'devis_total',
    avantOptimTransport: 'avant_optim_transport', avantOptimTotal: 'avant_optim_total',
    economie: 'economie', paiementMontant: 'paiement_montant',
    paiementDate: 'paiement_date', dateReception: 'date_reception',
    envoi: 'envoi_id', urgence: 'urgence', notesInternes: 'notes_internes',
    produitInterdit: 'produit_interdit', checkInterdits: 'check_interdits',
    poidsFact: 'poids_facturable', trackings: 'trackings',
    trackingsDetail: 'trackings_detail',
    dimsParColis: 'dims_par_colis', nbColis: 'nb_colis',
    valeur: 'valeur_declaree',
    casierHistorique: 'casier_historique',
    tagsPreparation: 'tags_preparation',
    notesReception: 'notes_reception',
    commentairePreparation: 'commentaire_preparation',
  };

  for (const [key, val] of Object.entries(changes)) {
    const snakeKey = map[key] || key;
    snakeChanges[snakeKey] = val;
  }

  const { error } = await supabase
    .from('colis')
    .update(snakeChanges)
    .eq('id', id);
  if (error) throw error;
}

export async function insertColis(colisData) {
  const row = {
    client_id: colisData.clientId,
    desc_contenu: colisData.desc || null,
    trackings: colisData.trackings || [],
    trackings_detail: colisData.trackingsDetail || [],
    casier: colisData.casier || null,
    date_reception: colisData.dateReception || new Date().toISOString(),
    valeur_declaree: colisData.valeur || null,
    notes_reception: colisData.notesReception || null,
    cree_par: colisData.creePar || null,
    nb_colis: colisData.nbColis || 1,
  };
  // Dims if provided
  if (colisData.dimL) row.dim_l = colisData.dimL;
  if (colisData.dimW) row.dim_w = colisData.dimW;
  if (colisData.dimH) row.dim_h = colisData.dimH;
  if (colisData.poids) row.poids = colisData.poids;
  if (colisData.dimsParColis?.length > 0) row.dims_par_colis = colisData.dimsParColis;
  // Override statut if provided (e.g., 'mesure' when dims are filled at reception)
  if (colisData.statut && colisData.statut !== 'receptionne') row.statut = colisData.statut;

  const { data, error } = await supabase
    .from('colis')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return mapColis({ ...data, _factures: [], _lignes: [], _messages: [] });
}

export async function updateClient(id, changes) {
  const snakeChanges = {};
  const map = {
    nom: 'nom', prenom: 'prenom', ville: 'ville', cp: 'cp',
    tel: 'tel', email: 'email', canal: 'canal', type: 'type',
    points: 'points', notes: 'notes', onboarded: 'onboarded',
    abonnement: 'abonnement',
    abonnementDebut: 'abonnement_debut',
    abonnementFin: 'abonnement_fin',
    methodePaiement: 'methode_paiement',
  };
  for (const [key, val] of Object.entries(changes)) {
    snakeChanges[map[key] || key] = val;
  }
  const { error } = await supabase.from('clients').update(snakeChanges).eq('id', id);
  if (error) throw error;
}

export async function insertMessage(colisId, msg) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      colis_id: colisId,
      type: msg.type,
      auteur_id: msg.auteurId || null,
      auteur_nom: msg.auteur,
      texte: msg.texte,
      statut: msg.statut || null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapMessage(data);
}

export async function markNotifRead(notifId) {
  const { error } = await supabase
    .from('notifications')
    .update({ lu: true })
    .eq('id', notifId);
  if (error) throw error;
}

export async function markAllNotifsRead(userId) {
  const { error } = await supabase
    .from('notifications')
    .update({ lu: true })
    .eq('user_id', userId)
    .eq('lu', false);
  if (error) throw error;
}

export async function insertClient(clientData) {
  // Split nom if it contains both nom + prenom (legacy format "FONTAINE Flavie")
  let nom = clientData.nom;
  let prenom = clientData.prenom || null;
  if (!prenom && nom && nom.includes(' ')) {
    const parts = nom.split(' ');
    // Don't split if it looks like a company name
    if (clientData.type !== 'pro') {
      nom = parts[0];
      prenom = parts.slice(1).join(' ');
    }
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({
      nom,
      prenom,
      ville: clientData.ville || null,
      cp: clientData.cp,
      tel: clientData.tel || null,
      email: clientData.email || null,
      canal: clientData.canal || 'telegram',
      type: clientData.type || 'particulier',
      points: clientData.points || 0,
      onboarded: clientData.onboarded || false,
      notes: clientData.notes || null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapClient(data);
}

export async function deleteClient(id) {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
}

export async function insertEnvoi(envoiData) {
  const { data, error } = await supabase
    .from('envois')
    .insert({
      date_depart: envoiData.date,
      statut: envoiData.statut || 'planifie',
      destination_code: envoiData.destinationCode || null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapEnvoi(data);
}

export async function updateEnvoi(id, changes) {
  const snakeChanges = {};
  const map = {
    date: 'date_depart', statut: 'statut', destinationCode: 'destination_code',
    transporteur: 'transporteur', trackingPrincipal: 'tracking_principal',
    notes: 'notes',
  };
  for (const [key, val] of Object.entries(changes)) {
    snakeChanges[map[key] || key] = val;
  }
  const { error } = await supabase.from('envois').update(snakeChanges).eq('id', id);
  if (error) throw error;
}

export async function deleteEnvoi(id) {
  const { error } = await supabase.from('envois').delete().eq('id', id);
  if (error) throw error;
}

// ── Realtime subscriptions ──────────────────────────────────────────

export function subscribeColis(callback) {
  return supabase
    .channel('colis-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'colis' }, callback)
    .subscribe();
}

export function subscribeMessages(callback) {
  return supabase
    .channel('messages-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, callback)
    .subscribe();
}

export function subscribeNotifications(userId, callback) {
  return supabase
    .channel('notifs-changes')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    }, callback)
    .subscribe();
}
