import { useState, useEffect, useCallback } from 'react';
import { STORAGE_KEY } from '../utils/constants';

export const useFormPersistence = (initialData) => {
  const [formData, setFormData] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...initialData, ...parsed };
      }
    } catch (e) {
      console.warn('Erreur lecture localStorage:', e);
    }
    return initialData;
  });
  
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(formData));
    } catch (e) {
      console.warn('Erreur sauvegarde localStorage:', e);
    }
  }, [formData]);
  
  const clearStorage = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
  }, []);
  
  return [formData, setFormData, clearStorage];
};

export const useStepNavigation = (totalSteps, validateCurrentStep) => {
  const [step, setStep] = useState(0);
  const [stepErrors, setStepErrors] = useState({});
  
  const nextStep = useCallback(() => {
    const errors = validateCurrentStep(step);
    if (Object.keys(errors).length > 0) {
      setStepErrors(errors);
      return false;
    }
    setStepErrors({});
    setStep(s => Math.min(s + 1, totalSteps - 1));
    return true;
  }, [step, totalSteps, validateCurrentStep]);
  
  const prevStep = useCallback(() => {
    setStepErrors({});
    setStep(s => Math.max(s - 1, 0));
  }, []);
  
  const goToStep = useCallback((targetStep) => {
    if (targetStep >= 0 && targetStep < totalSteps) {
      setStepErrors({});
      setStep(targetStep);
    }
  }, [totalSteps]);
  
  return { step, stepErrors, setStepErrors, nextStep, prevStep, goToStep };
};

export const useBeforeUnload = (shouldWarn) => {
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (shouldWarn) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldWarn]);
};
