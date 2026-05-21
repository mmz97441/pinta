import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sendTelegram(chatId: string, text: string) {
  if (!chatId || !TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

Deno.serve(async (req: Request) => {
  try {
    const now = new Date();
    console.log('[Relances] Running at', now.toISOString());

    // Get all clients with active colis in early statuses
    const { data: colis } = await supabase
      .from('colis')
      .select('id, ref, client_id, statut, date_reception, created_at')
      .in('statut', ['receptionne', 'mesure', 'attente_feu_vert'])
      .order('created_at', { ascending: true });

    if (!colis || colis.length === 0) {
      console.log('[Relances] No colis to process');
      return new Response(JSON.stringify({ processed: 0 }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Group by client — use FIRST colis date (not last)
    const byClient: Record<string, { clientId: string; firstDate: Date; colis: any[] }> = {};
    for (const c of colis) {
      const cid = c.client_id;
      const date = new Date(c.date_reception || c.created_at);
      if (!byClient[cid]) {
        byClient[cid] = { clientId: cid, firstDate: date, colis: [] };
      }
      if (date < byClient[cid].firstDate) byClient[cid].firstDate = date;
      byClient[cid].colis.push(c);
    }

    let relances20 = 0, relances30 = 0, relances60 = 0;

    for (const group of Object.values(byClient)) {
      const daysSinceFirst = Math.floor((now.getTime() - group.firstDate.getTime()) / (1000 * 60 * 60 * 24));

      // Get client info
      const { data: client } = await supabase
        .from('clients')
        .select('nom, prenom, telegram_chat_id, email, type')
        .eq('id', group.clientId)
        .single();
      if (!client) continue;

      const prenom = client.prenom || client.nom?.split(' ')[0] || 'Client';
      const refs = group.colis.map((c: any) => c.ref).join(', ');
      const isPro = client.type === 'pro';
      const chatId = client.telegram_chat_id;

      // J+20 — First reminder
      if (daysSinceFirst >= 20 && daysSinceFirst < 30) {
        // Check if we already sent a J+20 relance (avoid duplicates)
        const { data: existing } = await supabase
          .from('messages')
          .select('id')
          .eq('colis_id', group.colis[0].id)
          .ilike('texte', '%stockage%20 jours%')
          .limit(1);
        if (existing && existing.length > 0) continue;

        const msg = `Bonjour ${prenom} 👋\n\n⏰ *Rappel* — Vos colis sont dans notre entrepôt depuis *${daysSinceFirst} jours* :\n${refs}\n\nNous attendons votre accord (feu vert) pour lancer la préparation.\n\n📦 *Stockage gratuit : 20 jours.* Au-delà, des frais de stockage peuvent s'appliquer.\n\nMerci de nous donner votre feu vert rapidement !\n\n_L'équipe Expedîle_`;

        if (!isPro && chatId) {
          await sendTelegram(chatId, msg);
        }
        // Save message
        await supabase.from('messages').insert({
          colis_id: group.colis[0].id,
          type: 'staff', auteur_nom: 'Système (auto)',
          texte: msg, statut: 'envoye',
        });
        relances20++;
      }

      // J+30 — Second reminder with storage fees warning
      if (daysSinceFirst >= 30 && daysSinceFirst < 60) {
        const { data: existing } = await supabase
          .from('messages')
          .select('id')
          .eq('colis_id', group.colis[0].id)
          .ilike('texte', '%frais de stockage%30 jours%')
          .limit(1);
        if (existing && existing.length > 0) continue;

        const msg = `Bonjour ${prenom} 👋\n\n⚠️ *Avertissement stockage* — Vos colis sont dans notre entrepôt depuis *${daysSinceFirst} jours* :\n${refs}\n\n💰 *Des frais de stockage de 1€/jour/colis s'appliquent à partir de 30 jours.*\n\nSans réponse de votre part, les colis seront considérés comme abandonnés après 60 jours.\n\nMerci de nous contacter rapidement.\n\n_L'équipe Expedîle_`;

        if (!isPro && chatId) {
          await sendTelegram(chatId, msg);
        }
        await supabase.from('messages').insert({
          colis_id: group.colis[0].id,
          type: 'staff', auteur_nom: 'Système (auto)',
          texte: msg, statut: 'envoye',
        });
        relances30++;
      }

      // J+60 — Destruction warning
      if (daysSinceFirst >= 60) {
        const { data: existing } = await supabase
          .from('messages')
          .select('id')
          .eq('colis_id', group.colis[0].id)
          .ilike('texte', '%destruction%60 jours%')
          .limit(1);
        if (existing && existing.length > 0) continue;

        const msg = `Bonjour ${prenom} 👋\n\n🚨 *DERNIER AVERTISSEMENT* — Vos colis sont dans notre entrepôt depuis *${daysSinceFirst} jours* :\n${refs}\n\n❌ *Sans réponse sous 7 jours, vos colis seront détruits conformément à nos conditions générales.*\n\nContactez-nous immédiatement.\n\n_L'équipe Expedîle_`;

        if (!isPro && chatId) {
          await sendTelegram(chatId, msg);
        }
        await supabase.from('messages').insert({
          colis_id: group.colis[0].id,
          type: 'staff', auteur_nom: 'Système (auto)',
          texte: msg, statut: 'envoye',
        });
        relances60++;
      }
    }

    console.log(`[Relances] Done: ${relances20} J+20, ${relances30} J+30, ${relances60} J+60`);
    return new Response(JSON.stringify({ relances20, relances30, relances60 }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[Relances] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
