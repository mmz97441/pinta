import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  Link2, Copy, Check, Send, ShieldOff, Eye, Sparkles,
  Loader2, AlertCircle, RefreshCw, ExternalLink,
} from 'lucide-react';
import * as sb from '../../lib/supabaseData';
import { useApp } from '../../context/AppContext';
import { sendTelegram } from '../../services/telegramApi';
import { getPrenom, countLabel } from '../../utils';

// brand.css tokens: every surface, border and text follows the light and dark themes.
const BORDER = 'border-[color:var(--border-subtle)]';
const PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl brand-bg px-4 py-2 text-sm font-semibold text-white transition-transform duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';
const SECONDARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-300 dark:border-[color:var(--border-subtle)] bg-elevated px-4 py-2 text-sm font-semibold text-primary transition-transform duration-200 ease-out hover:bg-surface active:scale-[0.98] disabled:opacity-50';
// Telegram blue (#0088cc) darkened so white text reaches 5.6:1.
const TELEGRAM_BLUE = '#006DA3';

/**
 * ShareLinkPanel — gestion du lien de suivi partagé pour un client.
 *
 * États : loading (chargement initial), none (aucun lien), active (lien valide),
 * revoked (lien révoqué), error (lecture impossible).
 * Actions staff : créer, copier, envoyer via Telegram (client lié), révoquer (avec confirmation).
 */
export default function ShareLinkPanel({ client, currentUserId, flash, ask }) {
  const { data, refreshColis, can } = useApp();
  const dossiers = data.filter(c => c.clientId === client?.id && !c.archive);
  const [referenceId, setReferenceId] = useState('');
  const dossierId = dossiers.length === 1 ? dossiers[0].id : referenceId;
  const [link, setLink] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sendingTg, setSendingTg] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const telegramHint = useId();
  const referenceField = useId();

  // Charger le lien existant
  const reload = useCallback(async () => {
    if (!client?.id) return;
    setLoading(true);
    setError(null);
    try {
      const l = await sb.fetchShareLink(client.id);
      setLink(l);
    } catch (e) {
      setError(e.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [client?.id]);

  useEffect(() => { reload(); }, [reload]);

  const url = link ? `${window.location.origin}/suivi/${link.token}` : '';
  const isRevoked = link && !!link.revoked_at;

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const newLink = await sb.createShareLink(client.id, currentUserId);
      setLink(newLink);
      flash?.({ msg: 'Lien de suivi créé', type: 'success' });
    } catch (e) {
      flash?.({ msg: `Le lien de suivi n’a pas été créé : ${e.message}`, type: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!url) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      flash?.({ msg: 'Copie impossible : sélectionnez le lien pour le copier.', type: 'warning' });
    } finally {
      setCopying(false);
    }
  };

  // Why the Telegram sending is unavailable, shown next to the button.
  const telegramBlocked = !client?.telegramChatId ? 'Envoi par Telegram indisponible : le Telegram du client n’est pas lié. Il peut le lier avec son invitation personnelle.'
    : !can('perm_comm_telegram') ? 'Votre rôle ne permet pas d’envoyer un message Telegram.'
      : !dossiers.length ? 'Envoi par Telegram indisponible : le message se rattache à un dossier en cours, et ce client n’en a pas.'
        : !dossierId ? 'Choisissez le dossier de référence pour envoyer le lien par Telegram.' : '';

  const handleTelegramShare = async () => {
    if (!url || telegramBlocked || sendingTg) return;
    setSendingTg(true);
    const prenom = getPrenom(client) || 'bonjour';
    const message = `Bonjour ${prenom} 👋\n\nVoici votre lien de suivi à partager avec votre famille :\n\n${url}\n\nIls pourront suivre l'avancement de chaque colis sans créer de compte.\n\nL'équipe Expedîle`;
    try {
      const res = await sendTelegram(client.telegramChatId, message, { colisId: dossierId });
      if (!res.ok) throw new Error(res.error || 'Envoi non confirmé');
      flash?.({ msg: 'Lien envoyé via Telegram', type: 'success' });
      try { await refreshColis(dossierId); }
      catch { flash?.({ msg: 'Lien envoyé ; rechargez le dossier pour actualiser les échanges.', type: 'warning' }); }
    } catch (error) {
      flash?.({ msg: `Lien non envoyé par Telegram : ${error.message}`, type: 'error' });
    } finally {
      setSendingTg(false);
    }
  };

  const doRevoke = async () => {
    setRevoking(true);
    try {
      await sb.revokeShareLink(link.id);
      await reload();
      flash?.({ msg: 'Lien révoqué', type: 'success' });
    } catch (e) {
      flash?.({ msg: `Le lien n’a pas été révoqué : ${e.message}`, type: 'error' });
    } finally {
      setRevoking(false);
    }
  };

  const handleRevoke = () => {
    if (!ask) {
      // Fallback : confirm natif
      if (!confirm('Révoquer ce lien ? Le destinataire ne pourra plus accéder au suivi.')) return;
      doRevoke();
      return;
    }
    ask(
      `Révoquer le lien de ${client.nom} ?`,
      'Le destinataire ne pourra plus accéder au suivi via ce lien. Vous pourrez en créer un nouveau ensuite.',
      doRevoke,
      { danger: true, okLabel: 'Révoquer' },
    );
  };

  // ── Loading skeleton ────────────────────────────────────────────────
  if (loading) {
    return (
      <Section>
        <SectionHeader />
        <div role="status" aria-label="Chargement du lien de suivi" className="space-y-2.5">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
          <div className="h-11 animate-pulse rounded-xl bg-slate-100" />
          <div className="flex gap-2">
            <div className="h-11 w-36 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-11 w-36 animate-pulse rounded-xl bg-slate-100" />
          </div>
        </div>
      </Section>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <Section>
        <SectionHeader />
        <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 px-3 py-2.5 text-red-800">
          <AlertCircle size={16} className="mt-1 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Lien de suivi indisponible</p>
            <p className="text-sm">{error}</p>
          </div>
          <button type="button" onClick={reload} className={SECONDARY}><RefreshCw size={16} aria-hidden="true" />Réessayer</button>
        </div>
      </Section>
    );
  }

  // ── Empty state : aucun lien ────────────────────────────────────────
  if (!link) {
    return (
      <Section>
        <SectionHeader />
        <Explanation />
        <div className={`rounded-2xl border ${BORDER} bg-surface px-5 py-6`}>
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-elevated brand-t" aria-hidden="true">
              <Link2 size={18} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-primary">Pas encore de lien de suivi</p>
              <p className="mt-1 max-w-md text-sm leading-relaxed text-secondary">
                Générez un lien unique que <span className="font-semibold text-primary">{client.prenom || client.nom}</span> pourra partager
                avec sa famille : suivi des colis, sans compte à créer.
              </p>
              <button type="button" onClick={handleCreate} disabled={creating} className={`${PRIMARY} mt-3.5`}>
                {creating
                  ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" />Création…</>
                  : <><Sparkles size={16} strokeWidth={2.25} aria-hidden="true" />Créer le lien de suivi</>}
              </button>
            </div>
          </div>
        </div>
      </Section>
    );
  }

  // ── Revoked ────────────────────────────────────────────────────────
  if (isRevoked) {
    return (
      <Section>
        <SectionHeader />
        <Explanation />
        <div className={`rounded-2xl border ${BORDER} bg-elevated px-5 py-5`}>
          <div className="mb-3 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-surface" aria-hidden="true">
              <ShieldOff size={16} className="text-secondary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-primary">Lien révoqué</p>
              <p className="mt-0.5 text-sm text-secondary">
                Révoqué le {formatDate(link.revoked_at)} · {countLabel(link.access_count || 0, 'consultation', 'consultations')} avant révocation
              </p>
            </div>
          </div>
          <button type="button" onClick={handleCreate} disabled={creating} className={`${PRIMARY} w-full`}>
            {creating ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" />Création…</> : <><RefreshCw size={16} aria-hidden="true" />Générer un nouveau lien</>}
          </button>
        </div>
      </Section>
    );
  }

  // ── Active ──────────────────────────────────────────────────────────
  return (
    <Section>
      <SectionHeader />
      <Explanation />
      <a className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline underline-offset-2 brand-t" href={url} target="_blank" rel="noreferrer">
        Prévisualiser ce que verra le destinataire<ExternalLink size={14} aria-hidden="true" />
      </a>
      <div className={`overflow-hidden rounded-2xl border ${BORDER} bg-elevated`}>
        {/* Status bar */}
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b ${BORDER} px-4 py-1.5`}>
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-secondary">
            <span className="relative flex size-2 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-bold uppercase tracking-wider text-green-800">Actif</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap"><Eye size={14} aria-hidden="true" />{countLabel(link.access_count || 0, 'vue', 'vues')}</span>
            {link.last_accessed_at && <span className="whitespace-nowrap">· dernière consultation {relativeDate(link.last_accessed_at)}</span>}
          </div>
          <button
            type="button"
            onClick={handleRevoke}
            disabled={revoking}
            className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-secondary transition-transform duration-200 ease-out hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-200 disabled:opacity-50"
          >
            {revoking ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ShieldOff size={16} aria-hidden="true" />}
            Révoquer
          </button>
        </div>

        {dossiers.length > 1 && <div className="px-4 pt-4"><label htmlFor={referenceField} className="block text-[11px] font-bold uppercase tracking-wider text-gray-600">Dossier de référence</label><select id={referenceField} value={referenceId} onChange={e => setReferenceId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border-2 border-gray-200 bg-elevated px-3 text-sm text-primary"><option value="">Choisir le dossier de cet échange</option>{dossiers.map(c => <option key={c.id} value={c.id}>{c.ref} — {c.desc}</option>)}</select></div>}
        {/* URL display */}
        <div className="space-y-3 px-4 py-4">
          <code className={`block rounded-lg border ${BORDER} bg-surface px-3 py-2.5 font-mono text-sm text-primary [overflow-wrap:anywhere] select-all`}>
            {url}
          </code>

          {/* Action buttons */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button type="button" onClick={handleCopy} disabled={copying} className={`${SECONDARY} brand-t`}>
              {copied ? <Check size={16} strokeWidth={2.5} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copied ? 'Copié' : 'Copier le lien'}
            </button>
            <button
              type="button"
              onClick={handleTelegramShare}
              disabled={sendingTg || Boolean(telegramBlocked)}
              aria-describedby={telegramBlocked ? telegramHint : undefined}
              className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold text-white transition-transform duration-200 ease-out hover:-translate-y-px active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              style={{ background: TELEGRAM_BLUE }}
            >
              {sendingTg ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              {sendingTg ? 'Envoi…' : 'Envoyer via Telegram'}
            </button>
          </div>
          {telegramBlocked && <p id={telegramHint} className="text-sm leading-relaxed text-secondary">{telegramBlocked}</p>}
          <p className="sr-only" aria-live="polite">{copied ? 'Lien copié dans le presse-papiers.' : ''}</p>
        </div>
      </div>
    </Section>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function Section({ children }) {
  return <section aria-labelledby="share-link-title" className="space-y-3">{children}</section>;
}

function SectionHeader() {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 id="share-link-title" className="font-bold text-primary">Partager le suivi avec un proche</h2>
      <span className="text-sm text-secondary">Valable jusqu’à 10 jours après la dernière livraison</span>
    </div>
  );
}

function Explanation() {
  return <p className="text-sm text-secondary">Suivi public destiné aux proches : toute personne possédant ce lien peut consulter l’avancement des dossiers. Il ne donne pas accès à l’espace privé, aux factures ni aux messages.</p>;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function relativeDate(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'à l’instant';
  if (mins < 60) return `il y a ${countLabel(mins, 'minute', 'minutes')}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${countLabel(hrs, 'heure', 'heures')}`;
  return `il y a ${countLabel(Math.floor(hrs / 24), 'jour', 'jours')}`;
}
