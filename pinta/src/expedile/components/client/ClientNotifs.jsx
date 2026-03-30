import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ChevronRight, Package, CheckCircle, CreditCard, MessageCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';

// ── Icon + color by notification type ─────────────────────────────────────────
const TYPE_ICON = {
  statut_change: { Icon: Package, bg: '#dbeafe', color: '#2563eb' },
  feu_vert:      { Icon: CheckCircle, bg: '#d1fae5', color: '#059669' },
  paiement:      { Icon: CreditCard, bg: '#fef3c7', color: '#d97706' },
  message:       { Icon: MessageCircle, bg: '#ede9fe', color: '#7c3aed' },
};
const DEFAULT_ICON = { Icon: Bell, bg: '#f3f4f6', color: '#6b7280' };

// ── Relative date formatter ───────────────────────────────────────────────────
function relativeDate(raw) {
  if (!raw) return '';
  const d = typeof raw === 'string' ? new Date(raw) : raw;
  if (isNaN(d.getTime())) return raw; // fallback to raw string
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin}min`;
  if (diffH < 24) return `il y a ${diffH}h`;
  if (diffD === 1) return 'hier';
  if (diffD < 7) return `il y a ${diffD}j`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

export default function ClientNotifs() {
  const navigate = useNavigate();
  const { notifs, unreadNotifs, markNotifRead, markAllNotifsRead } = useApp();

  // Sort by date, newest first
  const sorted = useMemo(
    () => [...notifs].sort((a, b) => {
      const da = a.date ? new Date(a.date) : 0;
      const db = b.date ? new Date(b.date) : 0;
      return db - da;
    }),
    [notifs],
  );

  const handleNotifClick = (n) => {
    markNotifRead(n.id);
    if (n.colisId) {
      navigate(`/colis/${n.colisId}`);
    }
  };

  return (
    <div className="anim-fade space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-black text-gray-900">Notifications</h2>
          {unreadNotifs > 0 && (
            <span
              className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full text-[10px] font-black text-white"
              style={{ backgroundColor: BRAND.navy }}
            >
              {unreadNotifs}
            </span>
          )}
        </div>
        {unreadNotifs > 0 && (
          <button
            onClick={markAllNotifsRead}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all active:scale-95"
            style={{ color: BRAND.navy, backgroundColor: BRAND.navy + '10' }}
          >
            <CheckCheck size={13} />
            Tout marquer comme lu
          </button>
        )}
      </div>

      {/* ── Notification list ── */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: BRAND.navy + '10' }}
          >
            <Bell size={28} style={{ color: BRAND.navy }} strokeWidth={1.5} />
          </div>
          <p className="font-bold text-gray-700 mb-1">Aucune notification</p>
          <p className="text-xs text-gray-400">Vos notifications apparaîtront ici.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((n, i) => {
            const { Icon, bg, color } = TYPE_ICON[n.type] || DEFAULT_ICON;
            return (
              <button
                key={n.id}
                onClick={() => handleNotifClick(n)}
                className={`anim-fade w-full text-left card p-4 rounded-2xl flex items-start gap-3 transition-all active:scale-[0.99] ${
                  !n.lu ? 'ring-1' : ''
                }`}
                style={{
                  animationDelay: `${i * 0.04}s`,
                  ...(n.lu ? {} : { ringColor: BRAND.navy + '30' }),
                }}
              >
                {/* Type icon */}
                <div
                  className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center relative"
                  style={{ backgroundColor: bg }}
                >
                  <Icon size={17} style={{ color }} strokeWidth={2} />
                  {/* Unread blue dot */}
                  {!n.lu && (
                    <div
                      className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white pulse-soft"
                      style={{ backgroundColor: BRAND.navy }}
                    />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <p
                      className={`text-sm leading-snug ${n.lu ? 'font-medium text-gray-700' : 'font-bold text-gray-900'}`}
                    >
                      {n.titre}
                    </p>
                    <span className="flex-shrink-0 text-[10px] text-gray-400 font-medium mt-0.5 whitespace-nowrap">
                      {relativeDate(n.date)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{n.msg}</p>
                </div>
                {n.colisId && (
                  <ChevronRight size={14} className="flex-shrink-0 mt-1 text-gray-300" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
