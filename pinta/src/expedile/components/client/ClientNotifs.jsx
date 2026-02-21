import React from 'react';
import { Bell, CheckCheck, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';

export default function ClientNotifs() {
  const { notifs, unreadNotifs, markNotifRead, markAllNotifsRead, setSelId } = useApp();

  const handleNotifClick = (n) => {
    markNotifRead(n.id);
    if (n.colisId) {
      setSelId(n.colisId);
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
            Tout marquer lu
          </button>
        )}
      </div>

      {/* ── Notification list ── */}
      {notifs.length === 0 ? (
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
          {notifs.map((n, i) => (
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
              {/* Unread dot */}
              <div className="flex-shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center">
                {n.lu ? (
                  <div className="w-2 h-2 rounded-full bg-gray-200" />
                ) : (
                  <div
                    className="w-2.5 h-2.5 rounded-full pulse-soft"
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
                  <span className="flex-shrink-0 text-[10px] text-gray-400 font-medium mt-0.5">
                    {n.date}
                  </span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{n.msg}</p>
              </div>
              {n.colisId && (
                <ChevronRight size={14} className="flex-shrink-0 mt-1 text-gray-300" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
