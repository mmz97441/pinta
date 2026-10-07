import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Package, Ruler, Plane, ChevronRight, ChevronLeft, X } from 'lucide-react';
import { useDialog } from '../ui/useDialog';
import { BRAND, getDestByCP } from '../../constants';
import { useApp } from '../../context/AppContext';

const chip = { background: 'var(--bg-surface)', color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' };

const STEPS = [
  {
    icon: Package,
    title: 'Préparer mes premiers achats',
    desc: 'Avant de commander, demandez à notre équipe l’adresse de réception et les consignes à indiquer au vendeur. Conservez la facture complète de chaque achat.',
    tile: 'brand-bg-l', tone: 'brand-t',
    illustration: () => (
      <div className="flex flex-wrap items-center justify-center gap-3 my-4" aria-hidden="true">
        {['Amazon', 'Nike', 'Temu'].map((b) => (
          <div key={b} className="px-3 py-2 rounded-xl text-sm font-bold shadow-sm border" style={chip}>
            {b}
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Ruler,
    title: 'Factures et accord de préparation',
    desc: 'Ouvrez votre expédition pour déposer vos factures. Donnez votre accord quand vos achats sont réunis, ou choisissez «\u00a0Attendre d’autres achats\u00a0». Le devis vient après la préparation.',
    tile: 'bg-amber-50', tone: 'text-amber-700',
    illustration: () => (
      <div className="flex items-center justify-center my-4" aria-hidden="true">
        <div className="flex items-end gap-2">
          <div className="w-14 h-16 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 flex items-center justify-center text-amber-800 text-sm font-bold">
            Avant
          </div>
          <ChevronRight size={16} className="text-slate-500 mb-6" />
          <div className="w-14 h-12 rounded-lg border-2 border-green-400 bg-green-50 flex items-center justify-center text-green-800 text-sm font-bold">
            Après
          </div>
        </div>
      </div>
    ),
  },
  {
    icon: Plane,
    title: 'Suivre la suite depuis mon espace',
    desc: 'L’accueil affiche les actions attendues de votre part. Retrouvez les nouvelles et écrivez à notre équipe depuis votre expédition. La livraison est précisée lorsqu’elle est confirmée.',
    tile: 'bg-green-50', tone: 'text-green-700',
    illustration: (destination) => (
      <div className="flex items-center justify-center gap-2 my-4 text-sm font-bold text-slate-700" aria-hidden="true">
        <span>Paris</span>
        <div className="flex items-center gap-1">
          <div className="w-8 h-0.5 rounded" style={{ background: 'var(--border-subtle)' }} />
          <Plane size={16} className="brand-t -rotate-12" />
          <div className="w-8 h-0.5 rounded" style={{ background: 'var(--border-subtle)' }} />
        </div>
        <span>{destination}</span>
      </div>
    ),
  },
];

// The guide closed while « onboarded » could not be saved: it stays closed in this tab (reloads included)
// and is offered again in a new tab or at a next visit, since the choice was not recorded (sessionStorage is
// per tab; blocked storage only shortens this to the page). The toast says exactly that.
const DISMISSED = 'expedile-onboarding-dismissed';
const dismissedKey = clientId => `${DISMISSED}:${clientId || 'client'}`;
function wasDismissed(clientId) { try { return sessionStorage.getItem(dismissedKey(clientId)) === '1'; } catch { return false; } }
function rememberDismissed(clientId) { try { sessionStorage.setItem(dismissedKey(clientId), '1'); } catch { /* closed for this page only */ } }

/** Rendered on document.body: an animated (transformed) page wrapper would trap a fixed overlay.
 * `replay`: opened on request (« Revoir le guide »), whatever was decided before. */
export default function OnboardingOverlay({ onDone, replay = false }) {
  const { authCl, flash } = useApp();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [closed, setClosed] = useState(() => !replay && wasDismissed(authCl?.id));
  // Closing always works: when the server cannot record it, the guide closes all the same and says it will return.
  const finish = async () => {
    if (saving || closed) return;
    setSaving(true);
    try { await onDone(); }
    catch {
      rememberDismissed(authCl?.id);
      setClosed(true);
      flash({ msg: 'Le guide est fermé. Votre choix n’a pas pu être enregistré\u00a0: le guide vous sera de nouveau proposé dans un nouvel onglet ou lors de votre prochaine visite.', type: 'info', duration: 8000 });
    }
  };
  const dialogRef = useDialog(!closed, finish);
  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;
  const destination = getDestByCP(authCl?.cp)?.nom || 'Votre île';
  if (closed) return null;

  return createPortal(
    <div
      onClick={(event) => { if (event.target === event.currentTarget) finish(); }} className="fixed inset-0 z-[9999] flex items-center justify-center px-4 py-6 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      data-testid="onboarding-overlay"
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" tabIndex={-1} className="w-full max-w-sm max-h-full bg-white rounded-3xl overflow-y-auto shadow-2xl anim-fade-up">
        {/* Top accent bar */}
        <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${BRAND.navy}, ${BRAND.gold}, ${BRAND.navy})` }} />

        {/* Skip */}
        <div className="flex justify-end px-4 pt-3">
          <button
            disabled={saving} onClick={finish}
            className="min-h-11 px-2 text-sm text-gray-500 hover:text-gray-600 font-medium flex items-center gap-1 transition-colors"
          >
            Passer <X size={12} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-2 pt-1 text-center">
          <div className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-4 ${current.tile}`}>
            <Icon size={28} className={current.tone} strokeWidth={2} aria-hidden="true" />
          </div>

          <p className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-2">
            Étape {step + 1} sur {STEPS.length}
          </p>

          <h2 id="onboarding-title" className="text-xl font-black mb-2" style={{ color: 'var(--brand-text)' }}>
            {current.title}
          </h2>

          {current.illustration(destination)}

          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            {current.desc}
          </p>
          {step === 0 && <a className="min-h-11 inline-flex items-center text-sm font-semibold underline mb-3" href="mailto:contact@expedile.fr?subject=Consignes%20de%20r%C3%A9ception">Demander les consignes de réception</a>}
        </div>

        <div className="flex items-center justify-center gap-1 pb-2">
          {STEPS.map((_, i) => <button key={i} aria-label={`Voir l’étape ${i + 1}`} aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)} className="min-w-11 min-h-11 flex items-center justify-center"><span className="h-2 rounded-full transition-all" style={{ width: i === step ? 24 : 8, background: i === step ? 'var(--brand-text)' : 'var(--text-muted)' }} /></button>)}
        </div>

        <div className="flex gap-3 px-6 pb-6">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="min-h-11 flex items-center justify-center gap-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all duration-200 ease-out active:scale-95"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              Retour
            </button>
          )}
          <button
            onClick={() => {
              if (isLast) {
                finish();
              } else {
                setStep(step + 1);
              }
            }}
            className="min-h-11 flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all duration-200 ease-out active:scale-95"
            style={{
              background: isLast
                ? `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`
                : `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})`,
              color: isLast ? BRAND.navyD : 'white',
              boxShadow: isLast
                ? `0 3px 16px ${BRAND.gold}50`
                : `0 3px 16px ${BRAND.navy}40`,
            }}
          >
            {isLast ? (
              <>Ouvrir mon espace</>
            ) : (
              <>Suivant <ChevronRight size={14} aria-hidden="true" /></>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
