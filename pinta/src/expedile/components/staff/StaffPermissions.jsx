import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { PERMISSION_CATEGORIES } from '../../constants/permissions';
import { createPermissionDraft, permissionChanges, permissionChangeCount, mergePermissionDrafts, changePermissionValues } from '../../domain/permissionDrafts';
import * as sb from '../../lib/supabaseData';
import { supabase } from '../../lib/supabase';
import { functionErrorMessage } from '../../services/functionErrors';
import { Shield, Plus, Trash2, Save, ChevronDown, ChevronRight, Eye, EyeOff, RefreshCw } from 'lucide-react';

const ROLES = [
  { value: 'directeur', label: 'Directeur' }, { value: 'vice_directeur', label: 'Vice-directeur' },
  { value: 'logisticien', label: 'Logisticien' }, { value: 'preparateur', label: 'Préparateur' },
];
const EMPTY_USER = { nom: '', prenom: '', email: '', password: '', role: 'preparateur' };
const BUTTON = 'min-h-11 rounded-xl px-3 py-2 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98]';
const FIELD = 'min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800';
const fullName = (user) => [user.prenom, user.nom].filter(Boolean).join(' ') || user.email || 'Utilisateur';
const fixedRole = (user) => ['directeur', 'vice_directeur'].includes(user?.role);

// Retain drafts across settings tabs, only in memory and for the current administrator.
let draftSession = { owner: null, drafts: {} };
function retainedDrafts(owner) {
  if (draftSession.owner !== owner) draftSession = { owner, drafts: {} };
  return draftSession.drafts;
}
function Notice({ notice }) {
  if (!notice) return null;
  const color = notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800'
    : notice.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800'
    : notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-gray-200 bg-gray-50 text-gray-700';
  return <p role={['error', 'warning'].includes(notice.type) ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2 text-sm ${color}`}>{notice.text}</p>;
}

export default function StaffPermissions() {
  const { auth, can, refreshStaffAccess } = useApp();
  const owner = auth?.u?.id || null;
  const [staffUsers, setStaffUsers] = useState([]);
  const [drafts, setDrafts] = useState(() => retainedDrafts(owner));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [expandedCats, setExpandedCats] = useState(new Set(PERMISSION_CATEGORIES.map((category) => category.key)));
  const [notices, setNotices] = useState({});
  const [generalNotice, setGeneralNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const operation = useRef(null);
  const createdEmails = useRef(new Set());
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState(EMPTY_USER);
  const [newError, setNewError] = useState('');
  const [showNewPwd, setShowNewPwd] = useState(false);
  const totalChanges = Object.values(drafts).reduce((count, draft) => count + permissionChangeCount(draft), 0);
  const dirtyUsers = Object.values(drafts).filter((draft) => permissionChangeCount(draft)).length;
  const mayManage = can('perm_admin_utilisateurs');

  useEffect(() => { if (draftSession.owner === owner) draftSession.drafts = drafts; }, [drafts, owner]);
  useEffect(() => {
    if (!totalChanges && !busy) return;
    const preventLoss = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [totalChanges, busy]);
  const adoptUsers = useCallback((users) => {
    setStaffUsers(users);
    setDrafts((previous) => mergePermissionDrafts(previous, users));
    setSelectedId((previous) => users.some((user) => user.id === previous) ? previous : users.find((user) => !fixedRole(user))?.id || users[0]?.id || null);
    setLoadError('');
  }, []);
  useEffect(() => {
    let mounted = true;
    sb.fetchStaffUsers().then((users) => { if (mounted) adoptUsers(users); })
      .catch((error) => { if (mounted) setLoadError(error.message || 'Impossible de charger les accès de l’équipe.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [adoptUsers]);

  const begin = (key) => { if (operation.current) return false; operation.current = key; setBusy(key); return true; };
  const finish = () => { operation.current = null; setBusy(null); };
  const noticeFor = (id, notice) => setNotices((previous) => ({ ...previous, [id]: notice }));
  const refreshAccess = async () => { const users = await refreshStaffAccess(); adoptUsers(users); return users; };
  const retryRefresh = async () => {
    if (!begin('refresh')) return;
    try {
      await refreshAccess();
      setNotices((previous) => Object.fromEntries(Object.entries(previous).map(([id, notice]) => [id, notice?.refresh ? { type: 'success', text: 'Permissions enregistrées et accès actualisés.' } : notice])));
      setGeneralNotice({ type: 'success', text: 'Liste et accès actualisés. Les brouillons non enregistrés sont conservés.' });
    } catch (error) { setLoadError(error.message || 'Actualisation impossible. Réessayez.'); }
    finally { finish(); }
  };
  const changeValues = (user, keys, value) => {
    if (!mayManage || fixedRole(user) || operation.current) return;
    setDrafts((previous) => ({ ...previous, [user.id]: changePermissionValues(previous[user.id] || createPermissionDraft(user.permissions), keys, value) }));
  };
  const savePermissions = async () => {
    const user = staffUsers.find((item) => item.id === selectedId);
    const draft = drafts[selectedId];
    const changes = permissionChanges(draft);
    if (!user || fixedRole(user) || !mayManage || !Object.keys(changes).length || !begin(`save:${user.id}`)) return;
    try {
      const saved = await sb.updateStaffPermissions(user.id, changes, { expectedPermissions: draft.baseline });
      setDrafts((previous) => ({ ...previous, [user.id]: createPermissionDraft(saved) }));
      setStaffUsers((previous) => previous.map((item) => item.id === user.id ? { ...item, permissions: saved } : item));
      noticeFor(user.id, { type: 'success', text: 'Permissions enregistrées.' });
      try { await refreshAccess(); noticeFor(user.id, { type: 'success', text: 'Permissions enregistrées et accès actualisés.' }); }
      catch (error) { noticeFor(user.id, { type: 'warning', text: `Permissions enregistrées. Actualisation à réessayer : ${error.message || 'connexion interrompue'}`, refresh: true }); }
    } catch (error) { noticeFor(user.id, { type: 'error', text: `Enregistrement non confirmé. Votre brouillon est conservé. ${error.message || 'Réessayez ou rechargez les permissions enregistrées.'}`, reload: true }); }
    finally { finish(); }
  };
  const cancelDraft = (user) => {
    if (operation.current) return;
    setDrafts((previous) => ({ ...previous, [user.id]: createPermissionDraft(previous[user.id] ? previous[user.id].baseline : user.permissions) }));
    noticeFor(user.id, { type: 'info', text: 'Brouillon annulé. Les valeurs chargées avant vos modifications sont affichées.' });
  };
  const replaceDraft = async (user) => {
    if (!begin(`reload:${user.id}`)) return;
    try {
      const users = await sb.fetchStaffUsers(); const current = users.find((item) => item.id === user.id);
      if (!current) throw new Error('Cet utilisateur ne figure plus dans la liste de l’équipe.');
      adoptUsers(users);
      setDrafts((previous) => ({ ...previous, [user.id]: createPermissionDraft(current.permissions) }));
      noticeFor(user.id, { type: 'info', text: 'Permissions enregistrées rechargées. Le brouillon précédent a été abandonné.' });
    } catch (error) { noticeFor(user.id, { type: 'error', text: `Rechargement impossible. Votre brouillon est conservé. ${error.message}`, reload: true }); }
    finally { finish(); }
  };
  const createUser = async (event) => {
    event.preventDefault();
    const form = { ...newForm, nom: newForm.nom.trim(), prenom: newForm.prenom.trim(), email: newForm.email.trim() };
    if (!form.nom || !/^\S+@\S+\.\S+$/.test(form.email) || !form.password.trim() || form.password.length < 12) { setNewError('Renseignez un nom, un email valide et un mot de passe de 12 caractères minimum.'); return; }
    const emailKey = form.email.toLowerCase();
    if (staffUsers.some((user) => user.email?.trim().toLowerCase() === emailKey) || createdEmails.current.has(emailKey)) { setNewError('Un compte équipe utilise déjà cet email. Actualisez la liste pour le retrouver.'); return; }
    if (!mayManage || !begin('create')) return;
    setNewError('');
    try {
      const { data: result, error } = await supabase.functions.invoke('create-staff-user', { body: form });
      if (error || result?.error || !result?.success) throw new Error(await functionErrorMessage({ data: result, error }, 'Le compte équipe n’a pas pu être créé.'));
      createdEmails.current.add(emailKey);
      // The account exists already; a later refresh failure must never repeat its creation.
      setShowNew(false); setNewForm(EMPTY_USER); setShowNewPwd(false);
      setGeneralNotice({ type: 'success', text: `Compte de ${fullName(form)} créé. Le mot de passe devra être changé à la première connexion.` });
      try {
        const users = await refreshAccess(); const created = users.find((user) => user.authId === result.userId || user.email?.toLowerCase() === emailKey);
        if (created) setSelectedId(created.id);
      } catch (error) { setGeneralNotice({ type: 'warning', text: `Compte de ${fullName(form)} créé. La liste n’a pas pu être actualisée : ${error.message}. Utilisez « Actualiser la liste », sans recréer le compte.` }); }
    } catch (error) { setNewError(error.message || 'Création impossible.'); }
    finally { finish(); }
  };
  const deleteUser = async (user) => {
    if (!mayManage || operation.current || !window.confirm(`Supprimer l’utilisateur ${fullName(user)} ?${permissionChangeCount(drafts[user.id]) ? ' Son brouillon de permissions sera également abandonné.' : ''}`)) return;
    if (!begin(`delete:${user.id}`)) return;
    try {
      await sb.deleteStaffUser(user.id);
      setStaffUsers((previous) => previous.filter((item) => item.id !== user.id));
      setDrafts((previous) => { const next = { ...previous }; delete next[user.id]; return next; });
      setSelectedId(null); setGeneralNotice({ type: 'success', text: `Utilisateur ${fullName(user)} supprimé.` });
      try { await refreshAccess(); } catch (error) { setGeneralNotice({ type: 'warning', text: `Utilisateur supprimé. Actualisation à réessayer : ${error.message}` }); }
    } catch (error) { noticeFor(user.id, { type: 'error', text: `Suppression non confirmée : ${error.message}` }); }
    finally { finish(); }
  };

  const sel = staffUsers.find((user) => user.id === selectedId);
  const draft = sel ? drafts[sel.id] || createPermissionDraft(sel.permissions) : null;
  const changesCount = permissionChangeCount(draft);
  const selectedNotice = notices[selectedId];
  return <section aria-label="Équipe et permissions" className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-bold brand-t">Utilisateurs et permissions</h2><p className="mt-1 text-sm text-gray-600">Modifiez les cases, puis enregistrez les permissions de l’utilisateur sélectionné.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={Boolean(busy) || loading} onClick={retryRefresh} className={`${BUTTON} border border-gray-300 text-gray-700`}><RefreshCw size={16} />Actualiser la liste</button>{mayManage && <button type="button" disabled={Boolean(busy)} onClick={() => { setShowNew(true); setNewError(''); }} className={`${BUTTON} brand-bg text-white`}><Plus size={16} />Nouvel utilisateur</button>}</div>
    </header>
    {totalChanges > 0 && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{totalChanges} modification{totalChanges > 1 ? 's' : ''} non enregistrée{totalChanges > 1 ? 's' : ''} pour {dirtyUsers} utilisateur{dirtyUsers > 1 ? 's' : ''}. Les brouillons restent disponibles lorsque vous changez d’utilisateur ou d’onglet des paramètres.</p>}
    <Notice notice={generalNotice} />
    {loadError && <div className="space-y-2"><Notice notice={{ type: 'error', text: `Accès équipe indisponibles : ${loadError}` }} /><button type="button" disabled={Boolean(busy)} onClick={retryRefresh} className={`${BUTTON} border border-gray-300 text-gray-700`}>Réessayer le chargement</button></div>}
    {showNew && <form onSubmit={createUser} className="space-y-4 rounded-xl border border-gray-200 p-4" aria-label="Créer un utilisateur"><h3 className="font-semibold text-gray-800">Nouveau compte équipe</h3><fieldset disabled={Boolean(busy)} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">{[['nom', 'Nom', 'text', true], ['prenom', 'Prénom', 'text', false], ['email', 'Email', 'email', true]].map(([key, label, type, required]) => <label key={key} className="block space-y-1 text-xs font-semibold text-gray-600">{label}{required ? ' *' : ''}<input type={type} required={required} autoComplete={key === 'email' ? 'off' : undefined} value={newForm[key]} onChange={(event) => setNewForm((previous) => ({ ...previous, [key]: event.target.value }))} className={FIELD} /></label>)}
        <div><label htmlFor="new-staff-password" className="block text-xs font-semibold text-gray-600 mb-1">Mot de passe initial *</label><div className="relative"><input id="new-staff-password" required minLength={12} autoComplete="new-password" type={showNewPwd ? 'text' : 'password'} value={newForm.password} onChange={(event) => setNewForm((previous) => ({ ...previous, password: event.target.value }))} className={`${FIELD} pr-12`} /><button type="button" onClick={() => setShowNewPwd((previous) => !previous)} aria-label={showNewPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} className="absolute right-0 top-0 flex min-h-11 min-w-11 items-center justify-center text-gray-600">{showNewPwd ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><p className="mt-1 text-xs text-gray-600">12 caractères minimum. À changer à la première connexion.</p></div>
        <label className="block space-y-1 text-xs font-semibold text-gray-600">Rôle<select value={newForm.role} onChange={(event) => setNewForm((previous) => ({ ...previous, role: event.target.value }))} className={FIELD}>{ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
      </div><Notice notice={newError ? { type: 'error', text: newError } : null} /><div className="flex flex-wrap gap-2"><button type="submit" className={`${BUTTON} brand-bg text-white`}>{busy === 'create' ? 'Création…' : 'Créer le compte'}</button><button type="button" onClick={() => { setShowNew(false); setNewForm(EMPTY_USER); setShowNewPwd(false); setNewError(''); }} className={`${BUTTON} border border-gray-300 text-gray-700`}>Annuler la création</button></div>
    </fieldset></form>}
    {loading ? <div role="status" className="space-y-3 py-4"><p className="text-sm text-gray-600">Chargement des utilisateurs et de leurs permissions…</p><div className="h-12 rounded-xl bg-gray-100 animate-pulse" /><div className="h-36 rounded-xl bg-gray-100 animate-pulse" /></div> : <div className="flex flex-col gap-5 lg:flex-row">
      <div role="group" aria-label="Utilisateurs de l’équipe" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:w-56 lg:shrink-0 lg:flex-col lg:self-start">{staffUsers.map((user) => { const count = permissionChangeCount(drafts[user.id]); const role = ROLES.find((item) => item.value === user.role); return <button key={user.id} type="button" aria-pressed={sel?.id === user.id} onClick={() => setSelectedId(user.id)} className={`min-h-16 flex w-full items-center gap-3 rounded-xl border p-3 text-left ${sel?.id === user.id ? 'border-slate-400 bg-slate-100' : 'border-gray-200 hover:bg-gray-50'}`}><span className="brand-bg flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">{fullName(user).charAt(0)}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-gray-800">{fullName(user)}</span><span className="block text-xs text-gray-600">{role?.label || user.role}{!user.actif ? ' · Inactif' : ''}</span>{count > 0 && <span className="mt-1 block text-xs font-semibold text-amber-800">{count} modification{count > 1 ? 's' : ''}</span>}{busy === `save:${user.id}` && <span className="block text-xs text-gray-600">Enregistrement…</span>}</span></button>; })}{!staffUsers.length && !loadError && <p className="text-sm text-gray-600">Aucun utilisateur équipe. Créez un compte pour lui attribuer des permissions.</p>}</div>
      {sel && <div className="min-w-0 flex-1 space-y-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-bold brand-t">{fullName(sel)}</h3><p className="break-all text-sm text-gray-600">{sel.email}</p></div>{mayManage && <button type="button" disabled={Boolean(busy)} aria-label={`Supprimer l’utilisateur ${fullName(sel)}`} onClick={() => deleteUser(sel)} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 size={18} /></button>}</div>
        {fixedRole(sel) ? <div className="space-y-3 rounded-xl border border-gray-200 p-4"><h4 className="flex items-center gap-2 font-semibold text-gray-800"><Shield size={18} />Accès total lié au rôle</h4><p className="text-sm text-gray-600">Les rôles Directeur et Vice-directeur disposent d’un accès total. Les cases de permissions individuelles ne limitent pas cet accès et ne sont donc pas modifiables ici.</p>{changesCount > 0 && <><p className="text-sm text-amber-800">Ce rôle ne permet pas d’appliquer le brouillon précédent.</p><button type="button" disabled={Boolean(busy)} onClick={() => cancelDraft(sel)} className={`${BUTTON} border border-gray-300`}>Annuler ce brouillon</button></>}<Notice notice={selectedNotice} /></div> : <>
          {!mayManage && <p className="text-sm text-gray-600">Votre accès permet uniquement la consultation de ces permissions.</p>}
          {draft.baseline === null && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Aucune ligne de permissions enregistrée pour cet utilisateur. Les permissions spécifiques sont désactivées ; enregistrez vos changements pour les attribuer.</p>}
          {PERMISSION_CATEGORIES.map((category) => { const open = expandedCats.has(category.key); const checked = category.permissions.filter((permission) => draft.values[permission.key]).length; return <section key={category.key} aria-label={category.label} className="rounded-xl border border-gray-200"><div className="flex flex-wrap items-center justify-between gap-1 border-b border-gray-100 px-2">
            <button type="button" aria-expanded={open} aria-controls={`permissions-${category.key}`} onClick={() => setExpandedCats((previous) => { const next = new Set(previous); if (next.has(category.key)) next.delete(category.key); else next.add(category.key); return next; })} className="flex min-h-11 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold text-gray-800">{open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}{category.label}<span className="text-xs font-normal text-gray-600">{checked}/{category.permissions.length}</span></button>
            {mayManage && <div className="flex gap-1"><button type="button" disabled={Boolean(busy) || checked === category.permissions.length} onClick={() => changeValues(sel, category.permissions.map((permission) => permission.key), true)} className={`${BUTTON} text-gray-700 hover:bg-gray-100`}>Tout</button><button type="button" disabled={Boolean(busy) || checked === 0} onClick={() => changeValues(sel, category.permissions.map((permission) => permission.key), false)} className={`${BUTTON} text-gray-700 hover:bg-gray-100`}>Aucun</button></div>}
          </div><fieldset hidden={!open} id={`permissions-${category.key}`} disabled={Boolean(busy) || !mayManage} className="px-3 py-2">{category.permissions.map((permission) => <label key={permission.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm text-gray-700 hover:bg-gray-50"><input type="checkbox" checked={draft.values[permission.key] === true} onChange={(event) => changeValues(sel, [permission.key], event.target.checked)} className="h-4 w-4 shrink-0 rounded accent-[#1B3A4B]" /><span>{permission.label}</span></label>)}</fieldset></section>; })}
        </>}
      </div>}
    </div>}
    {sel && !fixedRole(sel) && <div role="region" aria-label="Enregistrement des permissions" className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 space-y-3 rounded-xl border border-gray-300 bg-white p-3 shadow-lg lg:bottom-0"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold text-gray-800">{fullName(sel)}</p><p className="text-xs text-gray-600">{changesCount ? `${changesCount} modification${changesCount > 1 ? 's' : ''} non enregistrée${changesCount > 1 ? 's' : ''}` : 'Aucune modification en attente'}</p></div><div className="flex w-full flex-wrap gap-2 sm:w-auto"><button type="button" disabled={Boolean(busy) || !changesCount} onClick={() => cancelDraft(sel)} className={`${BUTTON} flex-1 border border-gray-300 text-gray-700 sm:flex-none`}>Annuler</button><button type="button" disabled={Boolean(busy) || !changesCount || !mayManage} onClick={savePermissions} className={`${BUTTON} flex-1 brand-bg text-white sm:flex-none`}><Save size={17} />{busy === `save:${sel.id}` ? 'Enregistrement…' : 'Enregistrer les permissions'}</button></div></div>
      <Notice notice={selectedNotice} />{selectedNotice?.reload && <button type="button" disabled={Boolean(busy)} onClick={() => replaceDraft(sel)} className={`${BUTTON} border border-gray-300 text-gray-700`}>Recharger et remplacer ce brouillon</button>}{selectedNotice?.refresh && <button type="button" disabled={Boolean(busy)} onClick={retryRefresh} className={`${BUTTON} border border-gray-300 text-gray-700`}>Réessayer l’actualisation des accès</button>}
    </div>}
  </section>;
}
