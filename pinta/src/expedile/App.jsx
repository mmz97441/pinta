import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';
import { Settings, Users, LogOut, LayoutDashboard, Package, ChevronLeft, ChevronRight, Plus, FileText, Key, AlertTriangle, MessageCircle, Plane, MoreHorizontal } from 'lucide-react';
import './brand.css';
import { getPrenom } from './utils';

import { AppProvider, useApp } from './context/AppContext';
import { BRAND } from './constants';


import { Toast, ConfirmDialog } from './components/ui';
import ThemeToggle from './components/ui/ThemeToggle';
import LoginPage from './components/LoginPage';
import ForceChangePassword from './components/ForceChangePassword';
import ColisModal from './components/ColisModal';
import OnboardingOverlay from './components/client/OnboardingOverlay';

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

const ClientAccueil = lazy(() => import('./components/client/ClientAccueil'));
const ClientColis = lazy(() => import('./components/client/ClientColis'));
const ClientNotifs = lazy(() => import('./components/client/ClientNotifs'));
const ClientProfil = lazy(() => import('./components/client/ClientProfil'));
import ClientDetailView from './components/client/ClientDetailView';
import ClientDossierContext from './components/client/ClientDossierContext';
import ClientBottomNav from './components/client/ClientBottomNav';

import DetailHeader from './components/detail/DetailHeader';
import DossierContextPanel from './components/detail/DossierContextPanel';
import { dossierTaskUrl, resolveDossierTask } from './domain/dossierTasks';

function LoadingView({ label = 'Chargement de votre espace…' }) {
  return <div role="status" aria-live="polite" className="max-w-5xl mx-auto w-full p-6 space-y-5">
    <p className="text-sm font-semibold text-gray-600">{label}</p>
    <div className="h-8 w-1/2 rounded-xl bg-gray-100 animate-pulse" />
    <div className="grid grid-cols-2 gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-gray-100 animate-pulse" />)}</div>
  </div>;
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

function MissingColis({ isClient }) {
  return <div className="max-w-lg mx-auto p-8 space-y-4"><h1 className="text-xl font-bold text-gray-900">Dossier indisponible</h1>
    <p className="text-sm text-gray-600">Ce dossier n’existe pas ou votre compte n’y a pas accès.</p>
    <a className="inline-flex min-h-11 items-center px-4 rounded-xl brand-bg text-white" href={isClient ? '/colis' : '/colis'}>Retour aux colis</a></div>;
}

function Permission({ allowed, children }) {
  if (allowed) return children;
  return <div role="alert" className="p-8"><h1 className="text-lg font-bold text-gray-900">Accès limité</h1><p className="text-sm text-gray-600 mt-2">Votre rôle ne permet pas d’utiliser cet écran. Contactez votre responsable si nécessaire.</p></div>;
}

// ── Wrapper: Staff colis detail (reads :id from URL) ──
function StaffColisDetail() {
  const { id } = useParams();
  const { setSelId, sel, data, dataLoading, refreshColis, can, workActions = [] } = useApp();
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const [contextSection, setContextSection] = useState(null);
  const task = resolveDossierTask(sel || {}, location.search, workActions, can);

  useEffect(() => {
    let active = true;
    setDetailLoading(true); setDetailError('');
    if (id) { setSelId(id); refreshColis(id).catch((error) => { if (active) setDetailError(error.message || 'Chargement impossible.'); }).finally(() => { if (active) setDetailLoading(false); }); }
    return () => { active = false; setSelId(null); };
  }, [id, setSelId, refreshColis]);

  useEffect(() => { setContextSection(null); }, [id]);
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

  return (
    <>
      <DetailHeader task={task} onOpenContext={setContextSection} />
      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8" data-testid="dossier-task-workspace">
        {location.state?.receivedCarton?.colisId === id && <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800"><span>Carton {location.state.receivedCarton.index + 1} enregistré dans {sel.ref}.</span><button className="min-h-11 font-semibold underline" onClick={() => setContextSection('reception')}>Voir le carton reçu</button></div>}
        <StaffDetailView workspace task={task} onOpenContext={setContextSection} />
      </div>
      <DossierContextPanel key={sel.id} section={contextSection} onSectionChange={setContextSection} onClose={() => setContextSection(null)} />
    </>
  );
}

// ── Wrapper: Client colis detail (reads :id from URL) ──
function ClientColisDetail() {
  const { id } = useParams();
  const { setSelId, sel, data, dataLoading, refreshColis } = useApp();
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    let active = true;
    setDetailLoading(true); setDetailError('');
    if (id) { setSelId(id); refreshColis(id).catch((error) => { if (active) setDetailError(error.message || 'Chargement impossible.'); }).finally(() => { if (active) setDetailLoading(false); }); }
    return () => { active = false; setSelId(null); };
  }, [id, setSelId, refreshColis]);

  if (dataLoading || detailLoading) return <LoadingView label="Chargement du dossier…" />;
  if (detailError) return <div role="alert" className="p-6 text-sm text-red-700">{detailError}<button onClick={() => window.location.reload()} className="block min-h-11 font-semibold underline">Réessayer</button></div>;
  if (!data.some((c) => c.id === id)) return <MissingColis isClient />;
  if (!sel || sel.id !== id) return <LoadingView label="Ouverture du dossier…" />;

  return (
    <div className="space-y-4">
      <ClientDetailView />
      <ClientDossierContext key={sel.id} />
    </div>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, authLoading, authError, signOut, isStaff, authCl, updateClient, sbReady, dataLoading, dataError, retryLoad, passwordRecovery, completePasswordRecovery, can, flash } = useApp();
  const [modal, setModal] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => { setOnboardingDismissed(false); }, [auth?.session?.user?.id]);
  const needsPassword = passwordRecovery || auth?.u?.mustChangePassword || location.pathname === '/password';

  if (authLoading) return <div className="min-h-[100dvh] flex items-center"><LoadingView /></div>;
  if (!auth) return <LoginPage />;

  const handleLogout = async () => {
    try { await signOut(); navigate('/', { replace: true }); }
    catch (error) { flash({ msg: error.message || 'Déconnexion impossible. Réessayez.', type: 'error' }); }
  };

  if (needsPassword) return <ForceChangePassword
    staffUser={auth.u?.mustChangePassword ? { id: auth.u.staffId } : null}
    recovery={passwordRecovery}
    onDone={async () => { await completePasswordRecovery(); navigate('/', { replace: true }); }}
    onCancel={!passwordRecovery && !auth.u?.mustChangePassword ? () => navigate('/') : undefined}
  />;

  const loadBanner = dataError || (!sbReady && !dataLoading) ? <div role="alert" className="bg-red-50 border-b border-red-200 text-red-800 text-xs px-4 py-3 flex flex-wrap items-center gap-2">
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
      { key: '/clients', label: 'Clients', icon: Users, visible: can('perm_clients_voir') || can('perm_clients_creer') },
      { key: '/devis', label: 'Estimation', icon: FileText, visible: can('perm_colis_calculer_devis') },
      { key: '/settings', label: 'Paramètres', icon: Settings, visible: can('perm_admin_parametres') },
    ].filter((item) => item.visible !== false);

    const activePath = currentPath.startsWith('/colis') ? '/colis'
      : currentPath.startsWith('/clients') ? '/clients'
      : currentPath === '/devis' ? '/devis'
      : currentPath === '/settings' ? '/settings'
      : ['/equipe', '/conversations', '/departs', '/plus'].includes(currentPath) ? currentPath : '/';
    const mobileItems = NAV_ITEMS.filter((item) => ['/', '/colis', '/clients'].includes(item.key)).map((item) => ({ ...item, label: item.key === '/colis' ? 'Dossiers' : item.label }));
    mobileItems.push({ key: '/plus', label: 'Plus', icon: MoreHorizontal });
    const moreItems = NAV_ITEMS.filter((item) => !['/', '/colis', '/clients'].includes(item.key));

    return (
      <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }} className="h-[100dvh] flex overflow-hidden">
        <Toast />
        <ConfirmDialog />
        <ColisModal open={modal} onClose={() => setModal(false)} />

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

          {/* New colis button */}
          <div className="px-3 mb-2" hidden={!can('perm_colis_receptionner')}>
            <button
              aria-label="Réceptionner des cartons" onClick={() => setModal(true)}
              className={`w-full flex items-center gap-2 rounded-xl text-sm font-bold transition-all active:scale-95 ${sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}`}
              style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD }}
            >
              <Plus size={16} strokeWidth={2.5} />
              {!sidebarCollapsed && 'Réceptionner des cartons'}
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 space-y-1">
            {NAV_ITEMS.filter((item) => item.key !== '/settings').map((item) => {
              const Icon = item.icon;
              const isActive = activePath === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => navigate(item.key)}
                  aria-label={item.label} aria-current={isActive ? 'page' : undefined}
                  className={`w-full flex items-center gap-3 rounded-xl transition-all ${
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
                </button>
              );
            })}
          </nav>

          {can('perm_admin_parametres') && <button onClick={() => navigate('/settings')} aria-label="Paramètres" aria-current={activePath === '/settings' ? 'page' : undefined} className={`mx-3 mb-2 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${activePath === '/settings' ? 'bg-white/15 text-white' : 'text-gray-300 hover:bg-white/10'}`}><Settings size={18} />{!sidebarCollapsed && 'Paramètres'}</button>}
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
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0" style={{ background: `${BRAND.gold}30`, color: BRAND.gold }}>{(auth.u?.nom || '?').charAt(0)}</div>
              {!sidebarCollapsed && <div className="flex-1"><p className="text-xs font-semibold text-gray-200 truncate" title={auth.u?.nom}>{auth.u?.nom}</p><p className="text-[10px] text-gray-400 mt-0.5">{{ directeur: 'Direction', vice_directeur: 'Direction adjointe', logisticien: 'Logistique', preparateur: 'Préparation' }[auth.u.role] || 'Équipe'}</p></div>}
            </div>
            <div className={`mt-2 flex items-center ${sidebarCollapsed ? 'flex-col gap-1' : 'justify-between'}`}>
              <ThemeToggle compact />
              <button onClick={() => navigate('/password')} className="min-w-10 min-h-10 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-white/10 flex items-center justify-center" title="Modifier le mot de passe" aria-label="Modifier le mot de passe"><Key size={16} /></button>
              <button onClick={handleLogout} className="min-w-10 min-h-10 rounded-lg text-gray-400 hover:text-red-400 hover:bg-white/10 flex items-center justify-center" title="Se déconnecter" aria-label="Se déconnecter"><LogOut size={16} /></button>
            </div>
          </div>
        </div>

        {/* ── Mobile bottom nav ──────────────────────────────────────── */}
        <div
          className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 flex items-center justify-around py-2 px-1"
          style={{ background: 'var(--bg-elevated)', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          {mobileItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePath === item.key || (item.key === '/plus' && moreItems.some((entry) => entry.key === activePath));
            return (
              <button
                key={item.key}
                onClick={() => navigate(item.key)}
                  aria-label={item.label} aria-current={isActive ? 'page' : undefined}
                className="flex-1 min-h-11 flex flex-col items-center justify-center gap-0.5 px-1 py-1"
              >
                <Icon size={20} style={{ color: isActive ? 'var(--brand-text)' : '#9CA3AF' }} strokeWidth={isActive ? 2.5 : 2} />
                <span className={`text-[9px] font-bold ${isActive ? 'text-gray-800' : 'text-gray-400'}`}>{item.label}</span>
              </button>
            );
          })}

        </div>

        {/* ── Main content area ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
          <div className="lg:hidden min-h-12 px-4 flex items-center justify-between border-b border-gray-200">
            <span className="font-black brand-t">EXPÉD<span className="brand-t-gold">ÎLE</span></span>
            <div className="flex items-center gap-2">{can('perm_colis_receptionner') && <button aria-label="Réceptionner des cartons" onClick={() => setModal(true)} className="min-h-11 inline-flex items-center gap-1 rounded-xl px-2 text-xs font-bold brand-t"><Plus size={18} />Réceptionner</button>}<ThemeToggle compact /><button aria-label="Se déconnecter" onClick={handleLogout} className="min-h-11 min-w-11 flex items-center justify-center text-gray-500"><LogOut size={18} /></button></div>
          </div>
          {loadBanner}
          <div className="flex-1 min-h-0 overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
            {dataLoading ? <LoadingView /> : <Suspense fallback={<LoadingView />}><ScreenBoundary key={location.pathname}>
            <Routes>
              <Route path="/equipe" element={<TeamWorkView />} />
              <Route path="/conversations" element={<Permission allowed={can('perm_comm_message_libre') || can('perm_comm_telegram') || can('perm_comm_email') || can('perm_comm_voir_chat_autres')}><ConversationsView /></Permission>} />
              <Route path="/departs" element={<Permission allowed={can('perm_envois_voir')}><StaffDepartures /></Permission>} />
              <Route path="/travail" element={<Navigate to="/" replace />} />
              <Route path="/plus" element={<div className="mx-auto max-w-xl space-y-4 p-5"><h1 className="text-2xl font-bold brand-t">Votre espace</h1><nav aria-label="Autres rubriques" className="grid gap-3">{moreItems.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => navigate(key)} className="flex min-h-14 items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left font-semibold text-gray-800"><Icon size={20} />{label}<ChevronRight size={18} className="ml-auto" /></button>)}</nav></div>} />
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
                    <Permission allowed={can('perm_admin_parametres')}><StaffSettings /></Permission>
                  </div>
                </div>
              } />
              <Route path="/" element={
                <PersonalWorkView />
              } />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </ScreenBoundary></Suspense>}
          </div>
        </div>
      </div>
    );
  }

  // ── Client layout ──
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", background: 'var(--bg-canvas)' }} className="min-h-[100dvh]">
      <Toast />
      <ConfirmDialog />
      <ColisModal open={modal} onClose={() => setModal(false)} />

      {loadBanner}

      {/* Header */}
      <div
        className="glass-dark border-b border-white border-opacity-5 px-4 py-3.5 flex items-center justify-between sticky top-0 z-20"
        style={{ background: 'linear-gradient(135deg, rgba(18,42,54,0.98), rgba(27,58,75,0.98))' }}
      >
        <div className="flex items-center gap-2.5">
          <b className="text-lg text-white tracking-tight">
            EXPÉD<span style={{ color: BRAND.gold }}>ÎLE</span>
          </b>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          {authCl && (
            <button
              aria-label="Mon profil"
              onClick={() => navigate('/profil')}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-white hover:bg-white hover:bg-opacity-10 transition-all"
            >
              <span className="text-sm font-medium text-gray-300">{getPrenom(authCl)}</span>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD }}
              >
                {(authCl.nom || '?').charAt(0).toUpperCase()}
              </div>
            </button>
          )}
        </div>
      </div>

      <div className="max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
        <div className="pb-20">
          {showOnboarding && (
            <OnboardingOverlay
              onDone={async () => {
                if (authCl) await updateClient(authCl.id, { onboarded: true }, true);
                setOnboardingDismissed(true);
              }}
            />
          )}
          {dataLoading ? <LoadingView /> : <Suspense fallback={<LoadingView />}><ScreenBoundary key={location.pathname}><Routes>
            <Route path="/" element={<ClientAccueil />} />
            <Route path="/colis" element={<ClientColis />} />
            <Route path="/colis/:id" element={<ClientColisDetail />} />
            <Route path="/notifications" element={<ClientNotifs />} />
            <Route path="/profil" element={<ClientProfil />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes></ScreenBoundary></Suspense>}
          <ClientBottomNav />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Route publique — suivi partagé par token (pas d'auth nécessaire) */}
        <Route path="/suivi/:token" element={<Suspense fallback={<LoadingView />}><ScreenBoundary><TrackingPublic /></ScreenBoundary></Suspense>} />
        {/* Toute autre route passe par l'app authentifiée */}
        <Route path="/*" element={
          <AppProvider>
            <AppContent />
          </AppProvider>
        } />
      </Routes>
    </BrowserRouter>
  );
}
