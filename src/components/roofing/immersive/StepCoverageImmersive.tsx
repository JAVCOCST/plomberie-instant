import React, { useState, useEffect } from 'react';
import { Bot, Layers, Triangle, Pyramid, Grid3X3, Hexagon, Box, Lock } from 'lucide-react';
import { CoverageType } from '../../../types/roofing';
import c from './StepCoverageImmersive.module.css';

interface Props {
  value: CoverageType | null;
  onSelect: (val: CoverageType) => void;
  detectedType?: CoverageType | null;
}

interface OptionDef {
  val: CoverageType;
  label: string;
  icon: React.ReactNode;
}

interface OptionGroup {
  groupLabel: string;
  options: OptionDef[];
  disabled?: boolean;
}

const GROUPS: OptionGroup[] = [
  {
    groupLabel: "Bardeaux d'asphalte",
    options: [
      { val: 'shingle_2pans', label: '2 pans', icon: <Triangle size={24} /> },
      { val: 'shingle_4pans', label: '4 pans', icon: <Pyramid size={24} /> },
      { val: 'shingle_4pans_plus', label: '4 pans +', icon: <Hexagon size={24} /> },
    ],
  },
  {
    groupLabel: 'Toiture plate',
    options: [
      { val: 'membrane_elastomere', label: 'Membrane élastomère', icon: <Layers size={24} /> },
      { val: 'membrane_gravier', label: 'Membrane + gravier', icon: <Grid3X3 size={24} /> },
    ],
  },
  {
    groupLabel: 'Tôle',
    options: [
      { val: 'tole_2pans', label: '2 pans', icon: <Triangle size={24} /> },
      { val: 'tole_4pans', label: '4 pans', icon: <Pyramid size={24} /> },
      { val: 'tole_4pans_plus', label: '4 pans +', icon: <Box size={24} /> },
    ],
  },
];

const StepCoverageImmersive: React.FC<Props> = ({ value, onSelect, detectedType }) => {
  const firstAvailable = GROUPS.find(g => !g.disabled)?.options[0]?.val ?? null;
  const initial = value ?? detectedType ?? null;
  const [selected, setSelected] = useState<CoverageType | null>(initial);

  // Auto-select detected type when it arrives
  useEffect(() => {
    if (detectedType && !value) {
      setSelected(detectedType);
      onSelect(detectedType);
    }
  }, [detectedType]);

  const handleClick = (val: CoverageType) => {
    if (selected === val) return;
    setSelected(val);
    onSelect(val);
  };

  return (
    <div className={c.wrap}>
      <h2 className={c.title}>Quel type de couverture ?</h2>

      {GROUPS.map(group => (
        <div key={group.groupLabel} className={c.group}>
          <span className={c.groupLabel}>
            {group.groupLabel}
            {group.disabled && (
              <span className={c.unavailableTag}>
                <Lock size={10} /> Bientôt disponible
              </span>
            )}
          </span>
          <div className={c.row}>
            {group.options.map(opt => {
              const isDisabled = !!group.disabled;
              const isSelected = !isDisabled && selected === opt.val;
              const isDimmed = (selected !== null && !isSelected) || isDisabled;
              const isDetected = !isDisabled && detectedType === opt.val;

              return (
                <button
                  key={opt.val}
                  className={[
                    c.card,
                    isSelected && c.cardSelected,
                    isDimmed && c.cardDimmed,
                    isDisabled && c.cardDisabled,
                    isDetected && !isSelected && c.cardDetected,
                  ].filter(Boolean).join(' ')}
                  onClick={() => !isDisabled && handleClick(opt.val)}
                  tabIndex={isDisabled ? -1 : 0}
                  aria-pressed={isSelected}
                  aria-disabled={isDisabled}
                >
                  {isDetected && (
                    <div className={c.aiBadge} title="Détecté par l'IA">
                      <Bot size={12} />
                    </div>
                  )}
                  {isSelected && <div className={c.checkmark}>✓</div>}
                  <div className={c.iconWrap}>{opt.icon}</div>
                  <span className={c.label}>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default StepCoverageImmersive;
