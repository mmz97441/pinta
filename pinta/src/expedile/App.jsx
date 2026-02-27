import React, { useState } from 'react';
import { Settings, Users, LogOut, Plane } from 'lucide-react';
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
import StaffEnvois from './components/staff/StaffEnvois';

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
        className="px-4 py-3 flex items-center justify-between sticky top-0 z-20"
        style={{ background: BRAND.navy }}
      >
        <div className="flex items-center gap-2">
          <b className="text-[15px] text-white tracking-tight" style={{ letterSpacing: '-0.02em' }}>
            EXPÉD<span style={{ color: BRAND.gold }}>ÎLE</span>
          </b>
          {isStaff && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold tracking-wider" style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}>
              STAFF
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isStaff && (
            <>
              <button
                onClick={() => { setPage(page === 'envois' ? 'home' : 'envois'); setSelId(null); }}
                className="p-2 rounded-lg transition-all"
                style={{
                  background: page === 'envois' ? 'rgba(255,255,255,0.15)' : 'transparent',
                  color: page === 'envois' ? 'white' : 'rgba(255,255,255,0.45)',
                }}
                title="Envois"
              >
                <Plane size={16} />
              </button>
              <button
                onClick={() => { setPage(page === 'clients' ? 'home' : 'clients'); setSelId(null); }}
                className="p-2 rounded-lg transition-all"
                style={{
                  background: page === 'clients' ? 'rgba(255,255,255,0.15)' : 'transparent',
                  color: page === 'clients' ? 'white' : 'rgba(255,255,255,0.45)',
                }}
              >
                <Users size={16} />
              </button>
              <button
                onClick={() => { setPage(page === 'settings' ? 'home' : 'settings'); setSelId(null); }}
                className="p-2 rounded-lg transition-all"
                style={{
                  background: page === 'settings' ? 'rgba(255,255,255,0.15)' : 'transparent',
                  color: page === 'settings' ? 'white' : 'rgba(255,255,255,0.45)',
                }}
              >
                <Settings size={16} />
              </button>
              <span className="text-[12px] font-medium ml-1" style={{ color: 'rgba(255,255,255,0.5)' }}>{auth.u.nom.split(' ')[0]}</span>
              <button
                onClick={() => { setAuth(null); setSelId(null); setPage('home'); }}
                className="p-2 rounded-lg transition-all"
                style={{ color: 'rgba(255,255,255,0.35)' }}
              >
                <LogOut size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className={`mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4 ${isStaff ? 'max-w-[1600px]' : 'max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl'}`}>
        {/* Staff views */}
        {isStaff && page === 'settings' && <StaffSettings />}
        {isStaff && page === 'clients' && <StaffClients />}
        {isStaff && page === 'envois' && <StaffEnvois />}
        {isStaff && page !== 'settings' && page !== 'clients' && page !== 'envois' && (
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
