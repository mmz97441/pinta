import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { Badge } from '../ui';
import { hasTrack, trackStr, trackCount } from '../../utils';

export default function DetailHeader() {
  const navigate = useNavigate();
  const { sel, selClient, selDest, isStaff } = useApp();
  if (!sel) return null;

  return (
    <div
      className="border-b border-white border-opacity-5 px-4 py-3.5 flex items-center gap-3 sticky top-0 z-20"
      style={{ background: 'linear-gradient(135deg, rgba(18,42,54,0.98), rgba(27,58,75,0.98))' }}
    >
      <button onClick={() => navigate(isStaff ? '/' : '/colis')} className="text-white font-bold text-lg p-1 hover:bg-white hover:bg-opacity-10 rounded-xl transition-all">
        <ArrowLeft size={22} />
      </button>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <b className="font-mono text-white">{sel.ref}</b>
          <Badge statut={sel.statut} />
          {selDest && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-white bg-opacity-20 text-white">
              {selDest.flag} {selDest.label}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-300">
          {isStaff && selClient ? `${selClient.nom} — ` : ''}{sel.desc}
        </p>
        {hasTrack(sel) && (
          <p className="text-xs font-mono" style={{ color: '#E8B84B' }}>
            {trackStr(sel)}{trackCount(sel) > 1 ? ` (${trackCount(sel)} colis)` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
