import React, { useState } from 'react';
import { Settings, Users, LogOut, Plane, Package, Plus, ChevronRight } from 'lucide-react';
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

// ── Staff navigation items ──────────────────────────────────────────────────
const STAFF_NAV = [
  { key: 'home', label: 'Tous les colis', icon: Package },
  { key: 'envois', label: 'Envois', icon: Plane },
  { key: 'clients', label: 'Clients', icon: Users },
  { key: 'settings', label: 'Paramètres', icon: Settings },
];

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

  // ── Staff: sidebar + content layout ──
  if (isStaff) {
    return (
      <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", background: '#f6f7f8' }} className="min-h-screen">
        <Toast />
        <ConfirmDialog />
        <ColisModal open={modal} onClose={() => setModal(false)} />

        {/* ── Top header bar ── */}
        <div
          className="px-4 py-2.5 flex items-center justify-between sticky top-0 z-20"
          style={{ background: BRAND.navy }}
        >
          <div className="flex items-center gap-2">
            <b className="text-[15px] text-white tracking-tight" style={{ letterSpacing: '-0.02em' }}>
              EXPÉD<span style={{ color: BRAND.gold }}>ÎLE</span>
            </b>
            <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold tracking-wider" style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}>
              STAFF
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {auth.u.nom}
            </span>
            <button
              onClick={() => { setAuth(null); setSelId(null); setPage('home'); }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-all hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.5)' }}
            >
              <LogOut size={12} />
            </button>
          </div>
        </div>

        {/* ── Horizontal nav bar (mobile + desktop) ── */}
        <div
          className="sticky top-[44px] z-10 border-b"
          style={{ background: 'white', borderColor: '#E5E7EB' }}
        >
          <div className="max-w-[1600px] mx-auto flex items-center">
            {/* Nav items */}
            <div className="flex-1 flex items-center overflow-x-auto no-scrollbar">
              {STAFF_NAV.map((item) => {
                const Icon = item.icon;
                const active = item.key === 'home'
                  ? !['envois', 'clients', 'settings'].includes(page)
                  : page === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => { setPage(item.key); setSelId(null); }}
                    className="flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-all relative"
                    style={{
                      color: active ? BRAND.navy : '#9CA3AF',
                    }}
                  >
                    <Icon size={14} strokeWidth={active ? 2.5 : 2} />
                    {item.label}
                    {/* Active indicator */}
                    {active && (
                      <span
                        className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
                        style={{ background: BRAND.navy }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* New colis button — always visible */}
            <div className="flex-shrink-0 px-3 py-1.5">
              <button
                onClick={() => setModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold text-white transition-all hover:opacity-90 active:scale-95"
                style={{ background: BRAND.navy }}
              >
                <Plus size={13} strokeWidth={2.5} />
                <span className="hidden sm:inline">Nouveau colis</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
          {page === 'settings' && <StaffSettings />}
          {page === 'clients' && <StaffClients />}
          {page === 'envois' && <StaffEnvois />}
          {!['settings', 'clients', 'envois'].includes(page) && (
            <StaffDashboard onNewColis={() => setModal(true)} />
          )}
        </div>
      </div>
    );
  }

  // ── Client views ──
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", background: '#f6f7f8' }} className="min-h-screen">
      <Toast />
      <ConfirmDialog />
      <ColisModal open={modal} onClose={() => setModal(false)} />

      {/* Client header */}
      <div
        className="px-4 py-2.5 flex items-center justify-between sticky top-0 z-20"
        style={{ background: BRAND.navy }}
      >
        <b className="text-[15px] text-white tracking-tight" style={{ letterSpacing: '-0.02em' }}>
          EXPÉD<span style={{ color: BRAND.gold }}>ÎLE</span>
        </b>
      </div>

      <div className="max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-24 space-y-4">
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
