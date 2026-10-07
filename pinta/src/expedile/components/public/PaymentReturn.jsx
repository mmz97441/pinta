import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Home, Loader2, RefreshCw, Truck } from 'lucide-react';
import { supabase, configurationError } from '../../lib/supabase';
import { paymentReturnFacts, paymentReturnMessage, paymentShipmentMessage, receiptDate } from '../../domain/paymentReturn';

const surface = { background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' };
const secondary = { color: 'var(--text-secondary)' };
const inputStyle = { ...surface, color: 'var(--text-primary)' };
const primaryClass = 'min-h-12 w-full rounded-xl px-4 py-3 font-semibold text-white brand-bg disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4';
const tokenPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function LegacyPaymentLogin({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const submitting = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const response = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (response.error) throw response.error;
      if (active.current) { setPassword(''); onSignedIn(); }
    } catch {
      if (active.current) setError('Connexion impossible. Vérifiez votre email et votre mot de passe, puis réessayez.');
    } finally { submitting.current = false; if (active.current) setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-5 space-y-4" aria-label="Connexion pour vérifier le paiement">
    <label className="block text-sm font-semibold">Email<input required disabled={busy} type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border px-3" style={inputStyle} /></label>
    <label className="block text-sm font-semibold">Mot de passe<input required disabled={busy} type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border px-3" style={inputStyle} /></label>
    {error && <p role="alert" className="text-sm" style={secondary}>{error}</p>}
    <button disabled={busy} className={primaryClass}>{busy ? 'Connexion…' : 'Se connecter et vérifier'}</button>
  </form>;
}

/** A read-only customer receipt: deliberately outside AppProvider and staff routes. */
function Receipt({ token, colisId, cancelled }) {
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsSession, setNeedsSession] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pollingFinished, setPollingFinished] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let theme;
    try { theme = localStorage.getItem('expedile-theme'); } catch { /* The receipt remains usable without storage. */ }
    document.documentElement.classList.toggle('dark', (theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark');
    const previousTitle = document.title;
    document.title = 'Votre paiement — Expedîle';
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    let polls = 0;
    setError(null); setNeedsSession(false); setPollingFinished(false);
    const read = async () => {
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      controller.signal.addEventListener('abort', abortRequest, { once: true });
      let requestTimeout;
      setBusy(true);
      try {
        if (configurationError) throw new Error('Le service est momentanément indisponible.');
        if (!(token ? tokenPattern.test(token) : idPattern.test(colisId || ''))) {
          setError({ invalid: true, message: 'Ce lien ne permet pas de retrouver votre paiement. Contactez notre équipe.' });
          return;
        }
        let accessToken = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!token) {
          const session = await supabase.auth.getSession();
          if (controller.signal.aborted) return;
          if (session.error || !session.data?.session?.access_token) { setNeedsSession(true); return; }
          accessToken = session.data.session.access_token;
        }
        requestTimeout = setTimeout(abortRequest, 15000);
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-payment-return`, {
          method: 'POST', signal: requestController.signal, cache: 'no-store', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(token ? { token } : { colisId }),
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 && !token) { setPayment(null); setNeedsSession(true); return; }
        if (!response.ok) {
          const invalid = [400, 403, 404, 410].includes(response.status);
          setPayment(null);
          setError({ invalid, canSignIn: !token && response.status === 403, message: invalid ? 'Ce lien n’est plus accessible ou votre compte ne permet pas de le consulter. Contactez notre équipe si nécessaire.' : 'La vérification est momentanément indisponible. Réessayez sans effectuer un nouveau paiement.' });
          return;
        }
        const result = paymentReturnFacts(await response.json());
        if (controller.signal.aborted) return;
        setPayment(result); setError(null);
        if (result.status === 'pending' && polls < 5) { polls += 1; timer = setTimeout(read, 3000); }
        else if (result.status === 'pending') setPollingFinished(true);
      } catch {
        if (!controller.signal.aborted) setError({ message: 'La vérification est momentanément indisponible. Réessayez sans effectuer un nouveau règlement.' });
      } finally {
        clearTimeout(requestTimeout);
        controller.signal.removeEventListener('abort', abortRequest);
        if (!controller.signal.aborted) { setLoading(false); setBusy(false); }
      }
    };
    read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, colisId, retry]);

  const details = payment && paymentReturnMessage(payment, cancelled);
  const shipment = payment?.status === 'paid' ? paymentShipmentMessage(payment.shipment) : null;
  const checking = loading || busy && !payment && !needsSession && !error;
  const Icon = checking ? Loader2 : error || needsSession ? AlertTriangle : payment?.status === 'paid' ? CheckCircle2 : Clock;
  const title = checking ? 'Vérification du paiement…' : needsSession ? 'Retrouver votre confirmation' : error ? 'Vérification indisponible' : details?.title;
  const contact = `mailto:contact@expedile.fr?subject=${encodeURIComponent(payment?.reference ? `Mon paiement — ${payment.reference}` : 'Vérifier mon paiement Expedîle')}`;

  return <div className="min-h-[100dvh] px-4 py-6 sm:py-10" style={{ background: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
    <div className="mx-auto max-w-lg">
      <header className="mb-7 flex items-center justify-between gap-4"><b className="text-lg font-black tracking-tight" style={{ color: 'var(--brand-text)' }}>EXPÉD<span style={{ color: 'var(--text-accent)' }}>ÎLE</span></b><span className="text-sm" style={secondary}>Votre paiement</span></header>
      <main className="rounded-2xl border p-5 shadow-sm sm:p-8" style={surface} aria-label="Retour de paiement">
        <div aria-live="polite" aria-atomic="true">
          <Icon size={36} aria-hidden="true" className={checking ? 'animate-spin' : ''} style={{ color: payment?.status === 'paid' && !error ? 'var(--success)' : 'var(--text-secondary)' }} />
          <h1 className="mt-4 text-2xl font-bold leading-tight">{title}</h1>
          <p className="mt-3 text-base leading-relaxed" style={secondary}>{checking ? 'Nous vérifions la confirmation de votre règlement.' : needsSession ? 'Connectez-vous pour consulter la confirmation du paiement et la suite de votre envoi.' : error ? error.message : details?.message}</p>
        </div>
        {!loading && !error && !needsSession && payment && <>
          <div className="mt-6 border-t pt-5" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-sm font-semibold">Expédition {payment.reference}</p>
            {payment.amountCents != null && <p className="mt-2 text-2xl font-bold">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(payment.amountCents / 100)}<span className="ml-2 text-sm font-normal" style={secondary}>{payment.status === 'paid' ? payment.isLive === false ? 'simulés' : 'reçus' : 'à vérifier'}</span></p>}
            {payment.status === 'paid' && receiptDate(payment.paidAt) && <p className="mt-1 text-sm" style={secondary}>Confirmé le {receiptDate(payment.paidAt)}</p>}
            {payment.status !== 'paid' && payment.isLive === false && <p className="mt-2 text-sm font-semibold" style={secondary}>Mode test · aucun règlement réel</p>}
          </div>
          {shipment && <section className="mt-6 rounded-xl border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }} aria-label="Suite de votre envoi"><Truck size={22} aria-hidden="true" /><h2 className="mt-2 text-base font-bold">{shipment.title}</h2><p className="mt-2 text-sm leading-relaxed" style={secondary}>{shipment.message}</p></section>}
          {pollingFinished && payment.status === 'pending' && <p className="mt-4 text-sm" style={secondary}>La confirmation prend plus de temps que prévu. Vous pouvez vérifier à nouveau ou contacter notre équipe. Ne payez pas une seconde fois.</p>}
        </>}
        {needsSession && <LegacyPaymentLogin onSignedIn={() => setRetry(value => value + 1)} />}
        {!checking && !needsSession && !error?.invalid && <button disabled={busy} onClick={() => setRetry(value => value + 1)} className={`${primaryClass} mt-6`}><RefreshCw size={17} aria-hidden="true" className={`mr-2 inline ${busy ? 'animate-spin' : ''}`} />{busy ? 'Vérification…' : error ? 'Réessayer la vérification' : payment?.status === 'paid' ? 'Actualiser le suivi' : 'Vérifier le paiement'}</button>}
        {error?.canSignIn && <button className={`${primaryClass} mt-6`} onClick={() => { setError(null); setNeedsSession(true); }}>Utiliser un autre compte</button>}
      </main>
      <footer className="mt-5 text-center text-sm" style={secondary}>
        <div className="flex flex-wrap items-center justify-center gap-x-6"><a href="/" className="inline-flex min-h-11 items-center gap-2 font-semibold underline underline-offset-4" style={{ color: 'var(--brand-text)' }}><Home size={16} aria-hidden="true" />Retour à mon espace client</a><a href={contact} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Contacter l’équipe</a></div>
        <p className="mt-1">Gardez cette page pour retrouver la confirmation et le suivi. Votre espace client affiche aussi la suite de votre envoi.</p>
      </footer>
    </div>
  </div>;
}

export default function PaymentReturn({ colisId }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const token = params.get('token');
  return <Receipt key={token || colisId || 'missing'} token={token} colisId={colisId} cancelled={params.get('payment') === 'cancelled'} />;
}
