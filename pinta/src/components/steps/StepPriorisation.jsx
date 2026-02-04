import React, { useMemo } from 'react';
import { Target, AlertCircle } from 'lucide-react';
import { SliderField, StepHeader } from '../ui';
import { IA_VALUE_ITEMS } from '../../utils/constants';

const StepPriorisation = ({ formData, updateFormData }) => {
  const totalActivite = useMemo(() => 
    Object.values(formData.repartition).reduce((a, b) => a + b, 0),
    [formData.repartition]
  );
  
  return (
    <div className="space-y-8 animate-in">
      <StepHeader icon={Target} title="6. Matrice de Priorisation IA (Attentes CODIR)" />
      
      <p className="text-sm text-slate-600 font-medium italic">
        Selon vous, où l'IA apporterait-elle le plus de valeur immédiate ? (Note de 1 à 10)
      </p>
      
      <div className="space-y-10">
        {IA_VALUE_ITEMS.map(item => (
          <SliderField
            key={item.key}
            id={item.key}
            label={item.label}
            value={formData[item.key]}
            onChange={e => updateFormData(item.key, parseInt(e.target.value, 10))}
          />
        ))}
      </div>
      
      {totalActivite !== 100 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl" role="alert">
          <p className="text-sm text-amber-800 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Attention : La répartition d'activité (étape 2) n'est pas à 100%. Veuillez corriger avant de finaliser.
          </p>
        </div>
      )}
      
      <div className="mt-8 p-6 bg-blue-50 rounded-2xl border border-blue-100 text-center text-blue-800 italic text-sm">
        "Merci. Ce diagnostic servira de base à notre séance de travail Quick Wins & ROI."
      </div>
    </div>
  );
};

export default StepPriorisation;
