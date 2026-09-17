import React, { useState } from 'react';
import { Package, Ruler, Plane, Truck, ChevronRight, ChevronLeft, X } from 'lucide-react';
import { useDialog } from '../ui/useDialog';
import { BRAND } from '../../constants';

const STEPS = [
  {
    icon: Package,
    title: 'Préparer mes premiers achats',
    desc: 'Avant de commander, demandez à notre équipe l’adresse de réception et les consignes à indiquer au vendeur. Conservez la facture complète de chaque achat.',
    color: 'var(--brand-text)',
    illustration: (
      <div className="flex items-center justify-center gap-3 my-4">
        {['Amazon', 'Nike', 'Temu'].map((b) => (
          <div key={b} className="px-3 py-2 rounded-xl bg-white/80 text-sm font-bold text-gray-700 shadow-sm border border-gray-100">
            {b}
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Ruler,
    title: 'Factures et accord de préparation',
    desc: 'Ouvrez votre expédition pour déposer vos factures. Donnez votre accord quand vos achats sont réunis, ou choisissez « Attendre d’autres achats ». Le devis vient après la préparation.',
    color: '#F59E0B',
    illustration: (
      <div className="flex items-center justify-center my-4">
        <div className="flex items-end gap-2">
          <div className="w-12 h-16 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 flex items-center justify-center text-amber-600 text-sm font-bold">
            Avant
          </div>
          <ChevronRight size={16} className="text-gray-300 mb-6" />
          <div className="w-10 h-12 rounded-lg border-2 border-green-400 bg-green-50 flex items-center justify-center text-green-600 text-sm font-bold">
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
    color: '#22C55E',
    illustration: (
      <div className="flex items-center justify-center gap-2 my-4">
        <span className="text-2xl">🇫🇷</span>
        <div className="flex items-center gap-1">
          <div className="w-8 h-0.5 bg-gray-300 rounded" />
          <Plane size={16} className="text-blue-500 -rotate-12" />
          <div className="w-8 h-0.5 bg-gray-300 rounded" />
        </div>
        <span className="text-2xl">🇷🇪</span>
      </div>
    ),
  },
];

export default function OnboardingOverlay({ onDone }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const finish = async () => { if (saving) return; setSaving(true); try { await onDone(); } catch { setError('Votre progression n’a pas pu être enregistrée. Réessayez.'); setSaving(false); } };
  const dialogRef = useDialog(true, finish);
  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      onClick={(event) => { if (event.target === event.currentTarget) finish(); }} className="fixed inset-0 z-[9999] flex items-center justify-center px-4 py-6 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" tabIndex={-1} className="w-full max-w-sm max-h-full bg-white rounded-3xl overflow-y-auto shadow-2xl anim-fade-up">
        {/* Top accent bar */}
        <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${BRAND.navy}, ${BRAND.gold}, ${BRAND.navy})` }} />

        {/* Skip */}
        <div className="flex justify-end px-4 pt-3">
          <button
            disabled={saving} onClick={finish}
            className="min-h-11 text-sm text-gray-500 hover:text-gray-600 font-medium flex items-center gap-1 transition-colors"
          >
            Passer <X size={12} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-2 pt-1 text-center">
          {/* Icon */}
          <div
            className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-4"
            style={{ background: `${current.color}15` }}
          >
            <Icon size={28} style={{ color: current.color }} strokeWidth={2} />
          </div>

          {/* Step counter */}
          <p className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-2">
            Étape {step + 1} sur {STEPS.length}
          </p>

          {/* Title */}
          <h2 id="onboarding-title" className="text-xl font-black mb-2" style={{ color: 'var(--brand-text)' }}>
            {current.title}
          </h2>

          {/* Illustration */}
          {current.illustration}

          {/* Description */}
          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            {current.desc}
          </p>
          {step === 0 && <a className="min-h-11 inline-flex items-center text-sm font-semibold underline mb-3" href="mailto:contact@expedile.fr?subject=Consignes%20de%20r%C3%A9ception">Demander les consignes de réception</a>}
        </div>

        <div className="flex items-center justify-center gap-1 pb-2">
          {STEPS.map((_, i) => <button key={i} aria-label={`Voir l’étape ${i + 1}`} aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)} className="min-w-11 min-h-11 flex items-center justify-center"><span className="h-2 rounded-full transition-all" style={{ width: i === step ? 24 : 8, background: i === step ? 'var(--brand-text)' : 'var(--border-subtle)' }} /></button>)}
        </div>

        {error && <p role="alert" className="text-sm text-red-600 px-6 pb-3">{error}</p>}
        {/* Navigation */}
        <div className="flex gap-3 px-6 pb-6">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center justify-center gap-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all active:scale-95"
            >
              <ChevronLeft size={14} />
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
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
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
              <>Suivant <ChevronRight size={14} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
