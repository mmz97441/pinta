import { clientWorkState } from '../../domain/clientJourney';
import React from 'react';
import { Home, Package, Bell, User } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';
import { plural } from '../../domain/plural';

const TABS = [
  { key: 'accueil', Icon: Home,    label: 'Accueil',       path: '/' },
  { key: 'colis',   Icon: Package, label: 'Expéditions',   path: '/colis' },
  { key: 'notifs',  Icon: Bell,    label: 'Notifications', path: '/notifications' },
  { key: 'profil',  Icon: User,    label: 'Profil',        path: '/profil' },
];

function activeTabFor(pathname) {
  if (pathname === '/profil') return 'profil';
  if (pathname === '/notifications') return 'notifs';
  if (pathname === '/colis' || pathname.startsWith('/colis/')) return 'colis';
  return 'accueil';
}

/** One source for both navigations: the same tabs, badges and spoken counts. */
function useClientTabs() {
  const location = useLocation();
  const { data, authCl, unreadNotifs } = useApp();
  const actions = authCl ? data.filter(colis => colis.clientId === authCl.id && clientWorkState(colis, authCl).section === 'todo').length : 0;
  const badges = { colis: actions, notifs: unreadNotifs || 0 };
  const spoken = { colis: count => plural(count, 'action attendue', 'actions attendues'), notifs: count => plural(count, 'non lue') };
  const active = activeTabFor(location.pathname);
  return TABS.map(tab => {
    const badge = badges[tab.key] || 0;
    return { ...tab, badge, active: tab.key === active, label: tab.label, accessibleName: badge > 0 ? `${tab.label} (${spoken[tab.key](badge)})` : tab.label };
  });
}

const badgeText = count => (count > 99 ? '99+' : String(count));

/** Mobile and tablet: the bottom tab bar. From 1024 px the header carries the navigation. */
export default function ClientBottomNav() {
  const tabs = useClientTabs();
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 glass-nav border-t-0 z-40" aria-label="Navigation principale" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex max-w-xl md:max-w-3xl mx-auto">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            to={tab.path}
            aria-current={tab.active ? 'page' : undefined}
            aria-label={tab.accessibleName}
            className={`min-h-14 flex-1 flex flex-col items-center justify-center py-2 relative transition-all duration-200 ease-out active:scale-[0.98] ${tab.active ? '' : 'text-gray-500'}`}
          >
            <span
              className="relative p-1.5 rounded-xl transition-all duration-200"
              style={tab.active ? { backgroundColor: BRAND.navy + '12' } : {}}
              aria-hidden="true"
            >
              <tab.Icon size={21} style={tab.active ? { color: 'var(--brand-text)' } : {}} strokeWidth={tab.active ? 2.2 : 1.6} />
              {tab.badge > 0 && (
                <span className="absolute -top-0.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-700 text-white text-[11px] leading-[18px] font-bold flex items-center justify-center shadow-sm">
                  {badgeText(tab.badge)}
                </span>
              )}
            </span>
            <span
              aria-hidden="true"
              className={`whitespace-nowrap text-sm mt-0.5 transition-all ${tab.active ? 'font-bold' : 'font-medium'}`}
              style={tab.active ? { color: 'var(--brand-text)' } : {}}
            >
              {tab.label}
            </span>
            {tab.active && (
              <span aria-hidden="true" className="absolute top-0 left-1/4 right-1/4 h-[2.5px] rounded-full tab-indicator" style={{ backgroundColor: BRAND.gold }} />
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** Desktop (1024 px and more): the same navigation inside the navy header. */
export function ClientTopNav() {
  const tabs = useClientTabs();
  return (
    <nav aria-label="Navigation principale" className="client-top-nav hidden lg:flex items-stretch gap-1 self-stretch">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          to={tab.path}
          aria-current={tab.active ? 'page' : undefined}
          aria-label={tab.accessibleName}
          className={`relative inline-flex min-h-11 items-center gap-2 rounded-t-lg px-3 text-sm font-semibold transition-colors duration-200 ease-out hover:bg-white/10 hover:text-white ${tab.active ? 'text-white' : 'text-white/80'}`}
        >
          <tab.Icon size={18} aria-hidden="true" strokeWidth={tab.active ? 2.2 : 1.8} />
          <span aria-hidden="true">{tab.label}</span>
          {tab.badge > 0 && <span aria-hidden="true" className="min-w-[20px] rounded-full bg-red-700 px-1.5 text-center text-xs font-bold leading-5 text-white">{badgeText(tab.badge)}</span>}
        </Link>
      ))}
    </nav>
  );
}
