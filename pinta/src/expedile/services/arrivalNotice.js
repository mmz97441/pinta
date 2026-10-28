// Arrival notice (docs/specification-brouillon-reception-2026-10-28.md, « Messages : l'avis d'arrivée »): one message per
// validated reception, announcing all its cartons. The browser renders the text; validate_reception receives that text,
// its channel and its template, decides the channel again on the server and refuses a different one.
import { DEFAULT_BODIES } from './messageDefaults.js';
import { renderTemplate } from './messageTemplates.js';
import { invoiceRequestState } from '../domain/invoiceRequest.js';

// validate_reception and Telegram accept 1 to 4096 characters.
const MAX_TEXT = 4096;
const filled = (value) => String(value ?? '').trim() !== '';

/** The channel validate_reception decides, on a client of lib/supabaseData.js (mapClient): Telegram when the client
 * linked it (telegramChatId), otherwise e-mail when an address is known, otherwise none (null: validate without notice). */
export function arrivalChannel(client) {
  if (!client) return null;
  if (filled(client.telegramChatId)) return 'telegram';
  if (filled(client.email)) return 'email';
  return null;
}

/** 'arrivee_colis_facture' when a dossier of the reception still requests its purchase invoice, else 'arrivee_colis'.
 * The rule of « facture manquante »: invoiceRequestState(colis).requested (domain/invoiceRequest.js, mirror of the
 * invoice_requested of queue_message and of _shared/invoiceRequest.ts), on the dossiers' loaded factures. As for the
 * consent confirmation (feu_vert_recu_facture), never for a professional client: pass the client to apply it. */
export function arrivalTemplate(colisList, client) {
  if (client?.type === 'pro') return 'arrivee_colis';
  const dossiers = Array.isArray(colisList) ? colisList.filter(Boolean) : [];
  return dossiers.some((colis) => invoiceRequestState(colis).requested) ? 'arrivee_colis_facture' : 'arrivee_colis';
}

/** The notice of one reception: { canal, template, text }, or { canal: null } when the client has neither Telegram nor
 * e-mail. colisList: the reception's dossiers, in the order of validate_reception's items (the first one carries the
 * message and feeds the dossier variables such as {{ref}}). cartons: the reception's cartons ({ number, fournisseur,
 * dimL, dimW, dimH, poids }, other fields ignored), numbered in the order given: that of validate_reception's snapshot,
 * dossier by dossier in the items' order, then by carton number. bodies: the saved templates (AppContext messageTemplates, keyed
 * `${key}_${canal}`), with the default body otherwise, exactly as AppContext getPreview chooses it. An unknown variable
 * of a saved body throws: it is never replaced by the default. */
export function renderArrivalNotice({ client, colisList, cartons, destination, settings, bodies } = {}) {
  const canal = arrivalChannel(client);
  if (!canal) return { canal: null };
  const dossiers = Array.isArray(colisList) ? colisList.filter(Boolean) : [];
  const received = Array.isArray(cartons) ? cartons : [];
  if (!dossiers.length) throw new Error('Avis d’arrivée : aucun dossier pour cette réception.');
  if (!received.length) throw new Error('Avis d’arrivée : aucun colis à annoncer.');
  const template = arrivalTemplate(dossiers, client);
  const key = `${template}_${canal}`;
  const body = bodies?.[key] ?? DEFAULT_BODIES[key];
  const text = renderTemplate(body, { client, colis: dossiers[0], destination: destination || {}, settings: settings || {}, reception: { cartons: received } });
  if (!text.trim()) throw new Error('Le message est vide.');
  if (text.length > MAX_TEXT) throw new Error(`L’avis d’arrivée compte ${text.length} caractères, ${MAX_TEXT} au plus : raccourcissez le modèle ou validez moins de colis à la fois.`);
  return { canal, template, text };
}
