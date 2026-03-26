import React, { useState } from 'react';
import { Package, Ruler, Plane, Truck, ChevronRight, ChevronLeft, X } from 'lucide-react';
import { BRAND } from '../../constants';

const STEPS = [
  {
    icon: Package,
    title: 'Faites vos achats en ligne',
    desc: 'Passez commande chez Amazon, Nike, Temu, Shein… et faites livrer à notre entrepôt de Paris. On réceptionne votre colis pour vous.',
    color: BRAND.navy,
    illustration: (
      <div className="flex items-center justify-center gap-3 my-4">
        {['Amazon', 'Nike', 'Temu'].map((b) => (
          <div key={b} className="px-3 py-2 rounded-xl bg-white/80 text-xs font-bold text-gray-700 shadow-sm border border-gray-100">
            {b}
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Ruler,
    title: 'On optimise pour vous',
    desc: 'Dès la réception à Paris, on mesure, on regroupe et on optimise vos colis pour réduire le volume et donc le prix du transport.',
    color: '#F59E0B',
    illustration: (
      <div className="flex items-center justify-center my-4">
        <div className="flex items-end gap-2">
          <div className="w-12 h-16 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 flex items-center justify-center text-amber-600 text-[10px] font-bold">
            Avant
          </div>
          <ChevronRight size={16} className="text-gray-300 mb-6" />
          <div className="w-10 h-12 rounded-lg border-2 border-green-400 bg-green-50 flex items-center justify-center text-green-600 text-[10px] font-bold">
            Après
          </div>
        </div>
      </div>
    ),
  },
  {
    icon: Plane,
    title: 'Réception chez vous',
    desc: 'Votre colis est expédié vers La Réunion, Mayotte ou les Antilles. Suivi en temps réel jusqu\'à la livraison à votre porte.',
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
  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
    >
      <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl anim-fade-up">
        {/* Top accent bar */}
        <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${BRAND.navy}, ${BRAND.gold}, ${BRAND.navy})` }} />

        {/* Skip */}
        <div className="flex justify-end px-4 pt-3">
          <button
            onClick={onDone}
            className="text-xs text-gray-400 hover:text-gray-600 font-medium flex items-center gap-1 transition-colors"
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
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
            Étape {step + 1} sur {STEPS.length}
          </p>

          {/* Title */}
          <h2 className="text-xl font-black mb-2" style={{ color: BRAND.navy }}>
            {current.title}
          </h2>

          {/* Illustration */}
          {current.illustration}

          {/* Description */}
          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            {current.desc}
          </p>
        </div>

        {/* Dots */}
        <div className="flex items-center justify-center gap-2 pb-4">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className="transition-all rounded-full"
              style={{
                width: i === step ? 24 : 8,
                height: 8,
                background: i === step ? BRAND.navy : '#E5E7EB',
              }}
            />
          ))}
        </div>

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
                onDone();
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
              <>C'est parti !</>
            ) : (
              <>Suivant <ChevronRight size={14} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
