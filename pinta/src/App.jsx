import React, { useState, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronLeft, Send, Loader2, AlertCircle, X } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './config/firebase';

import { useFormPersistence, useStepNavigation, useBeforeUnload } from './hooks';
import { validateStep } from './utils/validation';
import { INITIAL_FORM_DATA, STEPS } from './utils/constants';

import { StepIdentite, StepVision, StepMarches, StepLogistique, StepData, StepPriorisation } from './components/steps';
import ConfirmationScreen from './components/ConfirmationScreen';

const App = () => {
  const [formData, setFormData, clearStorage] = useFormPersistence(INITIAL_FORM_DATA);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  
  const validateCurrentStep = useCallback((currentStep) => {
    return validateStep(currentStep, formData);
  }, [formData]);
  
  const { step, stepErrors, setStepErrors, nextStep, prevStep } = useStepNavigation(
    STEPS.length, 
    validateCurrentStep
  );
  
  const updateFormData = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, [setFormData]);

  const updateRepartition = useCallback((key, value) => {
    let cleanValue = value.toString().replace(/[^0-9]/g, '');
    let val = cleanValue === '' ? 0 : Math.min(parseInt(cleanValue, 10), 100);
    
    setFormData(prev => ({
      ...prev,
      repartition: { ...prev.repartition, [key]: val }
    }));
  }, [setFormData]);

  const totalActivite = useMemo(() => 
    Object.values(formData.repartition).reduce((a, b) => a + b, 0),
    [formData.repartition]
  );

  const hasData = formData.nom || formData.entreprise || formData.siret;
  useBeforeUnload(hasData && !isSubmitted);

  const downloadData = useCallback(() => {
    const fileName = `diagnostic_${formData.entreprise.replace(/\s+/g, '_') || 'export'}_${new Date().toISOString().slice(0, 10)}.json`;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(formData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }, [formData]);

  const handleSubmit = useCallback(async (e) => { 
    e.preventDefault();
    
    // Validation finale
    const finalErrors = validateStep(step, formData);
    if (Object.keys(finalErrors).length > 0) {
      setStepErrors(finalErrors);
      return;
    }
    
    if (totalActivite !== 100) {
      setSubmitError('La répartition d\'activité doit totaliser 100%');
      return;
    }
    
    setIsSubmitting(true);
    setSubmitError(null);
    
    try {
      // Envoi vers Firebase Firestore
      await addDoc(collection(db, 'diagnostics'), {
        ...formData,
        createdAt: serverTimestamp(),
        status: 'pending',
        source: 'pinta-web'
      });
      
      clearStorage();
      setIsSubmitted(true);
    } catch (error) {
      console.error('Erreur Firebase:', error);
      setSubmitError('Erreur lors de l\'envoi. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, step, totalActivite, setStepErrors, clearStorage]);

  const handleReset = useCallback(() => {
    clearStorage();
    setFormData(INITIAL_FORM_DATA);
    setIsSubmitted(false);
    window.location.reload();
  }, [clearStorage, setFormData]);

  // Écran de confirmation
  if (isSubmitted) {
    return (
      <ConfirmationScreen 
        formData={formData} 
        onDownload={downloadData} 
        onReset={handleReset} 
      />
    );
  }

  // Rendu du step actuel
  const renderStep = () => {
    const commonProps = { formData, updateFormData, errors: stepErrors };
    
    switch (step) {
      case 0: return <StepIdentite {...commonProps} />;
      case 1: return <StepVision {...commonProps} updateRepartition={updateRepartition} />;
      case 2: return <StepMarches {...commonProps} />;
      case 3: return <StepLogistique {...commonProps} />;
      case 4: return <StepData {...commonProps} />;
      case 5: return <StepPriorisation {...commonProps} />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-12">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-black text-sm">P</span>
            </div>
            <h1 className="text-xl font-bold text-blue-900">Pinta</h1>
            <span className="text-xs text-slate-400 hidden sm:inline">Diagnostic IA & Performance</span>
          </div>
          
          {/* Progress indicators */}
          <nav aria-label="Progression du formulaire">
            <ol className="flex gap-1 sm:gap-2">
              {STEPS.map((s, i) => (
                <li key={i}>
                  <div 
                    className={`h-2 w-6 sm:w-8 rounded-full transition-all duration-300 ${i <= step ? 'bg-blue-600' : 'bg-slate-200'}`}
                    aria-current={i === step ? 'step' : undefined}
                    title={`Étape ${i + 1}: ${s.title}`}
                  />
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </header>

      {/* Main form */}
      <main className="max-w-4xl mx-auto px-4 mt-8">
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 md:p-10">
            {renderStep()}
          </div>

          {/* Navigation footer */}
          <div className="bg-slate-50 border-t border-slate-200 p-6 md:p-8">
            {submitError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2" role="alert">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                {submitError}
                <button 
                  type="button" 
                  onClick={() => setSubmitError(null)}
                  className="ml-auto p-1 hover:bg-red-100 rounded"
                  aria-label="Fermer l'erreur"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
              {step > 0 && (
                <button 
                  type="button" 
                  onClick={prevStep} 
                  className="w-full sm:w-auto flex items-center justify-center gap-2 text-slate-500 font-bold hover:text-slate-900 py-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-lg px-4"
                >
                  <ChevronLeft className="w-5 h-5" aria-hidden="true" /> Retour
                </button>
              )}
              
              <div className="w-full sm:w-auto sm:ml-auto flex flex-col sm:flex-row gap-3">
                {step < STEPS.length - 1 ? (
                  <button 
                    type="button" 
                    onClick={nextStep} 
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-700 text-white px-10 py-4 rounded-xl font-black hover:bg-blue-800 transition-all shadow-xl shadow-blue-200 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Suivant <ChevronRight className="w-5 h-5" aria-hidden="true" />
                  </button>
                ) : (
                  <button 
                    type="submit" 
                    disabled={totalActivite !== 100 || isSubmitting}
                    className={`w-full sm:w-auto flex items-center justify-center gap-2 px-12 py-4 rounded-xl font-black transition-all shadow-xl active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2
                      ${totalActivite !== 100 || isSubmitting
                        ? 'bg-slate-300 text-slate-500 cursor-not-allowed' 
                        : 'bg-green-600 text-white hover:bg-green-700 shadow-green-200 focus:ring-green-500'
                      }`}
                    aria-disabled={totalActivite !== 100 || isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> 
                        Envoi...
                      </>
                    ) : (
                      <>
                        Finaliser <Send className="w-5 h-5" aria-hidden="true" />
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
        
        {/* Indicateur de sauvegarde automatique */}
        <p className="text-center text-xs text-slate-400 mt-4">
          💾 Vos réponses sont sauvegardées automatiquement
        </p>
      </main>
    </div>
  );
};

export default App;
