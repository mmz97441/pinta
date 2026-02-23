import React, { useState } from 'react';
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

function AppContent() {
  const { auth, setAuth, isStaff, sel, setSelId, page, setPage, clientTab, authCl, data, updateClient } = useApp();
  const [modal, setModal] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  // ── Not logged in ──
  if (!auth) return <LoginPage />;

  // ── Onboarding for new clients ──
  const showOnboarding = !isStaff && authCl && !authCl.onboarded && !onboardingDismissed && !sel;


  // ── Detail view (selected colis) ──
  if (sel) {
    // Staff: full detail with header, info panels, audit log
    if (isStaff) {
      return (
        <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", background: '#f6f7f8' }} className="min-h-screen">
          <Toast />
          <ConfirmDialog />
          <DetailHeader />
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
            <Etapes statut={sel.statut} />
            <ColisInfo />
            <StaffDetailView />
            <FacturesPanel />
            <ChatPanel />
            <AuditLog />
          </div>
        </div>
      );
    }

    // Client: streamlined detail — no redundant header, bottom nav stays
    return (
      <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", background: '#f6f7f8' }} className="min-h-screen">
        <Toast />
        <ConfirmDialog />
        <div className="max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-24 space-y-4">
          <ClientDetailView />
          <FacturesPanel />
          <ChatPanel />
        </div>
        <ClientBottomNav />
      </div>
    );
  }

  // ── Main list views ──
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", background: '#f6f7f8' }} className="min-h-screen">
      <Toast />
      <ConfirmDialog />
      <ColisModal open={modal} onClose={() => setModal(false)} />

      {/* Header */}
      <div
        className="glass-dark border-b border-white border-opacity-5 px-4 py-3.5 flex items-center justify-between sticky top-0 z-20"
        style={{ background: 'linear-gradient(135deg, rgba(18,42,54,0.98), rgba(27,58,75,0.98))' }}
      >
        <div className="flex items-center gap-2.5">
          <b className="text-lg text-white tracking-tight">
            EXPÉD<span style={{ color: BRAND.gold }}>ÎLE</span>
          </b>
          {isStaff && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-white bg-opacity-15 text-white tracking-wider">
              STAFF
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isStaff && (
            <>
              <button
                onClick={() => { setPage(page === 'clients' ? 'home' : 'clients'); setSelId(null); }}
                className={`p-2 rounded-xl transition-all ${page === 'clients' ? 'bg-white bg-opacity-20 text-white' : 'text-gray-400 hover:text-white hover:bg-white hover:bg-opacity-10'}`}
              >
                <Users size={18} />
              </button>
              <button
                onClick={() => { setPage(page === 'settings' ? 'home' : 'settings'); setSelId(null); }}
                className={`p-2 rounded-xl transition-all ${page === 'settings' ? 'bg-white bg-opacity-20 text-white' : 'text-gray-400 hover:text-white hover:bg-white hover:bg-opacity-10'}`}
              >
                <Settings size={18} />
              </button>
              <span className="text-sm text-gray-300 ml-1">{auth.u.nom.split(' ')[0]}</span>
              <button
                onClick={() => { setAuth(null); setSelId(null); setPage('home'); }}
                className="p-2 rounded-xl text-red-400 hover:text-red-300 hover:bg-white hover:bg-opacity-10 transition-all"
              >
                <LogOut size={16} />
              </button>
            </>
          )}
          {/* Client name shown in Accueil welcome card + Profil tab — no need to duplicate here */}
        </div>
      </div>

      <div className={`mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4 ${isStaff ? 'max-w-[1600px]' : 'max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl'}`}>
        {/* Staff views */}
        {isStaff && page === 'settings' && <StaffSettings />}
        {isStaff && page === 'clients' && <StaffClients />}
        {isStaff && page !== 'settings' && page !== 'clients' && (
          <StaffDashboard onNewColis={() => setModal(true)} />
        )}

        {/* Client views */}
        {!isStaff && (
          <div className="pb-20">
            {showOnboarding && (
              <OnboardingOverlay
                onDone={() => {
                  setOnboardingDismissed(true);
                  if (authCl) updateClient(authCl.id, { onboarded: true }, true);
                }}
              />
            )}
            {clientTab === 'accueil' && <ClientAccueil onNewColis={() => setModal(true)} />}
            {clientTab === 'colis' && <ClientColis onNewColis={() => setModal(true)} />}
            {clientTab === 'notifs' && <ClientNotifs />}
            {clientTab === 'profil' && <ClientProfil />}
            <ClientBottomNav />
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
