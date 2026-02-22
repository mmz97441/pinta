// ══════════ Pinta — WhatsApp Webhook Server ══════════
// Reçoit les messages entrants + statuts (distribué/lu) de Meta
// et les pousse en temps réel au frontend via SSE.
//
// Variables d'environnement :
//   WA_VERIFY_TOKEN  — token choisi pour la vérification Meta (défaut: pinta_verify_2024)
//   WA_APP_SECRET    — secret de l'app Meta pour valider la signature (optionnel)
//   PORT             — port d'écoute (défaut: 3001)
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3001;
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || 'pinta_verify_2024';
const APP_SECRET = process.env.WA_APP_SECRET || '';

// ── SSE clients ──────────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    client.res.write(payload);
  }
}

// ── Body parsing (conserve rawBody pour signature) ───────────────────────────
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// ── CORS pour dev (Vite sur un autre port) ───────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. Vérification webhook Meta  (GET /webhook)
// ══════════════════════════════════════════════════════════════════════════════
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Webhook] Verification OK');
    return res.status(200).send(challenge);
  }
  console.warn('[Webhook] Verification failed — token mismatch');
  res.sendStatus(403);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Réception des événements Meta  (POST /webhook)
//    — messages entrants du client
//    — mises à jour de statut (sent → delivered → read)
// ══════════════════════════════════════════════════════════════════════════════
app.post('/webhook', (req, res) => {
  // Vérification de signature (optionnel mais recommandé)
  if (APP_SECRET) {
    const sig = req.headers['x-hub-signature-256'];
    const expected = 'sha256=' + crypto
      .createHmac('sha256', APP_SECRET)
      .update(req.rawBody)
      .digest('hex');
    if (sig !== expected) {
      console.warn('[Webhook] Signature invalide');
      return res.sendStatus(401);
    }
  }

  const body = req.body;
  if (body.object !== 'whatsapp_business_account') {
    return res.sendStatus(404);
  }

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;

      // ── Messages entrants ────────────────────────────────────────────────
      if (value.messages) {
        for (const msg of value.messages) {
          const contact = (value.contacts || []).find((c) => c.wa_id === msg.from);
          const event = {
            type: 'message',
            from: msg.from,
            name: contact?.profile?.name || msg.from,
            text: msg.type === 'text' ? (msg.text?.body || '') : `[${msg.type}]`,
            timestamp: msg.timestamp,
            waId: msg.id,
            msgType: msg.type,
          };
          console.log(`[Webhook] Message reçu de ${event.from}: ${event.text.slice(0, 80)}`);
          broadcast(event);
        }
      }

      // ── Statuts (sent → delivered → read) ────────────────────────────────
      if (value.statuses) {
        for (const st of value.statuses) {
          const event = {
            type: 'status',
            waId: st.id,
            status: st.status, // sent | delivered | read | failed
            recipientId: st.recipient_id,
            timestamp: st.timestamp,
          };
          console.log(`[Webhook] Status: ${st.status} pour ${st.id}`);
          broadcast(event);
        }
      }
    }
  }

  // Meta exige un 200 rapide
  res.sendStatus(200);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. SSE endpoint  (GET /api/events)
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
  console.log(`\n  Pinta Webhook Server`);
  console.log(`  ────────────────────`);
  console.log(`  Port           : ${PORT}`);
  console.log(`  Verify token   : ${VERIFY_TOKEN}`);
  console.log(`  App secret     : ${APP_SECRET ? 'configuré' : 'non configuré (signature non vérifiée)'}`);
  console.log(`  SSE endpoint   : http://localhost:${PORT}/api/events`);
  console.log(`  Webhook URL    : https://<votre-domaine>/webhook\n`);
});
