import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';
import { Settings, Users, LogOut, LayoutDashboard, Package, ChevronLeft, ChevronRight, Plus, FileText } from 'lucide-react';
import './brand.css';

import { AppProvider, useApp } from './context/AppContext';
import { BRAND } from './constants';

import { Toast, ConfirmDialog } from './components/ui';
import LoginPage from './components/LoginPage';
import ColisModal from './components/ColisModal';
import OnboardingOverlay from './components/client/OnboardingOverlay';

import StaffDashboard from './components/staff/StaffDashboard';
import StaffColisPage, { DashboardPage } from './components/staff/StaffSplitView';
import StaffSettings from './components/staff/StaffSettings';
import StaffClients from './components/staff/StaffClients';
import StaffDetailView from './components/staff/StaffDetailView';
import DevisProspect from './components/staff/DevisProspect';

import ClientAccueil from './components/client/ClientAccueil';
import ClientColis from './components/client/ClientColis';
import ClientNotifs from './components/client/ClientNotifs';
import ClientProfil from './components/client/ClientProfil';
import ClientDetailView from './components/client/ClientDetailView';
import ClientBottomNav from './components/client/ClientBottomNav';

import DetailHeader from './components/detail/DetailHeader';
import ColisInfo from './components/detail/ColisInfo';
import FacturesPanel from './components/detail/FacturesPanel';
import ChatPanel from './components/detail/ChatPanel';
import AuditLog from './components/detail/AuditLog';
import { Etapes } from './components/ui';

// ── Wrapper: Staff colis detail (reads :id from URL) ──
function StaffColisDetail() {
  const { id } = useParams();
  const { setSelId, sel, data } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    if (id) setSelId(id);
    return () => setSelId(null);
  }, [id, setSelId]);

  // Wait for sel to be set (async state update)
  if (!sel) {
    // Check if the colis exists in data
    const exists = data.some((c) => c.id === id);
    if (!exists && data.length > 0) return <Navigate to="/" replace />;
    return <div className="flex items-center justify-center min-h-screen text-gray-400">Chargement...</div>;
  }

  return (
    <>
      <DetailHeader />
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
        <Etapes statut={sel.statut} />
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="w-full lg:w-[420px] lg:flex-shrink-0 lg:order-2">
            <div className="lg:sticky lg:top-4 space-y-4">
              <StaffDetailView />
            </div>
          </div>
          <div className="flex-1 lg:order-1 space-y-4 min-w-0">
            <ColisInfo />
            <FacturesPanel />
            <ChatPanel />
            <AuditLog />
          </div>
        </div>
      </div>
    </>
  );
}

// ── Wrapper: Client colis detail (reads :id from URL) ──
function ClientColisDetail() {
  const { id } = useParams();
  const { setSelId, sel, data } = useApp();

  useEffect(() => {
    if (id) setSelId(id);
    return () => setSelId(null);
  }, [id, setSelId]);

  if (!sel) {
    const exists = data.some((c) => c.id === id);
    if (!exists && data.length > 0) return <Navigate to="/" replace />;
    return <div className="flex items-center justify-center min-h-screen text-gray-400">Chargement...</div>;
  }

  return (
    <div className="max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-24 space-y-4">
      <ClientDetailView />
      <FacturesPanel />
      <ChatPanel />
    </div>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, setAuth, isStaff, sel, setSelId, page, setPage, clientTab, authCl, data, updateClient, sbReady } = useApp();
  const [modal, setModal] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Not logged in ──
  if (!auth) return <LoginPage />;

  // ── Onboarding for new clients ──
  const isColisDetail = location.pathname.startsWith('/colis/');
  const showOnboarding = !isStaff && authCl && !authCl.onboarded && !onboardingDismissed && !isColisDetail;

  // ── Staff layout with sidebar ──
  if (isStaff) {
    const currentPath = location.pathname;

    const NAV_ITEMS = [
      { key: '/', label: 'Dashboard', icon: LayoutDashboard },
      { key: '/colis', label: 'Colis', icon: Package },
      { key: '/clients', label: 'Clients', icon: Users },
      { key: '/devis', label: 'Devis', icon: FileText },
      { key: '/settings', label: 'Paramètres', icon: Settings },
    ];

    const activePath = currentPath.startsWith('/colis') ? '/colis'
      : currentPath === '/clients' ? '/clients'
      : currentPath === '/devis' ? '/devis'
      : currentPath === '/settings' ? '/settings'
      : '/';

    return (
      <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }} className="h-screen flex">
        <Toast />
        <ConfirmDialog />
        <ColisModal open={modal} onClose={() => setModal(false)} />

        {/* ── Sidebar (desktop) ──────────────────────────────────────── */}
        <div
          className="hidden lg:flex flex-col flex-shrink-0 border-r border-gray-800 transition-all duration-200"
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
          <div className="px-3 mb-2">
            <button
              onClick={() => setModal(true)}
              className={`w-full flex items-center gap-2 rounded-xl text-sm font-bold transition-all active:scale-95 ${sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}`}
              style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD }}
            >
              <Plus size={16} strokeWidth={2.5} />
              {!sidebarCollapsed && 'Nouveau colis'}
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePath === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => navigate(item.key)}
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

          {/* Collapse toggle */}
          <div className="px-3 py-2">
            <button
              onClick={() => setSidebarCollapsed((p) => !p)}
              className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/10 transition-all"
            >
              {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              {!sidebarCollapsed && <span className="text-xs font-medium">Réduire</span>}
            </button>
          </div>

          {/* User + logout */}
          <div className="px-3 pb-4 pt-2 border-t border-white border-opacity-10">
            <div className={`flex items-center gap-2.5 ${sidebarCollapsed ? 'justify-center' : ''}`}>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                style={{ background: `${BRAND.gold}30`, color: BRAND.gold }}
              >
                {auth.u.nom.charAt(0)}
              </div>
              {!sidebarCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-200 truncate">{auth.u.nom}</p>
                  <p className="text-[10px] text-gray-500 truncate">{auth.u.role || 'Staff'}</p>
                </div>
              )}
              <button
                onClick={() => { setAuth(null); navigate('/'); }}
                className={`p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-white/10 transition-all ${sidebarCollapsed ? 'mt-2' : ''}`}
                title="Se déconnecter"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Mobile bottom nav ──────────────────────────────────────── */}
        <div
          className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 flex items-center justify-around py-2 px-1"
          style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)' }}
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePath === item.key;
            return (
              <button
                key={item.key}
                onClick={() => navigate(item.key)}
                className="flex flex-col items-center gap-0.5 px-3 py-1"
              >
                <Icon size={20} style={{ color: isActive ? BRAND.navy : '#9CA3AF' }} strokeWidth={isActive ? 2.5 : 2} />
                <span className={`text-[9px] font-bold ${isActive ? 'text-gray-800' : 'text-gray-400'}`}>{item.label}</span>
              </button>
            );
          })}
          <button
            onClick={() => setModal(true)}
            className="flex flex-col items-center gap-0.5 px-3 py-1"
          >
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: BRAND.gold }}>
              <Plus size={18} style={{ color: BRAND.navyD }} strokeWidth={3} />
            </div>
          </button>
        </div>

        {/* ── Main content area ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
          {/* Offline banner */}
          {!sbReady && (
            <div className="bg-red-600 text-white text-center text-xs font-bold py-1.5 px-4">
              ⚠️ Mode hors-ligne — Supabase inaccessible.
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/colis/:id" element={<StaffColisDetail />} />
              <Route path="/colis" element={
                <StaffColisPage />
              } />
              <Route path="/clients" element={
                <div className="h-full overflow-y-auto">
                  <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
                    <StaffClients />
                  </div>
                </div>
              } />
              <Route path="/devis" element={
                <div className="h-full overflow-y-auto">
                  <DevisProspect />
                </div>
              } />
              <Route path="/settings" element={
                <div className="h-full overflow-y-auto">
                  <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
                    <StaffSettings />
                  </div>
                </div>
              } />
              <Route path="/" element={
                <DashboardPage />
              } />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    );
  }

  // ── Client layout ──
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", background: '#f6f7f8' }} className="min-h-screen">
      <Toast />
      <ConfirmDialog />
      <ColisModal open={modal} onClose={() => setModal(false)} />

      {/* ── Bandeau mode mock ── */}
      {!sbReady && (
        <div className="bg-red-600 text-white text-center text-xs font-bold py-1.5 px-4">
          ⚠️ Mode hors-ligne — Supabase inaccessible. Les données affichées sont des données de démonstration.
        </div>
      )}

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
          {authCl && (
            <button
              aria-label="Mon profil"
              onClick={() => navigate('/profil')}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-white hover:bg-white hover:bg-opacity-10 transition-all"
            >
              <span className="text-sm font-medium text-gray-300">{authCl.nom.split(' ')[0]}</span>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`, color: BRAND.navyD }}
              >
                {authCl.nom.charAt(0).toUpperCase()}
              </div>
            </button>
          )}
        </div>
      </div>

      <div className="max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
        <div className="pb-20">
          {showOnboarding && (
            <OnboardingOverlay
              onDone={() => {
                setOnboardingDismissed(true);
                if (authCl) updateClient(authCl.id, { onboarded: true }, true);
              }}
            />
          )}
          <Routes>
            <Route path="/" element={<ClientAccueil />} />
            <Route path="/colis" element={<ClientColis />} />
            <Route path="/colis/:id" element={<ClientColisDetail />} />
            <Route path="/notifications" element={<ClientNotifs />} />
            <Route path="/profil" element={<ClientProfil />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <ClientBottomNav />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </BrowserRouter>
  );
}
