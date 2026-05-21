import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sendTelegram(chatId: string, text: string) {
  if (!chatId || !TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
  } catch (e) { console.error('[Telegram]', e); }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const payload = await req.json();
    console.log('[PayPlug Webhook] Received:', JSON.stringify(payload).slice(0, 500));

    const paymentId = payload.id;
    const isPaid = payload.is_paid === true;
    const metadata = payload.metadata || {};
    const colisId = metadata.colis_id;
    const colisRef = metadata.colis_ref;
    const amountCents = payload.amount || 0;
    const amount = amountCents / 100;

    if (!isPaid) {
      console.log(`[PayPlug Webhook] Payment ${paymentId} not paid yet`);
      return new Response(JSON.stringify({ received: true, action: 'none' }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (!colisId) {
      console.error('[PayPlug Webhook] No colis_id in metadata');
      return new Response(JSON.stringify({ error: 'No colis_id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    console.log(`[PayPlug Webhook] PAID: ${paymentId} for ${colisId} = ${amount}EUR`);

    // Get current colis status before updating
    const { data: currentColis } = await supabase
      .from('colis')
      .select('statut, client_id, ref')
      .eq('id', colisId)
      .single();

    if (!currentColis) {
      console.error('[PayPlug Webhook] Colis not found:', colisId);
      return new Response(JSON.stringify({ error: 'Colis not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const oldStatut = currentColis.statut;

    // Skip if already paid
    if (oldStatut === 'paye' || oldStatut === 'expedie' || oldStatut === 'transit' || oldStatut === 'livre') {
      console.log(`[PayPlug Webhook] Already ${oldStatut}, skipping`);
      return new Response(JSON.stringify({ received: true, action: 'already_paid' }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Update colis to paye
    const { error: updateErr } = await supabase
      .from('colis')
      .update({
        statut: 'paye',
        paiement_montant: amount,
        paiement_date: new Date().toISOString(),
      })
      .eq('id', colisId);

    if (updateErr) {
      console.error('[PayPlug Webhook] Update error:', updateErr.message);
      return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    console.log(`[PayPlug Webhook] Status updated: ${oldStatut} -> paye`);

    // Log the status change (use correct column names)
    try {
      await supabase.from('logs_statut').insert({
        colis_id: colisId,
        ancien_statut: oldStatut,
        nouveau_statut: 'paye',
        user_nom: 'PayPlug',
        commentaire: `Paiement en ligne ${amount.toFixed(2)} EUR (${paymentId})`,
      });
    } catch (logErr) {
      console.warn('[PayPlug Webhook] Log insert failed:', logErr);
    }

    // Send Telegram confirmation to client
    if (currentColis.client_id) {
      try {
        const { data: client } = await supabase
          .from('clients')
          .select('nom, prenom, telegram_chat_id')
          .eq('id', currentColis.client_id)
          .single();

        if (client?.telegram_chat_id) {
          const prenom = client.prenom || client.nom?.split(' ')[0] || 'Client';
          const msg = `Bonjour ${prenom} 👋\n\n✅ *Paiement reçu !*\n\n📦 Colis : *${currentColis.ref || colisRef}*\n💰 Montant : *${amount.toFixed(2)} €*\n\n🚀 Votre colis va être expédié prochainement. Vous serez notifié(e) dès l'expédition.\n\nMerci pour votre confiance !\n\n_L'équipe Expedîle_`;
          await sendTelegram(client.telegram_chat_id, msg);
          console.log(`[PayPlug Webhook] Telegram sent to ${prenom}`);

          await supabase.from('messages').insert({
            colis_id: colisId,
            type: 'staff',
            auteur_nom: 'Système',
            texte: msg,
            statut: 'envoye',
          });
        }
      } catch (tgErr) {
        console.warn('[PayPlug Webhook] Telegram error:', tgErr);
      }
    }

    return new Response(JSON.stringify({ success: true, colisId, amount, oldStatut }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[PayPlug Webhook] Exception:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
