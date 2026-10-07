import useWorkDraft from '../../hooks/useWorkDraft';
import React, { Suspense, lazy, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Send, MessageCircle, ChevronDown, Check, CheckCheck, Clock, AlertCircle, MoreHorizontal, PenLine } from 'lucide-react';
import usePersistentDraft from '../../hooks/usePersistentDraft';
import { useApp } from '../../context/AppContext';
import { deliverMessage } from '../../services/telegramApi';
import { BRAND } from '../../constants';
import * as sb from '../../lib/supabaseData';
import { setConversationState, markVisibleMessagesRead } from '../../services/conversationApi';
import { CONVERSATION_STATES, conversationState, conversationLabel, messageDeliveryLabel } from '../../domain/conversations';
import { CHANNEL_LABELS, clientDisplayName, conversationClock, conversationDay, conversationDayKey, linkLabel, messageRecordedByTeam, textWithLinks } from '../../domain/conversationList';
import { supabase } from '../../lib/supabase';
import { staffName } from '../workspace/WorkActionRow';
import { invoicesEditable } from '../../domain/invoiceLock';
import useQuoteWithdrawal from '../../hooks/useQuoteWithdrawal';
import './chatThread.css';

const AttachmentPDFPreview = lazy(() => import('../ui/PDFPreview'));

// Array.prototype.findLast and toSorted are missing from Safari 14, the declared build target.
function lastWhere(list, predicate) {
  for (let index = list.length - 1; index >= 0; index -= 1) if (predicate(list[index])) return list[index];
  return undefined;
}
/** The open conversation task of a dossier, else the latest closed one. */
function conversationTask(actions) {
  return actions.find(action => action.state !== 'done')
    || actions.reduce((latest, action) => !latest || Date.parse(action.updated_at) > Date.parse(latest.updated_at) ? action : latest, undefined);
}

// Same freeze evidence as the server (D4): payment amount or date, departure, closing.
export function conversationInvoiceEditable(colis) {
  return invoicesEditable(colis);
}

// Pure rules shared with the dossier overview (domain/invoiceDocuments).
import { conversationAttachmentImported, pendingInvoiceAttachments } from '../../domain/invoiceDocuments';
export { conversationAttachmentImported, pendingInvoiceAttachments };

export function ConversationAttachment({ message, colis, lock = null, canImport, onImported, importLabel = 'Utiliser comme facture', preview = false }) {
  const [url, setUrl] = useState('');
  const [fileError, setFileError] = useState('');
  const [fileAttempt, setFileAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [saved, setSaved] = useState(false);
  const [savedText, setSavedText] = useState('Facture ajoutée, à vérifier dans Documents.');
  const { guard } = useQuoteWithdrawal(colis, lock, { report: text => setError(text) });
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const path = message.attachmentPath || message.attachment_path;
  const name = message.attachmentName || message.attachment_name || 'Télécharger le document';
  const type = message.attachmentType || message.attachment_type || '';
  const pdf = type === 'application/pdf' || /\.pdf$/i.test(name);
  const image = type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(name);
  const imported = saved || conversationAttachmentImported(message, colis);
  const importAllowed = canImport && conversationInvoiceEditable(colis) && !imported;
  useEffect(() => {
    let active = true;
    setUrl(''); setFileError('');
    if (path) sb.signedFileUrl('factures', path).then(value => { if (active) setUrl(value); }).catch(err => { if (active) setFileError(err.message || 'Document indisponible.'); });
    return () => { active = false; };
  }, [path, fileAttempt]);
  const previewRef = useRef(null);
  // An opened preview is brought on screen: the PDF reader loads only once visible.
  useEffect(() => { if (showPreview) previewRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [showPreview]);
  if (!path) return null;
  // withdrawal: the result of « Retirer le devis et ajouter la facture » (D2 +
  // D3), which already imported the invoice and queued the client message.
  const importInvoice = async (refreshOnly = false, withdrawal = null) => {
    if (busyRef.current || (!refreshOnly && !withdrawal && !importAllowed)) return;
    busyRef.current = true; setBusy(true); setError('');
    let invoiceSaved = refreshOnly || !!withdrawal;
    try {
      if (withdrawal) {
        setSaved(true);
        setSavedText(['sent', 'portal'].includes(withdrawal.message?.status) ? 'Facture ajoutée, devis retiré. Client prévenu.' : 'Facture ajoutée, devis retiré. Message au client à envoyer depuis la conversation.');
      } else if (!refreshOnly) {
        const { error: rpcError } = await supabase.rpc('import_conversation_invoice', { p_message_id: message.id });
        if (rpcError) throw rpcError;
        invoiceSaved = true; setSaved(true);
      }
      await onImported?.(colis.id); setNeedsRefresh(false);
    } catch (err) {
      // Raised again for the guard: a locked quote opens the withdrawal dialog.
      if (!invoiceSaved && err?.hint === 'quote_withdrawal_required') throw err;
      setNeedsRefresh(invoiceSaved);
      setError(invoiceSaved ? `Facture enregistrée. Actualisation impossible : ${err.message}` : err.message || 'Ajout impossible. Réessayez.');
    } finally { busyRef.current = false; setBusy(false); }
  };
  const importGuarded = () => {
    if (busyRef.current || !importAllowed) return;
    guard('import_attachment', () => importInvoice(), { messageId: message.id, afterWithdrawal: result => importInvoice(false, result) }).catch(err => setError(err.message || 'Ajout impossible. Réessayez.'));
  };
  return <div className="mt-2 min-w-0 space-y-2 border-t border-current/20 pt-2">
    {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center break-all underline">{name}</a> : !fileError && <span role="status">Préparation du document…</span>}
    {fileError && <div role="alert"><p>{fileError}</p><button onClick={() => setFileAttempt(value => value + 1)} className="min-h-11 font-semibold underline">Réessayer l’ouverture du document</button></div>}
    {preview && url && (pdf || image) && <div><button onClick={() => setShowPreview(value => !value)} aria-expanded={showPreview} className="min-h-11 rounded-lg border border-current px-3 text-xs font-semibold">{showPreview ? 'Fermer l’aperçu' : 'Voir l’aperçu'}</button>{showPreview && <div ref={previewRef} className="mt-2 min-w-0">{pdf ? <Suspense fallback={<p role="status">Chargement du lecteur PDF…</p>}><AttachmentPDFPreview url={url} title={name} /></Suspense> : <img src={url} alt={name} className="max-h-96 max-w-full rounded-lg object-contain" />}</div>}</div>}
    {importAllowed && <button disabled={busy} onClick={importGuarded} className="block min-h-11 rounded-lg border border-current px-3 text-xs font-semibold">{busy ? 'Import…' : importLabel}</button>}
    {imported && <p role="status">{saved ? savedText : 'Document déjà présent dans les factures.'}</p>}
    {error && <p role="alert">{error}</p>}
    {needsRefresh && <button disabled={busy} onClick={() => importInvoice(true)} className="min-h-11 font-semibold underline">Réessayer l’actualisation</button>}
  </div>;
}

// ── Status indicator (Telegram-style) ────────────────────────────────────────
function MsgStatut({ statut, canal }) {
  if (!statut) return null;
  // No business e-mail provider is connected: an e-mail stays a manual draft.
  const manualDraft = canal === 'email' && statut === 'envoi';
  const label = messageDeliveryLabel({ statut, canal });
  let icon;
  switch (statut) {
    case 'envoi':
      icon=manualDraft ? <PenLine size={13} /> : <Clock size={13} />;break;
    case 'envoye':
      icon=<Check size={13} />;break;
    case 'distribue':
      icon=<CheckCheck size={13} />;break;
    case 'lu':
      icon=<CheckCheck size={13} />;break;
    case 'echec':
      icon=<AlertCircle size={13} />;break;
    case 'en_attente':
      icon=<Clock size={13} />;break;
    default:
      icon=null;
  }
  return <span className="inline-flex items-center gap-1 text-xs">{icon}{label}</span>;
}

// ownership: the caller's task ownership (TaskOwnership compact), shown in the
// status bar. Without it, the bar names the person following the conversation.
export default function ChatPanel({ colis, client, embedded = false, active = true, ownership = null }) {
  const { sel: contextSel, selClient: contextClient, isStaff, auth, envMsg, setData, flash, ask, refreshColis, refreshWork, can, teamUsers=[], workActions=[] } = useApp();
  const sel = colis || contextSel;
  const selClient = client || contextClient;
  const [msgTxt, setMsgTxt, draft] = usePersistentDraft(sel?.id ? `conversation:${sel.id}` : null, '');
  const [sendAttempt, setSendAttempt, attemptDraft] = usePersistentDraft(sel?.id ? `conversation-send:${sel.id}` : null, null);
  const clearWorkDraft = useWorkDraft({ userId: auth?.u?.id, dossierId: sel?.id, kind: 'conversation', source: 'reply', dirty: isStaff && Boolean(msgTxt.trim()), label: 'brouillon de réponse au client' });
  const [sendError, setSendError] = useState('');
  const [sendResult, setSendResult] = useState('');
  const sendGuard = useRef(false);
  const currentDossier = useRef(sel?.id); currentDossier.current = sel?.id;
  useEffect(() => { setSendError(''); setSendResult(''); }, [sel?.id]);
  const [sending,setSending] = useState(false);
  const [changingState,setChangingState] = useState(false);
  const hasMsg = sel?.messages?.length > 0;
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);
  const moreRef = useRef(null);
  const moreButtonRef = useRef(null);
  const replyRef = useRef(null);

  // The conversation menu closes like a popover: outside press or Escape.
  useEffect(() => {
    if (!moreOpen) return undefined;
    const outside = event => { if (!moreRef.current?.contains(event.target)) setMoreOpen(false); };
    const escape = event => { if (event.key !== 'Escape') return; setMoreOpen(false); moreButtonRef.current?.focus(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [moreOpen]);

  // The staff reply grows with its text up to its CSS maximum, then scrolls.
  // A hidden tab has no layout: it is measured again when it becomes visible.
  useLayoutEffect(() => {
    const field = replyRef.current;
    if (!field?.getClientRects().length) return;
    field.style.height = '';
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  }, [msgTxt, active]);

  // Auto-expand only when there are messages
  useEffect(() => {
    setExpanded(hasMsg);
  }, [hasMsg]);

  useEffect(() => {
    if (!isStaff || !active || !sel?.messages?.some(m=>m.type==='client'&&!m.lu)) return;
    const id=sel.id;
    markVisibleMessagesRead(sel).then((ids)=>setData(prev=>prev.map(c=>c.id===id?{...c,messages:c.messages.map(m=>ids.includes(m.id)?{...m,lu:true}:m)}:c)))
      .catch(error=>flash({msg:error.message,type:'error'}));
  },[active,sel?.id,isStaff,sel?.messages?.length]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [expanded, sel?.messages?.length]);

  if (!sel) return null;

  const handleSend = async () => {
    if (!msgTxt.trim() || sending || sendGuard.current) return;
    if (isStaff && !canHandle) return;
    const txt = msgTxt; const id = sel.id;
    const attempt = sendAttempt?.text === txt ? sendAttempt : { key: crypto.randomUUID(), text: txt, channel: isStaff && selClient?.telegramChatId ? 'telegram' : 'portal' };
    setSendAttempt(attempt); sendGuard.current = true; setSending(true); setSendError(''); setSendResult('');
    // A client's message is in the team's conversation once the insert is confirmed;
    // the team's delivery states (Telegram…) are not the client's concern.
    try { await envMsg(id,txt,auth,{ idempotencyKey: attempt.key, channel: attempt.channel }); draft.clear(); attemptDraft.clear(); clearWorkDraft(); if (currentDossier.current === id) setSendResult(isStaff ? 'Message enregistré. Son état d’envoi apparaît dans la conversation.' : 'Message envoyé à l’équipe : nous vous répondons ici.'); }
    catch(error){if (currentDossier.current === id) setSendError(error.message || 'Envoi impossible. Votre brouillon est conservé.');}
    finally {sendGuard.current = false; setSending(false);}
  };
  const clearMessageDraft = () => { draft.clear(); attemptDraft.clear(); clearWorkDraft(); setSendError(''); };
  const retryNotice = sendAttempt && !sending ? <p role="status" className="mt-2 text-sm text-amber-800">{sendAttempt.text === msgTxt ? (isStaff ? 'Une tentative d’envoi existe. Vérifiez son état dans la conversation ; réessayer reprend ce même message.' : 'Un envoi n’a pas été confirmé. Vérifiez si votre message apparaît dans la conversation ; réessayer reprend ce même message, sans doublon.') : 'Le texte a changé depuis une tentative d’envoi. Vérifiez la conversation avant d’envoyer ce nouveau message.'}</p> : null;
  const state=conversationState(sel);
  const conversationActions=workActions.filter(action=>action.colis_id===sel.id&&action.kind==='conversation');
  const conversationAction=conversationTask(conversationActions);
  const colleagueHandling = isStaff && conversationAction?.state !== 'done' && Boolean(conversationAction?.assignee_id && conversationAction.assignee_id !== auth?.u?.id);
  const canHandle=!colleagueHandling && (can('perm_comm_message_libre')||can('perm_comm_telegram')||can('perm_comm_email'));
  const changeState=async(next)=>{
    if(changingState||sending||!canHandle)return;
    setChangingState(true);
    try{await setConversationState(sel,next);await refreshColis(sel.id);await refreshWork?.();flash(`Conversation : ${CONVERSATION_STATES[next].toLowerCase()}`);}
    catch(error){await refreshColis(sel.id).catch(()=>{});flash({msg:error.message,type:'error'});}
    finally{setChangingState(false);}
  };

  const hasMessages = (sel.messages || []).length > 0;

  // ── Render text with clickable URLs ─────────────────────────────────────────
  // The thread shows links as host and path (shortLinks); the href never changes.
  // Only http(s) addresses become links (textWithLinks), opened in a new tab
  // without access to this page.
  const renderText = (text, { shortLinks = false } = {}) => {
    if (!text) return null;
    return textWithLinks(text).map((part, i) => {
      if (part.href) {
        const isImage = /\.(jpg|jpeg|png|gif|webp)/i.test(part.href);
        return (
          <span key={i}>
            {isImage && (
              <a href={part.href} target="_blank" rel="noopener noreferrer" className="block mt-1 mb-1">
                <img src={part.href} alt="Pièce jointe" className="max-w-[200px] max-h-[150px] rounded-lg border border-gray-200" />
              </a>
            )}
            <a href={part.href} target="_blank" rel="noopener noreferrer" className={shortLinks ? 'chat-link' : 'chat-portal-link'}>
              {isImage ? 'Voir la pièce jointe' : shortLinks ? linkLabel(part.href) : part.href.length > 50 ? part.href.slice(0, 50) + '…' : part.href}
            </a>
          </span>
        );
      }
      return <span key={i}>{part.text}</span>;
    });
  };

  // ── Render a single message bubble (client portal) ──────────────────────────
  // The client's own messages read « Vous », on the right. The team's messages,
  // and a decision the team recorded for the client, sit on the left under their
  // author. The team's delivery states (Telegram, pending, unconfirmed) and its
  // unread marks are not shown to the client.
  const renderMessage = (m) => {
    const own = m.type === 'client' && !messageRecordedByTeam(m, auth?.session?.user?.id);
    const isFacture = m.texte?.includes('Facture envoyée') || m.texte?.includes('📎');
    return (
      <div key={m.id} data-from={own ? 'client' : 'team'} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`max-w-[90%] sm:max-w-[80%] px-3 py-2 rounded-2xl text-sm ${own ? isFacture ? 'bg-green-50 border border-green-200 text-gray-900' : 'text-white' : 'bg-gray-100 text-gray-900'}`}
          style={own && !isFacture ? { backgroundColor: BRAND.navy } : {}}
        >
          <p className="text-xs font-semibold mb-0.5">{own ? 'Vous' : m.auteur}</p>
          <p className="whitespace-pre-line">{renderText(m.texte)}</p>
          <ConversationAttachment message={m} colis={sel} canImport={false} onImported={async id => { await refreshColis(id); }} />
          {m.heure && <p className="mt-1 text-right text-xs">{m.heure}</p>}
        </div>
      </div>
    );
  };

  // Staff always sees full panel
  if (isStaff) {
    const now = Date.now();
    const messages = sel.messages || [];
    const clientName = clientDisplayName(selClient);
    const firstName = selClient?.prenom?.trim();
    const channel = selClient?.telegramChatId ? 'telegram' : 'portal';
    const ChannelIcon = channel === 'telegram' ? Send : MessageCircle;
    // A decision the team recorded for the client (client_decision from a staff
    // screen) is the team's: never under the client's name, never « unread ».
    const recordedByTeam = message => messageRecordedByTeam(message, selClient?.userId);
    const lastSent = lastWhere(messages, message => message.type === 'staff');
    const lastClientMessage = lastWhere(messages, message => message.type === 'client' && !recordedByTeam(message));
    // Reading is not handling: a closed conversation without a task names nobody.
    const ownerText = ownership || (state === 'termine' && !conversationAction) ? '' : staffName(conversationAction?.assignee_id, teamUsers);
    const busy = changingState || sending;
    const help = channel === 'telegram' ? 'Envoyer une réponse ne clôture pas le traitement.' : 'Message dans l’espace client. L’invitation Telegram se trouve dans sa fiche client.';
    const explanation = state==='a_traiter' ? 'La demande reste à traiter, même après lecture. Les relances automatiques de ce client sont suspendues.' : state==='attente_client' ? 'Votre réponse a été apportée ; le prochain retour est attendu du client. Les pauses demandées restent respectées.' : 'Le traitement est terminé. Un nouveau message du client rouvrira la conversation.';
    // Below 640px the secondary states move into the menu: the bar keeps one row.
    const stateButton = (key, phone = false) => <button key={key} type="button" disabled={busy} onClick={() => { setMoreOpen(false); changeState(key); }}
      className={phone ? 'chat-more__item chat-more__phone' : 'chat-action chat-action--secondary'}>{CONVERSATION_STATES[key]}</button>;
    const secondaryStates = canHandle ? ['attente_client', 'a_traiter'].filter(key => key !== state) : [];
    // One filled command at a time: a conversation still to take puts « Je m’en occupe » first.
    const closePrimary = state === 'a_traiter' && !(conversationAction && conversationAction.state !== 'done' && !conversationAction.assignee_id);
    const markUnread = async () => {
      if (!lastClientMessage || markingUnread) return;
      const id = sel.id, messageId = lastClientMessage.id;
      setMarkingUnread(true);
      try {
        await sb.updateMessageLu(messageId, false);
        setData(prev => prev.map(c => c.id !== id ? c : { ...c, messages: (c.messages || []).map(message => message.id === messageId ? { ...message, lu: false } : message) }));
        setMoreOpen(false); moreButtonRef.current?.focus();
        flash('Message marqué comme non lu.');
      } catch (error) { flash({ msg: error.message, type: 'error' }); }
      finally { setMarkingUnread(false); }
    };

    // One day separator per Paris day; the author once per consecutive group.
    let previousDay = null, previousAuthor = null;
    const thread = messages.map(m => {
      const byTeam = recordedByTeam(m);
      const fromStaff = m.type === 'staff' || byTeam;
      const author = byTeam ? (m.auteur && m.auteur !== 'Client' ? m.auteur : staffName(m.auteurId, teamUsers)) : m.type === 'client' ? clientName : m.auteur;
      const day = conversationDayKey(m.createdAt);
      const newDay = Boolean(day) && day !== previousDay;
      if (newDay) { previousDay = day; previousAuthor = null; }
      const group = `${byTeam ? 'staff' : m.type}:${author}`;
      const showAuthor = group !== previousAuthor;
      previousAuthor = group;
      const kind = fromStaff ? 'staff' : m.texte?.includes('Facture envoyée') || m.texte?.includes('📎') ? 'document' : 'client';
      const time = conversationClock(m.createdAt) || m.heure;
      return <React.Fragment key={m.id}>
        {newDay && <p className="chat-day">{conversationDay(m.createdAt, now)}</p>}
        {showAuthor && <p className="chat-author" data-from={fromStaff ? 'staff' : 'client'}>{author}</p>}
        <div className="chat-message" data-from={fromStaff ? 'staff' : 'client'}>
          {m.type === 'client' && !byTeam && !m.lu && <span className="chat-unread"><span className="sr-only">Non lu</span></span>}
          <div className="chat-bubble" data-kind={kind}>
            <p className="chat-bubble__text">{renderText(m.texte, { shortLinks: true })}</p>
            <ConversationAttachment message={m} colis={sel} canImport={can('perm_factures_ajouter')} onImported={async id => { await refreshColis(id); await refreshWork?.(); }} />
            {canHandle&&m.statut==='echec'&&m.canal==='telegram'&&can('perm_comm_telegram')&&<button className="chat-retry" onClick={()=>ask('Réessayer cet envoi','Vérifiez dans Telegram que le client n’a pas reçu ce message, puis confirmez le renvoi.',async()=>{
              const result=await deliverMessage(sel.id,m.id,{retryConfirmed:true});
              if(!result.ok)throw new Error(result.error || 'L’envoi reste à vérifier.');
              await refreshColis(sel.id);flash('Message envoyé à Telegram');
            })}>Vérifier et réessayer</button>}
            {(time || fromStaff && m.statut) && <p className="chat-bubble__footer">{time}{fromStaff && m.statut && <>{time && <span aria-hidden="true">·</span>}<MsgStatut statut={m.statut} canal={m.canal} /></>}</p>}
          </div>
        </div>
      </React.Fragment>;
    });

    return (
      <div className={embedded ? 'chat-thread' : 'chat-thread card anim-fade'} id="conversation-client">
        <p className={embedded ? 'sr-only' : 'chat-thread__title'}>Chat avec le client</p>
        <div className="chat-status">
          <div className="chat-status__lead">
            <span role="status" className="chat-state" data-tone={{ a_traiter: 'current', attente_client: 'waiting', termine: 'done' }[state]}>{conversationLabel(sel)}</span>
            {ownership ? <div className="chat-status__owner">{ownership}</div> : ownerText && <span className="chat-status__owner">{ownerText}</span>}
          </div>
          <div className="chat-status__commands">
            {canHandle && <div role="group" aria-label="Traitement de la conversation" className="chat-status__actions">
              {secondaryStates.includes('attente_client') && stateButton('attente_client')}
              {state !== 'termine' && <button type="button" disabled={busy} onClick={() => changeState('termine')} className={`chat-action chat-action--close${closePrimary ? ' chat-action--primary' : ''}`}><Check size={16} aria-hidden="true" />Marquer comme traité</button>}
              {secondaryStates.includes('a_traiter') && stateButton('a_traiter')}
            </div>}
            <div ref={moreRef} className="chat-more">
              <button ref={moreButtonRef} type="button" className="chat-more__button" aria-label="Autres actions sur la conversation" aria-expanded={moreOpen} aria-controls={`conversation-more-${sel.id}`} onClick={() => setMoreOpen(open => !open)}><MoreHorizontal size={18} aria-hidden="true" /></button>
              <div id={`conversation-more-${sel.id}`} className="chat-more__panel" hidden={!moreOpen}>
                <p className="chat-more__note">{explanation}</p>
                {secondaryStates.map(key => stateButton(key, true))}
                {lastClientMessage && <button type="button" className="chat-more__item" disabled={markingUnread || !lastClientMessage.lu} onClick={markUnread}>Marquer comme non lu</button>}
              </div>
            </div>
          </div>
        </div>
        {colleagueHandling && <p role="status" className="chat-notice">{staffName(conversationAction.assignee_id, teamUsers)} s’occupe de cette conversation. Vous pouvez lire les échanges et les pièces jointes. Pour répondre ou terminer le traitement, demandez un relais.</p>}
        {/* Focusable: the history scrolls by keyboard even without a link inside. */}
        <div ref={scrollRef} role="log" aria-label="Messages avec le client" tabIndex={0} className="chat-log">
          {!hasMessages && <p className="chat-log__empty">Aucun message</p>}
          {thread}
        </div>
        <div className="chat-composer">
          <div className="chat-composer__meta">
            <span className="chat-channel" data-channel={channel}><ChannelIcon size={14} aria-hidden="true" />{CHANNEL_LABELS[channel]}</span>
            <span id={`staff-message-help-${sel.id}`} className="chat-composer__help">{help}</span>
            <span className="chat-composer__shortcut">Ctrl + Entrée pour envoyer</span>
          </div>
          <label htmlFor={`staff-message-${sel.id}`} className="sr-only">Votre réponse au client</label>
          <div className="chat-composer__box">
            <textarea
              ref={replyRef}
              rows={2}
              id={`staff-message-${sel.id}`}
              value={msgTxt}
              disabled={!canHandle || sending}
              aria-describedby={`staff-message-help-${sel.id}`}
              aria-keyshortcuts="Control+Enter"
              onChange={(e) => setMsgTxt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); } }}
              placeholder={channel === 'telegram' ? `Écrire ${firstName ? `à ${firstName}` : 'au client'} via Telegram…` : 'Écrire dans l’espace client…'}
              className="chat-composer__field"
            />
            <span className="chat-channel chat-composer__box-channel" data-channel={channel} aria-hidden="true"><ChannelIcon size={14} />{CHANNEL_LABELS[channel]}</span>
            <button
              onClick={handleSend}
              disabled={!canHandle || sending || changingState || !msgTxt.trim()} aria-label="Envoyer le message"
              className="chat-send"
            >
              <Send size={16} aria-hidden="true" />{sending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
          {msgTxt && <div className="chat-composer__draft"><span>{draft.storageAvailable ? (sendAttempt ? 'Saisie conservée dans cet onglet · tentative à vérifier' : 'Brouillon conservé dans cet onglet · non envoyé') : 'Brouillon conservé jusqu’au rechargement de cette page'}</span><button disabled={sending} onClick={() => ask('Effacer ce brouillon ?', 'La saisie sera retirée de cet onglet. Cela ne retire pas un message déjà enregistré : vérifiez la conversation si une tentative d’envoi existe.', clearMessageDraft, { danger: true, okLabel: 'Effacer le brouillon' })} className="min-h-11 underline">Effacer le brouillon</button></div>}
          {retryNotice}
          {sendError && <p role="alert" className="mt-2 text-sm text-red-700">{sendError}</p>}
          {sendResult && <p role="status" className="mt-2 text-sm text-emerald-700">{sendResult}</p>}
          {lastSent?.statut && <p className="chat-composer__last">Dernier envoi : <MsgStatut statut={lastSent.statut} canal={lastSent.canal} />{lastSent.canal ? ` · ${CHANNEL_LABELS[lastSent.canal] || lastSent.canal}` : ''}</p>}
        </div>
      </div>
    );
  }

  // Client: collapsible — shows compact bar when no messages, expands on tap
  return (
    <div className={embedded ? 'min-w-0 py-3' : 'card anim-fade overflow-hidden'}>
      {!embedded && <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <MessageCircle size={15} style={{ color: BRAND.navy }} />
          <span className="text-sm font-bold text-gray-800">
            {hasMessages ? `Messages (${(sel.messages || []).length})` : 'Une question ?'}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={`text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>}

      {(expanded || embedded) && (
        <div className={embedded ? 'min-w-0' : 'px-4 pb-4 anim-slide-down'}>
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-3">{state==='a_traiter'?'Votre message attend une réponse de notre équipe.':state==='attente_client'?'Notre équipe attend votre retour.':'Vous pouvez nous écrire pour toute question sur ce dossier.'}</p>
          {/* Focusable: the history scrolls by keyboard even without a link inside. */}
          {hasMessages && (
            <div ref={scrollRef} role="log" aria-label="Messages avec l’équipe" tabIndex={0} className="chat-portal-log mb-3 max-h-80 space-y-1.5 overflow-y-auto">
              {(sel.messages || []).map(renderMessage)}
            </div>
          )}
          <label htmlFor={`client-message-${sel.id}`} className="block text-xs font-semibold mb-1">Votre message à l’équipe</label>
          <div className="flex gap-2">
            <textarea
              rows={3}
              disabled={sending}
              id={`client-message-${sel.id}`}
              value={msgTxt}
              onChange={(e) => setMsgTxt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); } }}
              placeholder="Poser une question..."
              className="flex-1 min-w-0 min-h-[44px] px-3 py-2 rounded-xl border text-sm"
            />
            <button
              onClick={handleSend}
              disabled={sending || !msgTxt.trim()} aria-label="Envoyer le message"
              className="px-3 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-30"
              style={{ backgroundColor: BRAND.navy }}
            >
              <Send size={16} className="inline mr-1" />{sending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
          {msgTxt && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600"><span>{draft.storageAvailable ? (sendAttempt ? 'Saisie conservée dans cet onglet · tentative à vérifier' : 'Brouillon conservé dans cet onglet · non envoyé') : 'Brouillon conservé jusqu’au rechargement de cette page'}</span><button disabled={sending} onClick={() => ask('Effacer ce brouillon ?', 'La saisie sera retirée de cet onglet. Cela ne retire pas un message déjà enregistré : vérifiez la conversation si une tentative d’envoi existe.', clearMessageDraft, { danger: true, okLabel: 'Effacer le brouillon' })} className="min-h-11 underline">Effacer le brouillon</button></div>}
          {retryNotice}
          {sendError && <p role="alert" className="mt-2 text-sm text-red-700">{sendError}</p>}
          {sendResult && <p role="status" className="mt-2 text-sm text-emerald-700">{sendResult}</p>}
        </div>
      )}
    </div>
  );
}
