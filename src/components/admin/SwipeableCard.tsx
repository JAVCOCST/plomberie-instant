import React, { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, animate, type PanInfo } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { playSwipeTick, unlockAudioFeedback } from '@/lib/audioFeedback';

export interface SwipeAction {
  icon: LucideIcon;
  label: string;
  /** Background color of the action panel (hex/hsl). */
  color: string;
  /** Text color shown on top of the action panel. */
  textColor?: string;
  /** Glow color (rgba/hsla) used as outer shadow while swiping. */
  glow?: string;
  onTrigger: () => void;
}

interface SwipeableCardProps {
  /** Action revealed when swiping LEFT (panel shows on the right). */
  rightAction?: SwipeAction;
  /** Action revealed when swiping RIGHT (panel shows on the left). */
  leftAction?: SwipeAction;
  /** Distance (px) to drag before the action is triggered on release. */
  triggerThreshold?: number;
  /** If true, swipe is disabled (e.g. while bulk-selecting). */
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * Gmail-style swipe-to-action card.
 * - Drag the card horizontally to reveal an action panel underneath.
 * - Past the threshold the action panel grows + becomes opaque (visual confirmation).
 * - Release past the threshold to trigger; otherwise snaps back.
 */
/** Haptic helper — graceful no-op on unsupported devices (most desktops, iOS Safari). */
const haptic = (pattern: number | number[]) => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {}
};

const playTick = (freq = 880, duration = 0.08, gain = 0.18) => {
  playSwipeTick(freq, duration, gain);
};
const playConfirm = (rising: boolean) => {
  // Two-note chirp — rising for "convert", descending for "archive"
  const a = rising ? 660 : 520;
  const b = rising ? 990 : 380;
  playTick(a, 0.09, 0.22);
  setTimeout(() => playTick(b, 0.12, 0.22), 60);
};

// Global one-time unlock — ensures AudioContext is running after the user's
// first interaction with the page (required by iOS Safari).
if (typeof window !== 'undefined') {
  const unlock = () => { unlockAudioFeedback(); };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('touchstart', unlock, { capture: true, passive: true });
}

export const SwipeableCard: React.FC<SwipeableCardProps> = ({
  rightAction,
  leftAction,
  triggerThreshold = 80,
  disabled,
  children,
}) => {
  const x = useMotionValue(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState<'left' | 'right' | null>(null);
  const prevArmedRef = useRef<'left' | 'right' | null>(null);

  // Haptic tick when crossing the threshold (arm/disarm)
  useEffect(() => {
    if (armed !== prevArmedRef.current) {
      if (armed) {
        // Crossing into armed zone: short, crisp tick
        haptic(12);
        playTick(armed === 'left' ? 880 : 660, 0.05, 0.05);
      } else if (prevArmedRef.current) {
        // Backing out of armed zone: subtle tick
        haptic(6);
        playTick(440, 0.04, 0.03);
      }
      prevArmedRef.current = armed;
    }
  }, [armed]);

  // Right-side panel (revealed when x < 0) — typically Archive
  const rightPanelOpacity = useTransform(x, [-triggerThreshold, -16, 0], [1, 0.5, 0]);
  const rightPanelScale = useTransform(x, [-triggerThreshold * 1.5, -triggerThreshold, 0], [1.05, 1, 0.9]);

  // Left-side panel (revealed when x > 0) — typically Convert
  const leftPanelOpacity = useTransform(x, [0, 16, triggerThreshold], [0, 0.5, 1]);
  const leftPanelScale = useTransform(x, [0, triggerThreshold, triggerThreshold * 1.5], [0.9, 1, 1.05]);

  // Glow that intensifies as the user pulls further. Purple for left-swipe (archive),
  // green for right-swipe (convert). Defaults can be overridden per-action via `glow`.
  const purpleGlow = rightAction?.glow ?? 'hsla(265, 85%, 62%, 0.55)';
  const greenGlow = leftAction?.glow ?? 'hsla(150, 75%, 50%, 0.55)';
  const cardShadow = useTransform(x, (val) => {
    if (val < -2) {
      const t = Math.min(Math.abs(val) / triggerThreshold, 1.4);
      const blur = 18 + t * 36;
      const spread = 0 + t * 4;
      return `0 0 ${blur}px ${spread}px ${purpleGlow}`;
    }
    if (val > 2) {
      const t = Math.min(val / triggerThreshold, 1.4);
      const blur = 18 + t * 36;
      const spread = 0 + t * 4;
      return `0 0 ${blur}px ${spread}px ${greenGlow}`;
    }
    return '0 0 0px 0px rgba(0,0,0,0)';
  });

  const handleDrag = (_: unknown, info: PanInfo) => {
    const v = info.offset.x;
    if (v <= -triggerThreshold && rightAction) setArmed('right');
    else if (v >= triggerThreshold && leftAction) setArmed('left');
    else setArmed(null);
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const v = info.offset.x;
    const velocity = info.velocity.x;
    setArmed(null);

    if (v <= -triggerThreshold && rightAction) {
      // Confirm haptic — heavier "thump"
      haptic([18, 40, 25]);
      playConfirm(false);
      // Trigger immediately so the card is removed from the list,
      // then animate the residual off-screen for a clean exit feel.
      const w = cardRef.current?.offsetWidth ?? 400;
      rightAction.onTrigger();
      animate(x, -w, { type: 'spring', stiffness: 500, damping: 45, velocity });
      return;
    }

    if (v >= triggerThreshold && leftAction) {
      haptic([18, 40, 25]);
      playConfirm(true);
      const w = cardRef.current?.offsetWidth ?? 400;
      leftAction.onTrigger();
      animate(x, w, { type: 'spring', stiffness: 500, damping: 45, velocity });
      return;
    }

    // Snap back
    animate(x, 0, { type: 'spring', stiffness: 500, damping: 40, velocity });
  };

  if (disabled || (!rightAction && !leftAction)) {
    return <>{children}</>;
  }

  return (
    <div ref={cardRef} style={{ position: 'relative', overflow: 'hidden', borderRadius: 12, touchAction: 'pan-y' }}>
      {/* Right-side action panel (revealed by swipe LEFT — Archive) */}
      {rightAction && (
        <motion.div
          style={{
            position: 'absolute', inset: 0,
            // Subtle radial tint that blends with the dark app theme — no ugly solid block.
            background: `radial-gradient(120% 100% at 100% 50%, ${purpleGlow} 0%, transparent 70%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            paddingRight: 28, gap: 10,
            color: 'hsl(0, 0%, 98%)',
            fontWeight: 600, fontSize: 13, letterSpacing: 0.2,
            opacity: rightPanelOpacity,
            pointerEvents: 'none',
          }}
        >
          <motion.div style={{ display: 'flex', alignItems: 'center', gap: 8, scale: rightPanelScale }}>
            <rightAction.icon size={18} />
            <span>{armed === 'right' ? `Relâcher pour ${rightAction.label.toLowerCase()}` : rightAction.label}</span>
          </motion.div>
        </motion.div>
      )}

      {/* Left-side action panel (revealed by swipe RIGHT — Convert) */}
      {leftAction && (
        <motion.div
          style={{
            position: 'absolute', inset: 0,
            background: `radial-gradient(120% 100% at 0% 50%, ${greenGlow} 0%, transparent 70%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
            paddingLeft: 28, gap: 10,
            color: 'hsl(0, 0%, 98%)',
            fontWeight: 600, fontSize: 13, letterSpacing: 0.2,
            opacity: leftPanelOpacity,
            pointerEvents: 'none',
          }}
        >
          <motion.div style={{ display: 'flex', alignItems: 'center', gap: 8, scale: leftPanelScale }}>
            <leftAction.icon size={18} />
            <span>{armed === 'left' ? `Relâcher pour ${leftAction.label.toLowerCase()}` : leftAction.label}</span>
          </motion.div>
        </motion.div>
      )}

      {/* Foreground card */}
      <motion.div
        drag="x"
        dragDirectionLock
        // Resistance via elasticity (no hard wall — feels natural while still requiring effort
        // to push past the threshold). Constraints are wide so the trigger fires reliably.
        dragElastic={0.7}
        dragConstraints={{ left: 0, right: 0 }}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        style={{ x, position: 'relative', zIndex: 1, boxShadow: cardShadow, borderRadius: 12 }}
      >
        {children}
      </motion.div>
    </div>
  );
};