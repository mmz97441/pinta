// Edge Function telegram-webhook
// Reçoit les callbacks de boutons inline et les messages entrants
// du bot @Expedilebot, puis met à jour la DB Supabase en conséquence.
//
// Déploiement : `supabase functions deploy telegram-webhook`
// Variables d'environnement attendues :
//   - TELEGRAM_BOT_TOKEN
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ═════════════════════════════ HELPERS TELEGRAM ═════════════════════════════

async function sendReply(
  chatId: number,
  text: string,
  opts?: { replyMarkup?: unknown; replyToId?: number },
): Promise<number | null> {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "Markdown" };
  if (opts?.replyMarkup) body.reply_markup = opts.replyMarkup;
  if (opts?.replyToId) body.reply_to_message_id = opts.replyToId;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data?.result?.message_id || null;
}

async function answerCallback(cbId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cbId, text }),
  });
}

// Retire l'inline keyboard d'un message existant (sans toucher au texte).
// Plus robuste que editMessageText : pas de risque de casser le Markdown du message original.
async function removeInlineKeyboard(chatId: number, msgId: number): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: msgId,
      reply_markup: { inline_keyboard: [] },
    }),
  });
}

// ═════════════════════════════ HELPERS DIVERS ═════════════════════════════

// Équivalent Deno du helper frontend utils/getPrenom.
// c.nom est construit comme "NOM Prénom" dans mapClient() — donc split[0] donne
// le nom de famille (bug). On utilise c.prenom en priorité, avec fallback sur
// tout ce qui suit le premier mot de c.nom.
function getPrenom(client: { prenom?: string | null; nom?: string | null }): string {
  if (!client) return "";
  if (client.prenom) return client.prenom;
  const parts = (client.nom || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts.slice(1).join(" ");
  return parts[0] || "";
}

function nowParis(): string {
  return new Date().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

// Upload d'un fichier Telegram (photo ou document) vers Supabase Storage.
async function handleFile(
  fileId: string,
  colisId: string,
  fileName: string,
): Promise<string | null> {
  try {
    const fr = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fd = await fr.json();
    if (!fd.ok) return null;
    const blob = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fd.result.file_path}`);
    const bytes = await blob.arrayBuffer();
    const ext = fileName.split(".").pop() || "jpg";
    const path = `${colisId}/telegram_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("factures").upload(path, bytes, {
      contentType: ext === "pdf" ? "application/pdf" : `image/${ext}`,
      upsert: true,
    });
    if (error) return null;
    const { data: u } = supabase.storage.from("factures").getPublicUrl(path);
    return u?.publicUrl || null;
  } catch {
    return null;
  }
}

// ═════════════════════════════ ROUTING DES RÉPONSES CLIENT ═════════════════════════════

async function findColisFromReply(replyToMsgId: number): Promise<string | null> {
  if (!replyToMsgId) return null;
  const { data: msg } = await supabase
    .from("messages")
    .select("colis_id")
    .eq("telegram_msg_id", String(replyToMsgId))
    .limit(1)
    .single();
  if (msg?.colis_id) return msg.colis_id;
  const { data: fac } = await supabase
    .from("factures")
    .select("colis_id")
    .eq("telegram_msg_id", String(replyToMsgId))
    .limit(1)
    .single();
  if (fac?.colis_id) return fac.colis_id;
  return null;
}

async function findBestColis(
  clientId: string,
  activeColis: { id: string; ref: string }[],
  replyToMsgId?: number,
): Promise<{ id: string; ref: string } | null> {
  if (!activeColis?.length) return null;
  if (activeColis.length === 1) return activeColis[0];

  if (replyToMsgId) {
    const tracedColisId = await findColisFromReply(replyToMsgId);
    if (tracedColisId) {
      const match = activeColis.find((c) => c.id === tracedColisId);
      if (match) return match;
    }
  }

  // Priorité : dernière demande de facture staff
  const { data: factureRequests } = await supabase
    .from("messages")
    .select("colis_id")
    .eq("type", "staff")
    .in("colis_id", activeColis.map((c) => c.id))
    .or("texte.ilike.%facture%")
    .order("created_at", { ascending: false })
    .limit(1);
  if (factureRequests?.length) {
    const match = activeColis.find((c) => c.id === factureRequests[0].colis_id);
    if (match) return match;
  }

  // Priorité : dernière conversation staff
  const { data: recentMsgs } = await supabase
    .from("messages")
    .select("colis_id")
    .eq("type", "staff")
    .in("colis_id", activeColis.map((c) => c.id))
    .order("created_at", { ascending: false })
    .limit(1);
  if (recentMsgs?.length) {
    const match = activeColis.find((c) => c.id === recentMsgs[0].colis_id);
    if (match) return match;
  }

  return activeColis[0];
}

// ═════════════════════════════ SERVEUR PRINCIPAL ═════════════════════════════

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK");
  try {
    const update = await req.json();

    // ═════════════════ CALLBACK QUERIES (boutons inline) ═════════════════
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const msgId = cb.message?.message_id;
      const data = cb.data;

      if (data?.startsWith("fv_")) {
        const parts = data.split("_");
        const action = parts[1]; // "oui" | "non" | "wait"
        const colisId = parts.slice(2).join("_");

        const { data: colis } = await supabase
          .from("colis")
          .select("ref, statut, client_id")
          .eq("id", colisId)
          .single();

        if (!colis || colis.statut !== "attente_feu_vert") {
          await answerCallback(cb.id, "Cette demande n'est plus en attente.");
          return new Response("OK");
        }

        const ts = nowParis();

        // ─── OUI : on approuve UNIQUEMENT le colis cliqué ───
        // (et pas tous les autres en attente_feu_vert comme avant — fix du bulk OUI)
        if (action === "oui") {
          await supabase.from("colis").update({
            statut: "autorise",
            feu_vert: "autorise",
            feu_vert_date: new Date().toISOString(),
          }).eq("id", colisId);

          await supabase.from("logs_statut").insert({
            colis_id: colisId,
            ancien_statut: "attente_feu_vert",
            nouveau_statut: "autorise",
          });

          await supabase.from("messages").insert({
            colis_id: colisId,
            type: "client",
            auteur_nom: "Client (Telegram)",
            texte: "✅ Accord donné via bouton Telegram",
          });

          // Ligne "Système" — trace de la transition pour l'historique staff
          await supabase.from("messages").insert({
            colis_id: colisId,
            type: "systeme",
            auteur_nom: "Système",
            texte: `🔄 Feu vert reçu le ${ts} → colis passé de "Attente feu vert" à "Autorisé"`,
          });

          await answerCallback(cb.id, "Accord enregistré ✅");
          // On retire juste les boutons, le message original reste intact
          await removeInlineKeyboard(chatId, msgId);
          // Et on envoie un NOUVEAU message de confirmation en réponse
          await sendReply(
            chatId,
            `✅ *Accord enregistré le ${ts}*\n\nMerci ! Notre équipe lance la préparation de votre colis.\n\n⏱️ Vous recevrez votre devis final sous 24-48h, avec le résultat précis de notre optimisation et l'économie réalisée 💰\n\n_L'équipe Expedîle_`,
            { replyToId: msgId },
          );
          return new Response("OK");
        }

        // ─── J'ATTENDS : on met en pause sans annuler ───
        if (action === "wait") {
          await supabase.from("colis").update({
            attente_client_motif: "Attend d'autres colis (via Telegram)",
            attente_client_date: new Date().toISOString(),
          }).eq("id", colisId);

          await supabase.from("messages").insert({
            colis_id: colisId,
            type: "client",
            auteur_nom: "Client (Telegram)",
            texte: "⏸️ Attend d'autres colis avant préparation",
          });

          await supabase.from("messages").insert({
            colis_id: colisId,
            type: "systeme",
            auteur_nom: "Système",
            texte: `🔄 Client souhaite attendre d'autres colis (via Telegram, ${ts}) — préparation en pause, relance auto à la prochaine réception`,
          });

          await answerCallback(cb.id, "Pause enregistrée ⏸️");
          await removeInlineKeyboard(chatId, msgId);
          await sendReply(
            chatId,
            `⏸️ *Pause enregistrée le ${ts}*\n\nPas de préparation lancée pour l'instant. Votre colis reste en sécurité dans notre entrepôt.\n\n📦 Dès qu'un nouveau colis arrive à votre nom, nous vous redemandons si vous voulez toujours attendre ou lancer la préparation groupée.\n\n_L'équipe Expedîle_`,
            { replyToId: msgId },
          );
          return new Response("OK");
        }

        // ─── NON : refus explicite ───
        await supabase.from("colis").update({
          statut: "refuse_client",
          feu_vert: "refuse",
        }).eq("id", colisId);

        await supabase.from("logs_statut").insert({
          colis_id: colisId,
          ancien_statut: "attente_feu_vert",
          nouveau_statut: "refuse_client",
        });

        await supabase.from("messages").insert({
          colis_id: colisId,
          type: "client",
          auteur_nom: "Client (Telegram)",
          texte: "❌ Refus via bouton Telegram",
        });

        await supabase.from("messages").insert({
          colis_id: colisId,
          type: "systeme",
          auteur_nom: "Système",
          texte: `🔄 Refus reçu le ${ts} → colis passé de "Attente feu vert" à "Refusé par le client"`,
        });

        await answerCallback(cb.id, "Refus enregistré ❌");
        await removeInlineKeyboard(chatId, msgId);
        await sendReply(
          chatId,
          `❌ *Refus enregistré le ${ts}*\n\nMessage bien reçu. Votre colis reste en sécurité dans notre entrepôt en attendant vos instructions.\n\n💬 Deux options pour la suite :\n• Vous souhaitez qu'on le renvoie à l'expéditeur ?\n• Vous voulez qu'on le garde encore quelques jours au cas où ?\n\nRépondez simplement à ce message, notre équipe revient vers vous dans la journée.\n\n_L'équipe Expedîle_`,
          { replyToId: msgId },
        );
      }
      return new Response("OK");
    }

    // ═════════════════ MESSAGES ENTRANTS ═════════════════
    const msg = update.message;
    if (!msg) return new Response("OK");
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();
    const msgTelegramId = msg.message_id;
    const replyToMsgId = msg.reply_to_message?.message_id || null;
    const fromUsername = msg.from?.username || "";
    const fromName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ");

    // ─── /start : liaison du compte Telegram au client DB ───
    if (text.startsWith("/start")) {
      const param = text.replace("/start", "").trim();
      let client: { id: string; nom: string; prenom?: string; telegram_chat_id?: string; telegram_username?: string } | null = null;

      if (param) {
        const { data } = await supabase
          .from("clients")
          .select("id,nom,prenom,telegram_chat_id")
          .eq("id", param)
          .single();
        client = data;
      }
      if (!client && fromUsername) {
        const { data } = await supabase
          .from("clients")
          .select("id,nom,prenom,telegram_chat_id,telegram_username")
          .not("telegram_username", "is", null);
        if (data) {
          client = data.find((c: { telegram_username?: string }) =>
            (c.telegram_username || "").replace(/^@/, "").toLowerCase() === fromUsername.toLowerCase()
          );
        }
      }
      if (client) {
        if (client.telegram_chat_id === String(chatId)) {
          await sendReply(chatId, "Déjà lié ! ✅ /statut\n\n_Expedîle_");
          return new Response("OK");
        }
        await supabase.from("clients").update({ telegram_chat_id: String(chatId) }).eq("id", client.id);
        await sendReply(
          chatId,
          `Bonjour ${getPrenom(client)} 👋\n\nCompte lié ! ✅\n📦 Réception 🔔 Accords 💳 Devis ✈️ Expédition\n\n/statut\n\n_Expedîle_`,
        );
      } else {
        await sendReply(
          chatId,
          `Bienvenue ! 👋\nCompte non trouvé. Demandez le lien.\nChat ID: \`${chatId}\`\n${fromUsername ? `@${fromUsername}` : ""}\n\n_Expedîle_`,
        );
      }
      return new Response("OK");
    }

    // ─── /statut : liste des colis actifs ───
    if (text === "/statut") {
      const { data: cl } = await supabase
        .from("clients")
        .select("id,nom")
        .eq("telegram_chat_id", String(chatId))
        .single();
      if (!cl) {
        await sendReply(chatId, "Non lié. /start");
        return new Response("OK");
      }
      const { data: colis } = await supabase
        .from("colis")
        .select("ref,statut,desc_contenu")
        .eq("client_id", cl.id)
        .not("statut", "in", '("livre","annule")')
        .order("created_at", { ascending: false });
      if (!colis?.length) {
        await sendReply(chatId, "Aucun colis 📦\n_Expedîle_");
        return new Response("OK");
      }
      const e: Record<string, string> = {
        receptionne: "📦", mesure: "📐", attente_feu_vert: "🔔", autorise: "✅",
        en_preparation: "🔧", devis_envoye: "💳", attente_paiement: "⏳", paye: "💰",
        expedie: "✈️", transit: "🛫", dedouanement: "🏛️", arrive: "📍", livraison: "🚚",
      };
      const lines = colis.map((c: { statut: string; ref: string; desc_contenu?: string }) =>
        `${e[c.statut] || "📦"} *${c.ref}* — ${c.desc_contenu || "—"}\n   _${c.statut.replace(/_/g, " ")}_`
      );
      await sendReply(chatId, `📦 *Colis (${colis.length})* :\n\n${lines.join("\n\n")}\n\n_Expedîle_`);
      return new Response("OK");
    }

    // ─── /aide ───
    if (text === "/aide") {
      await sendReply(
        chatId,
        "*Aide* 📋\n/start — Lier\n/statut — Colis\n/aide — Aide\n\nEnvoyez vos *factures* (photo/PDF) ici.\n\n_Expedîle_",
      );
      return new Response("OK");
    }

    // ─── Identification du client ───
    const { data: client } = await supabase
      .from("clients")
      .select("id,nom,prenom")
      .eq("telegram_chat_id", String(chatId))
      .single();
    if (!client) {
      if (text) await sendReply(chatId, "Non lié. /start");
      return new Response("OK");
    }

    const { data: activeColis } = await supabase
      .from("colis")
      .select("id,ref,desc_contenu")
      .eq("client_id", client.id)
      .not("statut", "in", '("livre","annule")')
      .order("created_at", { ascending: false });
    if (!activeColis?.length) {
      await sendReply(chatId, "Aucun colis actif.");
      return new Response("OK");
    }

    // ─── PHOTO / DOCUMENT (facture) ───
    if (msg.photo || msg.document) {
      let fileId = "";
      let fileName = "facture.jpg";
      if (msg.photo?.length) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
        fileName = "facture_telegram.jpg";
      } else if (msg.document) {
        fileId = msg.document.file_id;
        fileName = msg.document.file_name || "document.pdf";
      }
      const caption = msg.caption || "";

      const bestColis = await findBestColis(client.id, activeColis, replyToMsgId);
      if (!bestColis) {
        await sendReply(chatId, "Aucun colis actif.");
        return new Response("OK");
      }

      const url = await handleFile(fileId, bestColis.id, fileName);
      if (url) {
        const vendeur = caption || "Facture (Telegram)";
        await supabase.from("factures").insert({
          colis_id: bestColis.id,
          vendeur,
          montant: 0,
          valide: false,
          fichier_url: url,
          fichier_nom: fileName,
          telegram_msg_id: String(msgTelegramId),
        });
        await supabase.from("messages").insert({
          colis_id: bestColis.id,
          type: "client",
          auteur_nom: fromName || `${client.nom}${client.prenom ? " " + client.prenom : ""}`,
          texte: `📎 Facture envoyée : ${vendeur}\n${url}`,
        });
        await sendReply(
          chatId,
          `✅ Facture reçue pour *${bestColis.ref}* !\nNotre équipe va la vérifier.\n\n_Expedîle_`,
          { replyToId: msgTelegramId },
        );
      } else {
        await sendReply(chatId, "⚠️ Erreur fichier. Ressayez.", { replyToId: msgTelegramId });
      }
      return new Response("OK");
    }

    // ─── TEXTE LIBRE ───
    if (text && !text.startsWith("/")) {
      const bestColis = await findBestColis(client.id, activeColis, replyToMsgId);
      const cId = bestColis?.id || activeColis[0].id;
      await supabase.from("messages").insert({
        colis_id: cId,
        type: "client",
        auteur_nom: fromName || `${client.nom}${client.prenom ? " " + client.prenom : ""}`,
        texte: text,
      });
      await sendReply(chatId, "Reçu ✅");
    }
    return new Response("OK");
  } catch (err) {
    console.error("Webhook:", err);
    return new Response("OK");
  }
});
