import React, { useEffect, useRef, useState } from 'react';
import { useFormContext } from '../../../context/FormContext';
import { ContactPreference } from '../../../types/roofing';
import s from './steps.module.css';

interface FieldProps {
  label: string;
  value: string;
  isValid: boolean;
  isFocused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  children: React.ReactNode;
}

const ValidatedField: React.FC<FieldProps> = ({ label, isValid, isFocused, children }) => {
  // Show check only when valid AND not currently focused
  const showCheck = isValid && !isFocused;

  const wrapperClass = [
    s.fieldGroup,
    showCheck ? s.fieldDone : '',
    !isValid && !isFocused ? s.fieldDimmed : '',
    isFocused ? s.fieldActive : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapperClass}>
      <label className={s.label}>{label}</label>
      <div className={s.inputWrap}>
        {children}
        {showCheck && <span className={s.inlineCheck}>✓</span>}
      </div>
    </div>
  );
};

const StepClient: React.FC = () => {
  const { data, updateData } = useFormContext();
  const c = data.client;
  const [focused, setFocused] = useState<string | null>('firstName');
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus prénom au montage
    setTimeout(() => firstInputRef.current?.focus(), 100);
  }, []);

  const update = (field: keyof typeof c, value: string) => {
    updateData({ client: { ...c, [field]: value } });
  };

  const isValidFirst = c.firstName.trim().length > 0;
  const isValidLast = c.lastName.trim().length > 0;
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email);
  const isValidPhone = c.phone.trim().length >= 7;

  const fields = [
    { key: 'firstName', label: 'Prénom *', valid: isValidFirst, placeholder: 'Jean', type: 'text' },
    { key: 'phone', label: 'Téléphone *', valid: isValidPhone, placeholder: '(514) 555-1234', type: 'tel' },
    { key: 'lastName', label: 'Nom *', valid: isValidLast, placeholder: 'Dupont', type: 'text' },
    { key: 'email', label: 'Courriel *', valid: isValidEmail, placeholder: 'jean@exemple.com', type: 'email' },
  ] as const;

  // Find first empty field to auto-highlight
  const firstIncomplete = fields.find(f => !f.valid)?.key || null;
  const activeField = focused || firstIncomplete;

  return (
    <div className={s.stepContainer}>
      <h2 className={s.stepTitle}>Informations client</h2>
      <div className={s.grid2}>
        {fields.slice(0, 2).map(f => (
          <ValidatedField
            key={f.key}
            label={f.label}
            value={c[f.key]}
            isValid={f.valid}
            isFocused={activeField === f.key}
            onFocus={() => setFocused(f.key)}
            onBlur={() => setFocused(null)}
          >
            <input
              ref={f.key === 'firstName' ? firstInputRef : undefined}
              className={s.input}
              type={f.type}
              value={c[f.key]}
              onChange={e => update(f.key, e.target.value)}
              onFocus={() => setFocused(f.key)}
              onBlur={() => setFocused(null)}
              placeholder={f.placeholder}
            />
          </ValidatedField>
        ))}
      </div>
      {fields.slice(2).map(f => (
        <ValidatedField
          key={f.key}
          label={f.label}
          value={c[f.key]}
          isValid={f.valid}
          isFocused={activeField === f.key}
          onFocus={() => setFocused(f.key)}
          onBlur={() => setFocused(null)}
        >
          <input
            className={s.input}
            type={f.type}
            value={c[f.key]}
            onChange={e => update(f.key, e.target.value)}
            onFocus={() => setFocused(f.key)}
            onBlur={() => setFocused(null)}
            placeholder={f.placeholder}
          />
        </ValidatedField>
      ))}

      <div className={s.fieldGroup}>
        <label className={s.label}>Recevoir ma soumission par</label>
        <div className={s.toggleGroup}>
          <button
            type="button"
            className={`${s.toggleBtn} ${data.contactPreference === 'email' ? s.toggleBtnActive : ''}`}
            onClick={() => updateData({ contactPreference: 'email' as ContactPreference })}
          >
            Courriel
          </button>
          <button
            type="button"
            className={`${s.toggleBtn} ${data.contactPreference === 'sms' ? s.toggleBtnActive : ''}`}
            onClick={() => updateData({ contactPreference: 'sms' as ContactPreference })}
          >
            SMS
          </button>
        </div>
      </div>
    </div>
  );
};

export default StepClient;
