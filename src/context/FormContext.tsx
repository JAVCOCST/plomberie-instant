import React, { createContext, useContext, useState, useCallback } from 'react';
import { FormData, initialFormData } from '../types/roofing';

interface FormContextType {
  data: FormData;
  step: number;
  setStep: (s: number) => void;
  updateData: (partial: Partial<FormData>) => void;
  resetForm: () => void;
}

const FormContext = createContext<FormContextType | null>(null);

export const useFormContext = () => {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error('useFormContext must be used within FormProvider');
  return ctx;
};

export const FormProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<FormData>(initialFormData);
  const [step, setStep] = useState(0);

  const updateData = useCallback((partial: Partial<FormData>) => {
    setData(prev => ({ ...prev, ...partial }));
  }, []);

  const resetForm = useCallback(() => {
    setData(initialFormData);
    setStep(0);
  }, []);

  return (
    <FormContext.Provider value={{ data, step, setStep, updateData, resetForm }}>
      {children}
    </FormContext.Provider>
  );
};
