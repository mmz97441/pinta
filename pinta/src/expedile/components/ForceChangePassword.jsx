import React, { useState } from 'react';
import { Eye, EyeOff, Check, Shield } from 'lucide-react';
import { BRAND } from '../constants';
import { supabase } from '../lib/supabase';
import * as sb from '../lib/supabaseData';

/**
 * Écran bloquant affiché à la première connexion.
 * L'utilisateur DOIT changer son mot de passe pour accéder à l'app.
 */
export default function ForceChangePassword({ staffUser, onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isValid = password.length >= 6 && password === confirm;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) { setError('Le mot de passe doit faire au moins 6 caractères'); return; }
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas'); return; }

    setLoading(true);
    setError('');

    try {
      // Update password in Supabase Auth
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) { setError(authError.message); setLoading(false); return; }

      // Mark as password changed
      if (staffUser?.id) {
        await sb.updateStaffUser(staffUser.id, { must_change_password: false });
      }

      onDone();
    } catch (err) {
      setError('Erreur : ' + err.message);
    }
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center px-4"
      style={{ background: `linear-gradient(160deg, ${BRAND.navy} 0%, ${BRAND.navyD} 100%)` }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8"
        style={{
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
        }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: `${BRAND.gold}30` }}>
            <Shield size={20} style={{ color: BRAND.gold }} />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">Bienvenue !</h2>
            <p className="text-xs text-gray-400">Définissez votre mot de passe personnel pour continuer</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: BRAND.goldL }}>
              Nouveau mot de passe
            </label>
            <div className="relative mt-1">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 caractères"
                className="w-full px-4 py-3 pr-11 rounded-xl text-sm font-medium outline-none"
                style={{ background: 'rgba(255,255,255,0.08)', border: `1px solid ${password.length >= 6 ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.15)'}`, color: 'white' }}
                autoFocus
              />
              <button type="button" onClick={() => setShowPwd((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors">
                {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {password.length > 0 && password.length < 6 && (
              <p className="text-[10px] text-red-400 mt-1">Minimum 6 caractères</p>
            )}
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: BRAND.goldL }}>
              Confirmer le mot de passe
            </label>
            <div className="relative mt-1">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Retapez le mot de passe"
                className="w-full px-4 py-3 pr-11 rounded-xl text-sm font-medium outline-none"
                style={{ background: 'rgba(255,255,255,0.08)', border: `1px solid ${confirm && confirm === password ? 'rgba(16,185,129,0.5)' : confirm && confirm !== password ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.15)'}`, color: 'white' }}
              />
              <button type="button" onClick={() => setShowConfirm((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors">
                {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {confirm && confirm !== password && (
              <p className="text-[10px] text-red-400 mt-1">Les mots de passe ne correspondent pas</p>
            )}
            {confirm && confirm === password && password.length >= 6 && (
              <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1"><Check size={10} /> Les mots de passe correspondent</p>
            )}
          </div>

          {error && (
            <div className="p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.15)' }}>
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={!isValid || loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD }}
          >
            <Check size={16} />
            {loading ? 'Enregistrement...' : 'Définir mon mot de passe et continuer'}
          </button>
        </form>
      </div>
    </div>
  );
}
