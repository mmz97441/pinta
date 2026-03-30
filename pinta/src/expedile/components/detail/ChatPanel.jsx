import React, { useState, useRef, useEffect } from 'react';
import { Send, MessageCircle, ChevronDown, Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';
import * as sb from '../../lib/supabaseData';

// ── Status indicator (Telegram-style) ────────────────────────────────────────
function MsgStatut({ statut }) {
  if (!statut) return null;
  switch (statut) {
    case 'envoi':
      return <Clock size={11} className="text-gray-300" />;
    case 'envoye':
      return <Check size={11} className="text-green-400" />;
    case 'distribue':
      return <CheckCheck size={11} className="text-green-400" />;
    case 'lu':
      return <CheckCheck size={11} className="text-blue-400" />;
    case 'echec':
      return <AlertCircle size={11} className="text-red-400" />;
    case 'en_attente':
      return <Clock size={11} className="text-orange-400" title="Client n'a pas encore lié Telegram" />;
    default:
      return null;
  }
}

export default function ChatPanel() {
  const { sel, selClient, isStaff, auth, envMsg, setData } = useApp();
  const [msgTxt, setMsgTxt] = useState('');
  const hasMsg = sel?.messages?.length > 0;
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef(null);

  // Auto-expand only when there are messages
  useEffect(() => {
    setExpanded(hasMsg);
  }, [hasMsg]);

  useEffect(() => {
    if (expanded && sel?.messages?.some((m) => m.type === 'client' && !m.lu)) {
      setData((prev) => prev.map((c) => {
        if (c.id !== sel.id) return c;
        return {
          ...c,
          messages: c.messages.map((m) => m.type === 'client' && !m.lu ? { ...m, lu: true } : m),
        };
      }));
      sb.markAllMessagesLu(sel.id).catch(console.error);
    }
  }, [expanded, sel?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [expanded, sel?.messages?.length]);

  if (!sel) return null;

  const handleSend = async () => {
    if (!msgTxt.trim()) return;
    const txt = msgTxt;
    setMsgTxt('');
    await envMsg(sel.id, txt, auth, selClient?.tel);
  };

  const hasMessages = sel.messages.length > 0;

  // ── Render a single message bubble ─────────────────────────────────────────
  const renderMessage = (m) => {
    const isS = m.type === 'staff';
    return (
      <div key={m.id} className={`flex ${isS ? 'justify-end' : 'justify-start'} items-center gap-1`}>
        {!isS && m.type === 'client' && !m.lu && (
          <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
        )}
        <div
          className={`max-w-[75%] px-3 py-2 rounded-2xl text-xs ${isS ? 'text-white' : 'bg-gray-100'}`}
          style={isS ? { backgroundColor: BRAND.navy } : {}}
        >
          <p style={{ fontSize: 10 }} className="opacity-60 mb-0.5">{m.auteur}</p>
          <p className="whitespace-pre-line">{m.texte}</p>
          {(m.heure || m.statut) && (
            <div className={`flex items-center justify-end gap-1 mt-1 ${isS ? 'opacity-70' : 'opacity-40'}`}>
              {m.heure && <span style={{ fontSize: 9 }}>{m.heure}</span>}
              {isS && <MsgStatut statut={m.statut} />}
            </div>
          )}
        </div>
        {isStaff && m.type === 'client' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const newLu = !m.lu;
              setData((prev) => prev.map((c) => {
                if (c.id !== sel.id) return c;
                return { ...c, messages: c.messages.map((msg) => msg.id === m.id ? { ...msg, lu: newLu } : msg) };
              }));
              sb.updateMessageLu(m.id, newLu).catch(console.error);
            }}
            className="text-[9px] text-gray-400 hover:text-blue-500"
            title={m.lu ? 'Marquer comme non lu' : 'Marquer comme lu'}
          >
            {m.lu ? '○' : '●'}
          </button>
        )}
      </div>
    );
  };

  // Staff always sees full panel
  if (isStaff) {
    return (
      <div className="card p-4 anim-fade">
        <p className="font-bold mb-2 text-sm">Chat avec le client{(() => {
          const unread = (sel?.messages || []).filter((m) => m.type === 'client' && !m.lu).length;
          if (unread === 0) return null;
          return <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white">{unread}</span>;
        })()}</p>
        <div ref={scrollRef} className="space-y-1.5 mb-3 max-h-64 overflow-y-auto">
          {!hasMessages && (
            <p className="text-xs text-gray-400 italic text-center py-3">Aucun message</p>
          )}
          {sel.messages.map(renderMessage)}
        </div>
        <div className="flex gap-2">
          <input
            value={msgTxt}
            onChange={(e) => setMsgTxt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            placeholder={selClient?.tel ? 'Écrire au client via Telegram…' : 'Note interne…'}
            className="flex-1 px-3 py-2 rounded-xl border text-sm"
          />
          <button
            onClick={handleSend}
            disabled={!msgTxt.trim()}
            className="px-3 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-30"
            style={{ backgroundColor: BRAND.navy }}
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-[10px] mt-1.5 text-right" style={{ color: selClient?.telegramChatId ? '#0088cc' : '#9CA3AF' }}>
          {selClient?.telegramChatId
            ? `Telegram connecté (ID: ${selClient.telegramChatId})`
            : 'Telegram non lié — le client doit envoyer /start à @Expedilebot ou cliquer le lien d\'invitation'}
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
            {hasMessages ? `Messages (${sel.messages.length})` : 'Une question ?'}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={`text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 anim-slide-down">
          {hasMessages && (
            <div ref={scrollRef} className="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
              {sel.messages.map(renderMessage)}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={msgTxt}
              onChange={(e) => setMsgTxt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              placeholder="Poser une question..."
              className="flex-1 px-3 py-2 rounded-xl border text-sm"
            />
            <button
              onClick={handleSend}
              disabled={!msgTxt.trim()}
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
