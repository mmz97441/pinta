import { HttpError, throwDb } from './http.ts';
import { telegram } from './telegram.ts';

export async function saveIncoming(db: any, client: any, colis: any, msg: any, updateId: number) {
  const eventKey = `telegram:${updateId}`;
  let text = String(msg.text || msg.caption || '').slice(0, 4096);
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
    throwDb(await db.from('factures').upsert({ colis_id: colis.id, vendeur: msg.caption || 'Facture reçue via Telegram', montant: 0, valide: false, fichier_url: path, fichier_nom: file.file_name || `facture.${extension}`, telegram_msg_id: String(msg.message_id), telegram_event_key: eventKey }, { onConflict: 'telegram_event_key', ignoreDuplicates: true }));
    text = `Facture reçue pour ${colis.ref}${text ? ` : ${text}` : ''}`;
  }
  if (!text) return;
  throwDb(await db.from('messages').upsert({ colis_id: colis.id, type: 'client', auteur_nom: [client.prenom,client.nom].filter(Boolean).join(' '), texte: text, telegram_msg_id: String(msg.message_id), telegram_event_key: eventKey, canal: 'telegram' }, { onConflict: 'telegram_event_key', ignoreDuplicates: true }));
}
