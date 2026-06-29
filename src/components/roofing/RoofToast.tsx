import React, { useEffect, useState, useCallback } from 'react';
import styles from './RoofToast.module.css';

interface ToastState {
  message: string;
  type: 'info' | 'error';
}

let showToastFn: ((msg: string, type?: 'info' | 'error') => void) | null = null;

export function showToast(msg: string, type: 'info' | 'error' = 'info') {
  showToastFn?.(msg, type);
}

const RoofToast: React.FC = () => {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [visible, setVisible] = useState(false);

  const show = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    setToast({ message, type });
    setVisible(true);
    setTimeout(() => setVisible(false), 3500);
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    showToastFn = show;
    return () => { showToastFn = null; };
  }, [show]);

  if (!toast) return null;

  return (
    <div className={`${styles.toast} ${visible ? styles.visible : ''} ${toast.type === 'error' ? styles.error : ''}`}>
      {toast.message}
    </div>
  );
};

export default RoofToast;
