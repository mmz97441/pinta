import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const API_SECRET = Deno.env.get('EDGE_API_SECRET') || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-secret, x-caller-auth-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function checkSecret(req: Request): boolean {
  if (!API_SECRET) return true;
  return req.headers.get('x-api-secret') === API_SECRET;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!checkSecret(req)) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 403, headers: cors });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    // TODO: switch to verify_jwt=true + auth.uid() — for now we trust the
    // x-caller-auth-id header sent by the frontend. The frontend reads it
    // from supabase.auth.getUser(), so a malicious caller bypassing the
    // frontend can still spoof. Mitigation: rotate EDGE_API_SECRET often.
    const callerAuthId = req.headers.get('x-caller-auth-id') || '';
    if (!callerAuthId) {
      return new Response(JSON.stringify({ ok: false, error: 'Caller identity required' }), { status: 401, headers: cors });
    }

    const { data: caller, error: callerErr } = await supabase
      .from('staff_users')
      .select('role')
      .eq('auth_id', callerAuthId)
      .in('role', ['directeur', 'vice_directeur'])
      .maybeSingle();

    if (callerErr || !caller) {
      return new Response(JSON.stringify({ ok: false, error: 'Seul un directeur peut créer un compte staff' }), { status: 403, headers: cors });
    }

    const { email, password, nom, prenom, role } = await req.json();
    if (!email || !password) return new Response(JSON.stringify({ ok: false, error: 'Email et password requis' }), { status: 400, headers: cors });

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nom: nom || '', prenom: prenom || '', role: role || 'preparateur' },
    });

    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 400, headers: cors });

    // Create staff_users entry + default permissions
    if (data?.user) {
      const { data: staffUser, error: staffErr } = await supabase.from('staff_users').insert({
        auth_id: data.user.id,
        nom: nom || '',
        prenom: prenom || null,
        email: email,
        role: role || 'preparateur',
        must_change_password: true,
      }).select().single();

      if (!staffErr && staffUser) {
        // Get default permissions for this role
        const { data: defaults } = await supabase.rpc('fn_default_permissions', { p_role: role || 'preparateur' });
        if (defaults) {
          await supabase.from('staff_permissions').insert({ staff_id: staffUser.id, ...defaults });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, userId: data?.user?.id }), { headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: cors });
  }
});
