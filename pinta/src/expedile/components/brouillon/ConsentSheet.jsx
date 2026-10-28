import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { UserRound, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { clientDisplayName } from '../../domain/clientGroups';
import { useDialog } from '../ui/useDialog';
import TaskMessage from '../staff/TaskMessage';
import { actionAllowed } from './colisLinks';

// The message of « Demander l’accord » and « Relancer », opened from « Colis » or a Brouillon sheet: one sheet for the
// page (a side sheet on a tablet, from the bottom on a phone), whatever happens to the line that opened it.

// The message each action prepares: the relance is offered only while the dossier's action is « Relancer ».
const TEMPLATES = { demander_accord: 'demande_feu_vert', relancer: 'relance_feu_vert' };
// A message is sent once Telegram confirms it (outbox « sent », message « envoye »…), placed in the client space
// (« sent ») or left as an e-mail draft to send by hand (« manual »).
const CONFIRMED_OUTBOX = new Set(['sent', 'manual']);
const DELIVERED = new Set(['envoye', 'distribue', 'lu']);
// queue_message refuses a task a colleague holds (_assert_staff_task_owner, 40001); nothing is recorded then.
const HELD_REFUSAL = /^Cette tâche est suivie par (.+?)\.\s/;

/** The template the current action of a dossier opens here, or null. */
export function sheetTemplate(action) {
  return TEMPLATES[action?.key] || null;
}

function confirmationText(message, template) {
  const relance = template === 'relance_feu_vert';
  if (message.canal === 'email') return relance ? 'Relance prête dans votre messagerie : envoyez-la depuis celle-ci' : 'Demande d’accord prête dans votre messagerie : envoyez-la depuis celle-ci';
  if (message.canal === 'portal') return relance ? 'Relance déposée dans l’espace client' : 'Demande d’accord déposée dans l’espace client';
  return relance ? 'Relance envoyée : Telegram a confirmé' : 'Demande d’accord envoyée : Telegram a confirmé';
}

const latestOf = messages => messages.reduce((best, message) => !best || String(message.createdAt || '') >= String(best.createdAt || '') ? message : best, null);

/**
 * The sheet of a dossier's consent message (TaskMessage, as its accord task shows it): `action` is the dossier's
 * current action, `held` the colleague holding its task (`stage.heldBy`). TaskMessage reads the selected dossier:
 * the page selects it before opening the sheet.
 * - An attempt (its first « Envoyer ») is followed in the dossier's messages: once the message is confirmed,
 *   `onSent(text)` (the page closes the sheet and says it on the line). Until then the same TaskMessage instance
 *   (and its key) stays, whatever the step became, so « Réessayer cet envoi » keeps its exact message.
 * - A colleague's task: said, with the way to the dossier, and no message to send; a refusal of queue_message for
 *   that reason replaces the message (its « Réessayer » would fail the same way).
 * - A client without Telegram, e-mail or client space: said, with the way to the client's record.
 */
export default function ConsentSheet({ id: givenId, dossierId, title, action, held = null, returnHref, clientHref, onClose, onSent }) {
  const { sel, selClient, can, demanderFeuVert, toast, refreshWork, ask } = useApp();
  const generatedId = `feuille-${useId().replace(/:/g, '')}`;
  const id = givenId || generatedId;
  const titleId = `${id}-titre`;
  const ready = sel?.id === dossierId;
  const [attempt, setAttempt] = useState(null);
  const [refused, setRefused] = useState(null);
  const attemptRef = useRef(null);
  const messages = ready && Array.isArray(sel.messages) ? sel.messages.filter(Boolean) : [];
  const knownIds = useRef(null);
  if (ready && !knownIds.current) knownIds.current = new Set(messages.map(message => message.id));
  // The message this attempt recorded (queue_message: a message absent when the sheet opened), and its delivery.
  const queued = attempt ? messages.filter(message => !attempt.known.has(message.id) && message.type !== 'client' && message.template === attempt.template) : [];
  const recorded = latestOf(queued);
  const confirmed = Boolean(recorded && (CONFIRMED_OUTBOX.has(recorded.outboxStatus) || DELIVERED.has(recorded.statut)));
  const live = useRef({});
  live.current = { attempt, recorded, confirmed, onSent, onClose };

  const start = useCallback(template => {
    if (attemptRef.current) return; // « Réessayer cet envoi »: the same attempt
    const next = { template, known: knownIds.current || new Set() };
    attemptRef.current = next;
    setAttempt(next);
    setRefused(null);
  }, []);

  // Sent: once, the page closes the sheet and says it on the line.
  const said = useRef(false);
  useEffect(() => {
    if (!confirmed || said.current) return;
    said.current = true;
    live.current.onSent?.(confirmationText(live.current.recorded, live.current.attempt.template));
  }, [confirmed]);

  // A refusal because a colleague holds the task (the error TaskMessage shows comes from queue_message).
  const lastToast = useRef(toast);
  useEffect(() => {
    const previous = lastToast.current;
    lastToast.current = toast;
    if (!attemptRef.current || !toast || toast === previous || typeof toast !== 'object' || toast.type !== 'error') return;
    const match = HELD_REFUSAL.exec(String(toast.msg || ''));
    if (!match) return;
    setRefused({ name: match[1], recorded: Boolean(live.current.recorded) });
    attemptRef.current = null;
    setAttempt(null);
    // The list then says who holds the task (stage.heldBy).
    refreshWork?.().catch(() => {});
  }, [toast, refreshWork]);

  // Closing while a send is not confirmed loses « Réessayer cet envoi »: asked first.
  const unconfirmed = Boolean(attempt) && !confirmed;
  const pending = useRef(false);
  pending.current = unconfirmed;
  const requestClose = useCallback(() => {
    if (!pending.current) { live.current.onClose?.(); return; }
    ask('Fermer sans confirmation de l’envoi ?', 'Ce message n’est pas confirmé. Après fermeture, « Réessayer cet envoi » ne sera plus proposé ici : vérifiez les échanges du dossier avant un nouvel envoi.',
      () => live.current.onClose?.(), { okLabel: 'Fermer quand même' });
  }, [ask]);
  const dialogRef = useDialog(true, requestClose);

  const template = attempt?.template || sheetTemplate(action);
  // The action as it is now; once it has moved on, the right its attempt was started with.
  const allowed = actionAllowed(action || { key: template === 'relance_feu_vert' ? 'relancer' : 'demander_accord', permissions: ['perm_colis_demander_feuvert'] }, can);
  // TaskMessage's channels: Telegram linked, an e-mail address, the client space.
  const noChannel = Boolean(selClient) && !['telegramChatId', 'email', 'userId'].some(key => Boolean(selClient[key]));
  const holder = refused?.name || (!attempt && held ? String(held.name || '').trim() || 'Un collègue' : null);
  // The client's name as the lines show it.
  const clientName = clientDisplayName(selClient) || 'Ce client';

  let content;
  if (!ready) content = <p role="status" className="m-0 text-[16px] colis-muted">Ouverture du message…</p>;
  else if (holder) content = <div className="grid gap-3" data-testid="feuille-collegue">
    <p className="colis-held-notice"><UserRound size={20} aria-hidden="true" className="shrink-0" />
      <span>{refused ? refused.recorded
        ? `${holder} suit maintenant l’accord de ce dossier : le message enregistré n’est pas confirmé. Vérifiez son envoi dans le dossier.`
        : `Le message n’a pas été envoyé : ${holder} suit l’accord de ce dossier. Rien n’est parti chez le client.`
        : `${holder} s’occupe de l’accord de ce dossier : le message part de son côté.`}</span></p>
    <p className="m-0 text-[16px]">Pour reprendre la main, demandez-lui un relais depuis le dossier.</p>
    {returnHref && <Link to={returnHref} className="colis-secondary">Ouvrir l’accord du client</Link>}
  </div>;
  else if (template && (attempt || !noChannel)) {
    const common = { key: `consent-${template}-${dossierId}`, template, autoPreview: true, disabled: !allowed };
    content = template === 'demande_feu_vert'
      ? <TaskMessage {...common} sendLabel="Envoyer la demande d’accord" label="Préparer la demande au client"
        beforeSend={options => { start('demande_feu_vert'); return demanderFeuVert(sel.id, options); }} />
      : <TaskMessage {...common} label="Préparer une relance" beforeSend={() => { start('relance_feu_vert'); return true; }} />;
  } else if (template) content = <div className="grid gap-3" data-testid="feuille-sans-canal">
    <p className="m-0 text-[16px]"><strong>{clientName}</strong> ne peut pas encore recevoir ce message : ni Telegram relié, ni adresse e-mail, ni espace client.</p>
    <p className="m-0 text-[16px] colis-muted">Ajoutez son adresse e-mail ou invitez-le sur Telegram depuis sa fiche, puis revenez ici.</p>
    {clientHref
      ? <Link to={clientHref} className="colis-secondary">Ouvrir la fiche de {clientName}</Link>
      : <p className="colis-reason">Une personne autorisée à modifier les clients doit ajouter un moyen de contact.</p>}
  </div>;
  else content = <div className="grid gap-3">
    <p className="m-0 text-[16px]">L’étape de ce dossier a changé : ce message n’est plus à envoyer d’ici.</p>
    {returnHref && <Link to={returnHref} className="colis-secondary">Ouvrir l’accord du client</Link>}
  </div>;

  return createPortal(<div className="colis-page colis-sheet-layer">
    <div className="colis-sheet-backdrop" aria-hidden="true" onClick={requestClose} />
    <section ref={dialogRef} id={id} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="colis-sheet" data-testid="colis-feuille">
      <div className="colis-sheet-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" onClick={requestClose} className="colis-secondary shrink-0"><X size={18} aria-hidden="true" />Fermer</button>
      </div>
      <div className="colis-sheet-body">{content}</div>
    </section>
  </div>, document.body);
}
