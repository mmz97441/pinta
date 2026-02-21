import React, { useState, useRef, useEffect } from 'react';
import { Send, MessageCircle, ChevronDown } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';
import { uid } from '../../utils';

export default function ChatPanel() {
  const { sel, isStaff, auth, envMsg } = useApp();
  const [msgTxt, setMsgTxt] = useState('');
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef(null);

  // Auto-expand when there are messages, auto-scroll to bottom
  useEffect(() => {
    if (sel?.messages?.length > 0) setExpanded(true);
  }, [sel?.messages?.length]);

  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [expanded, sel?.messages?.length]);

  if (!sel) return null;

  const handleSend = () => {
    if (!msgTxt.trim()) return;
    envMsg(sel.id, msgTxt, auth);
    setMsgTxt('');
  };

  const hasMessages = sel.messages.length > 0;

  // Staff always sees full panel
  if (isStaff) {
    return (
      <div className="card p-4 anim-fade">
        <p className="font-bold mb-2 text-sm">Chat avec le client</p>
        <div ref={scrollRef} className="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
          {!hasMessages && (
            <p className="text-xs text-gray-400 italic text-center py-3">Aucun message</p>
          )}
          {sel.messages.map((m) => {
            const isS = m.type === 'staff';
            return (
              <div key={m.id} className={`flex ${isS ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-3/4 px-3 py-2 rounded-2xl text-xs ${isS ? 'text-white' : 'bg-gray-100'}`}
                  style={isS ? { backgroundColor: BRAND.navy } : {}}
                >
                  <p style={{ fontSize: 10 }} className="opacity-60 mb-0.5">{m.auteur}</p>
                  <p>{m.texte}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <input
            value={msgTxt}
            onChange={(e) => setMsgTxt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            placeholder="Note interne ou réponse client..."
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
            <div ref={scrollRef} className="space-y-1.5 mb-3 max-h-32 overflow-y-auto">
              {sel.messages.map((m) => {
                const isS = m.type === 'staff';
                return (
                  <div key={m.id} className={`flex ${isS ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-3/4 px-3 py-2 rounded-2xl text-xs ${isS ? 'text-white' : 'bg-gray-100'}`}
                      style={isS ? { backgroundColor: BRAND.navy } : {}}
                    >
                      <p style={{ fontSize: 10 }} className="opacity-60 mb-0.5">{m.auteur}</p>
                      <p>{m.texte}</p>
                    </div>
                  </div>
                );
              })}
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
