import React from 'react';
import { AlertCircle } from 'lucide-react';

export const FormField = ({ 
  id, label, type = 'text', value, onChange, error, placeholder, 
  required = false, helpText, className = '', inputMode, maxLength 
}) => (
  <div className={`space-y-2 ${className}`}>
    <label htmlFor={id} className="text-sm font-semibold text-slate-700 flex items-center gap-1">
      {label}
      {required && <span className="text-red-500">*</span>}
    </label>
    <input
      id={id}
      name={id}
      type={type}
      inputMode={inputMode}
      maxLength={maxLength}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : helpText ? `${id}-help` : undefined}
      className={`w-full px-4 py-3 rounded-xl border outline-none transition-all duration-200
        ${error 
          ? 'border-red-300 bg-red-50 focus:ring-2 focus:ring-red-500' 
          : 'border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
        }`}
    />
    {error && (
      <p id={`${id}-error`} className="text-sm text-red-600 flex items-center gap-1" role="alert">
        <AlertCircle className="w-4 h-4" /> {error}
      </p>
    )}
    {helpText && !error && (
      <p id={`${id}-help`} className="text-xs text-slate-500">{helpText}</p>
    )}
  </div>
);

export const YesNoToggle = ({ id, label, description, value, onChange, variant = 'blue' }) => {
  const colors = {
    blue: { 
      active: 'bg-blue-600 text-white border-blue-600', 
      inactive: 'bg-white border-slate-200 text-slate-400 hover:border-slate-300' 
    },
    orange: { 
      active: 'bg-orange-600 text-white border-orange-600', 
      inactive: 'bg-white border-orange-200 text-orange-400 hover:border-orange-300' 
    }
  };
  const colorSet = colors[variant];
  
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-bold text-slate-700 uppercase">{label}</legend>
      {description && <p className="text-sm text-slate-500">{description}</p>}
      <div className="flex gap-4" role="radiogroup" aria-labelledby={`${id}-label`}>
        {['Oui', 'Non'].map(opt => (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={value === opt}
            onClick={() => onChange(opt)}
            className={`flex-1 py-3 rounded-xl border-2 font-bold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
              ${value === opt ? colorSet.active : colorSet.inactive}`}
          >
            {opt}
          </button>
        ))}
      </div>
    </fieldset>
  );
};

export const OptionSelector = ({ id, label, options, value, onChange, columns = 3 }) => (
  <fieldset className="space-y-4">
    <legend className="text-sm font-bold text-slate-700">{label}</legend>
    <div className={`grid grid-cols-1 sm:grid-cols-${columns} gap-3`} role="radiogroup">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={value === opt}
          onClick={() => onChange(opt)}
          className={`p-4 rounded-xl border-2 font-bold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
            ${value === opt 
              ? 'bg-blue-600 text-white border-blue-600 shadow-md' 
              : 'bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100'
            }`}
        >
          {opt}
        </button>
      ))}
    </div>
  </fieldset>
);

export const SliderField = ({ id, label, value, onChange, min = 1, max = 10, showLabels = true, labelMin, labelMax }) => (
  <div className="space-y-4">
    <div className="flex justify-between items-center">
      <label htmlFor={id} className="text-sm font-bold text-slate-800">{label}</label>
      <span className="font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
        {value} / {max}
      </span>
    </div>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={onChange}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className="w-full h-3 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 transition-all"
    />
    {showLabels && (
      <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase tracking-widest">
        <span>{labelMin || 'Impact Faible'}</span>
        <span>{labelMax || 'Valeur Critique'}</span>
      </div>
    )}
  </div>
);

export const StepHeader = ({ icon: Icon, title }) => (
  <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
    <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
      <Icon aria-hidden="true" />
    </div>
    <h2 className="text-xl font-bold text-slate-800">{title}</h2>
  </div>
);

export const ErrorSummary = ({ errors }) => {
  if (Object.keys(errors).length === 0) return null;
  
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6" role="alert" aria-live="polite">
      <h3 className="font-bold text-red-800 flex items-center gap-2 mb-2">
        <AlertCircle className="w-5 h-5" /> Erreurs à corriger
      </h3>
      <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
        {Object.entries(errors).map(([field, message]) => (
          <li key={field}>{message}</li>
        ))}
      </ul>
    </div>
  );
};
