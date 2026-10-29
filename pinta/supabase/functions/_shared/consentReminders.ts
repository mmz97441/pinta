import { throwDb } from './http.ts';
import { DEFAULT_BODIES } from './messageDefaults.ts';
import { renderMessage } from './messageTemplate.ts';

// The automatic reminders of an awaited consent (20261029000001_consent_automation.sql): consent_reminders_due lists
// them (48 hours after the request reached the client, then 24 hours after the first reminder, two at most, Telegram
// only, the requests delivered since the settings' start); each one is rendered from the saved « relance_feu_vert »
// text (the one the team validated; an unknown variable stops it, never another text) and queued by queue_message as
// a relance with the buttons of its dossier. The worker's own outbox loop then sends it, with the existing rules (one
// reminder per client in 24 hours, none while the client's conversation waits, none for a request replaced or
// answered meanwhile). Its key (consent-reminder:<dossier>:<consent version>:<number>) makes a run that repeats, or
// two runs at once, queue it once. A reminder is queued between 8 h and 20 h at the client's destination only.

export type DueReminder = { colisId: string; clientId: string; ref: string | null; consentVersion: number; number: number; dueAt: string; destinationCode: string };
export type ReminderRun = { due: number; queued: number; waiting: number; failed: number };

const ZONES: Record<string, string> = { '974': 'Indian/Reunion', '976': 'Indian/Mayotte', '971': 'America/Guadeloupe', '972': 'America/Martinique' };
export const SENDING_HOURS = { from: 8, to: 20 } as const;

/** The hour (0-23) at the client's destination (La Réunion when unknown). */
export function destinationHour(destinationCode: string, now: number): number {
  const zone = ZONES[String(destinationCode || '')] || ZONES['974'];
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now));
  return Number(parts.find(part => part.type === 'hour')?.value) % 24;
}

/** Whether a reminder may leave now: between 8 h and 20 h at the client's destination. */
export function inSendingHours(destinationCode: string, now: number): boolean {
  const hour = destinationHour(destinationCode, now);
  return hour >= SENDING_HOURS.from && hour < SENDING_HOURS.to;
}

/** The buttons of a consent request (« Demander l’accord », _consent_buttons): the decision applies to this dossier. */
export function consentButtons(colisId: string) {
  return { inline_keyboard: [
    [{ text: 'Autoriser la préparation', callback_data: `fv_oui_${colisId}` }],
    [{ text: 'Attendre mes autres colis', callback_data: `fv_wait_${colisId}` }, { text: 'Refuser', callback_data: `fv_non_${colisId}` }],
  ] };
}

export const reminderKey = (item: DueReminder) => `consent-reminder:${item.colisId}:${item.consentVersion}:${item.number}`;

/** Queues the reminders due now. Never throws for one dossier: its failure is logged and the others go on. */
export async function queueConsentReminders(db: any, now = Date.now()): Promise<ReminderRun> {
  const listed = await db.rpc('consent_reminders_due', { p_now: new Date(now).toISOString() }); throwDb(listed);
  const due: DueReminder[] = Array.isArray(listed.data) ? listed.data : [];
  const run: ReminderRun = { due: due.length, queued: 0, waiting: 0, failed: 0 };
  let saved: { body?: string } | null | undefined;
  for (const item of due) {
    if (!inSendingHours(item.destinationCode, now)) { run.waiting++; continue; }
    try {
      if (saved === undefined) {
        const template = await db.from('message_templates').select('body').eq('key', 'relance_feu_vert').eq('canal', 'telegram').maybeSingle(); throwDb(template);
        saved = template.data || null;
      }
      const [colis, client, destination] = await Promise.all([
        db.from('colis').select('*').eq('id', item.colisId).single(),
        db.from('clients').select('*').eq('id', item.clientId).single(),
        db.from('destinations').select('*').eq('code', item.destinationCode || '974').maybeSingle(),
      ]); throwDb(colis); throwDb(client); throwDb(destination);
      const text = renderMessage(saved?.body || DEFAULT_BODIES.relance_feu_vert_telegram, client.data, colis.data, destination.data, {});
      const queued = await db.rpc('queue_message', { p_colis_id: item.colisId, p_text: text, p_template: 'relance_feu_vert', p_idempotency_key: reminderKey(item),
        p_reply_markup: consentButtons(item.colisId), p_canal: 'telegram', p_expected_consent_version: item.consentVersion });
      throwDb(queued);
      run.queued++;
    } catch (error) {
      run.failed++;
      console.error('Consent reminder not queued', item.ref || item.colisId, String((error as any)?.message || error).slice(0, 300));
    }
  }
  return run;
}
