import React, { useId, useLayoutEffect } from 'react';
import { PackageCheck, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BRAND } from '../../constants';

/**
 * The client's expeditions are the essential view of the portal. Loading, a
 * failed first load and a failed refresh stay distinct: a failure never looks
 * like an empty account, and a later refresh failure keeps what is displayed.
 */
export function useClientDossiers() {
  const { dataLoading, dataError, sbReady, retryLoad } = useApp();
  return {
    loading: dataLoading && !sbReady,
    failed: !dataLoading && !sbReady && !!dataError,
    refreshFailed: sbReady && !!dataError,
    retry: retryLoad,
  };
}

export const DOSSIERS_UNAVAILABLE = 'Nous n’arrivons pas à afficher vos expéditions pour le moment. Vos colis sont bien pris en charge\u00a0: réessayez dans un instant.';

/** Reassuring error state, in place of an empty or first-shipment state. */
export function ClientDossiersError({ onRetry, compact = false, title = 'Affichage momentanément indisponible' }) {
  const { retry } = useClientDossiers();
  const titleId = useId();
  const Heading = compact ? 'h3' : 'h2';
  return <section role="alert" aria-labelledby={titleId} data-testid="client-dossiers-error" className={`rounded-2xl border border-slate-200 ${compact ? 'p-4' : 'p-5 sm:p-6'}`} style={{ background: 'var(--bg-elevated)' }}>
    <div className="flex items-start gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl brand-bg-l" aria-hidden="true"><PackageCheck size={22} className="brand-t" /></span>
      <div className="min-w-0 space-y-2">
        <Heading id={titleId} className="font-bold text-slate-900">{title}</Heading>
        <p className="text-sm text-slate-600">{DOSSIERS_UNAVAILABLE}</p>
        <button type="button" onClick={onRetry || retry} className="inline-flex min-h-11 items-center gap-2 rounded-xl brand-bg px-4 text-sm font-semibold text-white transition-all duration-200 ease-out hover:translate-y-[-1px] active:scale-[0.98]"><RefreshCw size={16} aria-hidden="true" />Réessayer</button>
      </div>
    </div>
  </section>;
}

const Bar = ({ className = '', style }) => <span aria-hidden="true" className={`block skeleton-bar ${className}`} style={style} />;

function CardSkeleton() {
  return <div aria-hidden="true" className="space-y-3 rounded-2xl border border-slate-200 p-4" style={{ background: 'var(--bg-elevated)' }}>
    <div className="flex items-start justify-between gap-3"><div className="w-full space-y-2"><Bar className="h-5 w-32" /><Bar className="h-4 w-44" /></div><Bar className="h-5 w-5 shrink-0" /></div>
    <Bar className="h-4 w-40" />
    <Bar className="h-4 w-52" />
    <Bar className="h-11 w-48 rounded-xl" />
  </div>;
}

function SectionSkeleton({ cards = 2 }) {
  return <div className="space-y-3"><div className="flex items-center gap-2"><Bar className="h-5 w-5 rounded-full" /><Bar className="h-5 w-36" /><Bar className="h-7 w-24 rounded-full" /></div>
    <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: cards }, (_, index) => <CardSkeleton key={index} />)}</div></div>;
}

const LABELS = {
  home: 'Chargement de votre espace…',
  list: 'Chargement de vos expéditions…',
  detail: 'Chargement de votre expédition…',
  notifications: 'Chargement de vos notifications…',
  profile: 'Chargement de votre profil…',
};

/** A skeleton with the shape of each portal screen. */
export function ClientPortalSkeleton({ view = 'home' }) {
  const label = LABELS[view] || LABELS.home;
  return <div role="status" aria-live="polite" aria-busy="true" data-testid={`client-skeleton-${view}`} className="space-y-6">
    <span className="sr-only">{label}</span>
    {view === 'home' && <>
      <div className="space-y-2 border-b border-slate-200 pb-4"><Bar className="h-4 w-44" /><Bar className="h-8 w-56" /><Bar className="h-4 w-72 max-w-full" /></div>
      <SectionSkeleton cards={2} />
      <SectionSkeleton cards={2} />
    </>}
    {view === 'list' && <>
      <div className="space-y-2"><Bar className="h-7 w-48" /><Bar className="h-4 w-80 max-w-full" /></div>
      <div className="flex flex-wrap gap-2">{[24, 28, 28].map((width, index) => <Bar key={index} className="h-11 rounded-xl" style={{ width: `${width * 4}px` }} />)}</div>
      <Bar className="h-11 w-full rounded-xl" />
      <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map(index => <CardSkeleton key={index} />)}</div>
    </>}
    {view === 'detail' && <>
      <div className="flex items-center gap-3"><Bar className="h-11 w-11 rounded-xl" /><div className="space-y-2"><Bar className="h-5 w-40" /><Bar className="h-4 w-52" /></div></div>
      <div className="space-y-3 rounded-2xl border border-slate-200 p-4" style={{ background: 'var(--bg-elevated)' }}><Bar className="h-5 w-56" /><Bar className="h-4 w-full" /><Bar className="h-4 w-3/4" /><Bar className="h-11 w-56 rounded-xl" /></div>
      <div className="space-y-3"><Bar className="h-5 w-44" /><Bar className="h-4 w-full" /><Bar className="h-4 w-2/3" /></div>
    </>}
    {view === 'notifications' && <>
      <div className="flex items-center gap-2"><Bar className="h-7 w-44" /><Bar className="h-6 w-20 rounded-full" /></div>
      <ul className="space-y-3" aria-hidden="true">{[0, 1, 2, 3].map(index => <li key={index} className="flex gap-3 rounded-2xl border border-slate-200 p-4" style={{ background: 'var(--bg-elevated)' }}><Bar className="h-10 w-10 shrink-0 rounded-xl" /><div className="w-full space-y-2"><Bar className="h-4 w-48" /><Bar className="h-4 w-full" /><Bar className="h-4 w-2/3" /></div></li>)}</ul>
    </>}
    {view === 'profile' && <>
      <div className="space-y-4 rounded-2xl p-5 sm:p-7 skeleton-bar" aria-hidden="true"><div className="flex items-center gap-4"><span className="h-14 w-14 rounded-2xl skeleton-strong" /><div className="space-y-2"><span className="block h-4 w-36 rounded skeleton-strong" /><span className="block h-6 w-48 rounded skeleton-strong" /></div></div><span className="block h-4 w-60 rounded skeleton-strong" /></div>
      <div className="flex flex-wrap gap-2">{[0, 1, 2].map(index => <Bar key={index} className="h-11 w-32 rounded-xl" />)}</div>
      <div className="space-y-3"><Bar className="h-5 w-40" />{[0, 1, 2, 3].map(index => <Bar key={index} className="h-6 w-full" />)}</div>
    </>}
  </div>;
}

/** Which skeleton matches a portal route. */
export function clientViewForPath(pathname = '/') {
  if (pathname === '/colis') return 'list';
  if (pathname.startsWith('/colis/')) return 'detail';
  if (pathname === '/notifications') return 'notifications';
  if (pathname === '/profil') return 'profile';
  return 'home';
}

/** Public pages live outside the application context: they apply the saved theme themselves. */
export function useSavedTheme() {
  useLayoutEffect(() => {
    let saved = null;
    try { saved = localStorage.getItem('expedile-theme'); } catch { saved = null; }
    const theme = saved || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, []);
}

/** The navy header of the portal, for the public pages. */
export function PublicBrandHeader({ label = 'Suivi partagé' }) {
  return <header className="glass-dark border-b border-white border-opacity-5" style={{ background: 'linear-gradient(135deg, rgba(18,42,54,0.98), rgba(27,58,75,0.98))' }}>
    <div className="mx-auto flex min-h-[60px] max-w-3xl items-center justify-between gap-3 px-4">
      <b className="text-lg text-white tracking-tight">EXPÉD<span style={{ color: BRAND.gold }}>ÎLE</span></b>
      <span className="text-sm font-semibold text-white/80">{label}</span>
    </div>
  </header>;
}

/** The shape of the public tracking page while it loads. */
export function PublicTrackingSkeleton() {
  useSavedTheme();
  const surface = { background: 'var(--bg-elevated)' };
  return <div className="min-h-[100dvh]" style={{ background: 'var(--bg-canvas)' }}>
    <PublicBrandHeader />
    <div role="status" aria-live="polite" aria-busy="true" data-testid="public-tracking-skeleton" className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <span className="sr-only">Chargement du suivi…</span>
      <div className="space-y-3 rounded-2xl border border-slate-200 p-5" style={surface}><Bar className="h-7 w-64 max-w-full" /><Bar className="h-4 w-48" /><Bar className="h-4 w-56" /></div>
      {[0, 1].map(index => <div key={index} className="space-y-3 rounded-2xl border border-slate-200 p-5" style={surface}>
        <div className="flex flex-wrap items-center gap-2"><Bar className="h-5 w-36" /><Bar className="h-6 w-28 rounded-full" /></div>
        <Bar className="h-4 w-60 max-w-full" />
        <Bar className="h-5 w-52" />
        <Bar className="h-4 w-full" />
        <Bar className="h-11 w-full rounded-xl" />
      </div>)}
    </div>
  </div>;
}
