import React from 'react';
import { Database } from 'lucide-react';
import { StepHeader } from '../ui';

const DATA_ITEMS = [
  { key: 'systemeCloud', label: 'Système Cloud & API : Utilisez-vous déjà des services Cloud (Google Cloud/Firebase) ?' },
  { key: 'suiviFlotte', label: 'Suivi Flotte : Disposez-vous de l\'historique GPS des véhicules ?' },
  { key: 'qualiteAdresses', label: 'Qualité des Adresses : Vos bases chantiers sont-elles géocodées ?' }
];

const StepData = ({ formData, updateFormData }) => (
  <div className="space-y-8 animate-in">
    <StepHeader icon={Database} title="5. Capital Data & Infrastructure" />
    
    <div className="space-y-4">
      {DATA_ITEMS.map(item => (
        <div 
          key={item.key} 
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 border border-slate-100 rounded-2xl hover:bg-blue-50/20 transition-colors"
        >
          <span id={`${item.key}-label`} className="text-sm font-semibold text-slate-700 leading-tight">
            {item.label}
          </span>
          <div className="flex gap-2" role="radiogroup" aria-labelledby={`${item.key}-label`}>
            {['Oui', 'Non'].map(opt => (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={formData[item.key] === opt}
                onClick={() => updateFormData(item.key, opt)}
                className={`px-8 py-2 rounded-xl border-2 text-xs font-black transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
                  ${formData[item.key] === opt 
                    ? 'bg-blue-600 text-white border-blue-600' 
                    : 'bg-white border-slate-200 text-slate-300 hover:border-slate-300'
                  }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default StepData;
