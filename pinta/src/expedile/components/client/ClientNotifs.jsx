import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ChevronRight, Package, CheckCircle, CreditCard, MessageCircle, FileText, RefreshCw, Send } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { plural } from '../../domain/plural';
import { useMinuteNow } from '../../hooks/useMinuteNow';
import useDocumentTitle from '../../hooks/useDocumentTitle';
import { ClientPortalSkeleton } from './ClientPortalStates';

// Icon tiles from the palette; brand.css maps these utilities in dark mode.
const TYPE_ICON = {
  statut_change: { Icon: Package, tile: 'bg-blue-50', tone: 'text-blue-700' },
  feu_vert: { Icon: CheckCircle, tile: 'bg-emerald-50', tone: 'text-emerald-700' },
  paiement: { Icon: CreditCard, tile: 'bg-amber-50', tone: 'text-amber-700' },
  message: { Icon: MessageCircle, tile: 'brand-bg-l', tone: 'brand-t' },
  facture: { Icon: FileText, tile: 'bg-amber-50', tone: 'text-amber-700' },
  facture_rejetee: { Icon: FileText, tile: 'bg-amber-50', tone: 'text-amber-700' },
  document: { Icon: FileText, tile: 'bg-blue-50', tone: 'text-blue-700' },
};
const DEFAULT_ICON = { Icon: Bell, tile: 'bg-slate-100', tone: 'text-slate-700' };
const NBSP = '\u00a0';

/** « à l’instant », « il y a 50 min », « il y a 5 h », « hier », « il y a 4 j », then the date. */
export function relativeDate(raw, now = Date.now()) {
  if (!raw) return '';
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((now - d.getTime()) / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 1) return 'à l’instant';
  if (diffMin < 60) return `il y a ${diffMin}${NBSP}min`;
  if (diffH < 24) return `il y a ${diffH}${NBSP}h`;
  if (diffD === 1) return 'hier';
  if (diffD < 7) return `il y a ${diffD}${NBSP}j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

function NotificationItem({ notification: n, now, onOpen }) {
  const { Icon, tile, tone } = TYPE_ICON[n.type] || DEFAULT_ICON;
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(false);
  const message = useRef(null);
  const messageId = `notification-${n.id}-message`;
  // « Lire la suite » only when the clamped message actually hides lines.
  const measure = () => {
    const element = message.current;
    if (element && !expanded) setLong(element.scrollHeight > element.clientHeight + 1);
  };
  useLayoutEffect(measure, [n.msg, expanded]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });
  const date = n.date ? new Date(n.date) : null;
  const validDate = date && !Number.isNaN(date.getTime());
  return <li className="notification-item relative rounded-2xl" data-unread={n.lu ? undefined : 'true'}>
    <div className="flex items-start gap-3 p-4">
      <span className={`relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${tile}`} aria-hidden="true">
        <Icon size={18} className={tone} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h2 className={`min-w-0 text-sm leading-snug ${n.lu ? 'font-semibold text-slate-700' : 'font-bold text-slate-900'}`}>
            {/* The title opens the notification; its hit area covers the whole card. */}
            <button type="button" onClick={() => onOpen(n)} aria-describedby={n.msg ? messageId : undefined} className="stretched-link text-left">
              {!n.lu && <span className="sr-only">Non lue · </span>}{n.titre}
            </button>
          </h2>
          <span className="flex flex-shrink-0 items-center gap-2 text-sm text-slate-600">
            {!n.lu && <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: 'var(--unread-accent)' }} aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--unread-accent)' }} />Nouveau</span>}
            {validDate && <time dateTime={date.toISOString()} title={date.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}>{relativeDate(date, now)}</time>}
          </span>
        </div>
        {n.msg && <p id={messageId} ref={message} className={`mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-slate-600 ${expanded ? '' : 'line-clamp-4'}`}>{n.msg}</p>}
        {(long || expanded) && <button type="button" aria-expanded={expanded} aria-controls={messageId} onClick={() => setExpanded(value => !value)} className="relative z-10 mt-1 min-h-11 text-sm font-semibold underline brand-t">{expanded ? 'Réduire' : 'Lire la suite'}</button>}
      </div>
      {n.colisId && <ChevronRight size={16} className="mt-1 flex-shrink-0 text-slate-500" aria-hidden="true" />}
    </div>
  </li>;
}

export default function ClientNotifs() {
  const navigate = useNavigate();
  const { authCl, notifs, unreadNotifs, markNotifRead, markAllNotifsRead, loadMoreNotifications, notificationsHasMore, notificationsLoading, notificationsError, refreshNotifications } = useApp();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const now = useMinuteNow();
  useDocumentTitle('Notifications');
  // A failed read is explained once, by the notice above the list (notificationsError).
  const handleLoad = async (load) => {
    setRetrying(true);
    try { await load?.(); } catch { /* the notice stays, with its retry */ }
    finally { setRetrying(false); }
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
    if (n.lu) return;
    try { await markNotifRead(n.id); setError(''); } catch { setError('Le suivi de lecture n’a pas pu être enregistré. Réessayez dans un instant.'); }
  };

  const loadingFirst = notificationsLoading && !notifs.length && !notificationsError;
  return (
    <div className="anim-fade space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-black text-gray-900">Notifications</h1>
          {unreadNotifs > 0 && (
            <span className="inline-flex min-h-6 items-center rounded-full px-2.5 text-sm font-bold" style={{ background: 'var(--unread-accent)', color: 'var(--bg-elevated)' }}>
              {plural(unreadNotifs, 'non lue')}
            </span>
          )}
        </div>
        {unreadNotifs > 0 && (
          <button
            disabled={busy} onClick={async () => { setBusy(true); try { await markAllNotifsRead(); setError(''); } catch { setError('Les notifications n’ont pas pu être marquées comme lues. Réessayez dans un instant.'); } finally { setBusy(false); } }}
            className="flex items-center gap-1.5 min-h-11 text-sm font-semibold px-3 py-2 rounded-xl brand-bg-l brand-t transition-all duration-200 ease-out active:scale-[0.98] disabled:opacity-60"
          >
            <CheckCheck size={16} aria-hidden="true" />
            {busy ? 'Enregistrement…' : 'Tout marquer comme lu'}
          </button>
        )}
      </div>

      {notificationsError && <div role="alert" className="rounded-2xl border border-slate-200 p-4 text-sm" style={{ background: 'var(--bg-elevated)' }}>
        <p className="font-semibold text-slate-800">Nous n’arrivons pas à afficher vos notifications pour le moment.</p>
        <p className="mt-1 text-slate-600">Vos expéditions restent suivies et consultables dans votre espace. Réessayez dans un instant.</p>
        <button className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl brand-bg px-4 font-semibold text-white disabled:opacity-60" disabled={retrying} onClick={() => handleLoad(refreshNotifications)}><RefreshCw size={16} aria-hidden="true" />{retrying ? 'Chargement…' : 'Réessayer'}</button>
      </div>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {loadingFirst ? <ClientPortalSkeleton view="notifications" /> : sorted.length === 0 ? (!notificationsError && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 brand-bg-l" aria-hidden="true">
            <Bell size={28} className="brand-t" strokeWidth={1.6} />
          </div>
          <h2 className="font-bold text-gray-800 mb-1">Aucune notification pour le moment</h2>
          <p className="max-w-sm text-sm text-gray-600">Nous vous prévenons ici à chaque étape de vos expéditions{authCl?.telegramChatId ? ', et aussi sur Telegram.' : '.'}</p>
          {authCl && !authCl.telegramChatId
            ? <Link to="/profil#telegram-title" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl brand-bg px-4 text-sm font-semibold text-white transition-all duration-200 ease-out hover:translate-y-[-1px] active:scale-[0.98]"><Send size={16} aria-hidden="true" />Recevoir aussi mes nouvelles sur Telegram</Link>
            : <Link to="/colis" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl brand-bg px-4 text-sm font-semibold text-white transition-all duration-200 ease-out hover:translate-y-[-1px] active:scale-[0.98]"><Package size={16} aria-hidden="true" />Voir mes expéditions</Link>}
        </div>
      )) : (
        <ul className="space-y-2.5" aria-label="Mes notifications">
          {sorted.map((n) => <NotificationItem key={n.id} notification={n} now={now} onOpen={handleNotifClick} />)}
        </ul>
      )}
      {notificationsHasMore && <button disabled={notificationsLoading} className="min-h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-semibold brand-t transition-all duration-200 ease-out hover:bg-slate-50 active:scale-[0.98]" onClick={() => handleLoad(loadMoreNotifications)}>{notificationsLoading ? 'Chargement…' : 'Charger les notifications précédentes'}</button>}
    </div>
  );
}
