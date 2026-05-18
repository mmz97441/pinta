const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
const API_SECRET = Deno.env.get('EDGE_API_SECRET') || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function checkSecret(req: Request): boolean {
  if (!API_SECRET) return true;
  const provided = req.headers.get('x-api-secret');
  return provided === API_SECRET;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  if (!checkSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 403, headers: cors });
  }

  try {
    if (!BOT_TOKEN) {
      return new Response(JSON.stringify({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }), { status: 500, headers: cors });
    }

    const { chatId, text, replyMarkup, replyToId } = await req.json();
    if (!chatId || !text) {
      return new Response(JSON.stringify({ ok: false, error: 'chatId and text required' }), { status: 400, headers: cors });
    }

    const body: any = { chat_id: chatId, text, parse_mode: 'Markdown' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    if (replyToId) body.reply_to_message_id = replyToId;

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    return new Response(JSON.stringify({
      ok: data.ok,
      messageId: data.result?.message_id || null,
      error: data.ok ? null : (data.description || 'Telegram error'),
    }), { headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: cors });
  }
});
