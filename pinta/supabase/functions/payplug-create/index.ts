import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYPLUG_API = 'https://api.payplug.com/v1';
const PAYPLUG_KEY = (Deno.env.get('PAYPLUG_SECRET_KEY') || '').trim();
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const API_SECRET = Deno.env.get('EDGE_API_SECRET') || '';
const APP_URL = 'https://pinta-git-claude-add-column-layout-ceg00-mmz97441s-projects.vercel.app';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function checkSecret(req: Request): boolean {
  if (!API_SECRET) return true;
  return req.headers.get('x-api-secret') === API_SECRET;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!checkSecret(req)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: cors });

  try {
    if (!PAYPLUG_KEY) return new Response(JSON.stringify({ error: 'PAYPLUG_SECRET_KEY non configuree' }), { status: 500, headers: cors });

    const body = await req.json();
    const { colisId, amount, clientEmail, clientName, colisRef } = body;
    if (!colisId || !amount || amount <= 0) return new Response(JSON.stringify({ error: 'colisId et amount requis' }), { status: 400, headers: cors });

    const amountCents = Math.round(amount * 100);
    const notificationUrl = `${SUPABASE_URL}/functions/v1/payplug-webhook`;
    const firstName = (clientName || 'Client').split(' ')[0] || 'Client';
    const lastName = (clientName || 'Client').split(' ').slice(1).join(' ') || 'Client';
    const email = (clientEmail || 'client@expedile.fr').replace(/\+/g, '');

    const payRes = await fetch(`${PAYPLUG_API}/payments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PAYPLUG_KEY}`, 'Content-Type': 'application/json', 'PayPlug-Version': '2019-08-06' },
      body: JSON.stringify({
        amount: amountCents, currency: 'EUR',
        billing: { first_name: firstName, last_name: lastName, email, address1: '1 rue Expedile', postcode: '75001', city: 'Paris', country: 'FR', language: 'fr' },
        shipping: { first_name: firstName, last_name: lastName, email, address1: '1 rue Expedile', postcode: '97400', city: 'Saint-Denis', country: 'FR', language: 'fr', delivery_type: 'NEW' },
        hosted_payment: { return_url: `${APP_URL}/colis?payment=success&ref=${colisRef || ''}`, cancel_url: `${APP_URL}/colis?payment=cancelled&ref=${colisRef || ''}` },
        notification_url: notificationUrl,
        metadata: { colis_id: colisId, colis_ref: colisRef || '' },
      }),
    });
    const payText = await payRes.text();
    if (!payRes.ok) return new Response(JSON.stringify({ error: 'Erreur PayPlug', status: payRes.status, details: payText.slice(0, 500) }), { status: 500, headers: cors });

    const payData = JSON.parse(payText);
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    await supabase.from('colis').update({ payplug_payment_id: payData.id, payplug_payment_url: payData.hosted_payment?.payment_url }).eq('id', colisId);

    return new Response(JSON.stringify({ success: true, paymentId: payData.id, paymentUrl: payData.hosted_payment?.payment_url }), { headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
