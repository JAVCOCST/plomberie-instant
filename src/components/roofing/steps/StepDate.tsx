import React from 'react';
import { useFormContext } from '../../../context/FormContext';
import s from './steps.module.css';

const StepDate: React.FC = () => {
  const { data, updateData } = useFormContext();
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className={s.stepContainer}>
      <h2 className={s.stepTitle}>Date d'installation souhaitée</h2>
      <div className={s.fieldGroup}>
        <label className={s.label}>Date *</label>
        <input
          className={s.input}
          type="date"
          min={today}
          value={data.desiredInstallDate}
          onChange={e => updateData({ desiredInstallDate: e.target.value })}
        />
      </div>
    </div>
  );
};

export default StepDate;
