import React from 'react';
import styles from './Stepper.module.css';

interface StepperProps {
  steps: string[];
  current: number;
}

const Stepper: React.FC<StepperProps> = ({ steps, current }) => {
  return (
    <div className={styles.stepper}>
      {steps.map((_, i) => (
        <div
          key={i}
          className={`${styles.step} ${i === current ? styles.active : ''} ${i < current ? styles.completed : ''}`}
        />
      ))}
    </div>
  );
};

export default Stepper;
