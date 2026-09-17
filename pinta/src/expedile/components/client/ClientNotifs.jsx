import React, { useMemo, useState } from 'react';
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
  const { notifs, unreadNotifs, markNotifRead, markAllNotifsRead, loadMoreNotifications, notificationsHasMore, notificationsLoading, notificationsError, refreshNotifications } = useApp();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const handleLoad = async (load) => {
    try { await load?.(); setError(''); }
    catch { setError('Le chargement des notifications a échoué. Réessayez.'); }
  };

  // Sort by date, newest first
  const sorted = useMemo(
    () => [...notifs].sort((a, b) => {
      const da = a.date ? new Date(a.date) : 0;
      const db = b.date ? new Date(b.date) : 0;
      return db - da;
    }),
    [notifs],
  );

  const handleNotifClick = async (n) => {
    if (n.colisId) {
      const query = new URLSearchParams({ notification: n.id });
      if (n.type === 'message') query.set('panel', 'messages');
      if (['facture', 'facture_rejetee', 'document'].includes(n.type)) query.set('panel', 'documents');
      navigate(`/colis/${n.colisId}?${query}`);
      return;
    }
    try { await markNotifRead(n.id); setError(''); } catch { setError('Le suivi de lecture n’a pas pu être enregistré.'); }
  };

  return (
    <div className="anim-fade space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-black text-gray-900">Notifications</h2>
          {unreadNotifs > 0 && (
            <span
              className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full text-sm font-black text-white"
              style={{ backgroundColor: BRAND.navy }}
            >
              {unreadNotifs} non lue{unreadNotifs > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {unreadNotifs > 0 && (
          <button
            disabled={busy} onClick={async () => { setBusy(true); try { await markAllNotifsRead(); setError(''); } catch { setError('Les notifications n’ont pas pu être marquées comme lues. Réessayez.'); } finally { setBusy(false); } }}
            className="flex items-center gap-1.5 min-h-11 text-sm font-semibold px-3 py-2 rounded-xl transition-all active:scale-95"
            style={{ color: 'var(--brand-text)', backgroundColor: BRAND.navy + '10' }}
          >
            <CheckCheck size={16} />
            Tout marquer comme lu
          </button>
        )}
      </div>

      {notificationsError && <div role="alert" className="text-sm text-red-700">{String(notificationsError.message || notificationsError)}<button className="min-h-11 block underline" onClick={() => handleLoad(refreshNotifications)}>Réessayer le chargement</button></div>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {/* ── Notification list ── */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: BRAND.navy + '10' }}
          >
            <Bell size={28} style={{ color: 'var(--brand-text)' }} strokeWidth={1.5} />
          </div>
          <p className="font-bold text-gray-700 mb-1">Aucune notification</p>
          <p className="text-sm text-gray-400">Vos notifications apparaîtront ici.</p>
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
                  animationDelay: `${Math.min(i, 8) * 0.04}s`,
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
                    <span className="flex-shrink-0 text-sm text-gray-400 font-medium mt-0.5 whitespace-nowrap">
                      {relativeDate(n.date)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 leading-relaxed">{n.msg}</p>
                </div>
                {n.colisId && (
                  <ChevronRight size={14} className="flex-shrink-0 mt-1 text-gray-300" />
                )}
              </button>
            );
          })}
        </div>
      )}
      {notificationsHasMore && <button disabled={notificationsLoading} className="min-h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-semibold brand-t" onClick={() => handleLoad(loadMoreNotifications)}>{notificationsLoading ? "Chargement…" : "Charger les notifications précédentes"}</button>}
    </div>
  );
}
