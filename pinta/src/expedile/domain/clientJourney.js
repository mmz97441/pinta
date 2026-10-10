import { receptionCartonManifest } from './reception.js';
import { currentInvoices } from './invoiceDocuments.js';
import { invoicesFrozenReason } from './invoiceLock.js';
import { plural } from './plural.js';
import { isoCalendarDay, parisCalendarDay } from './departureGroups.js';
import { PHASES_CLIENT, getPhaseIndex } from '../constants/index.js';
/** Client-facing facts only. A status never implies a delivery date. */
export function cartonManifest(colis) {
  const trackings = [...new Set((colis?.trackings || []).map(String).map((s) => s.trim()).filter(Boolean))];
  const count = receptionCartonManifest(colis).nbColis;
  return { id: colis.id, ref: colis.ref, updatedAt: colis.updatedAt, count, trackings };
}

export const PAYMENT_TERMS = {
  payplug: 'Carte bancaire sécurisée', virement: 'Virement bancaire', especes: 'Espèces',
  '30_jours': 'Paiement à 30 jours', fin_de_mois: 'Paiement en fin de mois',
};

/** Same saved facts for the portal and the PDF; legacy data has no invented tax rate. */
export function quotePresentation(colis, client = {}, destination = {}) {
  const snapshot = colis.devisSnapshot || colis.quoteSnapshot;
  if (!snapshot?.inputs || !snapshot?.amounts) return {
    colis, client, destination: { ...destination, tva: null },
    paymentMode: colis.modePaiementPro || null, version: colis.quoteVersion || null, issuedAt: null,
  };
  const { inputs, amounts } = snapshot;
  return {
    colis: { ...colis, ref: inputs.reference || colis.ref, desc: inputs.description,
      finalPackages: inputs.finalPackages || (inputs.finalBox ? [inputs.finalBox] : []),
      trackings: inputs.trackings || [], fraisDivers: inputs.fees || [],
      finL: inputs.finalBox?.dimL, finW: inputs.finalBox?.dimW, finH: inputs.finalBox?.dimH, finP: inputs.finalBox?.poids,
      devisTransport: amounts.transport, devisOM: amounts.om, devisOMR: amounts.omr, devisTVA: amounts.tva,
      devisTotal: amounts.total, poidsFact: amounts.billableWeight, economie: snapshot.savings || 0,
      avantOptimTransport: snapshot.before?.transport ?? null, avantOptimTotal: snapshot.before?.total ?? null },
    client: { ...client, ...inputs.client }, destination: { ...destination, ...inputs.destination },
    paymentMode: inputs.paymentTerms?.mode || null, version: snapshot.version || colis.quoteVersion || null,
    issuedAt: snapshot.createdAt || snapshot.created_at || null,
  };
}

// French typography: a no-break space before « : ; ! ? » and inside « ».
const NB = '\u00a0';

// [label, actor, what happens next] — sentences addressed to the account holder, with who acts and a reassurance.
// They never promise a date or a notification that the application does not send.
const STATES = {
  receptionne: ['Colis réceptionné', 'Notre équipe', `Notre équipe mesure vos cartons${NB}; vous recevrez ensuite la demande d’accord pour les préparer.`],
  mesure: ['Mesures enregistrées', 'Notre équipe', 'Vos cartons sont mesurés. Notre équipe vous envoie ensuite la demande d’accord pour les préparer.'],
  attente_feu_vert: ['Votre accord est attendu', 'À vous', 'Donnez votre accord pour la préparation, ou demandez à attendre d’autres achats.'],
  autorise: ['Votre accord est enregistré', 'Notre équipe', `Merci${NB}! Notre équipe va regrouper et réemballer vos achats${NB}; vous serez prévenu(e) dès que votre devis sera prêt.`],
  refuse_client: ['Préparation refusée', 'Notre équipe', 'Notre équipe vous contactera pour convenir avec vous de la suite de votre expédition.'],
  en_preparation: ['Préparation en cours', 'Notre équipe', `Notre équipe regroupe et réemballe vos achats, puis calcule le prix final${NB}; vous serez prévenu(e) dès que votre devis sera prêt.`],
  devis_envoye: ['Devis reçu — en attente de paiement', 'À vous', 'Consultez votre devis et réglez-le selon les modalités indiquées.'],
  attente_paiement: ['Devis reçu — en attente de paiement', 'À vous', 'Consultez votre devis et réglez-le selon les modalités indiquées.'],
  paye: ['Paiement reçu', 'Notre équipe', `Merci pour votre règlement${NB}! Notre équipe prépare le départ de votre colis${NB}; vous suivez chaque étape ici.`],
  expedie: ['Colis expédié', 'Transporteur', `Votre colis a pris le départ${NB}: le transporteur l’achemine vers votre destination. Vous suivez chaque étape ici.`],
  transit: ['Colis en transit', 'Transporteur', 'Votre colis est en route vers votre destination. Vous suivez chaque étape ici.'],
  dedouanement: ['Passage en douane', 'Notre équipe', `Notre équipe s’occupe des formalités de douane avant la livraison${NB}; vous n’avez rien à faire.`],
  arrive: ['Colis au dépôt local', 'Notre équipe', `Votre colis est arrivé au dépôt local${NB}: notre équipe organise sa livraison et vous en précisera les modalités.`],
  livraison: ['Livraison en cours', 'Transporteur', 'Votre colis est en cours de livraison. La date vous sera précisée dès qu’elle sera confirmée.'],
  livre: ['Colis livré', null, `Votre colis est bien arrivé. Merci de votre confiance, et à bientôt pour votre prochain envoi${NB}!`],
  annule: ['Expédition annulée', null, 'Les dispositions convenues avec notre équipe figurent dans vos échanges.'],
};
// The cancelled expedition without any exchange: nothing to consult, a way to ask.
const CANCELLED_WITHOUT_MESSAGES = `Pour toute question sur cette expédition, écrivez à notre équipe depuis «${NB}Messages${NB}».`;

export function clientJourney(colis, now = Date.now()) {
  const waiting = hasClientRequestedWait(colis);
  const reviewDue = waiting && !!colis.attenteClientUntil && Date.parse(colis.attenteClientUntil) <= now;
  const quoteNeedsReview = needsQuoteRecalculation(colis);
  // A late invoice is being added: the sent quote is about to be withdrawn, no payment is asked meanwhile.
  const quoteUpdating = quoteBeingUpdated(colis);
  const oldQuote = !!colis.devisEnvoyeLe && (quoteNeedsReview || quoteUpdating || ['receptionne','mesure','attente_feu_vert','autorise','refuse_client'].includes(colis.statut));
  // The waiting state asks nothing now: it says what is kept and how to resume, never « Autoriser … » as a task.
  const [label, actor, next] = waiting
    ? ['En attente à votre demande', 'À vous, lorsque vous serez prêt', `Nous conservons vos cartons en attendant vos autres achats. Quand vous serez prêt(e), il vous suffira de donner votre accord pour lancer la préparation.`]
    : quoteUpdating ? ['Devis en cours de mise à jour', 'Notre équipe', `Notre équipe ajoute votre nouvelle facture au devis${NB}; vous recevrez le devis mis à jour dès qu’il sera prêt. Aucun règlement n’est demandé d’ici là.`]
    : quoteNeedsReview ? ['Devis en cours de révision', 'Notre équipe', 'Notre équipe vérifie les changements et vous transmettra un nouveau devis. Aucun règlement n’est demandé pour le devis retiré.']
    : colis.statut === 'annule' && !(colis.messages?.length > 0) ? [...STATES.annule.slice(0, 2), CANCELLED_WITHOUT_MESSAGES]
    : STATES[colis.statut] || ['État à préciser', 'Notre équipe', 'Notre équipe confirme la prochaine étape de votre expédition.'];
  const events = [
    ['Réception enregistrée', colis.dateReception], ['Demande d’accord envoyée', colis.demandeFeuVertEnvoyeeAt],
    ['Attente demandée', colis.attenteClientDate], [colis.feuVert === 'refuse' || colis.statut === 'refuse_client' ? 'Refus enregistré' : 'Accord enregistré', colis.feuVertDate],
    [oldQuote ? 'Ancien devis envoyé' : 'Devis envoyé', colis.devisEnvoyeLe, oldQuote], ['Paiement reçu', colis.paiementDate], ['Expédition enregistrée', colis.dateExpedition], ['Livraison confirmée', colis.dateLivraison],
  ].filter(([, date]) => date && Number.isFinite(Date.parse(date)) && Date.parse(date) <= now)
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
  return { label, actor, next, waiting, reviewDue, quoteNeedsReview, quoteUpdating, event: events[0] ? { label: events[0][0], date: events[0][1], ...(events[0][2] ? { historical: true } : {}) } : null };
}

export function hasClientRequestedWait(colis) {
  return colis?.statut === 'attente_feu_vert' && !!colis.attenteClientDate;
}

/** Late client invoice received on a sent quote (client_colis.quote_update_pending), until the new quote is sent:
 * before the withdrawal (quote still sent) and after it (back in preparation). Never once paid, departed or closed. */
export function quoteBeingUpdated(colis) {
  return !!colis?.quoteUpdatePending && !invoicesFrozenReason(colis);
}

export function needsQuoteRecalculation(colis) {
  // A past quote is history when consent or receipt is being reopened. It must
  // never take precedence over the current task, even on the public projection.
  if (!['en_preparation', 'devis_envoye', 'attente_paiement'].includes(colis?.statut) || colis.paiementDate) return false;
  if (typeof colis?.quoteNeedsReview === 'boolean') return colis.quoteNeedsReview;
  return !!colis && !colis.paiementDate && (['devis_envoye', 'attente_paiement'].includes(colis.statut) || !!colis.devisEnvoyeLe)
    && (colis.devisBrouillon === true || !(Number(colis.devisTotal) > 0));
}

/** One expedition belongs to one section; a withdrawn quote never requests payment. */
export function clientWorkState(colis, client = {}) {
  const journey = clientJourney(colis);
  if (['livre', 'annule'].includes(colis.statut) || colis.archive) return { section: 'history', kind: 'none', action: 'Consulter l’expédition', journey };
  const rejected = currentInvoices(colis.factures).some(invoice => invoice.rejetMotif || invoice.rejet_motif);
  // A preparation pause never dismisses an independent request for a document
  // correction or a reply, and completing either request never gives consent.
  if (journey.waiting) {
    if (rejected && !colis.paiementDate) return { section: 'todo', kind: 'documents', action: 'Corriger une facture', journey };
    if (colis.conversationStatut === 'attente_client') return { section: 'todo', kind: 'messages', action: 'Répondre à l’équipe', journey };
    return { section: 'waiting', kind: 'none', action: 'Consulter mon attente', journey };
  }
  if (colis.statut === 'attente_feu_vert') return { section: 'todo', kind: 'agreement', action: 'Donner mon accord ou attendre', journey };
  if (journey.quoteUpdating) return { section: 'team', kind: 'none', action: 'Suivre la mise à jour du devis', journey };
  if (['devis_envoye', 'attente_paiement'].includes(colis.statut) && !journey.quoteNeedsReview && !colis.paiementDate)
    return { section: 'todo', kind: 'payment', action: client.type === 'pro' ? 'Consulter les modalités de règlement' : colis.payplugPaymentUrl ? 'Consulter et régler le devis' : 'Consulter le devis et le règlement', journey };
  if (rejected && !colis.paiementDate && ['receptionne','mesure','attente_feu_vert','autorise','en_preparation','devis_envoye','attente_paiement'].includes(colis.statut)) return { section: 'todo', kind: 'documents', action: 'Corriger une facture', journey };
  if (!colis.paiementDate && !journey.quoteNeedsReview && ['receptionne','mesure','autorise','en_preparation'].includes(colis.statut)
    && currentInvoices(colis.factures).length === 0)
    return { section: 'todo', kind: 'documents', action: 'Transmettre mes factures', journey };
  if (colis.conversationStatut === 'attente_client') return { section: 'todo', kind: 'messages', action: 'Répondre à l’équipe', journey };
  return { section: 'team', kind: 'none', action: 'Suivre mon expédition', journey };
}

/** Why the task is asked and what follows it, in one or two client sentences (never a technical status). */
export function clientTaskExplanation(colis, client = {}, task = clientWorkState(colis, client)) {
  if (task.kind === 'documents') {
    if (task.action === 'Corriger une facture') return `Une de vos factures doit être corrigée${NB}: la raison est indiquée dans «${NB}Mes factures${NB}». Dès réception de la nouvelle version, notre équipe la vérifie.`;
    const why = client?.type === 'pro'
      ? 'Votre facture d’achat justifie la valeur de vos achats pour les formalités de douane.'
      : `Votre facture d’achat nous permet d’établir votre devis${NB}: elle justifie la valeur de vos achats pour l’estimation des taxes à l’importation.`;
    const after = ['receptionne', 'mesure'].includes(colis?.statut)
      ? `Dès réception, notre équipe la vérifie${NB}; vous recevrez aussi la demande d’accord pour préparer vos cartons.`
      : 'Dès réception, notre équipe la vérifie puis prépare votre devis.';
    return `${why} ${after}`;
  }
  if (task.kind === 'messages') return `Notre équipe vous a posé une question${NB}: votre réponse lui permet de poursuivre votre expédition.`;
  return '';
}

// A step is done as soon as its outcome is recorded: the consent given, the payment received, the delivery confirmed.
const STEP_COMPLETED_BY = { accord: ['autorise'], paiement: ['paye'], livraison: ['livre'] };
/** Client timeline state of a step: 'done', 'active' (still in progress) or 'future'. */
export function clientPhaseState(index, statut) {
  const current = getPhaseIndex(statut);
  if (index < current) return 'done';
  if (index > current) return 'future';
  return (STEP_COMPLETED_BY[PHASES_CLIENT[index]?.key] || []).includes(statut) ? 'done' : 'active';
}

/** The card opens the task it names; opening a screen never performs that task. */
export function clientShipmentPath(colis, client) {
  const { kind } = clientWorkState(colis, client);
  return `/colis/${colis.id}${['documents', 'messages'].includes(kind) ? `?panel=${kind}` : ''}`;
}

// The shared tracking page: a neutral observer is neither the account holder nor the payer.
const PUBLIC_LABEL = { autorise: 'Accord du client enregistré' };
const PUBLIC_NEXT = {
  receptionne: 'Mesure des cartons par l’équipe, puis demande d’accord au client.',
  mesure: 'Demande d’accord à transmettre au client avant la préparation.',
  autorise: 'Préparation des achats par l’équipe, puis envoi du devis au client.',
  refuse_client: 'L’équipe convient avec le client de la suite de l’expédition.',
  en_preparation: 'Regroupement et réemballage des achats, puis calcul du prix final.',
  paye: 'Préparation du départ du colis.',
  expedie: 'Le colis a pris le départ vers sa destination.',
  transit: 'Le colis est en route vers sa destination.',
  dedouanement: 'Formalités de douane en cours avant la livraison.',
  arrive: 'Le colis est au dépôt local. L’équipe organise sa livraison.',
  livraison: 'Livraison en cours. La date sera précisée lorsqu’elle sera confirmée.',
  livre: 'Le colis a été livré.',
  annule: 'Cette expédition a été annulée.',
};

/** Public readers are observers, never the account holder or payer. */
export function publicJourney(colis, now) {
  const journey = clientJourney(colis, now);
  if (journey.quoteNeedsReview || journey.quoteUpdating) return { ...journey, actor: 'Équipe Expedîle', next: 'Vérification du devis avant transmission au client.' };
  if (journey.waiting) return { ...journey, label: 'En attente à la demande du client', actor: 'Client', next: 'La préparation attend un nouvel accord du client.' };
  if (colis.statut === 'attente_feu_vert') return { ...journey, label: 'Accord du client attendu', actor: 'Client', next: 'Accord nécessaire avant la préparation.' };
  if (['devis_envoye', 'attente_paiement'].includes(colis.statut)) return { ...journey, label: 'Règlement attendu du client', actor: 'Client', next: 'Le devis et les modalités de règlement sont disponibles dans son espace privé.' };
  return { ...journey, label: PUBLIC_LABEL[colis.statut] || journey.label, actor: journey.actor === 'Notre équipe' ? 'Équipe Expedîle' : journey.actor,
    next: PUBLIC_NEXT[colis.statut] || 'Prochaine étape à confirmer par l’équipe Expedîle.' };
}

export function outgoingTracking(colis, departures = []) {
  if (typeof colis?.outgoingTracking === 'string' && colis.outgoingTracking.trim()) return colis.outgoingTracking.trim();
  const departure = departures.find(item => item.id === colis?.envoiId);
  return typeof departure?.trackingPrincipal === 'string' ? departure.trackingPrincipal.trim() : '';
}

export function latestLogisticsEvent(colis, now = Date.now()) {
  return [['Livraison confirmée', colis.dateLivraison], ['Expédition enregistrée', colis.dateExpedition], ['Réception enregistrée', colis.dateReception]]
    .filter(([, date]) => date && Number.isFinite(Date.parse(date)) && Date.parse(date) <= now)
    .sort((a,b) => Date.parse(b[1]) - Date.parse(a[1]))
    .map(([label, date]) => ({ label, date }))[0] || null;
}

// Each shipment step, dated by the last status change (client_colis.statut_updated_at).
const SHIPMENT_NEWS = {
  expedie: 'Départ de votre colis', transit: 'Colis en route', dedouanement: 'Arrivée en douane',
  arrive: 'Arrivée au dépôt local', livraison: 'Départ en livraison', livre: 'Livraison confirmée',
};
/** The latest shipment news: the current step's own date when known, otherwise the latest logistics event. */
export function latestShipmentNews(colis, now = Date.now()) {
  const known = date => date && Number.isFinite(Date.parse(date)) && Date.parse(date) <= now;
  const candidates = [];
  if (SHIPMENT_NEWS[colis?.statut] && known(colis.statutUpdatedAt)) candidates.push({ label: SHIPMENT_NEWS[colis.statut], date: colis.statutUpdatedAt });
  const logistics = latestLogisticsEvent(colis || {}, now);
  if (logistics) candidates.push(logistics);
  return candidates.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0] || null;
}

/** « jeudi 8 octobre », « 1er octobre », the year only when it is not the current one. Date-only values stay on their day. */
export function clientDate(value, { weekday = false, now = Date.now() } = {}) {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return null;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('fr-FR', { ...(weekday ? { weekday: 'long' } : {}), day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })
    .replace(/(^|\s)1(?=\s)/u, (_, space) => `${space}1er`)
    .replace(/(\d(?:er)?) (?=\p{L})/u, `$1${NB}`);
}

/**
 * A calendar day the client chose or agreed (« Attendre jusqu’au », the end of a subscription), on that day
 * whatever the device's time zone: a date-only value as is, a stored instant on its Paris day (a day kept as
 * its midnight UTC reads one day early in the Antilles otherwise). « 20 octobre », « 1er novembre ».
 */
export function clientDay(value, options = {}) {
  if (!value) return null;
  const day = isoCalendarDay(String(value)) || parisCalendarDay(value);
  return day ? clientDate(day, options) : null;
}

/** The instant sent for a day chosen in « Attendre jusqu’au »: its midnight UTC, whatever the server's time zone. */
export const waitUntilInstant = day => isoCalendarDay(day) ? `${day}T00:00:00Z` : null;

/**
 * The first day « Attendre jusqu’au » offers (YYYY-MM-DD): the server refuses a resumption that is not in the
 * future (the chosen day is kept as its midnight UTC), and the device's own today is never offered either.
 */
export function firstWaitDay(now = Date.now()) {
  const next = new Date(now + 86400000);
  const utc = next.toISOString().slice(0, 10);
  const local = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  return utc > local ? utc : local;
}

// client_planned_departures: the steps where the shared tracking page shows the departure.
export const PLANNED_DEPARTURE_STATUSES = ['autorise', 'en_preparation', 'devis_envoye', 'attente_paiement', 'paye', 'expedie'];
export function plannedDepartureShown(colis) {
  return Boolean(colis && !colis.archive && PLANNED_DEPARTURE_STATUSES.includes(colis.statut));
}
/** Two versions: the confirmed day, or the day still to fix (no promise). A load failure is never read as « no date ». */
export function plannedDepartureMessage(colis, departure = {}, now = Date.now()) {
  if (!plannedDepartureShown(colis)) return null;
  if (departure.state === 'error') return { kind: 'error', text: 'La date de départ n’a pas pu être chargée.' };
  if (departure.state === 'loading') return { kind: 'loading', text: '' };
  if (departure.state !== 'ready') return null;
  const day = clientDate(departure.date, { weekday: true, now });
  if (day) return colis.statut === 'expedie'
    ? { kind: 'date', label: 'Départ du', day, note: 'Il s’agit du départ, pas de la date de livraison.' }
    : { kind: 'date', label: `Départ prévu${NB}:`, day, note: 'Il s’agit du départ, pas de la date de livraison.' };
  if (colis.statut === 'expedie') return null;
  return { kind: 'pending', text: `Votre date de départ n’est pas encore fixée${NB}: elle s’affichera ici dès que notre équipe l’aura confirmée.` };
}

/**
 * The departure line of the shared tracking page, by the rule of client_planned_departures: before the
 * departure, a day still to come (Paris) of a departure that has not left; once shipped, the day of the
 * departure that has left (« Départ du »). A past, stale or archived day is never presented as planned.
 */
export function publicDeparture(colis, now = Date.now()) {
  const day = isoCalendarDay(String(colis?.eta ?? '').slice(0, 10));
  if (!day || !PLANNED_DEPARTURE_STATUSES.includes(colis?.statut)) return null;
  const departed = ['parti', 'arrive'].includes(colis.envoiStatut);
  const label = clientDate(day, { weekday: true, now });
  if (colis.statut === 'expedie') return departed ? { label: 'Départ du', day: label } : null;
  if (departed || colis.envoiStatut === 'archive' || day < parisCalendarDay(now)) return null;
  return { label: `Départ prévu${NB}:`, day: label };
}

const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
/** French number, no-break space before the unit: « 6,2 kg ». */
export const frenchNumber = (value, unit = '') => `${NUMBER.format(Number(value))}${unit ? NB + unit : ''}`;
/** « 40 × 30 × 25 cm · 6,2 kg ». */
export function measureText(box) {
  return `${NUMBER.format(Number(box.dimL))} × ${NUMBER.format(Number(box.dimW))} × ${frenchNumber(box.dimH, 'cm')} · ${frenchNumber(box.poids, 'kg')}`;
}

/** What the client can be told about the received cartons: one line per measured carton, the global measures of a
 * multi-carton dossier measured as a whole (never shown as one fake box), or nothing measured yet. */
export function cartonMeasures(colis = {}) {
  const manifest = receptionCartonManifest(colis);
  const complete = box => ['dimL', 'dimW', 'dimH', 'poids'].every(key => Number(box?.[key]) > 0);
  const cartons = manifest.dimsParColis.map((box, index) => ({ index: index + 1, number: manifest.trackingsDetail[index]?.number || '', measures: complete(box) ? box : null }));
  const whole = { dimL: colis.dimL, dimW: colis.dimW, dimH: colis.dimH, poids: colis.poids };
  const count = manifest.nbColis;
  const title = count > 1 ? `Mesures de vos ${plural(count, 'carton')}` : 'Mesures de votre carton';
  if (cartons.some(carton => carton.measures)) return { count, mode: 'cartons', title, cartons, global: null };
  if (complete(whole)) return { count, mode: 'global', title, cartons: [], global: whole };
  return { count, mode: 'none', title: '', cartons: [], global: null };
}
