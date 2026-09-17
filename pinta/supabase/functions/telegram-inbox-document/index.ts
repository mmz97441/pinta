import { admin, cors, fail, HttpError, postOnly, requireStaff, throwDb, uuid } from '../_shared/http.ts';
import { telegram } from '../_shared/telegram.ts';

// Read-only preview before assignment. Provider credentials and URLs never reach
// the browser; no document, message, notification or invoice is created here.
Deno.serve(async (req: Request) => {
  const early = postOnly(req); if (early) return early;
  try {
    const db = admin(); await requireStaff(req, 'perm_comm_telegram', db);
    const { inboxId } = await req.json();
    if (!uuid(inboxId)) throw new HttpError(400, 'Message requis');
    const result = await db.from('client_inbox').select('id,status,payload').eq('id', inboxId).single();
    throwDb(result);
    if (result.data.status !== 'unassigned') throw new HttpError(409, 'Ce message a déjà été rattaché. Actualisez les conversations.');
    const payload = result.data.payload || {};
    const file = payload.document || payload.photo?.at(-1);
    if (!file?.file_id) throw new HttpError(404, 'Ce message ne contient pas de document consultable.');
    const limit = 10 * 1024 * 1024;
    if (file.file_size > limit) throw new HttpError(400, 'Le document dépasse 10 Mo. Demandez un fichier plus léger.');
    const meta = await telegram('getFile', { file_id: file.file_id });
    const path = String(meta.file_path || '');
    if (!/^[\w/.-]+$/.test(path) || path.includes('..')) throw new HttpError(502, 'Document indisponible.');
    const mime: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    const type = mime[path.split('.').pop()?.toLowerCase() || ''];
    if (!type) throw new HttpError(400, 'L’aperçu accepte PDF, JPEG, PNG ou WebP.');
    const response = await fetch(`https://api.telegram.org/file/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/${path}`, { signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok || !response.body) throw new HttpError(502, 'Téléchargement impossible. Réessayez.');
    const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw new HttpError(400, 'Le document dépasse 10 Mo.'); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return new Response(bytes, { headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return fail(error); }
});
