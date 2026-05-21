import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';
import { PERMISSION_CATEGORIES } from '../../constants/permissions';
import * as sb from '../../lib/supabaseData';
import { supabase } from '../../lib/supabase';
import { Shield, Plus, Trash2, Check, X, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';

const ROLES = [
  { value: 'directeur', label: 'Directeur', color: '#DC2626' },
  { value: 'vice_directeur', label: 'Vice-directeur', color: '#D97706' },
  { value: 'logisticien', label: 'Logisticien', color: '#2563EB' },
  { value: 'preparateur', label: 'Préparateur', color: '#059669' },
];

export default function StaffPermissions() {
  const { flash } = useApp();
  const [staffUsers, setStaffUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [expandedCats, setExpandedCats] = useState(new Set(PERMISSION_CATEGORIES.map((c) => c.key)));

  // New user form
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ nom: '', prenom: '', email: '', password: '', role: 'preparateur' });
  const [showNewPwd, setShowNewPwd] = useState(false);

  useEffect(() => {
    sb.fetchStaffUsers().then((users) => {
      setStaffUsers(users);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleCreateUser = async () => {
    if (!newForm.nom.trim() || !newForm.email.trim() || !newForm.password.trim()) {
      flash({ msg: 'Nom, email et mot de passe requis', type: 'warning' });
      return;
    }
    if (newForm.password.length < 6) {
      flash({ msg: 'Le mot de passe doit faire au moins 6 caractères', type: 'warning' });
      return;
    }
    try {
      // 1. Create Auth account via Edge Function
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://bqprktzehuhplpqjgjaz.supabase.co';
      // TODO: Remplacer par JWT Supabase Auth quand verify_jwt sera activé
      const edgeSecret = import.meta.env.VITE_EDGE_API_SECRET || '';
      // The Edge Function checks that the caller is a directeur/vice_directeur
      // by looking up x-caller-auth-id in staff_users. Without this header it 401s.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        flash({ msg: 'Session expirée — reconnectez-vous', type: 'warning' });
        return;
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/create-staff-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret': edgeSecret,
          'x-caller-auth-id': user.id,
        },
        body: JSON.stringify({
          email: newForm.email.trim(),
          password: newForm.password.trim(),
          nom: newForm.nom.trim(),
          prenom: newForm.prenom.trim(),
          role: newForm.role,
        }),
      });
      const authResult = await res.json();
      if (authResult.error) {
        flash({ msg: 'Erreur Auth : ' + authResult.error, type: 'warning' });
        return;
      }

      // 2. Refresh staff list
      const users = await sb.fetchStaffUsers();
      setStaffUsers(users);
      setShowNew(false);
      setNewForm({ nom: '', prenom: '', email: '', password: '', role: 'preparateur' });
      flash({ msg: `${newForm.prenom} ${newForm.nom} peut maintenant se connecter`, type: 'success', duration: 5000 });
    } catch (err) {
      flash({ msg: 'Erreur : ' + err.message, type: 'warning' });
    }
  };

  const handleTogglePerm = async (staffId, permKey, currentValue) => {
    const newVal = !currentValue;
    // Update local state immediately
    setStaffUsers((prev) => prev.map((u) => {
      if (u.id !== staffId) return u;
      return { ...u, permissions: { ...u.permissions, [permKey]: newVal } };
    }));
    // Persist
    try {
      await sb.updateStaffPermissions(staffId, { [permKey]: newVal });
    } catch (err) {
      flash({ msg: 'Erreur sauvegarde', type: 'warning' });
      // Revert
      setStaffUsers((prev) => prev.map((u) => {
        if (u.id !== staffId) return u;
        return { ...u, permissions: { ...u.permissions, [permKey]: currentValue } };
      }));
    }
  };

  const handleDeleteUser = async (id) => {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    try {
      await sb.deleteStaffUser(id);
      setStaffUsers((prev) => prev.filter((u) => u.id !== id));
      if (selectedUser?.id === id) setSelectedUser(null);
      flash({ msg: 'Utilisateur supprimé', type: 'success' });
    } catch (err) {
      flash({ msg: 'Erreur : ' + err.message, type: 'warning' });
    }
  };

  const toggleCat = (key) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const sel = selectedUser ? staffUsers.find((u) => u.id === selectedUser.id) : null;

  if (loading) return <p className="text-sm text-gray-400 p-4">Chargement...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold" style={{ color: BRAND.navy }}>Utilisateurs & Permissions</h3>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all active:scale-95"
          style={{ background: BRAND.navy }}>
          <Plus size={12} /> Nouvel utilisateur
        </button>
      </div>

      {/* New user form */}
      {showNew && (
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input value={newForm.nom} onChange={(e) => setNewForm((p) => ({ ...p, nom: e.target.value }))}
              placeholder="Nom *" className="px-3 py-2 rounded-lg border text-sm" />
            <input value={newForm.prenom} onChange={(e) => setNewForm((p) => ({ ...p, prenom: e.target.value }))}
              placeholder="Prénom" className="px-3 py-2 rounded-lg border text-sm" />
            <input value={newForm.email} onChange={(e) => setNewForm((p) => ({ ...p, email: e.target.value }))}
              placeholder="Email *" type="email" className="px-3 py-2 rounded-lg border text-sm" />
            <div className="relative">
              <input value={newForm.password} onChange={(e) => setNewForm((p) => ({ ...p, password: e.target.value }))}
                placeholder="Mot de passe *" type={showNewPwd ? 'text' : 'password'} className="w-full px-3 py-2 pr-9 rounded-lg border text-sm" />
              <button type="button" onClick={() => setShowNewPwd((p) => !p)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showNewPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <select value={newForm.role} onChange={(e) => setNewForm((p) => ({ ...p, role: e.target.value }))}
              className="px-3 py-2 rounded-lg border text-sm">
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreateUser}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: BRAND.navy }}>
              Créer
            </button>
            <button onClick={() => setShowNew(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-500 bg-gray-100">
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-4">
        {/* User list */}
        <div className="w-64 space-y-1">
          {staffUsers.map((u) => {
            const role = ROLES.find((r) => r.value === u.role);
            const isSelected = sel?.id === u.id;
            return (
              <button key={u.id} onClick={() => setSelectedUser(u)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all ${isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'}`}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black text-white"
                  style={{ background: role?.color || '#6B7280' }}>
                  {(u.prenom || u.nom || '?').charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-800 truncate">{u.prenom} {u.nom}</p>
                  <p className="text-[10px] text-gray-400">{role?.label || u.role}</p>
                </div>
                {!u.actif && <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-500">Inactif</span>}
              </button>
            );
          })}
        </div>

        {/* Permissions panel */}
        {sel ? (
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold" style={{ color: BRAND.navy }}>{sel.prenom} {sel.nom}</h4>
                <p className="text-[10px] text-gray-400">{sel.email} — {sel.role}</p>
              </div>
              <button onClick={() => handleDeleteUser(sel.id)}
                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600">
                <Trash2 size={14} />
              </button>
            </div>

            {/* Permission categories */}
            {PERMISSION_CATEGORIES.map((cat) => {
              const isOpen = expandedCats.has(cat.key);
              const checked = cat.permissions.filter((p) => sel.permissions?.[p.key]).length;
              return (
                <div key={cat.key} className="rounded-xl border border-gray-100">
                  <button onClick={() => toggleCat(cat.key)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="text-xs font-bold" style={{ color: BRAND.navy }}>{cat.label}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        {checked}/{cat.permissions.length}
                      </span>
                    </div>
                    {/* Select all / deselect all */}
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => cat.permissions.forEach((p) => { if (!sel.permissions?.[p.key]) handleTogglePerm(sel.id, p.key, false); })}
                        className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200">
                        Tout
                      </button>
                      <button onClick={() => cat.permissions.forEach((p) => { if (sel.permissions?.[p.key]) handleTogglePerm(sel.id, p.key, true); })}
                        className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600 hover:bg-red-200">
                        Aucun
                      </button>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-2 space-y-1">
                      {cat.permissions.map((perm) => {
                        const checked = sel.permissions?.[perm.key] || false;
                        return (
                          <label key={perm.key} className="flex items-center gap-2 cursor-pointer py-0.5">
                            <input type="checkbox" checked={checked}
                              onChange={() => handleTogglePerm(sel.id, perm.key, checked)}
                              className="w-3.5 h-3.5 rounded accent-blue-500" />
                            <span className="text-[11px] text-gray-700">{perm.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            <p>Sélectionnez un utilisateur</p>
          </div>
        )}
      </div>
    </div>
  );
}
