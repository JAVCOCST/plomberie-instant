import React, { useState, useEffect } from 'react';
import s from './Immersive.module.css';

const CALENDAR_LINK = 'https://calendar.app.google/GZHA4eB4E6r6C12R7';

interface Props {
  onConfirm: (dateStr: string) => void;
}

const DateAvailability: React.FC<Props> = ({ onConfirm }) => {
  const [phase, setPhase] = useState<'intro' | 'calendar' | 'confirmed'>('intro');
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (phase !== 'intro') return;
    const dotInterval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);
    const timer = setTimeout(() => setPhase('calendar'), 1800);
    return () => {
      clearInterval(dotInterval);
      clearTimeout(timer);
    };
  }, [phase]);

  const handleConfirmBooked = () => {
    onConfirm(new Date().toISOString().slice(0, 10));
  };

  if (phase === 'intro') {
    return (
      <div className={s.stepWrap} style={{ textAlign: 'center' }}>
        <div style={{ margin: '0 auto 8px' }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ animation: 'spin 2s linear infinite' }}>
            <circle cx="24" cy="24" r="20" stroke="var(--imm-accent)" strokeWidth="2" strokeDasharray="40 80" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className={s.question} style={{ marginTop: 20 }}>
          Vérification des disponibilités{dots}
        </h2>
        <p className={s.subtext}>Consultation du calendrier de l'équipe</p>
      </div>
    );
  }

  const handleOpenCalendar = () => {
    window.open(CALENDAR_LINK, '_blank', 'noopener');
  };

  return (
    <div className={s.stepWrap} style={{ textAlign: 'center' }}>
      <h2 className={s.question}>Planifier une visite sur place</h2>
      <p className={s.subtext} style={{ marginBottom: 16 }}>
        Un expert se déplacera pour valider les dimensions et confirmer les prix.
        <br />Choisissez un créneau directement dans notre calendrier.
      </p>

      <button
        className={s.ctaBtn}
        onClick={handleOpenCalendar}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        Ouvrir le calendrier
      </button>

      <button
        className={s.ctaBtn}
        onClick={handleConfirmBooked}
        style={{
          marginTop: 10,
          background: 'transparent',
          border: '1px solid var(--imm-border)',
          color: 'var(--imm-text-dim)',
          fontSize: 14,
        }}
      >
        J'ai réservé mon créneau ✓
      </button>
    </div>
  );
};

export default DateAvailability;
