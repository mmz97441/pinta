import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';

const contextSignature = (colis, client) => JSON.stringify([
  colis?.id, colis?.nbColis, colis?.trackings, colis?.trackingsDetail, colis?.dimsParColis,
  colis?.factures, colis?.devisSnapshot, colis?.quoteVersion,
  client?.id, client?.telegramChatId, client?.email, client?.userId,
]);

/** Preview and delivery are separate actions. A failed attempt retains its exact
 * payload and idempotency key, including when requesting consent changes status. */
export default function TaskMessage({ template, label = 'Informer le client', beforeSend, disabled = false }) {
  const { sel, selClient: client, can, getPreview, sendMsg } = useApp();
  const channels = [
    { value: 'telegram', label: 'Telegram', available: !!client?.telegramChatId, allowed: can('perm_comm_telegram') },
    { value: 'email', label: 'Email', available: !!client?.email, allowed: can('perm_comm_email') },
    { value: 'portal', label: 'Espace client', available: !!client?.userId, allowed: can('perm_comm_message_libre') },
  ].filter(item => item.available);
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState(() => channels.find(item => item.allowed)?.value || channels[0]?.value || 'portal');
  const [draft, setDraft] = useState('');
  const [baseline, setBaseline] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const lock = useRef(false);
  const request = useRef(null);
  const live = useRef(null);
  const effectiveTemplate = request.current?.template || template;
  const currentContext = contextSignature(sel, client);
  const proposed = (key, canal) => getPreview(key, client?.id, sel?.id, canal === 'portal' ? 'email' : canal);
  const latest = proposed(effectiveTemplate, channel);
  const allowed = channels.some(item => item.value === channel && item.allowed);
  const stale = open && baseline && (baseline.text !== latest || baseline.context !== currentContext);
  live.current = { context: currentContext, allowed, disabled, dossierId: sel?.id, getPreview };
  useEffect(() => {
    request.current = null; setOpen(false); setFeedback(null); setBaseline(null);
  }, [sel?.id]);

  const preview = (nextChannel = channel) => {
    const pending = request.current;
    if (pending?.queueStarted) {
      setChannel(pending.channel); setDraft(pending.text); setBaseline(pending.baseline);
    } else {
      const text = proposed(pending?.template || template, nextChannel);
      const nextBaseline = { text, context: currentContext };
      if (pending) Object.assign(pending, { key: crypto.randomUUID(), channel: nextChannel, text, baseline: nextBaseline });
      setChannel(nextChannel); setDraft(text); setBaseline(nextBaseline); setFeedback(null);
    }
    setOpen(true);
  };
  async function send() {
    if (lock.current || disabled || stale || !allowed || !draft.trim() || !sel || !client) return;
    lock.current = true; setBusy(true); setFeedback(null);
    if (!request.current) request.current = {
      key: crypto.randomUUID(), colisId: sel.id, clientId: client.id, template,
      channel, text: draft, baseline, beforeSend, prepared: false, queueStarted: false,
    };
    const attempt = request.current;
    if (!attempt.queueStarted) Object.assign(attempt, { channel, text: draft, baseline });
    try {
      if (!attempt.prepared && attempt.beforeSend) await attempt.beforeSend();
      attempt.prepared = true;
      const current = live.current;
      const currentText = current.getPreview(attempt.template, attempt.clientId, attempt.colisId, attempt.channel === 'portal' ? 'email' : attempt.channel);
      if (current.dossierId !== attempt.colisId || current.context !== attempt.baseline.context || currentText !== attempt.baseline.text || !current.allowed || current.disabled)
        throw new Error('Le dossier ou vos droits ont changé. Vérifiez les échanges avant de reprendre cette demande.');
      attempt.queueStarted = true;
      await sendMsg(attempt.colisId, attempt.clientId, attempt.channel, attempt.template, attempt.text, { idempotencyKey: attempt.key });
      request.current = null;
      setFeedback({ ok: true, text: attempt.channel === 'email' ? 'Brouillon ouvert dans votre messagerie. Confirmez l’envoi dans celle-ci.' : attempt.channel === 'portal' ? 'Message disponible dans l’espace client.' : 'Message livré à Telegram.' });
      setOpen(false);
    } catch (error) {
      setFeedback({ ok: false, text: error.message || 'Envoi non confirmé. Vérifiez les échanges avant de réessayer.' });
    } finally { lock.current = false; setBusy(false); }
  }
  if (!sel) return null;
  return <section aria-label="Notification au client" className="space-y-3">
    {!open && <button disabled={disabled || busy} onClick={() => preview()} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-40">{label}</button>}
    {open && <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <label className="block text-sm font-semibold text-slate-700">Canal<select aria-label="Canal de notification" value={channel} disabled={busy || !!request.current?.queueStarted} onChange={event => preview(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3">{channels.map(item => <option key={item.value} value={item.value} disabled={!item.allowed}>{item.label}</option>)}{!channels.length && <option value="portal">Aucun canal disponible</option>}</select></label>
      <label className="block text-sm font-semibold text-slate-700">Message pour {client?.prenom || client?.nom}<textarea aria-label="Message à envoyer au client" rows={6} value={draft} disabled={busy || !!request.current?.queueStarted} onChange={event => setDraft(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-normal" /></label>
      {stale && <p role="alert" className="text-sm text-amber-800">Le dossier a changé. {!request.current?.queueStarted ? <button className="min-h-11 font-semibold underline" onClick={() => preview()}>Actualiser le message proposé</button> : 'Une tentative existe déjà : vérifiez les échanges du dossier avant un nouvel envoi.'}</p>}
      {!allowed && <p className="text-sm text-amber-800">Ce canal nécessite un accès client et la permission correspondante.</p>}
      <div className="flex flex-wrap gap-2"><button disabled={disabled || busy || stale || !allowed || !draft.trim()} onClick={send} className="min-h-11 rounded-xl bg-slate-800 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Envoi en cours…' : channel === 'email' ? 'Ouvrir le brouillon email' : request.current ? 'Réessayer cet envoi' : 'Envoyer ce message'}</button><button disabled={busy} className="min-h-11 px-3 text-sm font-semibold text-slate-600" onClick={() => setOpen(false)}>Fermer</button></div>
    </div>}
    {feedback && <p role={feedback.ok ? 'status' : 'alert'} className={`rounded-xl p-3 text-sm ${feedback.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{feedback.text}</p>}
  </section>;
}
