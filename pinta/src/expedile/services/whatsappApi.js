// ══════════ WhatsApp Business Cloud API ══════════
// Documentation : https://developers.facebook.com/docs/whatsapp/cloud-api
//
// 2 modes d'envoi :
//   1. Template  → message pré-approuvé Meta (obligatoire pour initier une conversation)
//   2. Texte     → message libre (uniquement dans la fenêtre de 24h après un msg du client)
//
// ⚠️  En production, le token devra être sur un backend sécurisé (jamais côté client)
// ──────────────────────────────────────────────────────────────────────────────

const PHONE_ID    = import.meta.env.VITE_WA_PHONE_ID;
const TOKEN       = import.meta.env.VITE_WA_TOKEN;
const API_VERSION = import.meta.env.VITE_WA_API_VERSION || 'v22.0';

const BASE_URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}`;

/** Vérifie si l'API WhatsApp est configurée */
export function isWaConfigured() {
  return !!(PHONE_ID && TOKEN);
}

/**
 * Normalise un numéro FR/DOM-TOM au format international sans le +
 * Ex: "+262 692 12 34 56" → "262692123456"
 *     "0692123456"        → "262692123456"
 */
function normalizeTel(tel) {
  let cleaned = tel.replace(/[^0-9+]/g, '');
  // Si commence par +, on enlève le +
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  // Si commence par 0 (numéro local Réunion/Mayotte/Antilles)
  if (cleaned.startsWith('06') || cleaned.startsWith('07')) {
    cleaned = '33' + cleaned.slice(1); // France métro
  } else if (cleaned.startsWith('0692') || cleaned.startsWith('0693') || cleaned.startsWith('0694')) {
    cleaned = '262' + cleaned.slice(1); // Réunion
  } else if (cleaned.startsWith('0639')) {
    cleaned = '262' + cleaned.slice(1); // Mayotte
  }
  return cleaned;
}

/**
 * Envoie un message template (hello_world, etc.)
 * Utilisé pour initier une conversation ou envoyer des notifications standardisées.
 *
 * @param {string} to       - Numéro destinataire (ex: "+262692595378")
 * @param {string} template - Nom du template Meta (ex: "hello_world")
 * @param {string} lang     - Code langue (ex: "en_US", "fr")
 * @param {Array}  params   - Paramètres du template [{type:"text", text:"valeur"}, ...]
 * @returns {{ ok: boolean, data?: object, error?: string }}
 */
export async function sendTemplate(to, template, lang = 'en_US', params = []) {
  if (!isWaConfigured()) return { ok: false, error: 'API WhatsApp non configurée' };

  const body = {
    messaging_product: 'whatsapp',
    to: normalizeTel(to),
    type: 'template',
    template: {
      name: template,
      language: { code: lang },
    },
  };

  // Ajouter des paramètres si fournis
  if (params.length > 0) {
    body.template.components = [{
      type: 'body',
      parameters: params.map((p) =>
        typeof p === 'string' ? { type: 'text', text: p } : p
      ),
    }];
  }

  try {
    const res = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[WA API] Erreur template:', data);
      return { ok: false, error: data.error?.message || `HTTP ${res.status}`, data };
    }
    console.log('[WA API] Template envoyé ✓', data);
    return { ok: true, data };
  } catch (err) {
    console.error('[WA API] Erreur réseau:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Envoie un message texte libre.
 * ⚠️  Fonctionne UNIQUEMENT si le client a envoyé un message dans les dernières 24h.
 *     Sinon l'API retourne une erreur → on fallback sur wa.me
 *
 * @param {string} to   - Numéro destinataire
 * @param {string} text - Corps du message
 * @returns {{ ok: boolean, data?: object, error?: string }}
 */
export async function sendText(to, text) {
  if (!isWaConfigured()) return { ok: false, error: 'API WhatsApp non configurée' };

  const body = {
    messaging_product: 'whatsapp',
    to: normalizeTel(to),
    type: 'text',
    text: {
      preview_url: false,
      body: text,
    },
  };

  try {
    const res = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[WA API] Erreur texte:', data);
      return { ok: false, error: data.error?.message || `HTTP ${res.status}`, data };
    }
    console.log('[WA API] Message texte envoyé ✓', data);
    return { ok: true, data };
  } catch (err) {
    console.error('[WA API] Erreur réseau:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Construit un lien wa.me (fallback manuel uniquement).
 */
export function waMeLink(to, text) {
  return `https://wa.me/${normalizeTel(to)}?text=${encodeURIComponent(text)}`;
}

/**
 * Envoie un message WhatsApp via l'API — SANS redirection automatique.
 * Retourne { ok, error?, waLink? } pour que l'appelant gère l'affichage.
 *
 * @param {string} to   - Numéro destinataire
 * @param {string} text - Corps du message
 * @returns {{ ok: boolean, error?: string, waLink?: string }}
 */
export async function sendWhatsApp(to, text) {
  if (!isWaConfigured()) {
    return { ok: false, error: 'API non configurée', waLink: waMeLink(to, text) };
  }

  const result = await sendText(to, text);

  if (result.ok) {
    return { ok: true };
  } else {
    return { ok: false, error: result.error, waLink: waMeLink(to, text) };
  }
}
