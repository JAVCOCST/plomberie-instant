import React from 'react';
import styles from './ButtonGroup.module.css';

interface ButtonGroupProps<T extends string> {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (val: T) => void;
}

function ButtonGroup<T extends string>({ options, value, onChange }: ButtonGroupProps<T>) {
  return (
    <div className={styles.group}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className={`${styles.btn} ${value === o.value ? styles.active : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default ButtonGroup;
