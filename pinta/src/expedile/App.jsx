import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';
import { Settings, Users, LogOut } from 'lucide-react';
import './brand.css';

import { AppProvider, useApp } from './context/AppContext';
import { BRAND } from './constants';

import { Toast, ConfirmDialog } from './components/ui';
import LoginPage from './components/LoginPage';
import ColisModal from './components/ColisModal';
import OnboardingOverlay from './components/client/OnboardingOverlay';

import StaffDashboard from './components/staff/StaffDashboard';
import StaffSettings from './components/staff/StaffSettings';
import StaffClients from './components/staff/StaffClients';
import StaffDetailView from './components/staff/StaffDetailView';

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

  // ── Not logged in ──
  if (!auth) return <LoginPage />;

  // ── Onboarding for new clients ──
  const isColisDetail = location.pathname.startsWith('/colis/');
  const showOnboarding = !isStaff && authCl && !authCl.onboarded && !onboardingDismissed && !isColisDetail;

  // ── Staff layout ──
  if (isStaff) {
    // Determine active page from URL for header button styling
    const currentPath = location.pathname;
    const isClientsPage = currentPath === '/clients';
    const isSettingsPage = currentPath === '/settings';

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
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-white bg-opacity-15 text-white tracking-wider">
              STAFF
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-label="Gestion des clients"
              onClick={() => navigate(isClientsPage ? '/' : '/clients')}
              className={`p-2 rounded-xl transition-all ${isClientsPage ? 'bg-white bg-opacity-20 text-white' : 'text-gray-400 hover:text-white hover:bg-white hover:bg-opacity-10'}`}
            >
              <Users size={18} />
            </button>
            <button
              aria-label="Paramètres"
              onClick={() => navigate(isSettingsPage ? '/' : '/settings')}
              className={`p-2 rounded-xl transition-all ${isSettingsPage ? 'bg-white bg-opacity-20 text-white' : 'text-gray-400 hover:text-white hover:bg-white hover:bg-opacity-10'}`}
            >
              <Settings size={18} />
            </button>
            <span className="text-sm text-gray-300 ml-1">{auth.u.nom.split(' ')[0]}</span>
            <button
              aria-label="Se déconnecter"
              onClick={() => { setAuth(null); navigate('/'); }}
              className="p-2 rounded-xl text-red-400 hover:text-red-300 hover:bg-white hover:bg-opacity-10 transition-all"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        <Routes>
          <Route path="/colis/:id" element={<StaffColisDetail />} />
          <Route path="/clients" element={
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
              <StaffClients />
            </div>
          } />
          <Route path="/settings" element={
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
              <StaffSettings />
            </div>
          } />
          <Route path="/" element={
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
              <StaffDashboard onNewColis={() => setModal(true)} />
            </div>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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
