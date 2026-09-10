import React, { useState, useRef, useEffect } from 'react';
import { Send, MessageCircle, ChevronDown, Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { deliverMessage } from '../../services/telegramApi';
import { BRAND } from '../../constants';
import * as sb from '../../lib/supabaseData';
import { setConversationState, markVisibleMessagesRead } from '../../services/conversationApi';
import { CONVERSATION_STATES, conversationState, conversationLabel } from '../../domain/conversations';

// ── Status indicator (Telegram-style) ────────────────────────────────────────
function MsgStatut({ statut }) {
  if (!statut) return null;
  const labels = {envoi:'En attente de livraison',envoye:'Envoyé',distribue:'Distribué',lu:'Lu',echec:'Envoi non confirmé',en_attente:'En attente de connexion Telegram'};
  const label = labels[statut] || statut;
  let icon;
  switch (statut) {
    case 'envoi':
      icon=<Clock size={13} />;break;
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

export default function ChatPanel() {
  const { sel, selClient, isStaff, auth, envMsg, setData, flash, ask, refreshColis, can, teamUsers=[] } = useApp();
  const [msgTxt, setMsgTxt] = useState('');
  const [sending,setSending] = useState(false);
  const [changingState,setChangingState] = useState(false);
  const hasMsg = sel?.messages?.length > 0;
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef(null);

  // Auto-expand only when there are messages
  useEffect(() => {
    setExpanded(hasMsg);
  }, [hasMsg]);

  useEffect(() => {
    if (!isStaff || !expanded || !sel?.messages?.some(m=>m.type==='client'&&!m.lu)) return;
    const id=sel.id;
    markVisibleMessagesRead(sel).then((ids)=>setData(prev=>prev.map(c=>c.id===id?{...c,messages:c.messages.map(m=>ids.includes(m.id)?{...m,lu:true}:m)}:c)))
      .catch(error=>flash({msg:error.message,type:'error'}));
  },[expanded,sel?.id,isStaff,sel?.messages?.length]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [expanded, sel?.messages?.length]);

  if (!sel) return null;

  const handleSend = async () => {
    if (!msgTxt.trim() || sending) return;
    const txt = msgTxt;setSending(true);
    try { await envMsg(sel.id,txt,auth,selClient?.tel);setMsgTxt(''); }
    catch(error){flash({msg:error.message,type:'error'});}
    finally {setSending(false);}
  };
  const state=conversationState(sel);
  const owner=teamUsers.find((person)=>person.authId===sel.responsibleStaffId);
  const canHandle=can('perm_comm_message_libre')||can('perm_comm_telegram')||can('perm_comm_email');
  const changeState=async(next)=>{
    if(changingState||sending)return;
    setChangingState(true);
    try{await setConversationState(sel,next);await refreshColis(sel.id);flash(`Conversation : ${CONVERSATION_STATES[next].toLowerCase()}`);}
    catch(error){await refreshColis(sel.id).catch(()=>{});flash({msg:error.message,type:'error'});}
    finally{setChangingState(false);}
  };

  const hasMessages = (sel.messages || []).length > 0;

  // ── Render text with clickable URLs ─────────────────────────────────────────
  const renderText = (text) => {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
      if (/https?:\/\/[^\s]+/.test(part)) {
        const isImage = /\.(jpg|jpeg|png|gif|webp)/i.test(part);
        return (
          <span key={i}>
            {isImage && (
              <a href={part} target="_blank" rel="noopener noreferrer" className="block mt-1 mb-1">
                <img src={part} alt="Pièce jointe" className="max-w-[200px] max-h-[150px] rounded-lg border border-gray-200" />
              </a>
            )}
            <a href={part} target="_blank" rel="noopener noreferrer" className="underline text-blue-400 hover:text-blue-600 break-all">
              {isImage ? '📎 Voir la pièce jointe' : part.length > 50 ? part.slice(0, 50) + '...' : part}
            </a>
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  // ── Render a single message bubble ─────────────────────────────────────────
  const renderMessage = (m) => {
    const isS = m.type === 'staff';
    const isFacture = m.texte?.includes('Facture envoyée') || m.texte?.includes('📎');
    return (
      <div key={m.id} className={`flex ${isS ? 'justify-end' : 'justify-start'} items-center gap-1`}>
        {!isS && m.type === 'client' && !m.lu && (
          <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
        )}
        <div
          className={`max-w-[75%] px-3 py-2 rounded-2xl text-xs ${isS ? 'text-white' : isFacture ? 'bg-green-50 border border-green-200' : 'bg-gray-100'}`}
          style={isS ? { backgroundColor: BRAND.navy } : {}}
        >
          <p className="text-xs mb-0.5">{m.auteur}</p>
          <p className="whitespace-pre-line">{renderText(m.texte)}</p>
          {isStaff&&m.statut==='echec'&&<button className="min-h-[44px] text-xs underline" onClick={()=>ask('Réessayer cet envoi','Vérifiez dans Telegram que le client n’a pas reçu ce message, puis confirmez le renvoi.',async()=>{
            const result=await deliverMessage(sel.id,m.id,{retryConfirmed:true});
            if(!result.ok)throw new Error(result.error || 'L’envoi reste à vérifier.');
            await refreshColis(sel.id);flash('Message envoyé à Telegram');
          })}>Vérifier et réessayer</button>}
          {(m.heure || m.statut) && (
            <div className="flex flex-wrap items-center justify-end gap-1 mt-1">
              {m.heure && <span className="text-xs">{m.heure}</span>}
              {isS && <MsgStatut statut={m.statut} />}
            </div>
          )}
        </div>
        {isStaff && m.type === 'client' && (
          <button
            onClick={async(e) => {
              e.stopPropagation();
              const newLu = !m.lu;
              try { await sb.updateMessageLu(m.id,newLu); } catch(error){flash({msg:error.message,type:'error'});return;}
              setData((prev) => prev.map((c) => {
                if (c.id !== sel.id) return c;
                return { ...c, messages: (c.messages || []).map((msg) => msg.id === m.id ? { ...msg, lu: newLu } : msg) };
              }));

            }}
            className="min-h-11 min-w-11 text-xs text-gray-600 dark:text-gray-300 hover:text-blue-500"
            aria-label={m.lu ? 'Marquer ce message comme non lu' : 'Marquer ce message comme lu'}
            title={m.lu ? 'Marquer comme non lu' : 'Marquer comme lu'}
          >
            {m.lu ? 'Lu' : 'Non lu'}
          </button>
        )}
      </div>
    );
  };

  // Staff always sees full panel
  if (isStaff) {
    return (
      <div className="card p-4 anim-fade" id="conversation-client">
        <p className="font-bold mb-2 text-sm">Chat avec le client{(() => {
          const unread = (sel?.messages || []).filter((m) => m.type === 'client' && !m.lu).length;
          if (unread === 0) return null;
          return <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white">{unread}</span>;
        })()}</p>
        <div className="mb-3 rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
          <div className="flex flex-wrap justify-between items-center gap-2"><p className="text-sm font-semibold" role="status">{conversationLabel(sel)}</p><p className="text-xs text-gray-600 dark:text-gray-300">{owner ? `Responsable : ${[owner.prenom,owner.nom].filter(Boolean).join(' ')}` : sel.responsibleStaffId===auth?.u?.id ? 'Responsable : moi' : 'Responsable à attribuer'}</p></div>
          <p className="text-xs text-gray-600 dark:text-gray-300">{state==='a_traiter' ? 'La demande reste à traiter, même après lecture. Les relances automatiques de ce client sont suspendues.' : state==='attente_client' ? 'Votre réponse a été apportée ; le prochain retour est attendu du client. Les pauses demandées restent respectées.' : 'Le traitement est terminé. Un nouveau message du client rouvrira la conversation.'}</p>
          {canHandle&&<div className="flex flex-wrap gap-2" aria-label="Traitement de la conversation">{Object.entries(CONVERSATION_STATES).map(([key,label])=><button key={key} type="button" disabled={changingState||sending||state===key} onClick={()=>changeState(key)} className="min-h-11 rounded-lg border border-gray-300 dark:border-gray-600 px-3 text-xs font-semibold disabled:opacity-50">{key==='termine'?'Marquer comme traité':key==='a_traiter'?'À traiter':label}</button>)}</div>}
        </div>
        <div ref={scrollRef} role="log" aria-label="Messages avec le client" className="space-y-1.5 mb-3 max-h-64 overflow-y-auto">
          {!hasMessages && (
            <p className="text-xs text-gray-400 italic text-center py-3">Aucun message</p>
          )}
          {(sel.messages || []).map(renderMessage)}
        </div>
        <label htmlFor={`staff-message-${sel.id}`} className="block text-xs font-semibold mb-1">Votre réponse au client</label>
        <div className="flex gap-2">
          <input
            id={`staff-message-${sel.id}`}
            value={msgTxt}
            onChange={(e) => setMsgTxt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            placeholder={selClient?.telegramChatId ? 'Écrire au client via Telegram…' : 'Écrire dans l’espace client…'}
            className="flex-1 min-w-0 min-h-[44px] px-3 py-2 rounded-xl border text-sm"
          />
          <button
            onClick={handleSend}
            disabled={sending || changingState || !msgTxt.trim()} aria-label="Envoyer le message"
            className="px-3 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-30"
            style={{ backgroundColor: BRAND.navy }}
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-300 mt-2">
          {selClient?.telegramChatId
            ? 'Envoi via Telegram. Envoyer une réponse ne clôture pas automatiquement son traitement.'
            : 'Message dans l’espace client. L’invitation Telegram se trouve dans sa fiche client.'}
        </p>
      </div>
    );
  }

  // Client: collapsible — shows compact bar when no messages, expands on tap
  return (
    <div className="card anim-fade overflow-hidden">
      <button
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
      </button>

      {expanded && (
        <div className="px-4 pb-4 anim-slide-down">
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-3">{state==='a_traiter'?'Votre message attend une réponse de notre équipe.':state==='attente_client'?'Notre équipe attend votre retour.':'Vous pouvez nous écrire pour toute question sur ce dossier.'}</p>
          {hasMessages && (
            <div ref={scrollRef} className="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
              {(sel.messages || []).map(renderMessage)}
            </div>
          )}
          <label htmlFor={`client-message-${sel.id}`} className="block text-xs font-semibold mb-1">Votre message à l’équipe</label>
          <div className="flex gap-2">
            <input
              id={`client-message-${sel.id}`}
              value={msgTxt}
              onChange={(e) => setMsgTxt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              placeholder="Poser une question..."
              className="flex-1 min-w-0 min-h-[44px] px-3 py-2 rounded-xl border text-sm"
            />
            <button
              onClick={handleSend}
              disabled={sending || !msgTxt.trim()} aria-label="Envoyer le message"
              className="px-3 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-30"
              style={{ backgroundColor: BRAND.navy }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
