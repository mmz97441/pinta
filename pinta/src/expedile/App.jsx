import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';
import { Settings, Users, Contact, LogOut, LayoutDashboard, Package, ChevronLeft, ChevronRight, Plus, FileText, Key, AlertTriangle, MessageCircle, Plane, MoreHorizontal, RefreshCw } from 'lucide-react';
import './brand.css';
import './staffShell.css';
import { getPrenom } from './utils';
import { needsConversationAction } from './domain/conversations';

import { TaskAccessBoundary } from './context/TaskAccessContext';
import { findDossierWorkAction, staffDisplayName } from './domain/personalWork';
import { plural } from './domain/plural';
import { shellLoadBanner, staffDataState } from './domain/dataLoad';
import { staffName } from './components/workspace/WorkActionRow';
import TaskOwnership from './components/workspace/TaskOwnership';
import { AppProvider, useApp } from './context/AppContext';
import { BRAND } from './constants';


import { Toast, ConfirmDialog } from './components/ui';
import ThemeToggle from './components/ui/ThemeToggle';
import LoginPage from './components/LoginPage';
import ForceChangePassword from './components/ForceChangePassword';
import OnboardingOverlay from './components/client/OnboardingOverlay';

const ReceptionPage = lazy(() => import('./components/staff/ReceptionPage'));
const StaffColisPage = lazy(() => import('./components/staff/StaffSplitView'));
const PersonalWorkView = lazy(() => import('./components/workspace/PersonalWorkView'));
const TeamWorkView = lazy(() => import('./components/workspace/TeamWorkView'));
const ConversationsView = lazy(() => import('./components/workspace/ConversationsView'));
const StaffDepartures = lazy(() => import('./components/staff/StaffDepartures'));
const StaffSettings = lazy(() => import('./components/staff/StaffSettings'));
const StaffClients = lazy(() => import('./components/staff/StaffClients'));
const StaffClientDetail = lazy(() => import('./components/staff/StaffClientDetail'));
import StaffDetailView from './components/staff/StaffDetailView';
const DevisProspect = lazy(() => import('./components/staff/DevisProspect'));
const TrackingPublic = lazy(() => import('./components/public/TrackingPublic'));
const PaymentReturn = lazy(() => import('./components/public/PaymentReturn'));

const ClientAccueil = lazy(() => import('./components/client/ClientAccueil'));
const ClientColis = lazy(() => import('./components/client/ClientColis'));
const ClientNotifs = lazy(() => import('./components/client/ClientNotifs'));
const ClientProfil = lazy(() => import('./components/client/ClientProfil'));
import ClientDetailView from './components/client/ClientDetailView';
import ClientDossierContext from './components/client/ClientDossierContext';
import ClientBottomNav, { ClientTopNav } from './components/client/ClientBottomNav';
import { ClientDossiersError, ClientPortalSkeleton, PublicTrackingSkeleton, clientViewForPath } from './components/client/ClientPortalStates';
import useDocumentTitle from './hooks/useDocumentTitle';

import DetailHeader from './components/detail/DetailHeader';
import DossierAlerts from './components/detail/DossierAlerts';
import DossierContextPanel from './components/detail/DossierContextPanel';
import DossierOverview from './components/detail/DossierOverview';
import DossierDeparture from './components/detail/DossierDeparture';
import { buildDossierOverview } from './domain/dossierOverview';
import { revisionLockedReason } from './domain/shipmentRevision';
import { needsQuoteRecalculation } from './domain/clientJourney';
import { hasCurrentPreparation } from './domain/preparationReadiness';
import ChatPanel from './components/detail/ChatPanel';
import './components/detail/dossierConversation.css';
import AuditLog from './components/detail/AuditLog';
import { DOSSIER_TASKS, dossierTaskUrl, resolveDossierTask } from './domain/dossierTasks';

// ── Loading views ──
// One neutral skeleton for every screen, on the page gutters, so the heading
// appears where its placeholder was. bg-gray-200 stays visible on the page
// background in both themes (brand.css maps it in dark mode).
const BONE = 'animate-pulse rounded-lg bg-gray-200';
const APP_FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
function LoadingView({ label = 'Chargement de votre espace…', bare = false }) {
  return <div role="status" aria-live="polite" aria-busy="true" data-testid="loading-view" className={bare ? 'w-full space-y-4' : 'mx-auto w-full max-w-[1600px] space-y-4 px-4 py-4 sm:px-6 lg:px-8'}>
    <p className="text-sm font-semibold text-gray-600">{label}</p>
    <div aria-hidden="true" className="space-y-4">
      <div className={`${BONE} h-8 w-64 max-w-[75%]`} />
      <div className={`${BONE} h-4 w-[28rem] max-w-full`} />
      <div className="flex gap-2 pt-1"><div className={`${BONE} h-11 w-32`} /><div className={`${BONE} h-11 w-24`} /></div>
      <div className="space-y-2">{[0, 1, 2, 3, 4].map((row) => <div key={row} className={`${BONE} h-16 w-full`} />)}</div>
    </div>
  </div>;
}
const Logo = () => <b className="text-lg text-white tracking-tight">EXPÉD<span style={{ color: BRAND.gold }}>ÎLE</span></b>;
/** The staff shell (navy navigation column, mobile bars) with neutral placeholders: same sizes as the real one. */
function StaffShellSkeleton() {
  return <div data-testid="shell-skeleton" data-shell="staff" style={{ fontFamily: APP_FONT }} className="h-[100dvh] flex overflow-hidden">
    <div aria-hidden="true" className="hidden lg:flex w-[220px] flex-shrink-0 flex-col border-r border-gray-800" style={{ background: 'linear-gradient(180deg, #122A36 0%, #1B3A4B 100%)' }}>
      <div className="px-4 py-4"><Logo /></div>
      <div className="mx-3 mb-2 h-[3.75rem] rounded-xl bg-white/10" />
      <div className="flex-1 space-y-1 px-3">{[96, 132, 112, 72, 80, 72, 96].map((width, item) => <div key={item} className="flex h-11 items-center gap-3 px-3"><div className="h-[18px] w-[18px] shrink-0 rounded-md bg-white/10" /><div className="h-3 rounded bg-white/10" style={{ width }} /></div>)}</div>
      <div className="border-t border-white/10 px-3 pb-3 pt-3"><div className="flex items-center gap-2.5"><div className="h-8 w-8 shrink-0 rounded-full bg-white/10" /><div className="h-3 w-24 rounded bg-white/10" /></div><div className="mt-2 h-10" /></div>
    </div>
    <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
      <div aria-hidden="true" className="lg:hidden min-h-12 px-4 flex items-center justify-between border-b border-gray-200"><span className="font-black brand-t">EXPÉD<span className="brand-t-gold">ÎLE</span></span><div className="flex items-center gap-2"><div className={`${BONE} h-8 w-24`} /><div className={`${BONE} h-8 w-8`} /></div></div>
      <div className="flex-1 min-h-0 overflow-hidden pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0"><LoadingView /></div>
    </div>
    <div aria-hidden="true" className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 flex items-center justify-around py-2 px-1" style={{ background: 'var(--bg-elevated)', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
      {[0, 1, 2, 3].map((item) => <div key={item} className="flex-1 min-h-11 flex flex-col items-center justify-center gap-0.5 px-1 py-1"><div className="h-5 w-5 rounded-md bg-gray-200" /><div className="h-4 flex items-center"><div className="h-2.5 w-12 rounded bg-gray-200" /></div></div>)}
    </div>
  </div>;
}
/** The client portal shell: header bar and bottom navigation, with neutral
 * placeholders, built like the real ones (same height, same place, no bottom
 * bar from 1024 px where the links sit in the header): nothing moves when the
 * portal appears. */
function ClientShellSkeleton() {
  return <div data-testid="shell-skeleton" data-shell="client" style={{ fontFamily: APP_FONT, background: 'var(--bg-canvas)' }} className="min-h-[100dvh]">
    <div aria-hidden="true" className="glass-dark border-b border-white border-opacity-5 sticky top-0 z-20" style={{ background: 'linear-gradient(135deg, rgba(18,42,54,0.98), rgba(27,58,75,0.98))' }}>
      <div className="mx-auto flex min-h-[60px] max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Logo /><div className="flex items-center gap-2"><div className="h-10 w-10 rounded-xl bg-white/10 max-lg:h-11 [@media(pointer:coarse)]:h-11" /><div className="h-10 w-28 rounded-xl bg-white/10 max-lg:h-11 [@media(pointer:coarse)]:h-11" /></div>
      </div>
    </div>
    <div className="max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4"><div className="pb-20"><LoadingView bare /></div></div>
    <div aria-hidden="true" data-skeleton-bar="" className="lg:hidden fixed bottom-0 left-0 right-0 glass-nav z-40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex max-w-xl md:max-w-3xl mx-auto">{[0, 1, 2, 3].map((item) => <div key={item} className="min-h-14 flex-1 flex flex-col items-center justify-center py-2"><div className="h-[33px] w-[33px] rounded-xl bg-gray-200" /><div className="mt-0.5 h-5 w-14 rounded bg-gray-200" /></div>)}</div>
    </div>
  </div>;
}
// The portal of the last session on this device, so a client does not see the staff shell first.
// AppContent writes it as soon as the profile is resolved (staff or client), whichever screen follows.
const SHELL_HINT = 'expedile-shell';
const readShellHint = () => { try { return localStorage.getItem(SHELL_HINT); } catch { return null; } };
const writeShellHint = kind => { try { localStorage.setItem(SHELL_HINT, kind); } catch { /* the hint only shapes a placeholder */ } };
// Supabase Auth keeps a restored session as sb-<project>-auth-token; without one, the login page comes next.
const hasStoredSession = () => { try { return Object.keys(localStorage).some((key) => /^sb-.+-auth-token$/.test(key)); } catch { return false; } };
/** While the session is restored and the data load. The placeholders only shape the screen: the portal itself
 * is still decided by the resolved profile (auth.type), never by this hint. */
function AppLoading() {
  const { auth } = useApp();
  const kind = auth ? (auth.type === 'staff' ? 'staff' : 'client') : !hasStoredSession() ? 'none' : readShellHint() === 'client' ? 'client' : 'staff';
  if (kind === 'staff') return <StaffShellSkeleton />;
  if (kind === 'client') return <ClientShellSkeleton />;
  return <div className="min-h-[100dvh] flex items-center"><LoadingView /></div>;
}

class ScreenBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('[Expedîle] Écran indisponible', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" className="max-w-lg mx-auto p-8 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Cet écran n’a pas pu s’afficher</h1>
      <p className="text-sm text-gray-600">Rechargez votre espace. Les modifications déjà enregistrées sont conservées.</p>
      <button className="min-h-11 px-4 rounded-xl text-white brand-bg" onClick={() => window.location.reload()}>Recharger l’application</button>
    </div>;
  }
}

function MissingColis() {
  return <div className="max-w-lg mx-auto p-8 space-y-4"><h1 className="text-xl font-bold text-gray-900">Dossier indisponible</h1>
    <p className="text-sm text-gray-600">Ce dossier n’existe pas ou votre compte n’y a pas accès.</p>
    <a className="inline-flex min-h-11 items-center px-4 rounded-xl brand-bg text-white" href="/colis">Retour aux colis</a></div>;
}

function Permission({ allowed, children }) {
  if (allowed) return children;
  return <div role="alert" className="p-8"><h1 className="text-lg font-bold text-gray-900">Accès limité</h1><p className="text-sm text-gray-600 mt-2">Votre rôle ne permet pas d’utiliser cet écran. Contactez votre responsable si nécessaire.</p></div>;
}

// Fields that bring up a phone's on-screen keyboard.
const TEXT_ENTRY = 'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="image"]):not([type="reset"]):not([type="submit"]):not([type="hidden"])';

/** Below 1024px, while the on-screen keyboard is open for a text field (the
 * visual viewport noticeably shorter than the window, or under 640px), the
 * bottom navigation steps aside. The visible height decides: it is checked
 * when the keyboard opens or closes (visualViewport resize) and when a text
 * field takes the focus. Leaving a field never brings the bar back by itself:
 * the press that moves the focus to a button must end on that button, not on
 * a bar appearing under the finger (the keyboard closing brings it back). */
function useTypingOnPhone() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    const keyboardOpen = () => {
      const height = viewport ? viewport.height : window.innerHeight;
      return window.innerWidth < 1024 && (window.innerHeight - height > 120 || height < 640);
    };
    const typingIn = element => Boolean(element?.matches?.(TEXT_ENTRY)) && keyboardOpen();
    // A text field takes the focus with the keyboard already open: the bar steps aside.
    const focusIn = event => { if (typingIn(event.target)) setTyping(true); };
    // The keyboard opens or closes: the visible height and the focused element decide.
    const resize = () => setTyping(typingIn(document.activeElement));
    resize();
    document.addEventListener('focusin', focusIn);
    window.addEventListener('resize', resize);
    viewport?.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('focusin', focusIn);
      window.removeEventListener('resize', resize);
      viewport?.removeEventListener('resize', resize);
    };
  }, []);
  return typing;
}

/** The rendered height of an element (0 while hidden keeps the last one). */
function useMeasuredHeight() {
  const [height, setHeight] = useState(0);
  const observer = useRef(null);
  const ref = useCallback(node => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const measure = () => { if (node.offsetHeight > 0) setHeight(node.offsetHeight); };
    measure();
    if (typeof ResizeObserver === 'function') { observer.current = new ResizeObserver(measure); observer.current.observe(node); }
  }, []);
  return [ref, height];
}

// ── Wrapper: Staff colis detail (reads :id from URL) ──
function StaffColisDetail() {
  const { id } = useParams();
  const { setSelId, sel, selClient, data, dataLoading, refreshColis, can, workActions = [], auth, teamUsers = [], envois = [] } = useApp();
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const [contextSection, setContextSection] = useState(null);
  const [conversationVisited, setConversationVisited] = useState(null);
  const canMessages = ['perm_comm_message_libre', 'perm_comm_telegram', 'perm_comm_email', 'perm_comm_voir_chat_autres'].some(can);
  const conversationOpen = canMessages && new URLSearchParams(location.search).get('onglet') === 'conversation';
  const task = resolveDossierTask(sel || {}, location.search, workActions, can, selClient || {});
  const selectTab = tab => {
    setContextSection(null);
    const params = new URLSearchParams(location.search);
    params.delete('modifier');
    if (tab === 'conversation') params.set('onglet', 'conversation'); else params.delete('onglet');
    navigate(`${location.pathname}?${params}`, { state: location.state });
  };
  const openContext = section => section === 'messages' ? selectTab('conversation') : setContextSection(section);
  const openOverviewTask = next => {
    setContextSection(null);
    navigate(dossierTaskUrl(id, next, location.search, { hash: 'dossier-work' }));
  };
  const openOverviewEditor = next => {
    setContextSection(null);
    navigate(dossierTaskUrl(id, next, location.search, { edit: true, hash: 'dossier-work' }));
  };

  useEffect(() => {
    let active = true;
    setDetailLoading(true); setDetailError('');
    if (id) { setSelId(id); refreshColis(id).catch((error) => { if (active) setDetailError(error.message || 'Chargement impossible.'); }).finally(() => { if (active) setDetailLoading(false); }); }
    return () => { active = false; setSelId(null); };
  }, [id, setSelId, refreshColis]);

  useEffect(() => { setContextSection(null); }, [id]);
  useEffect(() => {
    if (detailLoading || conversationOpen || location.hash !== '#dossier-work') return;
    const frame = requestAnimationFrame(() => {
      const workspace = document.getElementById('dossier-work');
      if (!workspace?.contains(document.activeElement)) workspace?.focus({ preventScroll: true });
      workspace?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [detailLoading, conversationOpen, task, location.key, location.hash]);
  useEffect(() => { if (conversationOpen) setConversationVisited(id); }, [id, conversationOpen]);
  useEffect(() => {
    if (detailLoading || !sel || sel.id !== id) return;
    const params = new URLSearchParams(location.search);
    if (params.get('section') === task) return;
    // Pin the opening task: saving measurements or a colleague's update must
    // not replace the current form before its acknowledgement can be read.
    params.set('section', task);
    navigate(`${location.pathname}?${params}${location.hash}`, { replace: true, state: location.state });
  }, [detailLoading, id, sel?.id, task, location.search, location.hash, location.state, navigate]);

  if (dataLoading || detailLoading) return <LoadingView label="Chargement du dossier…" />;
  if (detailError) return <div role="alert" className="p-6 text-sm text-red-700">{detailError}<button onClick={() => window.location.reload()} className="block min-h-11 font-semibold underline">Réessayer</button></div>;
  if (!data.some((c) => c.id === id)) return <MissingColis />;
  if (!sel || sel.id !== id) return <LoadingView label="Ouverture du dossier…" />;

  const taskAction = findDossierWorkAction(sel, workActions, task, { can, actionId: new URLSearchParams(location.search).get('action') });
  const conversationAction = workActions.find(action => action.colis_id === id && action.kind === 'conversation' && action.state !== 'done');
  const colleagueWorking = Boolean(taskAction?.assignee_id && taskAction.assignee_id !== auth?.u?.id);
  // At « paye » the departure belongs to the expedition task: while a colleague holds that task,
  // the overview's Départ reads only too, as the task field does.
  const departureAction = sel.statut === 'paye' ? findDossierWorkAction(sel, workActions, 'expedition', { can }) : null;
  const departureHolder = departureAction?.assignee_id && departureAction.assignee_id !== auth?.u?.id ? departureAction.assignee_id : null;
  const overview = buildDossierOverview(sel, { client: selClient || {}, envois, can });
  const canEditCasier = !sel.archive && !['livre', 'annule'].includes(sel.statut)
    && ['perm_colis_receptionner', 'perm_colis_preparer', 'perm_colis_modifier_dims'].some(can);
  const canEditMeasures = phase => {
    const action = findDossierWorkAction(sel, workActions, phase, { can });
    const stage = needsQuoteRecalculation(sel) ? 'en_preparation' : sel.statut;
    const correction = phase === 'reception' ? stage !== 'receptionne'
      : !['autorise', 'en_preparation'].includes(stage) || sel.devisSnapshot?.inputs || sel.devisSnapshot && hasCurrentPreparation(sel);
    return !revisionLockedReason(sel, phase) && (!correction || can('perm_colis_revenir_arriere'))
      && can(phase === 'reception' ? 'perm_colis_mesurer' : 'perm_colis_preparer')
      && (!action?.assignee_id || action.assignee_id === auth?.u?.id);
  };
  const quoteAction = findDossierWorkAction(sel, workActions, 'devis', { can });
  const canEditQuote = !revisionLockedReason(sel, 'preparation') && can('perm_colis_calculer_devis')
    && (!['devis_envoye', 'attente_paiement'].includes(sel.statut) || can('perm_colis_revenir_arriere'))
    && (!quoteAction?.assignee_id || quoteAction.assignee_id === auth?.u?.id);
  return (
    <div className={conversationOpen ? 'dossier-page dossier-page--conversation' : 'dossier-page'}>
      <DetailHeader task={task} conversation={conversationOpen} onOpenContext={openContext} />
      <DossierAlerts conversation={conversationOpen} departureReadOnly={Boolean(departureHolder)} />
      <div className="dossier-page-tabs">
        <div className={`w-full px-4 sm:px-6 lg:px-8 ${conversationOpen ? '' : 'mx-auto max-w-[1600px]'}`}>
          <nav role="tablist" aria-label="Dossier et conversation" className="dossier-view-tabs" onKeyDown={event => {
            if (!canMessages || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'colis' : event.key === 'End' ? 'conversation' : conversationOpen ? 'colis' : 'conversation';
            selectTab(next); document.getElementById(`dossier-tab-${next}`)?.focus();
          }}>
            {[['colis', 'Colis'], ...(canMessages ? [['conversation', 'Conversation']] : [])].map(([key, label]) => {
              const selected = (key === 'conversation') === conversationOpen;
              const unread = key === 'conversation' ? (sel.messages || []).filter(message => message.type === 'client' && !message.lu).length : 0;
              return <button key={key} id={`dossier-tab-${key}`} role="tab" aria-selected={selected} aria-controls={`dossier-panel-${key}`} tabIndex={selected ? 0 : -1} onClick={() => selectTab(key)} className="dossier-view-tab">{label}{unread > 0 && <span className="dossier-tab-count" aria-label={`${unread} messages non lus`}>{unread}</span>}</button>;
            })}
          </nav>
        </div>
      </div>
      <section role="tabpanel" id="dossier-panel-colis" aria-labelledby="dossier-tab-colis" hidden={conversationOpen}>
      <div className="mx-auto max-w-[1600px] px-4 pt-4 sm:px-6 lg:px-8">
        <DossierDeparture readOnly={Boolean(departureHolder)} lockedReason={departureHolder ? `${staffName(departureHolder, teamUsers)} s’occupe de l’expédition.` : ''}>
          {({ line, editor }) => <DossierOverview dossier={sel} model={overview} currentTask={task}
            onNavigateTask={openOverviewTask} onCorrect={openOverviewEditor} onOpenContext={openContext} canEditQuote={canEditQuote}
            canEditCasier={canEditCasier} canEditReception={canEditMeasures('reception')} canEditPreparation={canEditMeasures('preparation')}
            departure={line} departureEditor={editor} />}
        </DossierDeparture>
      </div>
      <div id="dossier-work" tabIndex={-1} className="mx-auto max-w-[1600px] scroll-mt-4 px-4 py-5 outline-none sm:px-6 lg:px-8" aria-label={`Travail : ${DOSSIER_TASKS[task]?.label || task}`} data-testid="dossier-task-workspace">
        {location.state?.receivedCarton?.colisId === id && <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800"><span>Carton {location.state.receivedCarton.index + 1} enregistré dans {sel.ref}.</span><button className="min-h-11 font-semibold underline" onClick={() => setContextSection('reception')}>Voir le carton reçu</button></div>}
        {colleagueWorking && <p role="status" className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{staffName(taskAction.assignee_id, teamUsers)} s’occupe de cette tâche. Vous pouvez la consulter. Pour la reprendre, demandez un relais ou utilisez la réaffectation dans les options de la tâche.</p>}
        <TaskAccessBoundary readOnly={colleagueWorking}><StaffDetailView workspace active={!conversationOpen} task={task} onOpenContext={openContext} /></TaskAccessBoundary>
      </div>
      </section>
      {canMessages && <section role="tabpanel" id="dossier-panel-conversation" aria-labelledby="dossier-tab-conversation" hidden={!conversationOpen} className="dossier-conversation">
        {(conversationOpen || conversationVisited === id) && <><div className="dossier-conversation__chat"><ChatPanel key={id} colis={sel} client={selClient} embedded active={conversationOpen} ownership={conversationAction && <TaskOwnership key={conversationAction.id} action={conversationAction} compact />} /></div><details className="dossier-conversation__history"><summary><ChevronRight size={18} aria-hidden="true" />Ce qui a déjà été fait</summary><AuditLog key={id} expanded includeAudit={can('perm_admin_audit')} /></details></>}
      </section>}
      <DossierContextPanel key={sel.id} section={contextSection} onSectionChange={setContextSection} onClose={() => setContextSection(null)} />
    </div>
  );
}

// ── Wrapper: Client colis detail (reads :id from URL) ──
function MissingClientColis() {
  return <div className="max-w-lg mx-auto py-8 space-y-4"><h1 className="text-xl font-bold text-gray-900">Expédition introuvable</h1>
    <p className="text-sm text-gray-600">Cette expédition n’existe pas ou n’est pas rattachée à votre compte. Toutes vos expéditions restent consultables dans votre espace, et notre équipe peut vous aider si besoin.</p>
    <div className="flex flex-wrap items-center gap-3"><Link className="inline-flex min-h-11 items-center px-4 rounded-xl brand-bg text-white font-semibold transition-all duration-200 ease-out hover:translate-y-[-1px] active:scale-[0.98]" to="/colis">Retour à mes expéditions</Link><a className="inline-flex min-h-11 items-center text-sm font-semibold underline" href="mailto:contact@expedile.fr?subject=Une%20exp%C3%A9dition%20introuvable">Contacter l’équipe</a></div></div>;
}

function ClientColisDetail() {
  const { id } = useParams();
  const { setSelId, sel, data, dataLoading, dataError, sbReady, refreshColis, retryLoad } = useApp();
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const known = data.some((c) => c.id === id);
  // The title says what the page says: the expedition, or that it cannot be found.
  const missing = !known && !dataLoading && !detailLoading && !detailError && !(!sbReady && dataError);
  useDocumentTitle(sel?.id === id && sel.ref ? `Expédition ${sel.ref}` : missing ? 'Expédition introuvable' : 'Mon expédition');

  // Selected before paint: an expedition already shown in a list opens at once
  // and stays visible while its latest version is read.
  useLayoutEffect(() => {
    if (!id) return undefined;
    setSelId(id);
    return () => setSelId(null);
  }, [id, setSelId]);
  useEffect(() => {
    let active = true;
    setDetailLoading(true); setDetailError('');
    if (id) refreshColis(id).catch((error) => { if (active) setDetailError(error.message || 'Chargement impossible.'); }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [id, refreshColis, attempt]);

  const retry = () => { if (!sbReady) retryLoad(); setAttempt((value) => value + 1); };
  if (!known) {
    if (dataLoading || detailLoading) return <ClientPortalSkeleton view="detail" />;
    if (detailError || (!sbReady && dataError)) return <ClientDossiersError onRetry={retry} title="Cette expédition ne peut pas s’afficher pour le moment" />;
    return <MissingClientColis />;
  }
  if (!sel || sel.id !== id) return <ClientPortalSkeleton view="detail" />;

  return (
    <div className="space-y-4">
      {detailLoading && <p role="status" className="sr-only">Actualisation de votre expédition…</p>}
      {detailError && <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2 text-sm" style={{ background: 'var(--attention-bg)', color: 'var(--attention-text)', borderColor: 'var(--attention-border)' }}>
        <span className="min-w-0 flex-1">Les dernières nouvelles de cette expédition n’ont pas pu être chargées. Vous voyez les informations du dernier chargement.</span>
        <button type="button" onClick={retry} className="min-h-11 font-semibold underline">Réessayer</button>
      </div>}
      <ClientDetailView />
      <ClientDossierContext key={sel.id} />
    </div>
  );
}

// Where a voluntary password change returns: a page of this space, never the password page itself.
const safePasswordOrigin = from => typeof from === 'string' && /^\/(?!\/)/.test(from) && !from.startsWith('/password') ? from : '';

function PasswordScreen(props) {
  useDocumentTitle(props.recovery ? 'Réinitialiser mon mot de passe' : 'Mot de passe');
  return <ForceChangePassword {...props} />;
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, authLoading, authError, signOut, isStaff, authCl, updateClient, sbReady, dataLoading, dataError, retryLoad, passwordRecovery, completePasswordRecovery, can, flash, ask, data = [], inboxItems = [] } = useApp();
  const conversationCount = data.filter(item => !item.archive && needsConversationAction(item)).length + inboxItems.filter(item => item.status === 'unassigned').length;
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const typingOnPhone = useTypingOnPhone();
  const [bottomNavRef, bottomNavHeight] = useMeasuredHeight();
  useEffect(() => { setOnboardingDismissed(false); }, [auth?.session?.user?.id]);
  // Once the profile is resolved, the next visit starts from the right shell (staff or client).
  useEffect(() => { if (auth?.type) writeShellHint(auth.type === 'staff' ? 'staff' : 'client'); }, [auth?.type]);
  const needsPassword = passwordRecovery || auth?.u?.mustChangePassword || location.pathname === '/password';

  // A client identity is known before its expeditions: the portal shows its own skeletons meanwhile.
  if (authLoading && auth?.type !== 'client') return <AppLoading />;
  if (!auth) return <LoginPage />;

  const handleLogout = async () => {
    try { await signOut(); navigate('/', { replace: true }); }
    catch (error) { flash({ msg: error.message || 'Déconnexion impossible. Réessayez.', type: 'error' }); }
  };
  // On a phone the logout sits in « Plus », behind a confirmation: one stray tap
  // never ends the session nor clears the drafts kept on this device.
  const confirmLogout = () => ask('Se déconnecter ?', 'Vos brouillons non enregistrés sur cet appareil seront effacés. Les dossiers et messages enregistrés sont conservés.', handleLogout, { okLabel: 'Se déconnecter' });

  if (needsPassword) {
    // A chosen change goes back where it was asked (« Plus », a page, the profile).
    const voluntary = !passwordRecovery && !auth.u?.mustChangePassword;
    const origin = safePasswordOrigin(location.state?.from) || (isStaff ? '/' : '/profil');
    return <PasswordScreen
      staffUser={auth.u?.mustChangePassword ? { id: auth.u.staffId } : null}
      recovery={passwordRecovery}
      onDone={async () => {
        const created = Boolean(auth.u?.mustChangePassword);
        await completePasswordRecovery();
        // Confirmed by Auth: said once the space is back on screen.
        flash({ msg: created ? 'Mot de passe enregistré.' : 'Mot de passe modifié.', type: 'success', duration: 8000 });
        // A chosen change returns where it was asked, never through « / »; when the
        // password page has already sent the person back itself, its return stands.
        if (!voluntary) navigate('/', { replace: true });
        else if (window.location.pathname === '/password') navigate(origin, { replace: true });
      }}
      onCancel={voluntary ? () => navigate(origin, { replace: true }) : undefined}
    />;
  }

  // A failed first load: the pages that state it themselves (reason and « Réessayer »)
  // take the banner's place; loaded data kept after a failed refresh: the banner, everywhere.
  const dataState = staffDataState({ sbReady, dataLoading, dataError, hasData: data.length > 0 });
  const loadBanner = isStaff && shellLoadBanner(location.pathname, dataState.state) ? <div role="alert" className="bg-red-50 border-b border-red-200 text-red-800 text-xs px-4 py-3 flex flex-wrap items-center gap-2">
    <AlertTriangle size={16} /><span className="flex-1">{dataError || 'Connexion aux données interrompue. Réessayez avant de modifier un dossier.'}</span>
    <button onClick={retryLoad} className="font-bold underline min-h-11">Réessayer</button>
  </div> : null;

  // ── Onboarding for new clients ──
  const isColisDetail = location.pathname.startsWith('/colis/');
  const showOnboarding = !isStaff && authCl && !authCl.onboarded && !onboardingDismissed && !isColisDetail;

  // ── Staff layout with sidebar ──
  if (isStaff) {
    const currentPath = location.pathname;

    const NAV_ITEMS = [
      { key: '/', label: 'Mon travail', icon: LayoutDashboard },
      { key: '/colis', label: 'Dossiers d’expédition', icon: Package },
      { key: '/conversations', label: 'Conversations', icon: MessageCircle, visible: can('perm_comm_message_libre') || can('perm_comm_telegram') || can('perm_comm_email') || can('perm_comm_voir_chat_autres') },
      { key: '/equipe', label: 'Équipe', icon: Users },
      { key: '/departs', label: 'Départs', icon: Plane, visible: can('perm_envois_voir') },
      { key: '/clients', label: 'Clients', icon: Contact, visible: can('perm_clients_voir') || can('perm_clients_creer') },
      { key: '/devis', label: 'Estimation', icon: FileText, visible: can('perm_colis_calculer_devis') },
      { key: '/settings', label: 'Paramètres', icon: Settings, visible: ['perm_admin_parametres', 'perm_admin_utilisateurs', 'perm_admin_templates', 'perm_finances_modifier_tarifs', 'perm_admin_categories', 'perm_admin_produits_interdits'].some(can) },
    ].filter((item) => item.visible !== false);

    // A thread opened from Conversations stays under Conversations, on its dossier page too.
    const search = new URLSearchParams(location.search);
    const conversationThread = currentPath.startsWith('/colis/') && (search.get('onglet') === 'conversation' || (search.get('returnTo') || '').startsWith('/conversations'));
    const activePath = conversationThread ? '/conversations'
      : currentPath.startsWith('/colis') ? '/colis'
      : currentPath.startsWith('/clients') ? '/clients'
      : currentPath === '/devis' ? '/devis'
      : currentPath === '/settings' ? '/settings'
      : ['/equipe', '/conversations', '/departs', '/plus', '/reception'].includes(currentPath) ? currentPath : '/';
    const mobileItems = NAV_ITEMS.filter((item) => ['/', '/colis', '/conversations'].includes(item.key)).map((item) => ({ ...item, label: item.key === '/colis' ? 'Dossiers' : item.label }));
    mobileItems.push({ key: '/plus', label: 'Plus', icon: MoreHorizontal });
    const moreItems = NAV_ITEMS.filter((item) => !['/', '/colis', '/conversations'].includes(item.key));
    const conversationDescription = `${plural(conversationCount, 'demande')} à traiter`;
    const displayName = staffDisplayName(auth.u);
    const fullName = [auth.u?.prenom, auth.u?.nom].filter(Boolean).join(' ') || displayName;

    return (
      <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }} className="h-[100dvh] flex overflow-hidden">
        <Toast route={location.pathname} />
        <ConfirmDialog />

        {/* ── Sidebar (desktop) ──────────────────────────────────────── */}
        <div
          className="staff-sidebar hidden lg:flex flex-col flex-shrink-0 border-r border-gray-800 transition-all duration-200"
          style={{
            width: sidebarCollapsed ? 64 : 220,
            background: 'linear-gradient(180deg, #122A36 0%, #1B3A4B 100%)',
          }}
        >
          {/* Logo */}
          <div className="px-4 py-4 flex items-center justify-between">
            {!sidebarCollapsed ? (
              <b className="text-lg text-white tracking-tight">
                EXPÉD<span style={{ color: BRAND.gold }}>ÎLE</span>
              </b>
            ) : (
              <b className="text-lg text-white tracking-tight mx-auto">
                E<span style={{ color: BRAND.gold }}>.</span>
              </b>
            )}
          </div>

          {/* New colis button: its label holds on one line in the 220px sidebar. */}
          <div className="px-2 mb-2" hidden={!can('perm_colis_receptionner')}>
            <button
              aria-label="Réceptionner des cartons" onClick={() => navigate(`/reception?${new URLSearchParams({ returnTo: location.pathname + location.search })}`)}
              className={`staff-sidebar-receive w-full min-h-11 flex items-center gap-1.5 rounded-xl px-2 text-left text-[13px] font-bold leading-tight tracking-[-0.02em] transition-all active:scale-95 ${sidebarCollapsed ? 'justify-center' : ''}`}
              style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD }}
            >
              <Plus size={16} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />
              {!sidebarCollapsed && 'Réceptionner des cartons'}
            </button>
          </div>

          {/* Navigation */}
          {/* Its free space below the entries holds the toasts (ui/Toast.jsx). */}
          <nav data-toast-zone="" className="flex-1 px-3 space-y-1">
            {NAV_ITEMS.filter((item) => item.key !== '/settings').map((item) => {
              const Icon = item.icon;
              const isActive = activePath === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => navigate(item.key)}
                  aria-label={item.label} aria-description={item.key === '/conversations' ? conversationDescription : undefined} aria-current={isActive ? 'page' : undefined}
                  className={`w-full flex items-center gap-3 rounded-xl text-left transition-all ${
                    sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'
                  } ${isActive
                    ? 'bg-white bg-opacity-15 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                  {!sidebarCollapsed && (
                    <span className="text-sm font-semibold">{item.label}</span>
                  )}
                  {item.key === '/conversations' && !sidebarCollapsed && conversationCount > 0 && <span aria-hidden="true" className="ml-auto rounded-full bg-white/15 px-2 text-xs text-white">{conversationCount}</span>}
                </button>
              );
            })}
          </nav>

          {NAV_ITEMS.some(item => item.key === '/settings') && <button onClick={() => navigate('/settings')} aria-label="Paramètres" aria-current={activePath === '/settings' ? 'page' : undefined} className={`mx-3 mb-2 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${activePath === '/settings' ? 'bg-white/15 text-white' : 'text-gray-300 hover:bg-white/10'}`}><Settings size={18} />{!sidebarCollapsed && 'Paramètres'}</button>}
          {/* Collapse toggle */}
          <div className="px-3 py-2">
            <button
              aria-label={sidebarCollapsed ? 'Déplier la navigation' : 'Réduire la navigation'} onClick={() => setSidebarCollapsed((p) => !p)}
              className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/10 transition-all"
            >
              {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              {!sidebarCollapsed && <span className="text-xs font-medium">Réduire</span>}
            </button>
          </div>

          <div className="px-3 pb-3 pt-3 border-t border-white/10">
            <div className={`flex items-center gap-2.5 ${sidebarCollapsed ? 'justify-center' : ''}`}>
              {/* The same name as Mon travail: the first name, else the account name. */}
              <div aria-hidden="true" className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0" style={{ background: `${BRAND.gold}30`, color: BRAND.gold }}>{(displayName || '?').charAt(0).toLocaleUpperCase('fr-FR')}</div>
              {!sidebarCollapsed && <div className="min-w-0 flex-1"><p data-staff-name="" className="text-xs font-semibold text-gray-200 truncate" title={fullName}>{displayName}</p><p className="text-[11px] text-gray-300 mt-0.5">{{ directeur: 'Direction', vice_directeur: 'Direction adjointe', logisticien: 'Logistique', preparateur: 'Préparation' }[auth.u.role] || 'Équipe'}</p></div>}
            </div>
            <div className={`mt-2 flex items-center ${sidebarCollapsed ? 'flex-col gap-1' : 'justify-between'}`}>
              <ThemeToggle compact />
              <button onClick={() => navigate('/password', { state: { from: location.pathname + location.search } })} className="min-w-10 min-h-10 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-white/10 flex items-center justify-center" title="Modifier le mot de passe" aria-label="Modifier le mot de passe"><Key size={16} /></button>
              <button onClick={handleLogout} className="min-w-10 min-h-10 rounded-lg text-gray-400 hover:text-red-400 hover:bg-white/10 flex items-center justify-center" title="Se déconnecter" aria-label="Se déconnecter"><LogOut size={16} /></button>
            </div>
          </div>
        </div>

        {/* ── Mobile bottom nav ──────────────────────────────────────── */}
        {/* Hidden while typing on a phone: the keyboard already takes the bottom of the screen. */}
        <div
          ref={bottomNavRef} data-staff-bottom-nav="" data-toast-floor="" data-typing={typingOnPhone ? 'true' : undefined}
          className={`${typingOnPhone ? 'hidden' : 'flex'} lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 items-center justify-around py-2 px-1`}
          style={{ background: 'var(--bg-elevated)', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          {mobileItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePath === item.key || (item.key === '/plus' && moreItems.some((entry) => entry.key === activePath));
            return (
              <button
                key={item.key}
                onClick={() => navigate(item.key)}
                  aria-label={item.label} aria-description={item.key === '/conversations' ? conversationDescription : undefined} aria-current={isActive ? 'page' : undefined}
                className="staff-bottom-nav-item flex-1 min-w-max min-h-11 flex flex-col items-center justify-center gap-0.5 px-0.5 py-1"
              >
                <span className="relative"><Icon size={20} aria-hidden="true" style={{ color: isActive ? 'var(--brand-text)' : '#9CA3AF' }} strokeWidth={isActive ? 2.5 : 2} />{item.key === '/conversations' && conversationCount > 0 && <span aria-hidden="true" className="absolute -right-5 -top-2 rounded-full bg-blue-800 px-1 text-xs font-bold text-white">{conversationCount > 99 ? '99+' : conversationCount}</span>}</span>
                {/* One line at 11px: a wrapped label would grow the bar over the space the pages
                    reserve for it. At 320px a longer label (« Conversations ») takes its width
                    from the shorter ones (min-w-max) rather than wrapping. */}
                <span className={`whitespace-nowrap text-[11px] font-bold leading-4 ${isActive ? 'text-gray-800' : 'text-gray-500'}`}>{item.label}</span>
              </button>
            );
          })}

        </div>

        {/* ── Main content area ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
          <div data-toast-ceiling="" className="lg:hidden min-h-12 px-4 flex items-center justify-between border-b border-gray-200">
            <span className="font-black brand-t">EXPÉD<span className="brand-t-gold">ÎLE</span></span>
            {/* The logout lives in « Plus », away from the theme toggle. */}
            <div className="flex items-center gap-2">{can('perm_colis_receptionner') && <button aria-label="Réceptionner des cartons" onClick={() => navigate(`/reception?${new URLSearchParams({ returnTo: location.pathname + location.search })}`)} className="min-h-11 inline-flex items-center gap-1 whitespace-nowrap rounded-xl px-2 text-xs font-bold brand-t"><Plus size={18} className="shrink-0" />Recevoir</button>}<ThemeToggle compact /></div>
          </div>
          {loadBanner}
          {/* The one <main> of every staff page: the pages render their content without their own.
              Below 1024px it keeps exactly the measured height of the bottom navigation free,
              nothing while the navigation steps aside for the keyboard (staffShell.css holds the
              first-render reserve and the desktop). */}
          <main className="staff-main flex-1 min-h-0 overflow-y-auto" style={bottomNavHeight ? { paddingBottom: typingOnPhone ? 0 : bottomNavHeight, scrollPaddingBottom: typingOnPhone ? 0 : bottomNavHeight } : undefined}>
            {dataLoading ? <LoadingView /> : <Suspense fallback={<LoadingView />}><ScreenBoundary key={location.pathname}>
            <Routes>
              <Route path="/equipe" element={<TeamWorkView />} />
              <Route path="/conversations" element={<Permission allowed={can('perm_comm_message_libre') || can('perm_comm_telegram') || can('perm_comm_email') || can('perm_comm_voir_chat_autres')}><ConversationsView /></Permission>} />
              <Route path="/departs" element={<Permission allowed={can('perm_envois_voir')}><StaffDepartures /></Permission>} />
              <Route path="/travail" element={<Navigate to="/" replace />} />
              <Route path="/plus" element={<div className="mx-auto max-w-xl space-y-4 p-5"><h1 className="text-2xl font-bold brand-t">Votre espace</h1><nav aria-label="Autres rubriques" className="grid gap-3">{moreItems.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => navigate(key)} className="flex min-h-14 items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left font-semibold text-gray-800"><Icon size={20} aria-hidden="true" />{label}<ChevronRight size={18} aria-hidden="true" className="ml-auto" /></button>)}</nav>
                {/* The account commands of the desktop sidebar, below 1024px. */}
                <section aria-labelledby="plus-account-title" className="space-y-3 border-t border-gray-200 pt-4"><h2 id="plus-account-title" className="text-[11px] font-bold uppercase tracking-wider text-gray-600">Mon compte</h2><p className="text-sm text-gray-600">{fullName}</p>
                  <button onClick={() => navigate('/password', { state: { from: '/plus' } })} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left font-semibold text-gray-800"><Key size={20} aria-hidden="true" />Modifier le mot de passe<ChevronRight size={18} aria-hidden="true" className="ml-auto" /></button>
                  <button onClick={confirmLogout} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left font-semibold text-red-700"><LogOut size={20} aria-hidden="true" />Se déconnecter</button>
                </section></div>} />
              <Route path="/reception" element={<Permission allowed={can('perm_colis_receptionner')}><ReceptionPage /></Permission>} />
              <Route path="/colis/:id" element={<StaffColisDetail />} />
              <Route path="/colis" element={
                <StaffColisPage />
              } />
              <Route path="/clients" element={
                <div className="h-full overflow-y-auto">
                  <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
                    <Permission allowed={can('perm_clients_voir') || can('perm_clients_creer')}><StaffClients /></Permission>
                  </div>
                </div>
              } />
              <Route path="/clients/new" element={
                <div className="h-full overflow-y-auto">
                  <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
                    <Permission allowed={can('perm_clients_voir') || can('perm_clients_creer')}><StaffClientDetail /></Permission>
                  </div>
                </div>
              } />
              <Route path="/clients/:id" element={
                <div className="h-full overflow-y-auto">
                  <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
                    <Permission allowed={can('perm_clients_voir') || can('perm_clients_creer')}><StaffClientDetail /></Permission>
                  </div>
                </div>
              } />
              <Route path="/devis" element={
                <div className="h-full overflow-y-auto">
                  <Permission allowed={can('perm_colis_calculer_devis')}><DevisProspect /></Permission>
                </div>
              } />
              <Route path="/settings" element={
                <div className="h-full overflow-y-auto">
                  <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
                    <Permission allowed={['perm_admin_parametres', 'perm_admin_utilisateurs', 'perm_admin_templates', 'perm_finances_modifier_tarifs', 'perm_admin_categories', 'perm_admin_produits_interdits'].some(can)}><StaffSettings /></Permission>
                  </div>
                </div>
              } />
              <Route path="/" element={
                <PersonalWorkView />
              } />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </ScreenBoundary></Suspense>}
          </main>
        </div>
      </div>
    );
  }

  // ── Client layout ──
  const clientView = clientViewForPath(location.pathname);
  // First load (or a retry after a failed first load): skeletons. A later
  // refresh keeps the expeditions displayed, with a notice if it fails.
  const clientLoading = dataLoading && !sbReady;
  const clientRefreshFailed = sbReady && !!dataError;
  const initial = (authCl?.prenom || getPrenom(authCl) || authCl?.nom || '?').trim().charAt(0).toUpperCase();
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", background: 'var(--bg-canvas)' }} className="min-h-[100dvh]">
      <Toast route={location.pathname} />
      <ConfirmDialog />

      <header
        data-toast-ceiling=""
        className="glass-dark border-b border-white border-opacity-5 sticky top-0 z-20"
        style={{ background: 'linear-gradient(135deg, rgba(18,42,54,0.98), rgba(27,58,75,0.98))' }}
      >
        <div className="mx-auto flex min-h-[60px] max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl items-stretch justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <b className="text-lg text-white tracking-tight">
              EXPÉD<span style={{ color: BRAND.gold }}>ÎLE</span>
            </b>
          </div>
          <ClientTopNav />
          <div className="flex items-center gap-2">
            <ThemeToggle onDark />
            {authCl && (
              <Link
                to="/profil"
                aria-label={getPrenom(authCl) ? `Mon profil · ${getPrenom(authCl)}` : 'Mon profil'}
                className="flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-white transition-all duration-200 ease-out hover:bg-white/10"
              >
                <span className="max-w-[7rem] truncate text-sm font-medium text-white/90 sm:max-w-[12rem]">{getPrenom(authCl)}</span>
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-black"
                  style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD }}
                >
                  {initial}
                </span>
              </Link>
            )}
          </div>
        </div>
      </header>

      {clientRefreshFailed && <div role="status" className="border-b px-4 py-2 text-sm" style={{ background: 'var(--attention-bg)', color: 'var(--attention-text)', borderColor: 'var(--attention-border)' }}>
        <div className="mx-auto flex max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 sm:px-2 lg:px-4">
          <RefreshCw size={16} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1">Nous n’arrivons pas à actualiser vos expéditions pour le moment. Les informations affichées sont celles du dernier chargement.</span>
          <button type="button" onClick={retryLoad} disabled={dataLoading} className="min-h-11 font-semibold underline disabled:opacity-60">{dataLoading ? 'Actualisation…' : 'Réessayer'}</button>
        </div>
      </div>}

      <main className="mx-auto max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 sm:px-6 lg:px-8 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pb-12">
        {showOnboarding && (
          <OnboardingOverlay
            onDone={async () => {
              if (authCl) await updateClient(authCl.id, { onboarded: true }, true);
              setOnboardingDismissed(true);
            }}
          />
        )}
        {clientLoading ? <ClientPortalSkeleton view={clientView} /> : <Suspense fallback={<ClientPortalSkeleton view={clientView} />}><ScreenBoundary key={location.pathname}><Routes>
          <Route path="/" element={<ClientAccueil />} />
          <Route path="/colis" element={<ClientColis />} />
          <Route path="/colis/:id" element={<ClientColisDetail />} />
          <Route path="/notifications" element={<ClientNotifs />} />
          <Route path="/profil" element={<ClientProfil />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></ScreenBoundary></Suspense>}
      </main>
      <ClientBottomNav />
    </div>
  );
}

function AppRoutes() {
  const location = useLocation();
  const legacyPayment = /^\/colis\/([^/]+)\/?$/.exec(location.pathname);
  const paymentResult = new URLSearchParams(location.search).get('payment');
  if (legacyPayment && ['returned', 'cancelled'].includes(paymentResult)) return <Suspense fallback={<LoadingView label="Vérification du paiement…" />}><ScreenBoundary><PaymentReturn colisId={legacyPayment[1]} /></ScreenBoundary></Suspense>;
  return (
      <Routes>
        <Route path="/paiement/retour" element={<Suspense fallback={<LoadingView label="Vérification du paiement…" />}><ScreenBoundary><PaymentReturn /></ScreenBoundary></Suspense>} />
        {/* Route publique — suivi partagé par token (pas d'auth nécessaire) */}
        <Route path="/suivi/:token" element={<Suspense fallback={<PublicTrackingSkeleton />}><ScreenBoundary><TrackingPublic /></ScreenBoundary></Suspense>} />
        {/* Toute autre route passe par l'app authentifiée */}
        <Route path="/*" element={
          <AppProvider>
            <AppContent />
          </AppProvider>
        } />
      </Routes>
  );
}

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}
