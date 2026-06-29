import React, { useEffect, useState, useRef } from 'react';
import s from './HouseBuilder.module.css';

interface HouseBuilderProps {
  /** 0-based current step */
  current: number;
  /** total steps */
  total: number;
}

const EMOJIS = ['🏗️', '🔨', '🧱', '📐', '📏', '🪵', '🎨', '🖌️', '🏠'];

const HouseBuilder: React.FC<HouseBuilderProps> = ({ current, total }) => {
  const progress = Math.min((current / (total - 1)) * 100, 100);
  const prevStep = useRef(current);
  const [particles, setParticles] = useState<{ id: number; x: number; emoji: string }[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (current !== prevStep.current) {
      // Spawn particles on step change
      const newParticles = Array.from({ length: 6 }, () => ({
        id: idRef.current++,
        x: Math.random() * 80 + 10,
        emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
      }));
      setParticles(prev => [...prev, ...newParticles]);
      // Clean up after animation
      setTimeout(() => {
        setParticles(prev => prev.filter(p => !newParticles.find(np => np.id === p.id)));
      }, 1200);
      prevStep.current = current;
    }
  }, [current]);

  // House SVG layers - each appears at a certain progress threshold
  const layers = [
    { threshold: 0, id: 'ground' },
    { threshold: 5, id: 'foundation' },
    { threshold: 15, id: 'walls' },
    { threshold: 30, id: 'door' },
    { threshold: 40, id: 'window1' },
    { threshold: 50, id: 'window2' },
    { threshold: 60, id: 'roofBase' },
    { threshold: 75, id: 'roofTop' },
    { threshold: 90, id: 'chimney' },
  ];

  return (
    <div className={s.container}>
      {/* Particles */}
      {particles.map(p => (
        <span
          key={p.id}
          className={s.particle}
          style={{ left: `${p.x}%` }}
        >
          {p.emoji}
        </span>
      ))}

      {/* Progress bar glow */}
      <div className={s.progressTrack}>
        <div
          className={s.progressFill}
          style={{ width: `${progress}%` }}
        />
        <div
          className={s.progressGlow}
          style={{ left: `${progress}%` }}
        />
      </div>

      {/* House SVG */}
      <div className={s.houseWrap}>
        <svg viewBox="0 0 200 160" className={s.houseSvg} xmlns="http://www.w3.org/2000/svg">
          {/* Ground */}
          <rect
            x="10" y="145" width="180" height="8" rx="4"
            className={`${s.layer} ${progress >= 0 ? s.layerVisible : ''}`}
            fill="hsl(142, 40%, 78%)"
          />

          {/* Foundation */}
          <rect
            x="35" y="135" width="130" height="14" rx="2"
            className={`${s.layer} ${progress >= 5 ? s.layerVisible : ''}`}
            fill="hsl(30, 15%, 55%)"
          />

          {/* Walls */}
          <rect
            x="40" y="75" width="120" height="62" rx="2"
            className={`${s.layer} ${progress >= 15 ? s.layerVisible : ''}`}
            fill="hsl(35, 60%, 92%)"
            stroke="hsl(30, 20%, 70%)"
            strokeWidth="1.5"
          />

          {/* Door */}
          <rect
            x="85" y="100" width="30" height="37" rx="3"
            className={`${s.layer} ${progress >= 30 ? s.layerVisible : ''}`}
            fill="hsl(20, 50%, 40%)"
          />
          <circle
            cx="110" cy="120" r="2"
            className={`${s.layer} ${progress >= 30 ? s.layerVisible : ''}`}
            fill="hsl(45, 80%, 60%)"
          />

          {/* Window left */}
          <rect
            x="52" y="88" width="22" height="22" rx="2"
            className={`${s.layer} ${progress >= 40 ? s.layerVisible : ''}`}
            fill="hsl(200, 60%, 82%)"
            stroke="hsl(30, 20%, 60%)"
            strokeWidth="1.5"
          />
          <line
            x1="63" y1="88" x2="63" y2="110"
            className={`${s.layer} ${progress >= 40 ? s.layerVisible : ''}`}
            stroke="hsl(30, 20%, 60%)"
            strokeWidth="1"
          />
          <line
            x1="52" y1="99" x2="74" y2="99"
            className={`${s.layer} ${progress >= 40 ? s.layerVisible : ''}`}
            stroke="hsl(30, 20%, 60%)"
            strokeWidth="1"
          />

          {/* Window right */}
          <rect
            x="126" y="88" width="22" height="22" rx="2"
            className={`${s.layer} ${progress >= 50 ? s.layerVisible : ''}`}
            fill="hsl(200, 60%, 82%)"
            stroke="hsl(30, 20%, 60%)"
            strokeWidth="1.5"
          />
          <line
            x1="137" y1="88" x2="137" y2="110"
            className={`${s.layer} ${progress >= 50 ? s.layerVisible : ''}`}
            stroke="hsl(30, 20%, 60%)"
            strokeWidth="1"
          />
          <line
            x1="126" y1="99" x2="148" y2="99"
            className={`${s.layer} ${progress >= 50 ? s.layerVisible : ''}`}
            stroke="hsl(30, 20%, 60%)"
            strokeWidth="1"
          />

          {/* Roof base */}
          <polygon
            points="30,77 100,30 170,77"
            className={`${s.layer} ${progress >= 60 ? s.layerVisible : ''}`}
            fill="hsl(0, 55%, 45%)"
          />
          <polygon
            points="30,77 100,35 170,77"
            className={`${s.layer} ${progress >= 60 ? s.layerVisible : ''}`}
            fill="hsl(0, 50%, 52%)"
          />

          {/* Roof ridge line */}
          <line
            x1="100" y1="30" x2="100" y2="35"
            className={`${s.layer} ${progress >= 75 ? s.layerVisible : ''}`}
            stroke="hsl(0, 40%, 35%)"
            strokeWidth="2"
          />
          <line
            x1="30" y1="77" x2="170" y2="77"
            className={`${s.layer} ${progress >= 75 ? s.layerVisible : ''}`}
            stroke="hsl(0, 40%, 35%)"
            strokeWidth="1.5"
          />

          {/* Chimney */}
          <rect
            x="130" y="25" width="16" height="30" rx="2"
            className={`${s.layer} ${progress >= 90 ? s.layerVisible : ''}`}
            fill="hsl(0, 20%, 50%)"
          />
          {/* Smoke */}
          <circle
            cx="138" cy="18" r="4"
            className={`${s.layer} ${s.smoke} ${progress >= 90 ? s.layerVisible : ''}`}
            fill="hsl(0, 0%, 85%)"
            opacity="0.6"
          />
          <circle
            cx="142" cy="10" r="3"
            className={`${s.layer} ${s.smoke2} ${progress >= 90 ? s.layerVisible : ''}`}
            fill="hsl(0, 0%, 88%)"
            opacity="0.4"
          />
        </svg>
      </div>

      {/* Step counter */}
      <div className={s.stepCounter}>
        <span className={s.stepNum}>{current + 1}</span>
        <span className={s.stepSep}>/</span>
        <span className={s.stepTotal}>{total}</span>
      </div>
    </div>
  );
};

export default HouseBuilder;
