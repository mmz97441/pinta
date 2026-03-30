// ══════════ Pinta — Telegram Webhook Server ══════════
// Reçoit les messages entrants de Telegram Bot API
// et les pousse en temps réel au frontend via SSE.
//
// Variables d'environnement :
//   TG_BOT_TOKEN     — token du bot Telegram (obtenu via @BotFather)
//   TG_WEBHOOK_SECRET — secret pour valider les webhooks Telegram (optionnel)
//   PORT             — port d'écoute (défaut: 3001)
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';

const app = express();
const PORT = process.env.PORT || 3001;
const BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const WEBHOOK_SECRET = process.env.TG_WEBHOOK_SECRET || '';

// ── SSE clients ──────────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    client.res.write(payload);
  }
}

// ── Body parsing ────────────────────────────────────────────────────────────
app.use(express.json());

// ── CORS pour dev (Vite sur un autre port) ───────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Bot-Api-Secret-Token');
  next();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. Réception des updates Telegram  (POST /webhook)
//    — messages entrants du client
// ══════════════════════════════════════════════════════════════════════════════
app.post('/webhook', (req, res) => {
  // Vérification du secret token (optionnel mais recommandé)
  if (WEBHOOK_SECRET) {
    const token = req.headers['x-telegram-bot-api-secret-token'];
    if (token !== WEBHOOK_SECRET) {
      console.warn('[Webhook] Secret token invalide');
      return res.sendStatus(401);
    }
  }

  const update = req.body;

  // ── Messages entrants ────────────────────────────────────────────────
  if (update.message) {
    const msg = update.message;
    const event = {
      type: 'message',
      from: String(msg.from?.id || msg.chat?.id),
      name: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || String(msg.from?.id),
      text: msg.text || `[${Object.keys(msg).find((k) => ['photo', 'document', 'video', 'voice', 'sticker'].includes(k)) || 'media'}]`,
      timestamp: String(msg.date),
      tgMsgId: String(msg.message_id),
      chatId: String(msg.chat?.id),
    };
    console.log(`[Webhook] Message reçu de ${event.from}: ${event.text.slice(0, 80)}`);
    broadcast(event);
  }

  // Telegram exige un 200 rapide
  res.sendStatus(200);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. SSE endpoint  (GET /api/events)
//    Le frontend se connecte ici pour recevoir les événements en temps réel.
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Heartbeat toutes les 30s pour maintenir la connexion
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);

  const client = { res };
  sseClients.add(client);
  console.log(`[SSE] Client connecté (${sseClients.size} total)`);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
    console.log(`[SSE] Client déconnecté (${sseClients.size} restant)`);
  });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Pinta Webhook Server (Telegram)`);
  console.log(`  ────────────────────────────────`);
  console.log(`  Port             : ${PORT}`);
  console.log(`  Bot token        : ${BOT_TOKEN ? '****' + BOT_TOKEN.slice(-6) : 'non configuré'}`);
  console.log(`  Webhook secret   : ${WEBHOOK_SECRET ? 'configuré' : 'non configuré'}`);
  console.log(`  SSE endpoint     : http://localhost:${PORT}/api/events`);
  console.log(`  Webhook URL      : https://<votre-domaine>/webhook\n`);
});
