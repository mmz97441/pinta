import { HttpError, throwDb } from './http.ts';
import { telegram } from './telegram.ts';

export async function saveIncoming(db: any, client: any, colis: any, msg: any, updateId: number) {
  const eventKey = `telegram:${updateId}`;
  let text = String(msg.text || msg.caption || '').slice(0, 4096);
  let attachment: Record<string,string> = {};
  if (msg.intake_error) {
    // Keep a previously rejected upload actionable when staff later assigns its inbox item.
    text = `${text || 'Document client'} — ${String(msg.intake_error).slice(0, 500)}. Demander un nouveau fichier compatible.`;
    msg = { ...msg, photo: undefined, document: undefined };
  }
  if (msg.photo?.length || msg.document) {
    const file = msg.document || msg.photo[msg.photo.length - 1];
    if ((file.file_size || 0) > 10 * 1024 * 1024) throw new HttpError(400, 'Le document dépasse 10 Mo');
    const meta = await telegram('getFile', { file_id: file.file_id });
    const extension = (meta.file_path.split('.').pop() || '').toLowerCase();
    const contentTypes: Record<string,string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
    if (!contentTypes[extension]) throw new HttpError(400, 'Envoyez une facture PDF, JPEG, PNG ou WebP');
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${meta.file_path}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new HttpError(502, 'Téléchargement du document impossible');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 10 * 1024 * 1024) throw new HttpError(400, 'Le document dépasse 10 Mo');
    const path = `${colis.id}/telegram_${updateId}.${extension}`;
    const uploaded = await db.storage.from('factures').upload(path, bytes, { contentType: contentTypes[extension], upsert: true }); throwDb(uploaded);
    attachment = { attachment_path: path, attachment_name: file.file_name || `document.${extension}`, attachment_type: contentTypes[extension] };
    text = `Document reçu pour ${colis.ref}${text ? ` : ${text}` : ''}`;
  }
  if (!text) return;
  // Inbox assignment may happen days later. Invoice intent must use the time
  // Telegram received the document, not the later time staff selected a dossier.
  const receivedAt = Number.isSafeInteger(msg.date) && msg.date > 0 && msg.date * 1000 <= Date.now() + 300000
    ? new Date(msg.date * 1000).toISOString() : undefined;
  throwDb(await db.from('messages').upsert({ colis_id: colis.id, type: 'client', auteur_nom: [client.prenom,client.nom].filter(Boolean).join(' '), texte: text, telegram_msg_id: String(msg.message_id), telegram_event_key: eventKey, canal: 'telegram', ...(receivedAt ? { created_at: receivedAt } : {}), ...attachment }, { onConflict: 'telegram_event_key', ignoreDuplicates: true }));
  if (attachment.attachment_path) {
    // Read by the durable event key even on a webhook retry: ignoreDuplicates
    // does not return an existing row, and invoice registration may have failed
    // after the conversation message was saved on the previous attempt.
    const saved = await db.from('messages').select('id').eq('telegram_event_key', eventKey).single();
    throwDb(saved);
    const replyMessageId = msg.reply_to_message?.message_id;
    throwDb(await db.rpc('register_requested_invoice', { p_message_id: saved.data.id,
      ...(Number.isSafeInteger(replyMessageId) && replyMessageId > 0 ? { p_reply_message_id: String(replyMessageId) } : {}),
    }));
  }
}
