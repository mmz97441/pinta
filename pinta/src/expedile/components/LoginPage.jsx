import React, { useState } from 'react';
import { LogIn, AlertCircle, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BRAND } from '../constants';
import { supabase } from '../lib/supabase';

export default function LoginPage() {
  const { setAuth } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState('login'); // 'login' | 'forgot'

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
            nom: `${meta.prenom || ''} ${meta.nom || ''}`.trim() || data.user.email,
            email: data.user.email,
            role: meta.role || 'preparateur',
          },
          session: data.session,
        });
      }
    } catch (err) {
      setError('Erreur : ' + err.message);
    }
    setLoading(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!email.trim()) { setError('Saisissez votre email'); return; }
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (resetError) {
        setError(resetError.message);
      } else {
        setSuccess('Un email de réinitialisation a été envoyé. Vérifiez votre boîte mail.');
      }
    } catch (err) {
      setError('Erreur : ' + err.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-[100dvh] grid grid-cols-1 md:grid-cols-2 bg-white">

      {/* ── COLONNE GAUCHE — Brand visuel (cachée mobile, full desktop) ── */}
      <div
        className="hidden md:flex relative flex-col justify-between px-12 py-10 overflow-hidden"
        style={{ background: `linear-gradient(160deg, ${BRAND.navy} 0%, ${BRAND.navyD} 100%)` }}
      >
        {/* Decorative SVG pattern subtle */}
        <div
          className="absolute inset-0 opacity-[0.08] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 30%, ${BRAND.gold} 1px, transparent 1px), radial-gradient(circle at 70% 60%, ${BRAND.gold} 1px, transparent 1px)`,
            backgroundSize: '80px 80px, 120px 120px',
          }}
        />

        {/* Logo en haut */}
        <div className="relative z-10 select-none">
          <div className="flex items-baseline gap-0 leading-none">
            <span className="text-6xl font-black text-white tracking-tighter">EXPÉD</span>
            <span className="text-6xl font-black tracking-tighter" style={{ color: BRAND.gold }}>ÎLE</span>
          </div>
          <p className="mt-3 text-sm font-semibold uppercase" style={{ color: BRAND.gold, letterSpacing: '0.18em' }}>
            Paris → Réunion · Mayotte · Antilles
          </p>
        </div>

        {/* Tagline central */}
        <div className="relative z-10 max-w-md">
          <h2 className="text-3xl font-black text-white leading-tight tracking-tight">
            Vos colis, suivis<br />
            <span style={{ color: BRAND.gold }}>en temps réel.</span>
          </h2>
          <p className="mt-4 text-sm text-white/70 leading-relaxed max-w-sm">
            La plateforme logistique qui automatise la réexpédition de Paris vers
            les DOM-TOM. Mesure, devis, paiement, livraison — un seul outil.
          </p>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-[11px] text-white/40">
          © {new Date().getFullYear()} Expedîle · Tous droits réservés
        </p>
      </div>

      {/* ── COLONNE DROITE — Formulaire ── */}
      <div className="flex flex-col items-center justify-center px-6 py-10 md:px-16">
        {/* Logo mobile only */}
        <div className="md:hidden mb-8 flex flex-col items-center select-none">
          <div className="flex items-baseline gap-0 leading-none">
            <span className="text-4xl font-black tracking-tighter" style={{ color: BRAND.navy }}>EXPÉD</span>
            <span className="text-4xl font-black tracking-tighter" style={{ color: BRAND.gold }}>ÎLE</span>
          </div>
          <p className="mt-2 text-[10px] font-semibold uppercase" style={{ color: BRAND.navy, letterSpacing: '0.18em', opacity: 0.7 }}>
            Paris → Réunion · Mayotte · Antilles
          </p>
        </div>

        <div className="w-full max-w-sm">
          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <h1 className="text-2xl font-black tracking-tight" style={{ color: BRAND.navy }}>
                  Connexion
                </h1>
                <p className="text-sm text-slate-500 mt-1">Accédez à votre espace Expedîle.</p>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Email</label>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="direction@delivrex.io"
                  className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none border-2 border-slate-200 focus:border-blue-400 transition-colors bg-white"
                  style={{ color: BRAND.navy }}
                  autoComplete="email" autoFocus
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Mot de passe</label>
                <div className="relative">
                  <input
                    type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 pr-11 rounded-xl text-sm font-medium outline-none border-2 border-slate-200 focus:border-blue-400 transition-colors bg-white"
                    style={{ color: BRAND.navy }}
                    autoComplete="current-password"
                  />
                  <button type="button" onClick={() => setShowPwd((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors">
                    {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              <button
                type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98] hover:translate-y-[-1px] disabled:opacity-50 disabled:translate-y-0"
                style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD, boxShadow: `0 4px 14px -4px ${BRAND.gold}80` }}
              >
                <LogIn size={16} />
                {loading ? 'Connexion...' : 'Se connecter'}
              </button>

              <button type="button" onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}
                className="w-full text-center text-[12px] text-slate-500 hover:text-slate-800 transition-colors">
                Mot de passe oublié ?
              </button>
            </form>
          ) : (
            /* Forgot password */
            <form onSubmit={handleForgotPassword} className="space-y-5">
              <button type="button" onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
                className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-800 transition-colors">
                <ArrowLeft size={12} /> Retour à la connexion
              </button>

              <div>
                <h1 className="text-2xl font-black tracking-tight" style={{ color: BRAND.navy }}>
                  Mot de passe oublié
                </h1>
                <p className="text-sm text-slate-500 mt-1">Saisissez votre email, vous recevrez un lien pour réinitialiser votre mot de passe.</p>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Email</label>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="votre@email.com"
                  className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none border-2 border-slate-200 focus:border-blue-400 transition-colors bg-white"
                  style={{ color: BRAND.navy }}
                  autoComplete="email" autoFocus
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}
              {success && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                  <p className="text-xs text-emerald-700">{success}</p>
                </div>
              )}

              <button
                type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98] hover:translate-y-[-1px] disabled:opacity-50 disabled:translate-y-0"
                style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD, boxShadow: `0 4px 14px -4px ${BRAND.gold}80` }}
              >
                {loading ? 'Envoi...' : 'Envoyer le lien de réinitialisation'}
              </button>
            </form>
          )}

          <p className="mt-8 text-[11px] text-slate-400 text-center md:hidden">© {new Date().getFullYear()} Expedîle</p>
        </div>
      </div>
    </div>
  );
}
