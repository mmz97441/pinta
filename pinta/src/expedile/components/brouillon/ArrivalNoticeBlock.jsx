import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Mail, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { deliverMessage } from '../../services/telegramApi';
import { mailtoLink } from '../../utils';
import StagePill from './StagePill';
import { copyText } from './copyText';

/** The draft of an e-mail notice, as the application opens it elsewhere (mailto); a text without its own
 * « Objet : » line keeps its greeting in the body and takes the subject the client sees in the maquette. */
function mailDraftHref(email, text, cartonCount) {
  if (!email || !text) return null;
  if (/^Objet\s*:/.test(text)) return mailtoLink(email, text);
  const subject = cartonCount > 1 ? `Vos ${cartonCount} colis sont arrivés chez Expedîle` : 'Votre colis est arrivé chez Expedîle';
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

function EmailToSend({ notice, client, clientsAllowed }) {
  const field = useRef(null);
  const [feedback, setFeedback] = useState('');
  const href = mailDraftHref(client?.email, notice.text, notice.cartonCount);
  const copy = async () => {
    const copied = await copyText(notice.text || '');
    if (copied) { setFeedback('Texte copié : collez-le dans votre messagerie.'); return; }
    setFeedback('La copie n’est pas possible sur cet appareil : le texte est sélectionné, copiez-le avec le menu de l’appareil.');
    field.current?.focus();
    field.current?.select();
  };
  if (!notice.text) return <p className="m-0 text-[15px]">Le texte de cet avis n’est pas disponible ici. Ouvrez l’écran Avis d’arrivée.</p>;
  return <div className="grid gap-2">
    <div className="grid gap-1">
      <label htmlFor={`avis-texte-${notice.id}`} className="text-[15px] font-bold">Texte de l’avis</label>
      <textarea id={`avis-texte-${notice.id}`} ref={field} readOnly value={notice.text} rows={7} className="fiche-notice-text" />
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={copy} className="colis-secondary"><Copy size={18} aria-hidden="true" />Copier le texte</button>
      {href
        ? <a href={href} className="colis-secondary" data-testid="notice-mail-draft"><Mail size={18} aria-hidden="true" />Ouvrir un brouillon d’e-mail</a>
        : <p className="m-0 self-center text-[15px]">Adresse e-mail du client à renseigner{clientsAllowed && client?.id ? <> · <Link to={`/clients/${encodeURIComponent(client.id)}`} className="colis-link-button">Fiche du client</Link></> : null}.</p>}
    </div>
    <p className="m-0 min-h-[1.4em] text-[15px]" role="status">{feedback}</p>
  </div>;
}

function TelegramRetry({ notice, raw, onDone }) {
  const { can, ask, flash } = useApp();
  const messageId = raw?.message?.id || null;
  // The dossier that carries the notice (list_arrival_notices: message.colisId, the first dossier still requesting
  // its invoice); the first dossier of the reception for an older answer without it.
  const colisId = raw?.message?.colisId || raw?.items?.[0]?.colisId || null;
  const allowed = can('perm_comm_telegram');
  const reason = !allowed ? 'Réservé aux personnes autorisées à écrire sur Telegram.' : !messageId || !colisId ? 'Message introuvable : ouvrez l’écran Avis d’arrivée.' : '';
  const retry = () => ask('Réessayer l’avis d’arrivée', 'Vérifiez dans Telegram que le client n’a pas reçu cet avis, puis confirmez le renvoi.', async () => {
    const result = await deliverMessage(colisId, messageId, { retryConfirmed: true });
    if (!result?.ok) throw new Error(result?.error || 'Telegram n’a pas confirmé l’envoi. L’avis reste à vérifier.');
    flash('Avis d’arrivée envoyé à Telegram');
    onDone?.();
  }, { okLabel: 'Réessayer l’envoi' });
  return <div>
    <button type="button" disabled={Boolean(reason)} aria-describedby={reason ? 'avis-reessayer-raison' : undefined} onClick={retry} className="colis-secondary"><RefreshCw size={18} aria-hidden="true" />{notice.state.action.label}</button>
    {reason && <p id="avis-reessayer-raison" className="colis-reason">{reason}</p>}
  </div>;
}

/** « Avis d’arrivée » of the sheet: the latest notice of the dossier and its state (arrivalNoticeSummary), with
 * what can be done from here: the e-mail to send (text, copy, draft), « Réessayer » for a Telegram notice not
 * delivered or never taken (« Envoi à vérifier »), « Corriger l’adresse » for an e-mail refused. */
export default function ArrivalNoticeBlock({ fiche, raw, client, loading, error, onRetry, onChanged }) {
  const { can } = useApp();
  const clientsAllowed = can('perm_clients_voir') || can('perm_clients_creer');
  const notice = fiche.notice;
  let body;
  if (!notice && error) body = <p className="colis-quiet"><span>L’avis d’arrivée n’a pas pu être chargé ({error}).</span><button type="button" onClick={onRetry} className="colis-link-button">Réessayer</button></p>;
  else if (!notice && loading) body = <p role="status" className="m-0 text-[15px] colis-muted">Chargement de l’avis d’arrivée…</p>;
  else if (!notice) body = <p className="m-0 text-[15px] colis-muted">{fiche.noticeLabel}</p>;
  else {
    const { state } = notice;
    body = <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StagePill stage={state} notice={state.key} />
        <span className="text-[15px]">{[state.canalLabel, notice.dateLabel, notice.dossierCartonsLabel || notice.cartonsLabel].filter(Boolean).join(' · ')}</span>
      </div>
      {state.detail && <p className="m-0 text-[15px] colis-muted">{state.key === 'non_remis' ? `Raison : ${state.detail}` : state.detail}</p>}
      {state.key === 'a_envoyer' && <EmailToSend notice={notice} client={client} clientsAllowed={clientsAllowed} />}
      {['non_remis', 'a_verifier'].includes(state.key) && state.action?.key === 'reessayer' && <TelegramRetry notice={notice} raw={raw} onDone={onChanged} />}
      {state.key === 'non_remis' && state.action?.key === 'corriger_adresse' && (clientsAllowed && client?.id
        ? <div><Link to={`/clients/${encodeURIComponent(client.id)}`} className="colis-secondary">{state.action.label}</Link></div>
        : <p className="colis-reason">Une personne autorisée à modifier les clients doit corriger l’adresse.</p>)}
      {error && <p className="colis-quiet"><span>Dernière vérification impossible ({error}).</span><button type="button" onClick={onRetry} className="colis-link-button">Réessayer</button></p>}
    </div>;
  }
  return <section className="fiche-card" aria-labelledby="fiche-avis" data-testid="fiche-avis">
    <h2 id="fiche-avis">Avis d’arrivée</h2>
    {body}
    {/* The state that changes (a retry, a delivery confirmed by the next read) is announced alone, not the text. */}
    <p className="sr-only" aria-live="polite">{notice ? `Avis d’arrivée : ${notice.state.label}` : ''}</p>
  </section>;
}
