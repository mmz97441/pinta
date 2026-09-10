import { calculateQuote } from './quote.js';
import { DESTINATIONS, STATUTS } from '../constants/index.js';
import { needsConversationAction } from './conversations.js';

const DAY = 86400000;
const terminal = new Set(['annule', 'livre']);
const preQuote = new Set(['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation']);
export const WORK_QUEUES = [
  { key: 'messages', label: 'Répondre aux clients', detail: 'Conversations à traiter, même déjà lues', icon: 'messages' },
  { key: 'preparation', label: 'Préparer les dossiers', detail: 'Accord reçu, préparation à terminer', icon: 'preparation' },
  { key: 'documents', label: 'Vérifier les factures', detail: 'Pièces à recevoir, corriger ou vérifier', icon: 'documents' },
  { key: 'waiting', label: 'Attentes demandées', detail: 'Pauses et échéances à revoir', icon: 'waiting' },
  { key: 'decision', label: 'Accord attendu', detail: 'Dossiers sans choix, hors pauses', icon: 'waiting' },
  { key: 'ready', label: 'Prêts à chiffrer', detail: 'Mesures et prérequis du calcul complets', icon: 'documents' },
  { key: 'overdue', label: 'Échéances dépassées', detail: 'Actions échues, hors pauses actives', icon: 'waiting' },
  { key: 'wait-review', label: 'Attentes à reprendre', detail: 'Échéances de pause atteintes', icon: 'waiting' },
];
export const timestamp = (value) => value ? Date.parse(value) : NaN;
export const isActiveColis = (colis) => !colis.archive && !terminal.has(colis.statut);
export const hasVoluntaryWait = (colis) => colis.statut === 'attente_feu_vert' && Boolean(colis.attenteClientDate);
export function isClientWaiting(colis, now = Date.now()) {
  if (!hasVoluntaryWait(colis)) return false;
  const until = timestamp(colis.attenteClientUntil);
  return !Number.isFinite(until) || until > now;
}
export function isWaitDue(colis, now = Date.now()) {
  return hasVoluntaryWait(colis) && Number.isFinite(timestamp(colis.attenteClientUntil)) && timestamp(colis.attenteClientUntil) <= now;
}
export function needsDocuments(colis, client) {
  if (client?.type === 'pro' || !preQuote.has(colis.statut)) return false;
  const invoices = (colis.factures || []).filter((invoice) => !invoice.rejetMotif);
  return !invoices.length || invoices.some((invoice) => !invoice.valide || !(invoice.fichier || invoice.fichierUrl || invoice.storagePath) || !(Number(invoice.montant) > 0));
}
export function isActionDue(colis, now = Date.now()) {
  return colis.nextActionSource === 'manual' && isActiveColis(colis) && !isClientWaiting(colis, now)
    && Number.isFinite(timestamp(colis.nextActionAt)) && timestamp(colis.nextActionAt) <= now;
}
export function queueContext({ clients = [], getClient, categories = [], tarifs = {}, settings = {}, now = Date.now() } = {}) {
  const byId = new Map(clients.map((client) => [client.id, client]));
  return { getClient: getClient || ((id) => byId.get(id)), categories, tarifs, settings, now };
}
export function matchesWorkQueue(colis, key, context = {}) {
  if (colis.archive) return false;
  if (key === 'messages') return needsConversationAction(colis);
  if (!isActiveColis(colis)) return false;
  const now = context.now ?? Date.now();
  const client = context.getClient?.(colis.clientId);
  switch (key) {
    case 'preparation': return ['autorise', 'en_preparation'].includes(colis.statut);
    case 'documents': return needsDocuments(colis, client);
    case 'waiting': return hasVoluntaryWait(colis);
    case 'decision': return colis.statut === 'attente_feu_vert' && !hasVoluntaryWait(colis);
    case 'overdue': return isActionDue(colis, now);
    case 'wait-review': return isWaitDue(colis, now);
    case 'ready': {
      if (colis.statut !== 'en_preparation' || !client) return false;
      const destination = DESTINATIONS[String(client.cp || '').slice(0, 3)];
      return calculateQuote({ colis, client, destination, tarif: context.tarifs?.[destination?.code], categories: context.categories || [], settings: context.settings || {} }).ok;
    }
    default: return true;
  }
}
export function queueRows(data, key, context = {}) {
  return data.filter((colis) => matchesWorkQueue(colis, key, context));
}

/** Only a dated current event may create an overdue alert; reception is not a proxy for later stages. */
export function urgency(colis, now = Date.now()) {
  const conversationNeedsAction = needsConversationAction(colis);
  if (!conversationNeedsAction && (isClientWaiting(colis, now) || terminal.has(colis.statut))) return { overdue: false, label: '', since: null };
  if (!conversationNeedsAction && isWaitDue(colis, now)) return { overdue: true, label: 'Attente à reprendre', since: colis.attenteClientUntil };
  if (!conversationNeedsAction && isActionDue(colis, now)) return { overdue: true, label: 'Action échue', since: colis.nextActionAt };
  let since;
  let label;
  if (needsConversationAction(colis)) { since = colis.conversationOpenedAt || colis.conversationUpdatedAt; label = 'Réponse à traiter'; }
  else if (colis.statut === 'attente_feu_vert') { since = colis.demandeFeuVertEnvoyeeAt; label = 'Accord demandé'; }
  else if (['devis_envoye', 'attente_paiement'].includes(colis.statut)) { since = colis.devisEnvoyeLe; label = 'Devis envoyé'; }
  else { since = colis.statutUpdatedAt || (colis.statut === 'receptionne' ? colis.dateReception : null); label = 'Dans cette étape'; }
  const start = timestamp(since);
  if (!Number.isFinite(start) || start > now) return { overdue: false, label: 'Date de l’étape non renseignée', since: null };
  const days = Math.floor((now - start) / DAY);
  return { overdue: days >= 7, label: `${label} depuis ${days ? `${days} j` : 'aujourd’hui'}`, since, days };
}
export function nextAction(colis, client, now = Date.now()) {
  if (needsConversationAction(colis)) return 'Répondre au client';
  if (isWaitDue(colis, now)) return 'Revoir l’attente avec le client';
  if (isClientWaiting(colis, now)) return 'Attente demandée';
  if (colis.nextAction?.trim()) return colis.nextAction;
  if (colis.statut === 'autorise') return 'Commencer la préparation';
  if (colis.statut === 'en_preparation') return needsDocuments(colis, client) ? 'Vérifier les documents' : 'Finaliser le devis';
  if (colis.statut === 'receptionne') return 'Mesurer le colis';
  if (colis.statut === 'mesure') return 'Demander l’accord client';
  if (needsDocuments(colis, client)) return 'Vérifier les documents';
  if (colis.statut === 'attente_feu_vert') return colis.demandeFeuVertEnvoyeeAt ? 'Réponse client attendue' : 'Envoyer la demande d’accord';
  if (['devis_envoye', 'attente_paiement'].includes(colis.statut)) return 'Règlement attendu';
  if (colis.statut === 'paye') return 'Préparer le départ';
  return STATUTS[colis.statut]?.label || 'Consulter le dossier';
}
export function priorityScore(colis, client, now = Date.now()) {
  if (terminal.has(colis.statut) && !needsConversationAction(colis)) return -10000;
  if (needsConversationAction(colis)) {
    const opened = timestamp(colis.conversationOpenedAt || colis.conversationUpdatedAt);
    return 6000 + (Number.isFinite(opened) ? Math.min(999, Math.max(0, (now - opened) / DAY)) : 0);
  }
  if (isWaitDue(colis, now) || isActionDue(colis, now)) return 5000 + Math.min(999, Math.max(0, (now - timestamp(isWaitDue(colis, now) ? colis.attenteClientUntil : colis.nextActionAt)) / DAY));
  if (isClientWaiting(colis, now)) return -1000;
  const event = urgency(colis, now);
  const stage = ['autorise', 'en_preparation'].includes(colis.statut) ? 4000 : ['receptionne', 'mesure', 'paye'].includes(colis.statut) ? 3000 : 1000;
  return stage + Math.min(event.days || 0, 999) + (client?.abonnement === 'vip' ? 10 : 0);
}
export function matchesOwner(colis, owner, currentUserId) {
  if (owner === 'mine') return Boolean(currentUserId) && colis.responsibleStaffId === currentUserId;
  if (owner === 'unassigned') return !colis.responsibleStaffId;
  return !owner || colis.responsibleStaffId === owner;
}
