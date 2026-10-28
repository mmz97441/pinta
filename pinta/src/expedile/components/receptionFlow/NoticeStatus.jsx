import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Mail, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { arrivalNoticeState, arrivalNoticeSummary } from '../../domain/brouillon';
import { deliverMessage } from '../../services/telegramApi';
import { Note } from './ReceptionParts';
import { count, firstName, noticeMailto, parisWhen } from './receptionFlowModel';

// The state of an arrival notice (arrivalNoticeState) and its one action: « Réessayer » for a Telegram notice not
// delivered (after checking in Telegram: retryConfirmed) or never taken by the automatic sending (« Envoi à
// vérifier »), « Copier le texte » and the e-mail ready in the mail app for an e-mail to send by hand, « Corriger
// l’adresse » for an e-mail refused. Nothing is ever sent again on its own.
const TONES = { envoye: 'success', remis: 'success', a_envoyer: 'warning', a_verifier: 'warning', non_remis: 'danger', en_cours: 'info', sans_avis: 'neutral', annule: 'neutral' };
const PILLS = { envoye: 'done', remis: 'done', a_envoyer: 'todo', a_verifier: 'check', non_remis: 'alert', en_cours: 'wait', sans_avis: 'neutral', annule: 'neutral' };

export function NoticePill({ state }) {
  return <span className={`rf-pill rf-pill--${PILLS[state.key] || 'neutral'}`}>{state.label}</span>;
}

/** The dossier holding the notice's message: the first of its reception (validate_reception queues it there). */
const messageDossier = notice => notice?.message?.colisId || notice?.items?.[0]?.colisId || null;
const cartonCountOf = notice => Array.isArray(notice?.cartons) ? notice.cartons.length : 0;

export function NoticeActions({ notice, client, onChanged, compact = false, now }) {
  const { can } = useApp();
  const state = arrivalNoticeState(notice, { now });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [showText, setShowText] = useState(false);
  if (!state) return null;
  const text = notice.message?.texte || '';
  const action = state.action?.key;

  const retry = async () => {
    if (busy) return;
    setBusy(true); setFeedback(null);
    const still = state.key === 'a_verifier' ? 'Message toujours pas envoyé' : 'Message toujours non remis';
    try {
      const result = await deliverMessage(messageDossier(notice), notice.message?.id, { retryConfirmed: true });
      setFeedback(result?.ok ? { tone: 'success', text: 'Telegram a confirmé l’envoi.' }
        : { tone: 'danger', text: `${still} : ${String(result?.error || 'Telegram n’a pas confirmé l’envoi').replace(/[.\s]+$/, '')}.` });
    } catch (error) {
      setFeedback({ tone: 'danger', text: `${still} : ${error.message || 'réseau indisponible'}.` });
    } finally {
      setBusy(false);
      onChanged?.();
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback({ tone: 'success', text: client?.email ? `Texte copié : collez-le dans un e-mail à ${client.email}.` : 'Texte copié.' });
    } catch {
      setShowText(true);
      setFeedback({ tone: 'danger', text: 'Copie impossible : sélectionnez le texte ci-dessous pour le copier.' });
    }
  };

  const buttons = [];
  if (action === 'reessayer' && notice.message?.id) {
    if (can('perm_comm_telegram')) buttons.push(<button key="retry" type="button" onClick={retry} disabled={busy} className="rf-small-action inline-flex items-center gap-2 whitespace-nowrap"><RefreshCw size={18} aria-hidden="true" />{busy ? 'Envoi…' : 'Réessayer l’envoi'}</button>);
  }
  if (action === 'copier_texte' && text) {
    buttons.push(<button key="copy" type="button" onClick={copy} className="rf-small-action inline-flex items-center gap-2 whitespace-nowrap"><Copy size={18} aria-hidden="true" />Copier le texte</button>);
    const mailto = noticeMailto(client?.email, cartonCountOf(notice), text);
    if (mailto) buttons.push(<a key="mail" href={mailto} className="rf-small-action inline-flex items-center gap-2 whitespace-nowrap"><Mail size={18} aria-hidden="true" />Préparer l’e-mail</a>);
  }
  if (action === 'corriger_adresse' && notice.clientId) buttons.push(<Link key="fix" to={`/clients/${encodeURIComponent(notice.clientId)}?completer=email`} className="rf-small-action inline-flex items-center gap-2 whitespace-nowrap">Corriger l’adresse</Link>);

  // A notice never taken by the automatic sending has not left: it can be sent now (once what holds it back, if
  // anything, is settled). A refused one may have arrived.
  const hint = action === 'reessayer'
    ? !can('perm_comm_telegram') ? 'Un collègue autorisé à écrire sur Telegram peut réessayer l’envoi.'
      : state.key !== 'a_verifier' ? 'Avant de réessayer, vérifiez dans Telegram que le message n’est pas arrivé.'
        : notice.outbox?.status === 'blocked' ? 'Réglez d’abord ce qui retient l’envoi, puis réessayez.' : 'Il n’est jamais parti : vous pouvez l’envoyer maintenant.'
    : null;
  if (!buttons.length && !hint && !(compact && text)) return null;
  return <div className="space-y-2">
    {hint && <p className={`${compact ? 'rf-muted ' : ''}text-[15px]`}>{hint}</p>}
    {buttons.length > 0 && <div className="flex flex-wrap gap-2">{buttons}</div>}
    {feedback && <p role="status" className={`text-[15px] font-semibold ${feedback.tone === 'danger' ? 'rf-error' : ''}`}>{feedback.text}</p>}
    {text && (action === 'copier_texte' || compact) && <details open={showText} onToggle={event => setShowText(event.currentTarget.open)}>
      <summary className="rf-strong min-h-11 cursor-pointer py-2.5 text-[16px] font-semibold">Voir le texte de l’avis</summary>
      <pre className="rf-message rf-card mt-1 rounded-xl p-3">{text}</pre>
    </details>}
  </div>;
}

/** The notice of the reception just validated, in a coloured box. */
export function NoticeCard({ notice, client, delivery, onChanged, onRefresh, refreshing = false, now }) {
  const state = arrivalNoticeState(notice, { now });
  if (!state) return null;
  const summary = arrivalNoticeSummary(notice, { now });
  const name = firstName(client);
  const colis = count(summary.cartonCount, 'colis', 'colis');
  const sentAt = parisWhen(notice.outbox?.sentAt);
  const titles = {
    envoye: `${state.canal === 'email' ? 'E-mail envoyé' : 'Message Telegram envoyé'} à ${name} · ${colis}`,
    remis: `Avis remis à ${name} · ${colis}`,
    en_cours: `Envoi en cours à ${name} · ${colis}`,
    a_verifier: `Envoi à vérifier pour ${name} · ${colis}`,
    a_envoyer: `E-mail à envoyer à ${name} · ${colis}`,
    non_remis: `Avis non remis à ${name}`,
    annule: `Envoi annulé · ${colis}`,
    sans_avis: 'Réception validée sans avis : le client n’est pas prévenu',
  };
  const details = {
    envoye: state.canal === 'telegram' && sentAt ? `Telegram a confirmé l’envoi ${sentAt}.` : `${state.detail}.`,
    a_envoyer: 'L’envoi automatique des e-mails n’est pas encore branché : copiez le texte et envoyez-le depuis votre messagerie.',
    en_cours: `Le message part dans quelques instants.${delivery && !delivery.ok && delivery.error ? ` Telegram n’a pas encore confirmé l’envoi : ${String(delivery.error).replace(/[.\s]+$/, '')}.` : ''} Son état se suit dans « Avis d’arrivée ».`,
    a_verifier: state.detail,
    non_remis: `Raison : ${state.reason || state.detail}.`,
  };
  return <Note tone={TONES[state.key] || 'neutral'} role="status" title={titles[state.key] || state.label}
    action={['en_cours', 'a_verifier'].includes(state.key) && onRefresh ? <button type="button" className="rf-small-action inline-flex items-center gap-2 whitespace-nowrap" onClick={onRefresh} disabled={refreshing}><RefreshCw size={18} aria-hidden="true" />{refreshing ? 'Actualisation…' : 'Actualiser'}</button> : null}>
    {details[state.key] && <p>{details[state.key]}</p>}
    <div className={details[state.key] ? 'mt-2' : ''}><NoticeActions notice={notice} client={client} onChanged={onChanged} now={now} /></div>
  </Note>;
}

export const noticeTone = key => TONES[key] || 'neutral';
