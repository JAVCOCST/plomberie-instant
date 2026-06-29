import React from 'react';
import { useFormContext } from '../../../context/FormContext';
import { CoverageType } from '../../../types/roofing';
import ButtonGroup from '../ButtonGroup';
import s from './steps.module.css';

const options: { value: CoverageType; label: string }[] = [
  { value: 'shingle_2pans', label: "Bardeaux 2 pans" },
  { value: 'shingle_4pans', label: "Bardeaux 4 pans" },
  { value: 'shingle_4pans_plus', label: "Bardeaux 4 pans +" },
  { value: 'membrane_elastomere', label: 'Membrane élastomère' },
  { value: 'membrane_gravier', label: 'Membrane gravier' },
  { value: 'tole_2pans', label: 'Tôle 2 pans' },
  { value: 'tole_4pans', label: 'Tôle 4 pans' },
  { value: 'tole_4pans_plus', label: 'Tôle 4 pans +' },
];

const StepCoverage: React.FC = () => {
  const { data, updateData } = useFormContext();

  return (
    <div className={s.stepContainer}>
      <h2 className={s.stepTitle}>Type de couverture</h2>
      <ButtonGroup options={options} value={data.coverageType} onChange={v => updateData({ coverageType: v, product: null, color: '' })} />
    </div>
  );
};

export default StepCoverage;
