import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
export const admin = () => createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false, autoRefreshToken: false } });
export function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: cors }); }
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function fail(error: unknown) {
  console.error(error instanceof HttpError ? error.message : 'Backend operation failed', error instanceof HttpError ? '' : error);
  return json({ ok: false, error: error instanceof HttpError ? error.message : 'Une erreur serveur empêche cette opération. Réessayez.' }, error instanceof HttpError ? error.status : 500);
}
export function postOnly(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  return null;
}
export async function requireUser(req: Request, db = admin()) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Connexion requise');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Session expirée');
  const profile = await db.from('profiles').select('id,role,actif,nom,prenom').eq('id', data.user.id).single();
  if (profile.error || !profile.data?.actif) throw new HttpError(403, 'Compte inactif ou profil introuvable');
  return { ...profile.data, email: data.user.email, token };
}
export async function requireStaff(req: Request, permission?: string, db = admin()) {
  const user = await requireUser(req, db);
  if (user.role === 'client') throw new HttpError(403, 'Accès équipe requis');
  if (permission && !['directeur', 'vice_directeur'].includes(user.role)) {
    const staff = await db.from('staff_users').select('id,actif').eq('auth_id', user.id).single();
    if (staff.error || !staff.data?.actif) throw new HttpError(403, 'Accès équipe désactivé');
    const perms = await db.from('staff_permissions').select('*').eq('staff_id', staff.data.id).single();
    if (perms.error || perms.data?.[permission] !== true) throw new HttpError(403, 'Permission insuffisante');
  }
  return user;
}
export function uuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
export function throwDb(result: { error?: unknown }) { if (result.error) throw result.error; }
export function trustedStoragePath(value: string, bucket: string, colisId: string): string {
  let path = value;
  if (/^https?:/.test(value)) {
    const url = new URL(value);
    if (url.origin !== new URL(Deno.env.get('SUPABASE_URL') || '').origin) throw new HttpError(400, 'Document hors du stockage autorisé');
    const prefix = `/storage/v1/object/`;
    if (!url.pathname.startsWith(prefix)) throw new HttpError(400, 'Document non reconnu');
    const relative = decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^(public|sign|authenticated)\//, '');
    if (!relative.startsWith(`${bucket}/`)) throw new HttpError(400, 'Document non reconnu');
    path = relative.slice(bucket.length + 1);
  }
  if (!path.startsWith(`${colisId}/`) || path.includes('..')) throw new HttpError(400, 'Document rattaché à un autre colis');
  return path;
}
