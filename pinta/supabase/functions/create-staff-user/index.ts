import { admin, fail, HttpError, json, postOnly, requireStaff, throwDb } from '../_shared/http.ts';

Deno.serve(async (req: Request) => {
  const early = postOnly(req); if (early) return early;
  try {
    const db = admin(); const caller = await requireStaff(req, 'perm_admin_utilisateurs', db);
    if (!['directeur', 'vice_directeur'].includes(caller.role)) throw new HttpError(403, 'Accès direction requis');
    const { email, password, nom, prenom, role, mode } = await req.json();
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim()) || (mode !== 'invite' && (typeof password !== 'string' || password.length < 12)) || !nom?.trim() || !['directeur','vice_directeur','logisticien','preparateur'].includes(role)) throw new HttpError(400, 'Nom, email, rôle valide et mot de passe de 12 caractères minimum requis');
    const appUrl = Deno.env.get('APP_URL');
    if (mode === 'invite' && (!appUrl || !appUrl.startsWith('https://'))) throw new HttpError(503, 'Adresse de l’application indisponible pour l’invitation');
    const created = mode === 'invite'
      ? await db.auth.admin.inviteUserByEmail(email.trim(), { redirectTo: `${appUrl!.replace(/\/$/, '')}/password`, data: { nom: nom.trim(), prenom: prenom || '' } })
      : await db.auth.admin.createUser({ email: email.trim(), password, email_confirm: true, user_metadata: { nom: nom.trim(), prenom: prenom || '' } });
    if (created.error || !created.data.user) throw new HttpError(400, created.error?.message || 'Création impossible');
    try {
      const staff = await db.from('staff_users').insert({ auth_id: created.data.user.id, nom: nom.trim(), prenom: prenom || null, email: email.trim(), role, must_change_password: true }).select().single(); throwDb(staff);
      const defaults = await db.rpc('fn_default_permissions', { p_role: role }); throwDb(defaults);
      throwDb(await db.from('staff_permissions').insert({ staff_id: staff.data.id, ...defaults.data }));
    } catch (error) {
      // Avoid a half-created account that appears successful in the UI.
      await db.auth.admin.deleteUser(created.data.user.id); throw error;
    }
    return json({ success: true, userId: created.data.user.id, invitation_sent: mode === 'invite' });
  } catch (error) { return fail(error); }
});
