import React, { useMemo } from 'react';
import { BarChart3, Lightbulb, Star } from 'lucide-react';
import { StepHeader, ErrorSummary } from '../ui';
import { ACTIVITE_ITEMS, PRIORITES_ITEMS, RANGS } from '../../utils/constants';

const StepVision = ({ formData, updateFormData, updateRepartition, errors }) => {
  const totalActivite = useMemo(() => 
    Object.values(formData.repartition).reduce((a, b) => a + b, 0),
    [formData.repartition]
  );
  
  return (
    <div className="space-y-8 animate-in">
      {/* Note de synthèse */}
      <div className="bg-blue-50 border-l-4 border-blue-600 p-6 rounded-r-xl space-y-3">
        <h3 className="flex items-center gap-2 font-bold text-blue-900 uppercase tracking-wide text-sm">
          <Lightbulb className="w-5 h-5" aria-hidden="true" /> Note de Synthèse
        </h3>
        <p className="text-sm text-blue-800 leading-relaxed">
          L'objectif de ce diagnostic n'est pas technologique, mais <strong>économique</strong>. Il s'agit d'identifier les leviers d'IA capables de :
        </p>
        <ul className="list-disc list-inside text-sm text-blue-700 space-y-1 ml-2">
          <li>Sécuriser vos marges face à l'inflation (matériaux, fret, carburant).</li>
          <li>Augmenter votre "Win Rate" sur les marchés publics et privés.</li>
          <li>Optimiser vos ressources critiques (main-d'œuvre, flotte, logistique).</li>
        </ul>
      </div>

      <StepHeader icon={BarChart3} title="2. Vision & Performance Business" />
      
      <ErrorSummary errors={errors} />
      
      {/* Répartition activité */}
      <fieldset className="space-y-4">
        <div className="flex justify-between items-end">
          <legend className="text-sm font-bold text-slate-700 uppercase">Répartition de l'Activité (%)</legend>
          <div 
            className={`px-3 py-1 rounded-full text-xs font-bold border transition-all
              ${totalActivite !== 100 
                ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' 
                : 'bg-green-50 text-green-600 border-green-200'
              }`}
            role="status"
            aria-live="polite"
          >
            Total: {totalActivite}%
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ACTIVITE_ITEMS.map(item => (
            <div key={item.key} className="flex items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <label htmlFor={`repartition-${item.key}`} className="text-sm flex-1 font-medium">
                {item.label}
              </label>
              <input
                id={`repartition-${item.key}`}
                type="text"
                inputMode="numeric"
                maxLength={3}
                className="w-20 bg-white border border-slate-300 rounded-lg px-2 py-2 text-right font-bold text-blue-700 outline-none focus:ring-2 focus:ring-blue-500"
                value={formData.repartition[item.key]}
                onChange={e => updateRepartition(item.key, e.target.value)}
                aria-describedby="repartition-help"
              />
              <span className="text-slate-400 font-bold text-xs" aria-hidden="true">%</span>
            </div>
          ))}
        </div>
        <p id="repartition-help" className="text-xs text-slate-500">Le total doit égaler 100%</p>
      </fieldset>

      {/* Dépendance marchés publics */}
      <div className="space-y-4 pt-6 border-t border-slate-100">
        <div className="flex justify-between items-center">
          <label htmlFor="dependancePublique" className="text-sm font-bold text-slate-700 uppercase">
            Dépendance Marchés Publics
          </label>
          <span className="font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
            {formData.dependancePublique}% du CA
          </span>
        </div>
        <input 
          id="dependancePublique"
          type="range" 
          min="0" 
          max="100" 
          step="5"
          value={formData.dependancePublique} 
          onChange={e => updateFormData('dependancePublique', parseInt(e.target.value, 10))}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={formData.dependancePublique}
          className="w-full h-3 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
      </div>

      {/* Priorités stratégiques */}
      <fieldset className="space-y-6 pt-6 border-t border-slate-100">
        <legend className="text-sm font-bold text-slate-700 uppercase flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-500 fill-amber-500" aria-hidden="true" /> 
          Priorités Stratégiques (1 à 3 uniques)
        </legend>
        <div className="space-y-3">
          {PRIORITES_ITEMS.map(item => {
            const othersChoices = Object.entries(formData.priorites)
              .filter(([k, v]) => k !== item.key && v !== '')
              .map(([, v]) => v);
            return (
              <div key={item.key} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl">
                <label htmlFor={`priorite-${item.key}`} className="text-sm font-medium">
                  {item.label}
                </label>
                <select 
                  id={`priorite-${item.key}`}
                  value={formData.priorites[item.key]} 
                  onChange={e => updateFormData('priorites', {...formData.priorites, [item.key]: e.target.value})}
                  className="px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 font-bold outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-</option>
                  {RANGS.map(r => (
                    <option key={r} value={r} disabled={othersChoices.includes(r)}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
};

export default StepVision;
