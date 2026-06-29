import React from 'react';
import { useFormContext } from '../../../context/FormContext';
import { AreaUnit } from '../../../types/roofing';
import ButtonGroup from '../ButtonGroup';
import s from './steps.module.css';

const unitOptions: { value: AreaUnit; label: string }[] = [
  { value: 'sqft', label: 'pi²' },
  { value: 'sqm', label: 'm²' },
];

const StepArea: React.FC = () => {
  const { data, updateData } = useFormContext();

  return (
    <div className={s.stepContainer}>
      <h2 className={s.stepTitle}>Superficie</h2>
      <div className={s.inlineGroup}>
        <div className={s.fieldGroup}>
          <label className={s.label}>Superficie *</label>
          <input
            className={s.input}
            type="number"
            min="0"
            value={data.area || ''}
            onChange={e => updateData({ area: parseFloat(e.target.value) || 0 })}
            placeholder="ex: 1500"
          />
        </div>
        <div className={s.fieldGroup}>
          <label className={s.label}>Unité</label>
          <ButtonGroup options={unitOptions} value={data.areaUnit} onChange={v => updateData({ areaUnit: v })} />
        </div>
      </div>
    </div>
  );
};

export default StepArea;
