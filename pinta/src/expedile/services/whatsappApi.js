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
export function normalizeTel(tel) {
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
 * Envoie un message WhatsApp texte libre (chat) — SANS redirection automatique.
 * ⚠️  Ne fonctionne que dans la fenêtre 24h.
 * Pour les notifications, utiliser sendNotification() à la place.
 *
 * @param {string} to   - Numéro destinataire
 * @param {string} text - Corps du message
 * @returns {{ ok: boolean, messageId?: string, error?: string, waLink?: string }}
 */
export async function sendWhatsApp(to, text) {
  if (!isWaConfigured()) {
    return { ok: false, error: 'API non configurée', waLink: waMeLink(to, text) };
  }

  const result = await sendText(to, text);

  if (result.ok) {
    return { ok: true, messageId: result.data?.messages?.[0]?.id };
  } else {
    return { ok: false, error: result.error, waLink: waMeLink(to, text) };
  }
}

/**
 * Envoie une notification WhatsApp avec chaîne de fallback intelligente :
 *   1. Template Meta approuvé (fonctionne à tout moment, pas de fenêtre 24h)
 *   2. Si pas de template ou échec → texte libre (fenêtre 24h uniquement)
 *   3. Si tout échoue → retourne le lien wa.me pour envoi manuel
 *
 * @param {string} to         - Numéro destinataire
 * @param {string} text       - Corps du message (pour texte libre / fallback)
 * @param {object} [meta]     - Config template Meta { name, lang, params: string[] }
 * @returns {{ ok: boolean, messageId?: string, error?: string, waLink?: string, method?: string }}
 */
export async function sendNotification(to, text, meta) {
  if (!isWaConfigured()) {
    return { ok: false, error: 'API non configurée', waLink: waMeLink(to, text) };
  }

  // ── 1. Essayer le template Meta si disponible ──
  if (meta?.name) {
    console.log(`[WA API] Tentative template "${meta.name}"…`);
    const tplResult = await sendTemplate(to, meta.name, meta.lang || 'fr', meta.params || []);
    if (tplResult.ok) {
      return {
        ok: true,
        messageId: tplResult.data?.messages?.[0]?.id,
        method: 'template',
      };
    }
    // Template échoué (pas encore créé sur Meta, etc.) → on continue au fallback
    console.warn(`[WA API] Template "${meta.name}" échoué:`, tplResult.error, '→ fallback texte libre');
  }

  // ── 2. Fallback texte libre (fenêtre 24h) ──
  const textResult = await sendText(to, text);
  if (textResult.ok) {
    return {
      ok: true,
      messageId: textResult.data?.messages?.[0]?.id,
      method: 'text',
    };
  }

  // ── 3. Tout a échoué → lien manuel ──
  return {
    ok: false,
    error: textResult.error,
    waLink: waMeLink(to, text),
    method: 'failed',
  };
}
