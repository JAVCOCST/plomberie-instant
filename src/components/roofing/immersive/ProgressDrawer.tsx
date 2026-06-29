import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Circle, MapPin, User, Phone, Home, Wrench, Layers, X } from 'lucide-react';
import { useFormContext } from '../../../context/FormContext';

/* ── Building metrics ── */
export interface BuildingMetrics {
  superficieM2: number;
  perimetreM: number | null;
  largeurM: number | null;
  profondeurM: number | null;
  noLot: string | null;
}

/* ── Step config ── */
interface StepInfo {
  key: string;
  label: string;
  icon: React.ReactNode;
  getValue: (data: any, extra: ExtraData) => string | null;
  editable?: boolean;
}

interface ExtraData {
  introName: string;
  introPhone: string;
  addressText: string;
  workType: string | null;
  buildingType: string | null;
}

const STEP_CONFIG: StepInfo[] = [
  {
    key: 'name', label: 'Prénom', icon: <User size={16} />,
    getValue: (d, e) => e.introName || d.client?.firstName || null,
  },
  {
    key: 'address', label: 'Adresse', icon: <MapPin size={16} />,
    getValue: (d) => {
      if (!d.address?.formatted_address) return null;
      const parts = d.address.formatted_address.split(',');
      return parts[0]?.trim() || d.address.formatted_address;
    },
  },
  {
    key: 'workType', label: 'Type de travaux', icon: <Wrench size={16} />,
    getValue: (d, e) => {
      const map: Record<string, string> = {
        remplacement: 'Remplacement', reparations: 'Réparations',
        inspection: 'Inspection', nouvelle_construction: 'Nouvelle construction', autre: 'Autre',
      };
      return e.workType ? (map[e.workType] || e.workType) : null;
    },
  },
  {
    key: 'building', label: 'Bâtiment confirmé', icon: <Home size={16} />,
    getValue: (d) => d.address ? '✓' : null,
  },
  {
    key: 'analysis', label: 'Analyse IA', icon: <Layers size={16} />,
    getValue: (d) => {
      if (!d.coverageType || !d.slope || !d.product || !d.color) return null;
      const covMap: Record<string, string> = {
        shingle_2pans: 'Bardeaux 2V', shingle_4pans: 'Bardeaux 4V',
        shingle_4pans_plus: 'Bardeaux 4V+', membrane_elastomere: 'Élastomère',
        membrane_gravier: 'Gravier', tole_2pans: 'Tôle 2V',
        tole_4pans: 'Tôle 4V', tole_4pans_plus: 'Tôle 4V+',
      };
      return covMap[d.coverageType] || d.coverageType;
    },
  },
  {
    key: 'contact', label: 'Coordonnées', icon: <Phone size={16} />,
    getValue: (d) => d.client?.email || null,
  },
];

const FORM_STEP_TO_PROGRESS: Record<number, number> = {
  0: 1,
  1: 2,
  2: 3,
  3: 4,
  4: 5,
};

const PROGRESS_TO_FORM_STEP: Record<number, number> = {
  1: 0,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
};

interface ProgressDrawerProps {
  phase: 'intro' | 'form' | 'computing' | 'result';
  introName: string;
  introPhone: string;
  addressText: string;
  workType: string | null;
  buildingType: string | null;
  onBuildingTypeChange?: (val: string) => void;
  onNavigateToStep?: (formStep: number) => void;
  buildingMetrics?: BuildingMetrics;
}

const triggerHaptic = () => {
  try {
    if (navigator.vibrate) navigator.vibrate([8, 30, 8]);
  } catch {}
};

const m2ToSqft = (m2: number) => Math.round(m2 * 10.7639);
const mToFt = (m: number) => (m * 3.28084).toFixed(1);

const ProgressDrawer: React.FC<ProgressDrawerProps> = ({
  phase, introName, introPhone, addressText, workType, buildingType, onBuildingTypeChange, onNavigateToStep, buildingMetrics,
}) => {
  const { data, step } = useFormContext();
  const [open, setOpen] = useState(false);
  const prevCompletedRef = useRef(0);

  const extra: ExtraData = { introName, introPhone, addressText, workType, buildingType };

  const completedSteps = STEP_CONFIG.map((s, i) => ({
    ...s, index: i,
    value: s.getValue(data, extra),
  }));

  const completedCount = completedSteps.filter(s => s.value !== null).length;

  useEffect(() => {
    if (completedCount > prevCompletedRef.current && completedCount > 0) {
      triggerHaptic();
    }
    prevCompletedRef.current = completedCount;
  }, [completedCount]);

  const activeProgressStep = phase === 'intro'
    ? (introName ? 1 : 0)
    : (FORM_STEP_TO_PROGRESS[step] ?? 2);

  const toggle = useCallback(() => {
    triggerHaptic();
    setOpen(o => !o);
  }, []);

  const handleStepClick = useCallback((progressIndex: number) => {
    const formStep = PROGRESS_TO_FORM_STEP[progressIndex];
    if (formStep !== undefined && onNavigateToStep) {
      triggerHaptic();
      onNavigateToStep(formStep);
      setOpen(false);
    }
  }, [onNavigateToStep]);

  if (phase === 'computing' || phase === 'result') return null;

  const pct = Math.round((completedCount / STEP_CONFIG.length) * 100);

  return (
    <>
      <motion.button
        onClick={toggle}
        className="progress-fab"
        whileTap={{ scale: 0.9 }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.5 }}
        aria-label="Voir la progression"
      >
        <svg width="52" height="52" viewBox="0 0 52 52" style={{ position: 'absolute', inset: 0 }}>
          <circle cx="26" cy="26" r="22" fill="none" stroke="hsla(260, 70%, 62%, 0.2)" strokeWidth="3" />
          <motion.circle
            cx="26" cy="26" r="22" fill="none"
            stroke="hsl(260, 70%, 62%)" strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 22}
            initial={{ strokeDashoffset: 2 * Math.PI * 22 }}
            animate={{ strokeDashoffset: 2 * Math.PI * 22 * (1 - pct / 100) }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--imm-text)', zIndex: 1 }}>
          {completedCount}
        </span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="progress-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={toggle}
            />
            <motion.div
              className="progress-drawer"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            >
              <div style={{ height: 8 }} />

              <div className="progress-drawer-header">
                <div>
                  <h3 className="progress-drawer-title">Votre progression</h3>
                  <p className="progress-drawer-subtitle">{completedCount}/{STEP_CONFIG.length} étapes complétées</p>
                </div>
                <button onClick={toggle} className="progress-drawer-close" aria-label="Fermer">
                  <X size={18} />
                </button>
              </div>

              <div className="progress-drawer-bar-wrap">
                <motion.div
                  className="progress-drawer-bar-fill"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>

              <div className="progress-drawer-steps">
                {completedSteps.map((s, i) => {
                  const isCompleted = s.value !== null;
                  const isActive = i === activeProgressStep;
                  const canNavigate = isCompleted && PROGRESS_TO_FORM_STEP[i] !== undefined;
                  const isBuildingStep = s.key === 'building';

                  return (
                    <React.Fragment key={s.key}>
                      <motion.button
                        className={`progress-step-row ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}
                        onClick={() => { if (canNavigate) handleStepClick(i); }}
                        disabled={!canNavigate}
                        initial={false}
                        animate={isCompleted ? { opacity: 1 } : { opacity: 0.5 }}
                        transition={{ duration: 0.3 }}
                        whileTap={canNavigate ? { scale: 0.97 } : undefined}
                      >
                        <div className="progress-step-icon">
                          {isCompleted ? (
                            <motion.div
                              initial={{ scale: 0, rotate: -180 }}
                              animate={{ scale: 1, rotate: 0 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                            >
                              <CheckCircle2 size={20} />
                            </motion.div>
                          ) : (
                            <Circle size={20} />
                          )}
                        </div>
                        <div className="progress-step-content">
                          <span className={`progress-step-label ${isCompleted ? 'done' : ''}`}>
                            {s.label}
                          </span>
                          {isCompleted && s.value !== '✓' && !isBuildingStep && (
                            <motion.span
                              className="progress-step-value"
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.3, delay: 0.1 }}
                            >
                              {s.value}
                            </motion.span>
                          )}
                        </div>
                        <span className="progress-step-num">{i + 1}</span>
                      </motion.button>

                      {/* Building metrics inline (no dropdown) */}
                      {isBuildingStep && isCompleted && buildingMetrics && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          transition={{ duration: 0.3 }}
                          style={{
                            padding: '6px 16px 10px 52px',
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '4px 12px',
                            fontSize: 11,
                            color: 'hsla(0,0%,100%,0.6)',
                            lineHeight: 1.5,
                          }}
                        >
                          <span>Superficie au sol</span>
                          <span style={{ fontWeight: 600, color: 'hsla(0,0%,100%,0.85)', textAlign: 'right' }}>
                            {m2ToSqft(buildingMetrics.superficieM2).toLocaleString('fr-CA')} pi²
                          </span>
                          {buildingMetrics.perimetreM != null && (
                            <>
                              <span>Périmètre toiture</span>
                              <span style={{ fontWeight: 600, color: 'hsla(0,0%,100%,0.85)', textAlign: 'right' }}>
                                {mToFt(buildingMetrics.perimetreM)} pi
                              </span>
                            </>
                          )}
                          {buildingMetrics.largeurM != null && buildingMetrics.profondeurM != null && (
                            <>
                              <span>Dimensions</span>
                              <span style={{ fontWeight: 600, color: 'hsla(0,0%,100%,0.85)', textAlign: 'right' }}>
                                {mToFt(buildingMetrics.largeurM)} × {mToFt(buildingMetrics.profondeurM)} pi
                              </span>
                            </>
                          )}
                          {buildingMetrics.noLot && (
                            <>
                              <span>Lot cadastral</span>
                              <span style={{ fontWeight: 600, color: 'hsla(0,0%,100%,0.85)', textAlign: 'right' }}>
                                {buildingMetrics.noLot}
                              </span>
                            </>
                          )}
                        </motion.div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default ProgressDrawer;
