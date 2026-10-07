import React, { useState } from 'react';
import { LogIn, AlertCircle, Eye, EyeOff, ArrowLeft, RefreshCw, LogOut } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BRAND } from '../constants';
import { supabase, configurationError } from '../lib/supabase';
import { IDENTITY_UNAVAILABLE } from '../lib/supabaseData';
import useDocumentTitle from '../hooks/useDocumentTitle';

/** A request that never reached the server (offline, blocked): the only case presented as a connection problem. */
function networkFailure(error, text) {
  const status = Number(error?.status);
  return (error?.name === 'AuthRetryableFetchError' && !(status >= 500)) || error?.status === 0 || error instanceof TypeError
    || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(text);
}

/** Supabase Auth answers in English: the person reads French, never a technical message. `reset`: the
 * « Mot de passe oublié » form, whose limit concerns the links sent. */
function loginMessage(error, { reset = false } = {}) {
  const text = String(error?.message || error || '').trim();
  const code = String(error?.code || '');
  const status = Number(error?.status);
  if (/invalid login credentials/i.test(text) || code === 'invalid_credentials') return 'Email ou mot de passe incorrect.';
  if (/email not confirmed/i.test(text) || code === 'email_not_confirmed') return 'Votre email n’est pas encore confirmé. Ouvrez le lien reçu par email, puis reconnectez-vous.';
  if (/security purposes|rate limit|too many/i.test(text) || /^over_.*rate_limit$/.test(code) || status === 429) return reset
    ? 'Un lien vient d’être demandé. Patientez une minute avant d’en demander un nouveau.'
    : 'Trop de tentatives de connexion. Patientez une minute, puis réessayez.';
  if (/validate email|invalid format|email address .*invalid/i.test(text) || ['validation_failed', 'email_address_invalid'].includes(code)) return 'Vérifiez l’adresse email\u00a0: elle doit ressembler à nom@exemple.fr.';
  if (/banned/i.test(text) || code === 'user_banned') return 'Ce compte est suspendu. Contactez l’équipe Expedîle.';
  if (networkFailure(error, text)) return 'Connexion impossible pour le moment. Vérifiez votre accès à internet, puis réessayez.';
  if (status >= 500) return 'Le service de connexion est momentanément indisponible. Réessayez dans un instant.';
  // Any other message of the server (English) is never shown as is, nor as an internet problem.
  if (!text || /^[\x20-\x7E]*$/.test(text)) return 'La demande n’a pas abouti. Réessayez dans un instant ou contactez l’équipe Expedîle.';
  return text;
}

/** The account could not be read (network, server): the session is kept, the person tries again or changes account. */
function IdentityUnavailable({ message }) {
  const { retryIdentity, signOut } = useApp();
  const [busy, setBusy] = useState('');
  const [leaveError, setLeaveError] = useState('');
  const retry = async () => {
    if (busy) return;
    setBusy('retry'); setLeaveError('');
    try { await retryIdentity(); } catch { /* still unavailable: this panel is shown again */ }
    finally { setBusy(''); }
  };
  const leave = async () => {
    if (busy) return;
    setBusy('leave'); setLeaveError('');
    try { await signOut(); }
    catch { setLeaveError('La déconnexion n’a pas abouti. Réessayez lorsque votre connexion sera revenue.'); }
    finally { setBusy(''); }
  };
  return <section aria-labelledby="identity-title" className="space-y-5">
    <div>
      <h1 id="identity-title" className="text-2xl font-black tracking-tight" style={{ color: 'var(--brand-text)' }}>Connexion momentanément impossible</h1>
      <p role="alert" className="mt-2 text-sm text-slate-600">{message}</p>
    </div>
    <button type="button" onClick={retry} disabled={Boolean(busy)}
      className="w-full min-h-11 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all duration-200 ease-out active:scale-[0.98] hover:translate-y-[-1px] disabled:opacity-50 disabled:translate-y-0"
      style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD }}>
      <RefreshCw size={16} aria-hidden="true" className={busy === 'retry' ? 'animate-spin' : ''} />{busy === 'retry' ? 'Nouvelle tentative…' : 'Réessayer'}
    </button>
    <button type="button" onClick={leave} disabled={Boolean(busy)} className="w-full min-h-11 flex items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 transition-all duration-200 ease-out active:scale-[0.98] disabled:opacity-50">
      <LogOut size={16} aria-hidden="true" />{busy === 'leave' ? 'Déconnexion…' : 'Utiliser un autre compte'}
    </button>
    {leaveError && <p role="alert" className="text-sm text-red-700">{leaveError}</p>}
  </section>;
}

export default function LoginPage() {
  const { signIn, authError, identityError } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [recoveryInvalid] = useState(() => window.location.pathname === '/password' && new URLSearchParams(window.location.hash.slice(1)).has('error'));
  const [mode, setMode] = useState(() => window.location.pathname === '/password' && new URLSearchParams(window.location.hash.slice(1)).has('error') ? 'forgot' : 'login'); // 'login' | 'forgot'
  useDocumentTitle(identityError ? 'Connexion momentanément impossible' : mode === 'login' ? 'Connexion' : 'Mot de passe oublié');

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) { setError('Saisissez votre email et votre mot de passe.'); return; }
    setLoading(true);
    setError('');

    try {
      await signIn(email.trim(), password);
    } catch (err) {
      // An unreadable account is shown by its own panel (identityError), never as a wrong password.
      if (err?.code !== IDENTITY_UNAVAILABLE) setError(loginMessage(err));
    }
    setLoading(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (configurationError) { setError(configurationError); return; }
    if (!email.trim()) { setError('Saisissez votre email.'); return; }
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/password`,
      });
      if (resetError) {
        setError(loginMessage(resetError, { reset: true }));
      } else {
        setSuccess('Si un compte correspond à cette adresse, vous recevrez un lien de réinitialisation. Vérifiez aussi les courriers indésirables.');
      }
    } catch (err) {
      setError(loginMessage(err, { reset: true }));
    }
    setLoading(false);
  };
  const shownError = error || (authError ? loginMessage(authError) : '');

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
          <p className="text-3xl font-black text-white leading-tight tracking-tight">
            Vos achats, de Paris<br />
            <span style={{ color: BRAND.gold }}>jusqu’à votre île.</span>
          </p>
          <p className="mt-4 text-sm text-white/80 leading-relaxed max-w-sm">
            Retrouvez vos expéditions, donnez votre accord de préparation,
            transmettez vos factures et réglez vos devis depuis votre espace.
            Notre équipe vous prévient à chaque étape.
          </p>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-[11px] text-white/70">
          © {new Date().getFullYear()} Expedîle · Tous droits réservés
        </p>
      </div>

      {/* ── COLONNE DROITE — Formulaire ── */}
      <div className="flex flex-col items-center justify-center px-6 py-10 md:px-16">
        {/* Logo mobile only */}
        <div className="md:hidden mb-8 flex flex-col items-center select-none">
          <div className="flex items-baseline gap-0 leading-none">
            <span className="text-4xl font-black tracking-tighter" style={{ color: 'var(--brand-text)' }}>EXPÉD</span>
            <span className="text-4xl font-black tracking-tighter" style={{ color: 'var(--text-accent)' }}>ÎLE</span>
          </div>
          <p className="mt-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--brand-text)', letterSpacing: '0.18em' }}>
            Paris → Réunion · Mayotte · Antilles
          </p>
        </div>

        <div className="w-full max-w-sm">
          {identityError ? <IdentityUnavailable message={identityError} /> : <>
          {recoveryInvalid && <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Ce lien de récupération n’est plus valable. Saisissez votre email pour recevoir un nouveau lien.</p>}
          {/* Keyed forms: switching to « Mot de passe oublié » mounts a new form, so the click that opens it can
              never activate (submit) the new form's button rendered at the same place. */}
          {mode === 'login' ? (
            <form key="login" onSubmit={handleLogin} className="space-y-5">
              <div>
                <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--brand-text)' }}>
                  Connexion
                </h1>
                <p className="text-sm text-slate-500 mt-1">Accédez à votre espace Expedîle.</p>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600" htmlFor="login-email">Email</label>
                <input
                  id="login-email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@exemple.fr"
                  className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none border-2 border-slate-200 focus:border-blue-400 transition-colors bg-white"
                  style={{ color: 'var(--brand-text)' }}
                  autoComplete="email" autoFocus
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600" htmlFor="login-password">Mot de passe</label>
                <div className="relative">
                  <input
                    id="login-password" required type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 pr-11 rounded-xl text-sm font-medium outline-none border-2 border-slate-200 focus:border-blue-400 transition-colors bg-white"
                    style={{ color: 'var(--brand-text)' }}
                    autoComplete="current-password"
                  />
                  <button aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} type="button" onClick={() => setShowPwd((p) => !p)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors">
                    {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {shownError && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <p role="alert" className="text-xs text-red-700">{shownError}</p>
                </div>
              )}

              <button
                type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98] hover:translate-y-[-1px] disabled:opacity-50 disabled:translate-y-0"
                style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD, boxShadow: `0 4px 14px -4px ${BRAND.gold}80` }}
              >
                <LogIn size={16} />
                {loading ? 'Connexion…' : 'Se connecter'}
              </button>

              <button type="button" onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}
                className="w-full text-center text-[12px] text-slate-500 hover:text-slate-800 transition-colors">
                Mot de passe oublié&nbsp;?
              </button>
            </form>
          ) : (
            /* Forgot password: the link is sent only by its own submit button. */
            <form key="forgot" onSubmit={handleForgotPassword} className="space-y-5">
              <button type="button" onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
                className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-800 transition-colors">
                <ArrowLeft size={12} /> Retour à la connexion
              </button>

              <div>
                <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--brand-text)' }}>
                  Mot de passe oublié
                </h1>
                <p className="text-sm text-slate-500 mt-1">Saisissez votre email, vous recevrez un lien pour réinitialiser votre mot de passe.</p>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600" htmlFor="login-email">Email</label>
                <input
                  id="login-email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="votre@email.com"
                  className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none border-2 border-slate-200 focus:border-blue-400 transition-colors bg-white"
                  style={{ color: 'var(--brand-text)' }}
                  autoComplete="email" autoFocus
                />
              </div>

              {shownError && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <p role="alert" className="text-xs text-red-700">{shownError}</p>
                </div>
              )}
              {success && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                  <p role="status" className="text-sm text-emerald-700"><strong className="block">Vérifiez votre messagerie</strong>{email.trim()}<br />{success}</p>
                </div>
              )}

              <button
                type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98] hover:translate-y-[-1px] disabled:opacity-50 disabled:translate-y-0"
                style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD, boxShadow: `0 4px 14px -4px ${BRAND.gold}80` }}
              >
                {loading ? 'Envoi…' : success ? 'Recevoir un nouveau lien' : 'Envoyer le lien de réinitialisation'}
              </button>
            </form>
          )}
          </>}

          {!identityError && <details className="mt-5 border-t border-slate-200 pt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-700">Première connexion&nbsp;?</summary><p className="text-sm text-slate-600">Utilisez l’email et les instructions d’accès transmis par notre équipe. Vous n’avez pas reçu votre invitation&nbsp;?</p><a className="inline-flex min-h-11 items-center text-sm font-semibold underline" href="mailto:contact@expedile.fr?subject=Mon%20acc%C3%A8s%20Exped%C3%AEle">Demander mon accès à l’équipe</a></details>}
          <p className="mt-8 text-[11px] text-slate-400 text-center md:hidden">© {new Date().getFullYear()} Expedîle</p>
        </div>
      </div>
    </div>
  );
}
