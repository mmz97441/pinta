import React from 'react';
import { Truck, Info } from 'lucide-react';
import { OptionSelector, YesNoToggle, StepHeader } from '../ui';

const StepLogistique = ({ formData, updateFormData }) => (
  <div className="space-y-8 animate-in">
    <StepHeader icon={Truck} title="4. Excellence Opérationnelle & Logistique" />
    
    <div className="space-y-8">
      <OptionSelector
        id="optimisationTournees"
        label="Optimisation des Tournées :"
        options={['Manuel', 'Expérience', 'Algorithme']}
        value={formData.optimisationTournees}
        onChange={(val) => updateFormData('optimisationTournees', val)}
      />
      
      <div className="p-6 bg-orange-50 rounded-2xl border-2 border-orange-100 space-y-4">
        <div className="flex items-center gap-2 text-orange-800 font-bold text-sm uppercase tracking-wide mb-2">
          <Info className="w-4 h-4" aria-hidden="true" />
          Contraintes de Circulation (Réunion)
        </div>
        <YesNoToggle
          id="contraintesCirculation"
          label=""
          description="Prenez-vous en compte les pics de congestion (ex: St-Denis, Route du Littoral) ?"
          value={formData.contraintesCirculation}
          onChange={(val) => updateFormData('contraintesCirculation', val)}
          variant="orange"
        />
      </div>
      
      <fieldset className="space-y-4">
        <legend className="text-sm font-bold text-slate-700">Gestion des Ressources :</legend>
        <div className="flex gap-4" role="radiogroup">
          {['Centralisés', 'Silos'].map(opt => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={formData.gestionRessources === opt}
              onClick={() => updateFormData('gestionRessources', opt)}
              className={`flex-1 p-4 rounded-xl border-2 font-bold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
                ${formData.gestionRessources === opt 
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md' 
                  : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200'
                }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  </div>
);

export default StepLogistique;
