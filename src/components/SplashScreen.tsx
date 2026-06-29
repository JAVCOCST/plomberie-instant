import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import vbLogo from '@/assets/vb-logo-white.svg';
import {
  primeAudioInGesture,
  playWhooshFromGesture,
  WHOOSH_DURATION_SECONDS,
} from '@/lib/audioFeedback';

const TRACK_WIDTH = 280;
const KNOB_SIZE = 60;
const MAX_DRAG = TRACK_WIDTH - KNOB_SIZE - 8;
const UNLOCK_THRESHOLD = MAX_DRAG * 0.85;

const SplashScreen: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [unlocked, setUnlocked] = useState(false);
  const [dragX, setDragX] = useState(0);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const doneRef = useRef(false);
  const armedRef = useRef(false); // seuil franchi mais pas encore déclenché
  const timeoutRef = useRef<number | null>(null);
  const knobRef = useRef<HTMLDivElement>(null);

  const fireUnlock = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    draggingRef.current = false;
    armedRef.current = false;
    setUnlocked(true);
    setDragX(MAX_DRAG);

    playWhooshFromGesture();

    timeoutRef.current = window.setTimeout(
      onDone,
      (WHOOSH_DURATION_SECONDS + 0.12) * 1000
    );
  }, [onDone]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (unlocked || doneRef.current) return;
    e.preventDefault();

    // Pre-allocation du graphe whoosh dans CE user gesture (pointerdown).
    // Les oscillateurs sont créés et démarrés ici — au pointerup on n'aura
    // qu'à moduler les gains, ce qui ne nécessite pas de gesture.
    primeAudioInGesture();

    draggingRef.current = true;
    armedRef.current = false;
    startXRef.current = e.clientX - dragX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || unlocked) return;
    const x = Math.max(0, Math.min(MAX_DRAG, e.clientX - startXRef.current));
    setDragX(x);

    // On ne déclenche PAS le whoosh ici (pointermove n'est pas un user
    // gesture fiable en iOS PWA). On marque juste que le seuil est armé.
    if (x >= UNLOCK_THRESHOLD) {
      armedRef.current = true;
      // Si l'utilisateur garde le doigt enfoncé au bout sans relever,
      // on déclenche quand même via un fallback rAF (plus fiable que setTimeout
      // pour rester proche du gesture si jamais iOS le tolère).
    }
  };

  const onPointerUp = () => {
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    if (!wasDragging) return;

    if (armedRef.current && !unlocked) {
      // pointerup EST un user gesture iOS PWA fiable — on déclenche ici
      fireUnlock();
    } else if (!unlocked) {
      // Slide pas assez loin, on remet à zéro
      setDragX(0);
    }
  };

  // Fallback : si le doigt est resté au bout du slider trop longtemps sans
  // relever (rare mais possible), on déclenche après 200ms d'inactivité.
  // Ce path n'est pas dans un gesture, mais comme le graphe est pré-créé
  // au pointerdown, ça fonctionne sur iOS PWA.
  useEffect(() => {
    if (!armedRef.current || unlocked || doneRef.current) return;
    const id = window.setTimeout(() => {
      if (armedRef.current && !doneRef.current) {
        fireUnlock();
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [dragX, unlocked, fireUnlock]);

  // Fallback clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (unlocked || doneRef.current) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        primeAudioInGesture();
        fireUnlock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fireUnlock, unlocked]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#0a0a14',
        overflow: 'hidden',
      }}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <motion.img
          src={vbLogo}
          alt="Toitures VB"
          animate={{ scale: unlocked ? 1.04 : 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ height: 48, width: 'auto', filter: 'brightness(0) invert(1)' }}
        />

        <AnimatePresence>
          {unlocked && (
            <motion.div
              key="bar"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: WHOOSH_DURATION_SECONDS, ease: 'easeInOut' }}
              style={{
                width: 160,
                height: 2,
                borderRadius: 2,
                background: 'linear-gradient(90deg, transparent, #818cf8, transparent)',
                boxShadow: '0 0 14px rgba(129,140,248,0.6)',
                transformOrigin: 'left',
              }}
            />
          )}
        </AnimatePresence>
      </motion.div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 'calc(80px + env(safe-area-inset-bottom))',
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <AnimatePresence>
          {!unlocked && (
            <motion.div
              key="slider"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{
                pointerEvents: 'auto',
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: TRACK_WIDTH,
                  height: KNOB_SIZE + 8,
                  borderRadius: 9999,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(12px)',
                  overflow: 'hidden',
                  touchAction: 'none',
                  WebkitTouchCallout: 'none',
                  overscrollBehavior: 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: dragX + KNOB_SIZE / 2 + 4,
                    background: 'linear-gradient(90deg, hsl(260,80%,65%), hsl(195,85%,60%), hsl(260,80%,65%))',
                    backgroundSize: '200% 100%',
                    animation: 'splashGradient 4s ease-in-out infinite',
                    opacity: 0.35,
                    transition: draggingRef.current ? 'none' : 'width 0.25s ease-out',
                    willChange: 'width',
                  }}
                />

                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    color: 'rgba(255,255,255,0.85)',
                    fontSize: 14,
                    letterSpacing: 2,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    opacity: 1,
                    textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                  }}
                >
                  Glisser pour ouvrir
                </div>

                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    width: '40%',
                    background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.25) 50%, transparent 60%)',
                    animation: 'splashShine 2.6s ease-in-out infinite',
                    pointerEvents: 'none',
                  }}
                />

                <div
                  ref={knobRef}
                  style={{
                    position: 'absolute',
                    top: 4,
                    left: 4,
                    width: KNOB_SIZE,
                    height: KNOB_SIZE,
                    borderRadius: 9999,
                    background: 'linear-gradient(135deg, #ffffff, #e0e7ff)',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.4), 0 0 24px rgba(129,140,248,0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transform: `translateX(${dragX}px)`,
                    transition: draggingRef.current ? 'none' : 'transform 0.25s ease-out',
                    touchAction: 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    willChange: 'transform',
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="hsl(260,60%,40%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style>{`
        @keyframes splashGradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes splashShine {
          0% { left: -40%; }
          60% { left: 110%; }
          100% { left: 110%; }
        }
      `}</style>
    </motion.div>
  );
};

export default SplashScreen;
