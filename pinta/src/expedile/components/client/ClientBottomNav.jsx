import React from 'react';
import { Home, Package, Bell, User } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';

const TABS = [
  { key: 'accueil', Icon: Home,    label: 'Accueil' },
  { key: 'colis',   Icon: Package, label: 'Colis' },
  { key: 'notifs',  Icon: Bell,    label: 'Notifs' },
  { key: 'profil',  Icon: User,    label: 'Profil' },
];

export default function ClientBottomNav() {
  const { clientTab, setClientTab, setSelId, unreadNotifs } = useApp();

  // Count actions needed for badge on "Colis" tab
  const { data, authCl } = useApp();
  const myColis = data.filter((c) => c.clientId === authCl?.id);
  const mesActions = myColis.filter((c) => c.statut === 'attente_feu_vert' || c.statut === 'attente_paiement').length;

  const badges = {
    accueil: 0,
    colis: mesActions,
    notifs: unreadNotifs,
    profil: 0,
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 glass-nav border-t-0 z-40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex max-w-md lg:max-w-2xl mx-auto">
        {TABS.map((tab) => {
          const active = clientTab === tab.key;
          const badge = badges[tab.key] || 0;
          return (
            <button
              key={tab.key}
              onClick={() => { setClientTab(tab.key); setSelId(null); }}
              className={`flex-1 flex flex-col items-center py-2 relative transition-all duration-200 ${active ? '' : 'text-gray-400'}`}
            >
              <div
                className={`relative p-1.5 rounded-xl transition-all duration-200 ${active ? 'bg-opacity-10' : ''}`}
                style={active ? { backgroundColor: BRAND.navy + '12' } : {}}
              >
                <tab.Icon size={21} style={active ? { color: BRAND.navy } : {}} strokeWidth={active ? 2.2 : 1.5} />
                {badge > 0 && (
                  <span className="absolute -top-0.5 -right-1.5 min-w-[16px] h-[16px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center shadow-sm">
                    {badge}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] mt-0.5 transition-all ${active ? 'font-bold' : 'font-medium'}`}
                style={active ? { color: BRAND.navy } : {}}
              >
                {tab.label}
              </span>
              {active && (
                <div className="absolute top-0 left-1/4 right-1/4 h-[2.5px] rounded-full tab-indicator" style={{ backgroundColor: BRAND.gold }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
