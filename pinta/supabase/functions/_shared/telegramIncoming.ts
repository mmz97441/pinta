import { HttpError, throwDb, uuid } from './http.ts';
import { processQuoteWithdrawal, type WithdrawalOutcome } from './quoteWithdrawal.ts';
import { telegram } from './telegram.ts';

/** What happened to a received document (register_telegram_document), for the acknowledgement. */
export type IncomingDocument = { status: 'registered'|'identical'|'frozen'|'ask_client'|'not_invoice'; factureId?: string; originalId?: string;
  withdrawalId?: string; withdrawal?: WithdrawalOutcome; ref?: string; prenom?: string; quoteSent?: boolean };

export async function saveIncoming(db: any, client: any, colis: any, msg: any, updateId: number): Promise<{ messageId: string | null; document?: IncomingDocument }> {
  const eventKey = `telegram:${updateId}`;
  let text = String(msg.text || msg.caption || '').slice(0, 4096);
  let attachment: Record<string,string> = {};
  let sha256: string | null = null;
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
    // Computed here on the bytes actually stored: an identical copy of a validated invoice changes nothing.
    sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const path = `${colis.id}/telegram_${updateId}.${extension}`;
    const uploaded = await db.storage.from('factures').upload(path, bytes, { contentType: contentTypes[extension], upsert: true }); throwDb(uploaded);
    attachment = { attachment_path: path, attachment_name: file.file_name || `document.${extension}`, attachment_type: contentTypes[extension] };
    text = `Document reçu pour ${colis.ref}${text ? ` : ${text}` : ''}`;
  }
  if (!text) return { messageId: null };
  // Inbox assignment may happen days later. Invoice intent must use the time
  // Telegram received the document, not the later time staff selected a dossier.
  const receivedAt = Number.isSafeInteger(msg.date) && msg.date > 0 && msg.date * 1000 <= Date.now() + 300000
    ? new Date(msg.date * 1000).toISOString() : undefined;
  throwDb(await db.from('messages').upsert({ colis_id: colis.id, type: 'client', auteur_nom: [client.prenom,client.nom].filter(Boolean).join(' '), texte: text, telegram_msg_id: String(msg.message_id), telegram_event_key: eventKey, canal: 'telegram', ...(receivedAt ? { created_at: receivedAt } : {}), ...attachment }, { onConflict: 'telegram_event_key', ignoreDuplicates: true }));
  if (!attachment.attachment_path) return { messageId: null };
  // Read by the durable event key even on a webhook retry: ignoreDuplicates
  // does not return an existing row, and invoice registration may have failed
  // after the conversation message was saved on the previous attempt.
  const saved = await db.from('messages').select('id').eq('telegram_event_key', eventKey).single();
  throwDb(saved);
  const replyMessageId = msg.reply_to_message?.message_id;
  // Registration is idempotent on the stored path. A requested invoice is
  // registered; on a sent quote, another document leads to a question to the client.
  const registered = await db.rpc('register_telegram_document', { p_message_id: saved.data.id,
    p_reply_message_id: Number.isSafeInteger(replyMessageId) && replyMessageId > 0 ? String(replyMessageId) : null,
    p_document_sha256: sha256,
  });
  throwDb(registered);
  const result = registered.data || {};
  const document: IncomingDocument = { status: result.status || 'not_invoice', ref: result.ref || colis.ref, prenom: result.prenom || client.prenom || client.nom,
    ...(result.factureId ? { factureId: result.factureId } : {}), ...(result.originalId ? { originalId: result.originalId } : {}),
    ...(typeof result.quoteSent === 'boolean' ? { quoteSent: result.quoteSent } : {}) };
  if (uuid(result.withdrawalId)) {
    // Late invoice on a sent quote: cancel the old link and withdraw the quote now.
    // The invoice is saved; a provider failure leaves the request for relances-auto.
    document.withdrawalId = result.withdrawalId;
    try { document.withdrawal = await processQuoteWithdrawal(db, result.withdrawalId, { deadline: Date.now() + 15000 }); }
    catch (error) { console.error('Late invoice processing deferred', error instanceof Error ? error.message : 'error'); }
  }
  return { messageId: saved.data.id, document };
}
