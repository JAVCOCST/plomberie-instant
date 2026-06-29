import React from 'react';
import { useFormContext } from '../../../context/FormContext';
import { SlopeLevel } from '../../../types/roofing';
import CardOption from '../CardOption';
import s from './steps.module.css';

const items: { value: SlopeLevel; label: string; rise: number }[] = [
  { value: '4-7', label: '4/12 – 7/12', rise: 4 },
  { value: '7-9', label: '7/12 – 9/12', rise: 7 },
  { value: '9-12', label: '9/12 – 12/12', rise: 9 },
  { value: '12+', label: '12/12+', rise: 12 },
];

const SlopeIcon: React.FC<{ rise: number }> = ({ rise }) => {
  const angle = Math.atan(rise / 12);
  const endY = 38 - Math.sin(angle) * 28;
  const endX = 8 + Math.cos(angle) * 28;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <line x1="8" y1="38" x2="40" y2="38" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
      <line x1="8" y1="38" x2={endX} y2={endY} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d={`M 16 38 A 8 8 0 0 1 ${8 + Math.cos(angle) * 12} ${38 - Math.sin(angle) * 12}`} stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
};

const StepSlope: React.FC = () => {
  const { data, updateData } = useFormContext();

  return (
    <div className={s.stepContainer}>
      <h2 className={s.stepTitle}>Inclinaison</h2>
      <div className={s.grid4}>
        {items.map(item => (
          <CardOption
            key={item.value}
            title={item.label}
            selected={data.slope === item.value}
            onClick={() => updateData({ slope: item.value })}
          >
            <SlopeIcon rise={item.rise} />
          </CardOption>
        ))}
      </div>
    </div>
  );
};

export default StepSlope;
