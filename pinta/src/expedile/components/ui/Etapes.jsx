import React from 'react';
import { Package, CheckCircle, Wrench, CreditCard, Truck } from 'lucide-react';
import { STATUTS, BRAND } from '../../constants';

const STEP_NAMES = ['Réception', 'Accord', 'Préparation', 'Paiement', 'Livraison'];
const STEP_ICONS = [Package, CheckCircle, Wrench, CreditCard, Truck];

export default function Etapes({ statut }) {
  const cur = STATUTS[statut] ? STATUTS[statut].phase : 0;

  return (
    <div className="flex items-center gap-0">
      {STEP_NAMES.map((nom, i) => {
        const n = i + 1;
        const done = cur > n;
        const active = cur === n;
        const Icon = STEP_ICONS[i];
        return (
          <div key={i} className="flex-1 flex flex-col items-center relative">
            {i > 0 && (
              <div
                className="absolute top-3 right-1/2 w-full h-0.5"
                style={{ backgroundColor: done || active ? BRAND.gold : '#e5e7eb', transform: 'translateX(-50%)' }}
              />
            )}
            <div
              className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all ${done ? 'shadow-sm' : active ? 'shadow-md' : ''}`}
              style={done ? { backgroundColor: BRAND.gold } : active ? { backgroundColor: BRAND.navy } : { backgroundColor: '#e5e7eb' }}
            >
              <Icon size={12} strokeWidth={2.5} className={done || active ? 'text-white' : 'text-gray-400'} />
            </div>
            <span
              className={`mt-1.5 text-center leading-tight ${done || active ? 'font-bold' : 'text-gray-400'}`}
              style={done ? { fontSize: 9, color: BRAND.goldD } : active ? { fontSize: 9, color: BRAND.navy } : { fontSize: 9 }}
            >
              {nom}
            </span>
          </div>
        );
      })}
    </div>
  );
}
