import React from 'react';
import styles from './CardOption.module.css';

interface CardOptionProps {
  title: string;
  description?: string;
  selected?: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}

const CardOption: React.FC<CardOptionProps> = ({ title, description, selected, onClick, children }) => {
  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      onClick={onClick}
    >
      {children && <div className={styles.cardImage}>{children}</div>}
      <span className={styles.cardTitle}>{title}</span>
      {description && <span className={styles.cardDesc}>{description}</span>}
    </button>
  );
};

export default CardOption;
