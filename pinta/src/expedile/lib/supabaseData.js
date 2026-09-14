// ══════════════════════════════════════════════════════════════════════
// Service layer : queries Supabase → format app (camelCase)
// ══════════════════════════════════════════════════════════════════════
import { supabase } from './supabase';
import { randomId } from './randomId';
import { normalizeStaffPermissions, staffPermissionSaveArgs } from '../domain/staffPermissions';

let dataScope = 'staff';
export function setDataScope(type) {
  dataScope = type === 'client' ? 'client' : 'staff';
}
const readTable = (table) =>
  dataScope === 'client' && ['clients', 'colis'].includes(table) ? `client_${table}` : table;

// ── Helpers de mapping ──────────────────────────────────────────────

// Map colis row from Supabase (snake_case) to app format (camelCase)
export function mapColis(row) {
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
    dateExpedition: row.date_expedition,
    dateLivraison: row.date_livraison || null,
    devisEnvoyeLe: row.devis_envoye_le,
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
    finalPackages: row.final_packages || [],
    preparationCompositionVersion: row.preparation_composition_version ?? 0,
    finalMeasurementsVersion: row.final_measurements_version ?? null,
    finalMeasurementsAt: row.final_measurements_at || null,
    outgoingParcelCount: row.outgoing_parcel_count ?? null,
    destinationCode: row.destination_code || null,
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
    fraisDivers: row.frais_divers || [],
    modePaiementPro: row.mode_paiement_pro || null,
    photoReception: row.photo_reception || false,
    photoReceptionUrl: row.photo_reception_url || null,
    photoPrep: row.photo_prep || null,
    archive: row.archive || false,
    payplugPaymentId: row.payplug_payment_id || null,
    payplugPaymentUrl: row.payplug_payment_url || null,
    updatedAt: row.updated_at,
    statutUpdatedAt: row.statut_updated_at || null,
    conversationStatut: row.conversation_statut || null,
    conversationVersion: row.conversation_version ?? 0,
    conversationUpdatedAt: row.conversation_updated_at || null,
    conversationOpenedAt: row.conversation_opened_at || null,
    conversationResolvedAt: row.conversation_resolved_at || null,
    quoteVersion: row.quote_version || 0,
    devisSnapshot: row.devis_snapshot || null,
    attenteClientMotif: row.attente_client_motif || null,
    attenteClientDate: row.attente_client_date || null,
    attenteClientUntil: row.attente_client_until || null,
    demandeFeuVertEnvoyeeAt: row.demande_feu_vert_envoyee_at || null,
    responsibleStaffId: row.responsible_staff_id || null,
    nextActionAt: row.next_action_at || null,
    nextAction: row.next_action || null,
    nextActionSource: row.next_action_source || 'system',
    createdAt: row.created_at,
    // Relations (loaded separately or joined)
    factures: row._factures || [],
    lignes: row._lignes || [],
    messages: row._messages || [],
  };
}

export function mapClient(row) {
  return {
    id: row.id,
    userId: row.user_id,
    ref: row.ref || null,
    nom: (row.nom || '') + (row.prenom ? ' ' + row.prenom : ''),
    nomFamille: row.nom || '',
    prenom: row.prenom || '',
    genre: row.genre || null,
    dateNaissance: row.date_naissance || null,
    ville: row.ville,
    adresse: row.adresse || '',
    adresseLigne1: row.adresse_ligne1 || '',
    adresseLigne2: row.adresse_ligne2 || '',
    commune: row.commune || '',
    infosLivraison: row.infos_livraison || '',
    cp: row.cp,
    tel: row.tel,
    telFixe: row.tel_fixe || '',
    email: row.email,
    canal: row.canal,
    type: row.type,
    modePaiement: row.mode_paiement || 'colis',
    points: row.points || 0,
    notes: row.notes,
    onboarded: row.onboarded || false,
    created: row.created_at,
    abonnement: row.abonnement || 'freemium',
    abonnementDebut: row.abonnement_debut,
    abonnementFin: row.abonnement_fin,
    methode_paiement: row.methode_paiement,
    methodePaiement: row.methode_paiement,
    telegramChatId: row.telegram_chat_id || null,
    telegramUsername: row.telegram_username || null,
    // Pro fields
    raisonSociale: row.raison_sociale || '',
    siret: row.siret || '',
    interlocuteur: row.interlocuteur || '',
  };
}

export function mapEnvoi(row) {
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
    updatedAt: row.updated_at,
    loadingClosesAt: row.loading_closes_at || null,
    departedAt: row.departed_at || null,
    manifestVersion: row.manifest_version || 0,
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

export function mapFact(row) {
  return {
    id: row.id,
    vendeur: row.vendeur,
    montant: row.montant ? +row.montant : 0,
    valide: row.valide || false,
    fichier: row.fichier_url,
    fichierNom: row.fichier_nom,
    replacesFactureId: row.replaces_facture_id || null,
    rejetMotif: row.rejet_motif || null,
    telegramMsgId: row.telegram_msg_id || null,
    ocrStatus: row.ocr_status || null,
    ocrResult: row.ocr_result || null,
    ocrError: row.ocr_error || null,
  };
}

export function mapLigne(row) {
  return {
    id: row.id,
    desc: row.description,
    qte: row.qte,
    prix: row.prix_unitaire ? +row.prix_unitaire : 0,
    cat: row.categorie_id,
    factureId: row.facture_id || null,
  };
}

function formatMessageDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (msgDay.getTime() === today.getTime()) return time;
  if (msgDay.getTime() === yesterday.getTime()) return `Hier ${time}`;
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${time}`;
}

export function mapMessage(row) {
  return {
    id: row.id,
    type: row.type,
    auteur: row.auteur_nom || 'Système',
    texte: row.texte,
    heure: formatMessageDate(row.created_at),
    createdAt: row.created_at,
    statut: row.statut,
    msgId: row.msg_id || row.wa_id,
    lu: row.lu || false,
    attachmentPath: row.attachment_path || null,
    attachmentName: row.attachment_name || null,
    attachmentType: row.attachment_type || null,
  };
}

// ── Fetch functions ─────────────────────────────────────────────────

// Keyset pagination avoids PostgREST's default row cap and unstable offsets.
export async function fetchAllRows(table, configure = (query) => query, cursorKey = 'id', columns = '*') {
  const rows = [];
  let after = null;
  for (;;) {
    let query = configure(supabase.from(readTable(table)).select(columns))
      .order(cursorKey)
      .limit(500);
    if (after) query = query.gt(cursorKey, after);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data?.length || data.length < 500) break;
    const next = data[data.length - 1][cursorKey];
    if (next === after) throw new Error('Pagination interrompue : curseur inchangé');
    after = next;
  }
  return rows;
}

export async function fetchClients() {
  return (await fetchAllRows('clients'))
    .map(mapClient)
    .sort((a, b) => (b.created || '').localeCompare(a.created || ''));
}

// Only a complete modern or historical reference triggers a server lookup.
// Normalize pasted typographic hyphens without treating arbitrary search text as a reference.
export function normalizeColisReference(value) {
  const reference = String(value || '').normalize('NFKC').trim().toUpperCase()
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/\s*-\s*/g, '-');
  return /^EXP-(?:[A-Z0-9]{6}|\d{4,})$/.test(reference) ? reference : '';
}

export async function findColisByReference(value, { signal } = {}) {
  const reference = normalizeColisReference(value);
  if (!reference) return null;
  // RLS enforces staff access. No archive, creator or working-view filter belongs here.
  let query = supabase.from('colis').select('id,ref,statut,archive').ilike('ref', reference).limit(2);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  if (data?.length > 1) throw new Error('Plusieurs dossiers portent cette référence. Faites vérifier leur référence par la direction.');
  return data?.[0] || null;
}

export async function fetchColis(colisId = null, { archived = false, clientId = null, envoiId = null } = {}) {
  const scope = (q) => colisId ? q.eq('id', colisId) : clientId ? q.eq('client_id', clientId) : envoiId ? q.eq('envoi_id', envoiId) : q.eq('archive', archived);
  const colisRows = await fetchAllRows('colis', scope);
  if (!colisRows.length) return [];
  const grouped = { factures: {}, lignes: {}, messages: {} };
  const mappers = { factures: mapFact, lignes: mapLigne, messages: mapMessage };
  // Load only relations belonging to the requested working set, in bounded requests.
  for (let i = 0; i < colisRows.length; i += 100) {
    const ids = colisRows.slice(i, i + 100).map((c) => c.id);
    const result = await Promise.all(
      Object.keys(grouped).map(async (table) => [
        table,
        await fetchAllRows(table, (q) => q.in('colis_id', ids)),
      ]),
    );
    for (const [table, rows] of result)
      for (const row of rows) {
        (grouped[table][row.colis_id] ||= []).push(mappers[table](row));
      }
  }
  return colisRows
    .map((row) =>
      mapColis({
        ...row,
        _factures: grouped.factures[row.id] || [],
        _lignes: grouped.lignes[row.id] || [],
        _messages: (grouped.messages[row.id] || []).sort((a, b) =>
          (a.createdAt || '').localeCompare(b.createdAt || ''),
        ),
      }),
    )
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function resolveIdentity(session) {
  if (!session?.user) return null;
  const userId = session.user.id;
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw new Error('Profil inaccessible. Contactez l’équipe Expedîle.');
  if (profile.actif === false) throw new Error('Ce compte est désactivé.');
  if (['directeur', 'vice_directeur', 'logisticien', 'preparateur'].includes(profile.role)) {
    const { data: staff, error: staffError } = await supabase
      .from('staff_users')
      .select('*, staff_permissions(*)')
      .eq('auth_id', userId)
      .maybeSingle();
    if (staffError) throw staffError;
    if (!staff || staff.actif === false)
      throw new Error('Accès équipe non activé. Contactez la direction.');
    return {
      type: 'staff',
      session,
      u: {
        id: userId,
        staffId: staff.id,
        role: profile.role,
        nom: staff.nom || profile.nom || '',
        prenom: staff.prenom || '',
        email: session.user.email,
        mustChangePassword: !!staff.must_change_password,
        permissions: normalizeStaffPermissions(staff.staff_permissions),
      },
    };
  }
  if (profile.role !== 'client') throw new Error('Rôle de compte non reconnu.');
  const { data: client, error: clientError } = await supabase
    .from('client_clients')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (clientError || !client)
    throw new Error(
      'Votre compte n’est pas encore rattaché à un dossier client. Contactez l’équipe.',
    );
  return { type: 'client', session, cl: mapClient(client) };
}

export async function fetchEnvois() {
  return (await fetchAllRows('envois'))
    .map(mapEnvoi)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

export async function fetchCategories() {
  const [catRes, tauxRes] = await Promise.all([
    supabase.from('categories').select('*').order('position'),
    supabase.from('taux_categories').select('*'),
  ]);
  if (catRes.error) throw catRes.error;
  if (tauxRes.error) throw tauxRes.error;
  return catRes.data.map((c) => mapCategorie(c, tauxRes.data || []));
}

export async function fetchTarifs() {
  const { data, error } = await supabase.from('tarifs').select('*').eq('actif', true);
  if (error) throw error;
  const obj = {};
  data.forEach((t) => {
    obj[t.destination_code] = { base: +t.base, parKg: +t.par_kg };
  });
  return obj;
}

// ══════════ STAFF USERS & PERMISSIONS ══════════

export async function fetchStaffUsers() {
  const { data, error } = await supabase
    .from('staff_users')
    .select('*, staff_permissions(*)')
    .order('nom');
  if (error) throw error;
  return (data || []).map((u) => ({
    id: u.id,
    authId: u.auth_id,
    nom: u.nom,
    prenom: u.prenom,
    email: u.email,
    role: u.role,
    actif: u.actif,
    mustChangePassword: u.must_change_password || false,
    permissions: normalizeStaffPermissions(u.staff_permissions),
  }));
}

export async function insertStaffUser(userData) {
  const { data, error } = await supabase
    .from('staff_users')
    .insert({
      nom: userData.nom,
      prenom: userData.prenom || null,
      email: userData.email,
      role: userData.role || 'preparateur',
    })
    .select()
    .single();
  if (error) throw error;
  // Create default permissions via SQL function
  const { data: defaults } = await supabase.rpc('fn_default_permissions', { p_role: data.role });
  const permsRow = { staff_id: data.id, ...(defaults || {}) };
  await supabase.from('staff_permissions').insert(permsRow);
  return data;
}

export async function updateStaffUser(id, changes) {
  const { error } = await supabase.from('staff_users').update(changes).eq('id', id);
  if (error) throw error;
}

export async function updateStaffPermissions(staffId, perms, { expectedPermissions } = {}) {
  const args = staffPermissionSaveArgs(staffId, perms, expectedPermissions);
  const { data, error } = await supabase.rpc('save_staff_permissions', args);
  if (error) throw error;
  const saved = normalizeStaffPermissions(data);
  if (!saved || saved.staff_id !== staffId)
    throw new Error('Enregistrement non confirmé. Rechargez les permissions pour vérifier leur état.');
  return saved;
}

export async function deleteStaffUser(id) {
  const { error } = await supabase.from('staff_users').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchNotificationPage(userId, limit = 50) {
  const [page, unread] = await Promise.all([supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, limit - 1),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('lu', false),
  ]);
  if (page.error) throw page.error;
  if (unread.error) throw unread.error;
  const rows = (page.data || []).map((n) => ({
    id: n.id,
    date: n.created_at,
    titre: n.titre,
    msg: n.msg,
    lu: n.lu,
    colisId: n.colis_id,
    type: n.type || null,
  }));
  return { rows, total: page.count ?? rows.length, unread: unread.count ?? rows.filter((n) => !n.lu).length };
}

export async function fetchNotifications(userId) {
  return (await fetchNotificationPage(userId)).rows;
}

export async function fetchStaffWork() {
  const { error } = await supabase.rpc('refresh_staff_work_actions');
  if (error) throw error;
  const [actions, preferences] = await Promise.all([
    fetchAllRows('staff_work_actions', (query) => query.neq('state', 'done')),
    fetchAllRows('staff_work_preferences', (query) => query, 'staff_id'),
  ]);
  return { actions, preferences };
}

export async function mutateStaffWorkAction(action, command, payload = {}) {
  const { data, error } = await supabase.rpc('mutate_staff_work_action', {
    p_action_id: action.id, p_command: command, p_expected_version: action.version, p_payload: payload,
  });
  if (error) throw error;
  const saved = Array.isArray(data) ? data[0] : data;
  if (!saved?.id) throw new Error('La modification du travail n’a pas été confirmée. Actualisez la liste.');
  return saved;
}

export async function saveStaffWorkPreferences(changes, expectedVersion = null) {
  const { data, error } = await supabase.rpc('save_staff_work_preferences', {
    p_preferences: changes, p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const saved = Array.isArray(data) ? data[0] : data;
  if (!saved?.staff_id) throw new Error('Les préférences n’ont pas été confirmées.');
  return saved;
}

// ── Mutations ───────────────────────────────────────────────────────

export async function updateColis(id, changes, expectedUpdatedAt) {
  // Convert camelCase to snake_case
  const snakeChanges = {};
  const map = {
    statut: 'statut',
    desc: 'desc_contenu',
    casier: 'casier',
    dimL: 'dim_l',
    dimW: 'dim_w',
    dimH: 'dim_h',
    poids: 'poids',
    finL: 'fin_l',
    finW: 'fin_w',
    finH: 'fin_h',
    finP: 'fin_p',
    feuVert: 'feu_vert',
    feuVertDate: 'feu_vert_date',
    devisBrouillon: 'devis_brouillon',
    devisTransport: 'devis_transport',
    devisOM: 'devis_om',
    devisOMR: 'devis_omr',
    devisTVA: 'devis_tva',
    devisTotal: 'devis_total',
    avantOptimTransport: 'avant_optim_transport',
    avantOptimTotal: 'avant_optim_total',
    economie: 'economie',
    paiementMontant: 'paiement_montant',
    paiementDate: 'paiement_date',
    dateReception: 'date_reception',
    envoi: 'envoi_id',
    urgence: 'urgence',
    notesInternes: 'notes_internes',
    produitInterdit: 'produit_interdit',
    checkInterdits: 'check_interdits',
    poidsFact: 'poids_facturable',
    trackings: 'trackings',
    trackingsDetail: 'trackings_detail',
    dimsParColis: 'dims_par_colis',
    nbColis: 'nb_colis',
    valeur: 'valeur_declaree',
    casierHistorique: 'casier_historique',
    tagsPreparation: 'tags_preparation',
    notesReception: 'notes_reception',
    commentairePreparation: 'commentaire_preparation',
    fraisDivers: 'frais_divers',
    modePaiementPro: 'mode_paiement_pro',
    photoReception: 'photo_reception',
    photoReceptionUrl: 'photo_reception_url',
    photoPrep: 'photo_prep',
    archive: 'archive',
    payplugPaymentId: 'payplug_payment_id',
    payplugPaymentUrl: 'payplug_payment_url',
    devisSnapshot: 'devis_snapshot',
    attenteClientMotif: 'attente_client_motif',
    attenteClientDate: 'attente_client_date',
    attenteClientUntil: 'attente_client_until',
    demandeFeuVertEnvoyeeAt: 'demande_feu_vert_envoyee_at',
    responsibleStaffId: 'responsible_staff_id',
    nextActionAt: 'next_action_at',
    nextAction: 'next_action',
  };

  for (const [key, val] of Object.entries(changes)) {
    if (!map[key]) throw new Error(`Champ colis non pris en charge : ${key}`);
    snakeChanges[map[key]] = val;
  }
  let query = supabase.from('colis').update(snakeChanges).eq('id', id);
  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
  const { data, error } = await query.select().maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error('Ce dossier a été modifié par un collègue. Rechargez-le avant de réessayer.');
  return mapColis(data);
}

function generateRandomRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return (
    'EXP-' +
    Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  );
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
    check_interdits: colisData.checkInterdits || [],
    produit_interdit: Boolean(colisData.produitInterdit),
  };
  // Dims if provided
  if (colisData.dimL) row.dim_l = colisData.dimL;
  if (colisData.dimW) row.dim_w = colisData.dimW;
  if (colisData.dimH) row.dim_h = colisData.dimH;
  if (colisData.poids) row.poids = colisData.poids;
  if (colisData.dimsParColis?.length > 0) row.dims_par_colis = colisData.dimsParColis;
  // Override statut if provided (e.g., 'mesure' when dims are filled at reception)
  if (colisData.statut && colisData.statut !== 'receptionne') row.statut = colisData.statut;

  // Retry with new ref on unique constraint violation (max 5 attempts)
  for (let attempt = 0; attempt < 5; attempt++) {
    row.ref = generateRandomRef();
    const { data, error } = await supabase.from('colis').insert(row).select().single();
    if (error && error.code === '23505') continue; // unique violation → retry
    if (error) throw error;
    return mapColis({ ...data, _factures: [], _lignes: [], _messages: [] });
  }
  throw new Error('Impossible de générer une référence unique après 5 tentatives');
}

export async function updateClient(id, changes) {
  const snakeChanges = {};
  const map = {
    nom: 'nom',
    prenom: 'prenom',
    genre: 'genre',
    dateNaissance: 'date_naissance',
    ville: 'ville',
    adresse: 'adresse',
    adresseLigne1: 'adresse_ligne1',
    adresseLigne2: 'adresse_ligne2',
    commune: 'commune',
    infosLivraison: 'infos_livraison',
    cp: 'cp',
    tel: 'tel',
    telFixe: 'tel_fixe',
    email: 'email',
    canal: 'canal',
    type: 'type',
    modePaiement: 'mode_paiement',
    points: 'points',
    notes: 'notes',
    onboarded: 'onboarded',
    abonnement: 'abonnement',
    abonnementDebut: 'abonnement_debut',
    abonnementFin: 'abonnement_fin',
    methodePaiement: 'methode_paiement',
    telegramUsername: 'telegram_username',
    raisonSociale: 'raison_sociale',
    siret: 'siret',
    interlocuteur: 'interlocuteur',
  };
  const dateFields = ['date_naissance', 'abonnement_debut', 'abonnement_fin'];
  for (const [key, val] of Object.entries(changes)) {
    const snakeKey = map[key] || key;
    snakeChanges[snakeKey] = val === '' && dateFields.includes(snakeKey) ? null : val;
  }
  if (dataScope === 'client') {
    const { data, error } = await supabase.rpc('update_client_profile', {
      p_changes: snakeChanges,
    });
    if (error) throw error;
    return mapClient(Array.isArray(data) ? data[0] : data);
  }
  const { data, error } = await supabase
    .from('clients')
    .update(snakeChanges)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapClient(data);
}

export async function insertMessage(colisId, msg) {
  const row = {
    colis_id: colisId,
    type: msg.type,
    auteur_id: msg.auteurId || null,
    auteur_nom: msg.auteur,
    texte: msg.texte,
    statut: msg.statut || null,
  };
  if (msg.telegramMsgId) row.telegram_msg_id = String(msg.telegramMsgId);
  const { data, error } = await supabase.from('messages').insert(row).select().single();
  if (error) throw error;
  return mapMessage(data);
}

// ── Factures ─────────────────────────────────────────────────────────

export async function insertFacture(colisId, factureData) {
  const { data, error } = await supabase
    .from('factures')
    .insert({
      colis_id: colisId,
      vendeur: factureData.vendeur || null,
      montant: factureData.montant || 0,
      valide: factureData.valide || false,
      fichier_url: factureData.fichierUrl || null,
      fichier_nom: factureData.fichierNom || null,
      replaces_facture_id: factureData.replacesFactureId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapFact(data);
}

export async function updateFacture(factureId, changes) {
  const snakeChanges = {};
  if ('valide' in changes) snakeChanges.valide = changes.valide;
  if ('vendeur' in changes) snakeChanges.vendeur = changes.vendeur;
  if ('montant' in changes) snakeChanges.montant = changes.montant;
  if ('fichierUrl' in changes) snakeChanges.fichier_url = changes.fichierUrl;
  if ('fichierNom' in changes) snakeChanges.fichier_nom = changes.fichierNom;
  if ('rejetMotif' in changes) snakeChanges.rejet_motif = changes.rejetMotif;
  const { data, error } = await supabase
    .from('factures')
    .update(snakeChanges)
    .eq('id', factureId)
    .select()
    .single();
  if (error) throw error;
  return mapFact(data);
}

export async function deleteFacture(factureId) {
  const { error } = await supabase.from('factures').delete().eq('id', factureId);
  if (error) throw error;
}

// ── Lignes (articles) ────────────────────────────────────────────────

export async function insertLigne(colisId, ligneData) {
  const { data, error } = await supabase
    .from('lignes')
    .insert({
      colis_id: colisId,
      description: ligneData.desc || '',
      qte: ligneData.qte || 1,
      prix_unitaire: ligneData.prix || 0,
      categorie_id: ligneData.cat || null,
      facture_id: ligneData.factureId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    desc: data.description,
    qte: data.qte,
    prix: data.prix_unitaire ? +data.prix_unitaire : 0,
    cat: data.categorie_id,
    factureId: data.facture_id || null,
  };
}

export async function updateLigne(ligneId, changes) {
  const snakeChanges = {};
  if ('desc' in changes) snakeChanges.description = changes.desc;
  if ('qte' in changes) snakeChanges.qte = changes.qte;
  if ('prix' in changes) snakeChanges.prix_unitaire = changes.prix;
  if ('cat' in changes) snakeChanges.categorie_id = changes.cat;
  const { error } = await supabase.from('lignes').update(snakeChanges).eq('id', ligneId);
  if (error) throw error;
}

export async function deleteLigne(ligneId) {
  const { error } = await supabase.from('lignes').delete().eq('id', ligneId);
  if (error) throw error;
}

export async function updateMessageLu(messageId, lu) {
  const { error } = await supabase.from('messages').update({ lu }).eq('id', messageId);
  if (error) throw error;
}

export async function markAllMessagesLu(colisId) {
  const { error } = await supabase
    .from('messages')
    .update({ lu: true })
    .eq('colis_id', colisId)
    .eq('lu', false);
  if (error) throw error;
}

export async function markNotifRead(notifId) {
  const { error } = await supabase.from('notifications').update({ lu: true }).eq('id', notifId);
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

function generateClientRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return (
    'CLI-' +
    Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  );
}

export async function insertClient(clientData) {
  const row = {
    nom: clientData.nom || '',
    prenom: clientData.prenom || null,
    genre: clientData.genre || null,
    date_naissance: clientData.dateNaissance || null,
    ville: clientData.ville || null,
    adresse: clientData.adresse || null,
    adresse_ligne1: clientData.adresseLigne1 || null,
    adresse_ligne2: clientData.adresseLigne2 || null,
    commune: clientData.commune || null,
    infos_livraison: clientData.infosLivraison || null,
    cp: clientData.cp,
    tel: clientData.tel || null,
    tel_fixe: clientData.telFixe || null,
    email: clientData.email || null,
    canal: clientData.canal || 'telegram',
    type: clientData.type || 'particulier',
    mode_paiement: clientData.modePaiement || 'colis',
    points: clientData.points || 0,
    onboarded: clientData.onboarded || false,
    notes: clientData.notes || null,
    telegram_username: clientData.telegramUsername || null,
    abonnement: clientData.abonnement || 'freemium',
    abonnement_debut: clientData.abonnementDebut || null,
    abonnement_fin: clientData.abonnementFin || null,
    raison_sociale: clientData.raisonSociale || null,
    siret: clientData.siret || null,
    interlocuteur: clientData.interlocuteur || null,
  };

  // Retry with new ref on unique constraint violation
  for (let attempt = 0; attempt < 5; attempt++) {
    row.ref = generateClientRef();
    const { data, error } = await supabase.from('clients').insert(row).select().single();
    if (error && error.code === '23505') continue;
    if (error) throw error;
    return mapClient(data);
  }
  throw new Error('Impossible de générer une référence client unique');
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
      loading_closes_at: envoiData.loadingClosesAt || null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapEnvoi(data);
}

export async function updateEnvoi(id, changes, expectedUpdatedAt) {
  if (!expectedUpdatedAt) throw new Error('Rechargez le départ avant de le modifier.');
  const snakeChanges = {};
  const map = {
    date: 'date_depart',
    statut: 'statut',
    destinationCode: 'destination_code',
    transporteur: 'transporteur',
    trackingPrincipal: 'tracking_principal',
    notes: 'notes',
    loadingClosesAt: 'loading_closes_at',
  };
  for (const [key, val] of Object.entries(changes)) {
    snakeChanges[map[key] || key] = val;
  }
  const { data, error } = await supabase.from('envois').update(snakeChanges).eq('id', id)
    .eq('updated_at', expectedUpdatedAt).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Le départ a été modifié par un collègue ou vos permissions ont changé. Actualisez le planning avant de reprendre.');
  return mapEnvoi(data);
}

export async function deleteEnvoi(id) {
  const { error } = await supabase.from('envois').delete().eq('id', id);
  if (error) throw error;
}

// ── Share links CRUD ────────────────────────────────────────────────

function generateToken() {
  // 32 caractères hex non devinables
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function fetchShareLink(clientId) {
  const { data, error } = await supabase
    .from('share_links')
    .select('id, token, created_at, revoked_at, access_count, last_accessed_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createShareLink(clientId, createdBy) {
  const token = generateToken();
  const { data, error } = await supabase
    .from('share_links')
    .insert({ client_id: clientId, token, created_by: createdBy || null })
    .select('id, token, created_at, revoked_at, access_count, last_accessed_at')
    .single();
  if (error) throw error;
  return data;
}

export async function revokeShareLink(linkId) {
  const { error } = await supabase
    .from('share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId);
  if (error) throw error;
}

// ── Categories CRUD ────────────────────────────────────────────────

export async function insertCategorie(label, custom = true) {
  const { data, error } = await supabase
    .from('categories')
    .insert({ label, custom, position: 99 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCategorie(id, changes) {
  const { error } = await supabase.from('categories').update(changes).eq('id', id);
  if (error) throw error;
}

export async function deleteCategorie(id) {
  await supabase.from('taux_categories').delete().eq('categorie_id', id);
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}

export async function upsertTauxCategorie(categorieId, destinationCode, om, omr) {
  const { error } = await supabase.from('taux_categories').upsert(
    {
      categorie_id: categorieId,
      destination_code: destinationCode,
      om,
      omr,
    },
    { onConflict: 'categorie_id,destination_code' },
  );
  if (error) throw error;
}

// ── Tarifs CRUD ────────────────────────────────────────────────────

export async function updateTarif(destinationCode, base, parKg) {
  const { error } = await supabase
    .from('tarifs')
    .update({ base, par_kg: parKg })
    .eq('destination_code', destinationCode)
    .eq('actif', true);
  if (error) throw error;
}

// ── Audit logs ─────────────────────────────────────────────────────

export async function insertLog(colisId, ancienStatut, nouveauStatut, userNom) {
  const { error } = await supabase.from('logs_statut').insert({
    colis_id: colisId,
    ancien_statut: ancienStatut,
    nouveau_statut: nouveauStatut,
    user_nom: userNom,
  });
  if (error) console.error('[Supabase] insertLog error:', error.message);
}

export async function insertAuditAction(colisId, userNom, action, detail) {
  const { error } = await supabase.from('audit_actions').insert({
    colis_id: colisId,
    user_nom: userNom,
    action,
    detail,
  });
  if (error) console.error('[Supabase] insertAuditAction:', error.message);
}

export async function fetchAuditActions(colisId) {
  const { data, error } = await supabase
    .from('audit_actions')
    .select('*')
    .eq('colis_id', colisId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data || []).map((row) => ({
    id: row.id,
    user: row.user_nom || '—',
    action: row.action,
    detail: row.detail,
    date: row.created_at,
  }));
}

export async function fetchLogsForColis(colisId) {
  const { data, error } = await supabase
    .from('logs_statut')
    .select('*')
    .eq('colis_id', colisId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('fetchLogs:', error.message);
    return [];
  }
  return (data || []).map((row) => ({
    id: row.id,
    ancienStatut: row.ancien_statut,
    nouveauStatut: row.nouveau_statut,
    user: row.user_nom || '—',
    commentaire: row.commentaire,
    date: row.created_at,
  }));
}

// ── Realtime subscriptions ──────────────────────────────────────────

export function subscribeColis(callback) {
  return supabase
    .channel('colis-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'colis' }, callback)
    .subscribe();
}

export function subscribeFactures(callback) {
  return supabase
    .channel('factures-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'factures' }, callback)
    .subscribe();
}

export function subscribeMessages(callback) {
  return supabase
    .channel('messages-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, callback)
    .subscribe();
}

export function subscribeNotifications(userId, callback) {
  return supabase
    .channel('notifs-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      callback,
    )
    .subscribe();
}

// Server-owned settings; failures must remain visible rather than silently using demo data.
export async function fetchSettings() {
  const [{ data: settings, error }, { data: templates, error: templateError }] = await Promise.all([
    supabase.from('app_settings').select('*'),
    supabase.from('message_templates').select('*'),
  ]);
  if (error) throw error;
  if (templateError) throw templateError;
  return {
    settings: Object.fromEntries((settings || []).map((r) => [r.key, r.value])),
    templates: Object.fromEntries((templates || []).map((r) => [`${r.key}_${r.canal}`, r.body])),
  };
}
export async function saveSetting(key, value) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}
export async function saveTemplate(key, canal, body) {
  const { error } = await supabase
    .from('message_templates')
    .upsert({ key, canal, body }, { onConflict: 'key,canal' });
  if (error) throw error;
}
export async function signedFileUrl(bucket, pathOrUrl) {
  if (!pathOrUrl) return null;
  let path = pathOrUrl;
  if (/^https?:/.test(path)) {
    const url = new URL(path);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const signedMarker = `/storage/v1/object/sign/${bucket}/`;
    if (url.origin !== new URL(supabase.supabaseUrl).origin)
      throw new Error('Document hébergé sur un domaine non autorisé');
    const markerUsed = url.pathname.includes(marker) ? marker : signedMarker;
    if (!url.pathname.includes(markerUsed)) throw new Error('Chemin du document non reconnu');
    path = decodeURIComponent(url.pathname.split(markerUsed)[1]);
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
export async function uploadDocument(bucket, colisId, file) {
  if (!file || file.size > 20 * 1024 * 1024)
    throw new Error('Le document doit faire moins de 20 Mo.');
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Utilisez un PDF ou une image JPG, PNG ou WebP.');
  const ext = file.name
    .split('.')
    .pop()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const path = `${colisId}/${randomId()}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return { path, url: await signedFileUrl(bucket, path) };
}
