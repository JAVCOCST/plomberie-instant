import React from 'react';
import { useFormContext } from '../../../context/FormContext';
import { ComplexityLevel } from '../../../types/roofing';
import CardOption from '../CardOption';
import s from './steps.module.css';

const items: { value: ComplexityLevel; label: string; desc: string }[] = [
  { value: 'simple', label: 'Simple', desc: 'Toit 2 pans, peu d\'obstacles' },
  { value: 'moyenne', label: 'Moyenne', desc: 'Quelques pénétrations' },
  { value: 'complexe', label: 'Complexe', desc: 'Multiples niveaux' },
  { value: 'tres_complexe', label: 'Très complexe', desc: 'Géométrie irrégulière' },
];

const ComplexityIcon: React.FC<{ level: ComplexityLevel }> = ({ level }) => {
  const lines = level === 'simple' ? 1 : level === 'moyenne' ? 2 : level === 'complexe' ? 3 : 4;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      {Array.from({ length: lines }).map((_, i) => (
        <line key={i} x1={8 + i * 4} y1={36 - i * 6} x2={24} y2={12 + i * 2} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ))}
      <line x1="8" y1="36" x2="40" y2="36" stroke="currentColor" strokeWidth="2" />
      {lines > 1 && <line x1="24" y1="12" x2="40" y2="36" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
};

const StepComplexity: React.FC = () => {
  const { data, updateData } = useFormContext();

  return (
    <div className={s.stepContainer}>
      <h2 className={s.stepTitle}>Complexité du toit</h2>
      <div className={s.grid4}>
        {items.map(item => (
          <CardOption
            key={item.value}
            title={item.label}
            description={item.desc}
            selected={data.complexity === item.value}
            onClick={() => updateData({ complexity: item.value })}
          >
            <ComplexityIcon level={item.value} />
          </CardOption>
        ))}
      </div>
    </div>
  );
};

export default StepComplexity;
