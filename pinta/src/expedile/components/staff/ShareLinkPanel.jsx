import React, { useState, useEffect, useCallback } from 'react';
import {
  Link2, Copy, Check, Send, ShieldOff, Eye, Sparkles,
  Loader2, AlertCircle, RefreshCw,
} from 'lucide-react';
import { BRAND } from '../../constants';
import * as sb from '../../lib/supabaseData';
import { sendTelegram } from '../../services/telegramApi';

/**
 * ShareLinkPanel — gestion du lien de suivi partagé pour un client.
 *
 * États :
 *   - loading      : chargement initial
 *   - none         : aucun lien créé
 *   - active       : lien actif (token valide, non révoqué)
 *   - revoked      : lien révoqué
 *
 * Actions staff :
 *   - Créer le lien
 *   - Copier dans le presse-papier
 *   - Partager via Telegram (si client.telegramChatId)
 *   - Révoquer (avec confirmation)
 */
export default function ShareLinkPanel({ client, currentUserId, flash, ask }) {
  const [link, setLink] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sendingTg, setSendingTg] = useState(false);
  const [revoking, setRevoking] = useState(false);

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
  const isActive = link && !link.revoked_at;
  const isRevoked = link && !!link.revoked_at;

  const handleCreate = async () => {
    setCreating(true);
    try {
      const newLink = await sb.createShareLink(client.id, currentUserId);
      setLink(newLink);
      flash?.({ msg: 'Lien de suivi créé', type: 'success' });
    } catch (e) {
      flash?.({ msg: 'Erreur création : ' + e.message, type: 'warning' });
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
      flash?.({ msg: 'Impossible de copier', type: 'warning' });
    } finally {
      setCopying(false);
    }
  };

  const handleTelegramShare = async () => {
    if (!client?.telegramChatId) {
      flash?.({ msg: 'Client non lié à Telegram', type: 'warning' });
      return;
    }
    if (!url) return;
    setSendingTg(true);
    const prenom = (client.prenom || (client.nom || '').split(' ')[0]) || 'bonjour';
    const message = `Bonjour ${prenom} 👋\n\nVoici votre *lien de suivi en temps réel* à partager avec votre famille :\n\n${url}\n\nIls pourront suivre l'avancement de chaque colis sans créer de compte.\n\n_L'équipe Expedîle_`;
    const res = await sendTelegram(client.telegramChatId, message);
    setSendingTg(false);
    if (res.ok) flash?.({ msg: 'Lien envoyé via Telegram', type: 'success' });
    else flash?.({ msg: 'Échec envoi Telegram : ' + (res.error || ''), type: 'warning' });
  };

  const handleRevoke = () => {
    if (!ask) {
      // Fallback : confirm natif
      if (!confirm('Révoquer ce lien ? Le destinataire ne pourra plus accéder au suivi.')) return;
      doRevoke();
      return;
    }
    ask(
      'Révoquer le lien',
      'Le destinataire ne pourra plus accéder au suivi via ce lien. Vous pourrez en créer un nouveau ensuite.',
      doRevoke,
      { danger: true, okLabel: 'Révoquer' },
    );
  };

  const doRevoke = async () => {
    setRevoking(true);
    try {
      await sb.revokeShareLink(link.id);
      await reload();
      flash?.({ msg: 'Lien révoqué', type: 'success' });
    } catch (e) {
      flash?.({ msg: 'Erreur : ' + e.message, type: 'warning' });
    } finally {
      setRevoking(false);
    }
  };

  // ── Loading skeleton ────────────────────────────────────────────────
  if (loading) {
    return (
      <Section>
        <div className="space-y-2.5">
          <div className="h-3 w-32 rounded bg-slate-100 animate-pulse" />
          <div className="h-10 rounded-xl bg-slate-100 animate-pulse" />
          <div className="flex gap-2">
            <div className="h-9 w-28 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-9 w-28 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        </div>
      </Section>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <Section>
        <div className="flex items-start gap-2.5 text-rose-700 bg-rose-50/60 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">Lien indisponible</p>
            <p className="text-[11px] text-rose-600 mt-0.5">{error}</p>
          </div>
          <button onClick={reload} className="text-xs font-bold underline hover:no-underline">Réessayer</button>
        </div>
      </Section>
    );
  }

  // ── Empty state : aucun lien ────────────────────────────────────────
  if (!link) {
    return (
      <Section>
        <SectionHeader />
        <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50/40 to-white px-5 py-6">
          <div className="flex items-start gap-4">
            <div
              className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
              style={{ background: `${BRAND.navy}0d`, color: BRAND.navy }}
            >
              <Link2 size={18} strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 leading-snug">
                Pas encore de lien de suivi
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed mt-1 max-w-md">
                Générez un lien unique que <span className="font-semibold text-slate-700">{client.prenom || client.nom}</span> pourra partager
                avec sa famille. Suivi en temps réel, sans compte requis.
              </p>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="mt-3.5 inline-flex items-center gap-1.5 text-xs font-bold text-white px-3.5 py-2 rounded-xl transition-all duration-200 ease-out hover:translate-y-[-1px] active:translate-y-0 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: BRAND.navy, boxShadow: `0 4px 14px -4px ${BRAND.navy}60` }}
              >
                {creating
                  ? <><Loader2 size={13} className="animate-spin" />Création…</>
                  : <><Sparkles size={13} strokeWidth={2.25} />Créer le lien de suivi</>
                }
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
        <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
              <ShieldOff size={14} className="text-slate-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">Lien révoqué</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {formatDate(link.revoked_at)} · {link.access_count || 0} consultation{link.access_count > 1 ? 's' : ''} avant révocation
              </p>
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white px-3.5 py-2.5 rounded-xl transition-all duration-200 hover:translate-y-[-1px] active:scale-[0.98] disabled:opacity-60"
            style={{ background: BRAND.navy }}
          >
            {creating ? <><Loader2 size={13} className="animate-spin" />Création…</> : <><RefreshCw size={13} />Générer un nouveau lien</>}
          </button>
        </div>
      </Section>
    );
  }

  // ── Active ──────────────────────────────────────────────────────────
  return (
    <Section>
      <SectionHeader />

      <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden">
        {/* Status bar */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 whitespace-nowrap">
              Actif
            </span>
            <span className="text-[11px] text-slate-400">·</span>
            <span className="text-[11px] text-slate-500 inline-flex items-center gap-1 whitespace-nowrap">
              <Eye size={10} />
              {link.access_count || 0} {link.access_count === 1 ? 'vue' : 'vues'}
            </span>
            {link.last_accessed_at && (
              <span className="text-[11px] text-slate-400 hidden sm:inline whitespace-nowrap">
                · {relativeDate(link.last_accessed_at)}
              </span>
            )}
          </div>
          <button
            onClick={handleRevoke}
            disabled={revoking}
            className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 transition-colors inline-flex items-center gap-1 disabled:opacity-50 whitespace-nowrap"
          >
            {revoking ? <Loader2 size={11} className="animate-spin" /> : <ShieldOff size={11} />}
            Révoquer
          </button>
        </div>

        {/* URL display */}
        <div className="px-5 py-4 space-y-3">
          <div className="group relative">
            <code className="block text-[11px] font-mono text-slate-700 bg-slate-50/60 rounded-lg px-3 py-2.5 pr-12 border border-slate-200/60 truncate select-all">
              {url}
            </code>
            <button
              onClick={handleCopy}
              disabled={copying}
              title="Copier le lien"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center transition-all duration-200 hover:bg-white hover:shadow-sm active:scale-90"
              style={{ color: copied ? '#059669' : BRAND.navy }}
            >
              {copied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={13} strokeWidth={2} />}
            </button>
            {copied && (
              <span className="absolute -top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 animate-in fade-in slide-in-from-top-1 duration-200">
                Copié
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={handleCopy}
              disabled={copying}
              className="inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition-all"
              style={{ color: BRAND.navy }}
            >
              {copied ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} />}
              {copied ? 'Copié' : 'Copier le lien'}
            </button>
            <button
              onClick={handleTelegramShare}
              disabled={sendingTg || !client?.telegramChatId}
              title={!client?.telegramChatId ? 'Client non lié à Telegram' : 'Envoyer au client via Telegram'}
              className="inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-xl text-white transition-all hover:translate-y-[-1px] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 whitespace-nowrap"
              style={{ background: '#0088cc' }}
            >
              {sendingTg ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {sendingTg ? 'Envoi…' : 'Envoyer via Telegram'}
            </button>
          </div>
          {!client?.telegramChatId && (
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Le client doit envoyer <code className="text-[10px] font-mono bg-slate-100 px-1 py-0.5 rounded">/start</code> à @Expedilebot pour activer le partage Telegram.
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function Section({ children }) {
  return <div className="space-y-3">{children}</div>;
}

function SectionHeader() {
  return (
    <div className="flex items-baseline justify-between">
      <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
        Lien de suivi partagé
      </h3>
      <span className="text-[10px] text-slate-400">expire 10j après livraison</span>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function relativeDate(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'à l\'instant';
  if (mins < 60) return `il y a ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `il y a ${days}j`;
}
