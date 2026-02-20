import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';
import { uid } from '../../utils';

export default function ChatPanel() {
  const { sel, isStaff, auth, envMsg } = useApp();
  const [msgTxt, setMsgTxt] = useState('');

  if (!sel) return null;

  const handleSend = () => {
    if (!msgTxt.trim()) return;
    envMsg(sel.id, msgTxt, auth);
    setMsgTxt('');
  };

  return (
    <div className="card p-4 anim-fade">
      <p className="font-bold mb-2 text-sm">{isStaff ? 'Chat avec le client' : 'Messages'}</p>
      <div className="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
        {sel.messages.length === 0 && (
          <p className="text-xs text-gray-400 italic text-center py-3">Aucun message pour le moment</p>
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
          placeholder={isStaff ? 'Note interne ou réponse client...' : 'Poser une question...'}
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
