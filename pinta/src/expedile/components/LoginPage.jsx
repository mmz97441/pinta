import React, { useState } from 'react';
import { LogIn, AlertCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BRAND } from '../constants';
import { supabase } from '../lib/supabase';

export default function LoginPage() {
  const { setAuth } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) { setError('Email et mot de passe requis'); return; }
    setLoading(true);
    setError('');

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });

      if (authError) {
        setError(authError.message === 'Invalid login credentials'
          ? 'Email ou mot de passe incorrect'
          : authError.message);
        setLoading(false);
        return;
      }

      if (data?.user) {
        const meta = data.user.user_metadata || {};
        setAuth({
          type: 'staff',
          u: {
            id: data.user.id,
            nom: `${meta.nom || ''} ${meta.prenom || ''}`.trim() || data.user.email,
            email: data.user.email,
            role: meta.role || 'preparateur',
          },
          session: data.session,
        });
      }
    } catch (err) {
      setError('Erreur de connexion : ' + err.message);
    }
    setLoading(false);
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{ background: `linear-gradient(160deg, ${BRAND.navy} 0%, ${BRAND.navyD} 100%)` }}
    >
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center select-none">
        <div className="flex items-baseline gap-0 leading-none">
          <span className="text-5xl font-black text-white" style={{ letterSpacing: '-0.03em' }}>EXPÉD</span>
          <span className="text-5xl font-black" style={{ color: BRAND.gold, letterSpacing: '-0.03em' }}>ÎLE</span>
        </div>
        <p className="mt-2 text-sm font-semibold uppercase" style={{ color: BRAND.gold, letterSpacing: '0.18em' }}>
          Paris → Réunion · Mayotte · Antilles
        </p>
      </div>

      {/* Login card */}
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
        }}
      >
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: BRAND.goldL }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="direction@delivrex.io"
              className="w-full mt-1 px-4 py-3 rounded-xl text-sm font-medium outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'white',
              }}
              onFocus={(e) => { e.target.style.borderColor = BRAND.gold; }}
              onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.15)'; }}
              autoComplete="email"
              autoFocus
            />
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: BRAND.goldL }}>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full mt-1 px-4 py-3 rounded-xl text-sm font-medium outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'white',
              }}
              onFocus={(e) => { e.target.style.borderColor = BRAND.gold; }}
              onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.15)'; }}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.15)' }}>
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50"
            style={{
              background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`,
              color: BRAND.navyD,
              boxShadow: `0 4px 20px ${BRAND.gold}40`,
            }}
          >
            <LogIn size={16} />
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </div>

      <p className="mt-6 text-[10px] text-gray-500">Expedîle © 2026 — Réexpédition DOM-TOM</p>
    </div>
  );
}
