import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const THRESHOLD = 110;
const MAX_PULL = 160;
const IOS_HAPTIC_DELAY = 70;

const PullToRefresh: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const hapticInputRef = useRef<HTMLInputElement | null>(null);
  const hapticLabelRef = useRef<HTMLLabelElement | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // "resting" = idle, not mid-pull. While resting we drop the translateY transform
  // entirely: a transformed ancestor (even translateY(0)) makes nested overflow:auto
  // scrollers and iframes deadlock touch on iOS, freezing the whole page. The
  // transform is only applied during/just-after a pull so the release still animates.
  const [resting, setResting] = useState(true);
  const restTimer = useRef<number | undefined>(undefined);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const didVibrate = useRef(false);

  useEffect(() => {
    const id = `pull-refresh-haptic-${Math.random().toString(36).slice(2)}`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.setAttribute('switch', '');
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    Object.assign(input.style, {
      position: 'fixed',
      left: '-9999px',
      top: '0',
      opacity: '0',
      pointerEvents: 'none',
      width: '1px',
      height: '1px',
    });

    const label = document.createElement('label');
    label.htmlFor = id;
    label.setAttribute('aria-hidden', 'true');
    Object.assign(label.style, {
      position: 'fixed',
      left: '-9999px',
      top: '0',
      opacity: '0',
      pointerEvents: 'none',
      width: '1px',
      height: '1px',
    });

    document.body.appendChild(input);
    document.body.appendChild(label);
    hapticInputRef.current = input;
    hapticLabelRef.current = label;

    return () => {
      input.remove();
      label.remove();
      hapticInputRef.current = null;
      hapticLabelRef.current = null;
    };
  }, []);

  const isIOS = useCallback(() => {
    if (typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }, []);

  const canPull = useCallback(() => {
    const el = containerRef.current;
    if (!el) return false;
    return el.scrollTop <= 0;
  }, []);

  const triggerIosHaptic = useCallback((pulses: number) => {
    const label = hapticLabelRef.current;
    const input = hapticInputRef.current;

    if (!label || !input) return false;

    try {
      for (let i = 0; i < pulses; i += 1) {
        const trigger = () => {
          if (!hapticInputRef.current || !hapticLabelRef.current) return;
          hapticInputRef.current.checked = !hapticInputRef.current.checked;
          hapticLabelRef.current.click();
        };

        if (i === 0) {
          trigger();
        } else {
          window.setTimeout(trigger, i * IOS_HAPTIC_DELAY);
        }
      }

      return true;
    } catch {
      return false;
    }
  }, []);

  const vibrate = useCallback((kind: 'threshold' | 'trigger') => {
    const isAppleTouch = isIOS();

    if (isAppleTouch) {
      return triggerIosHaptic(kind === 'trigger' ? 2 : 1);
    }

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        return navigator.vibrate(kind === 'trigger' ? [60, 40, 80] : [35]);
      }
    } catch {
      return false;
    }

    return false;
  }, [isIOS, triggerIosHaptic]);

  const fireHaptic = useCallback((kind: 'threshold' | 'trigger') => {
    const didStart = vibrate(kind);

    if (didStart && kind === 'trigger' && !isIOS()) {
      window.setTimeout(() => {
        vibrate('threshold');
      }, 120);
    }

    return didStart;
  }, [isIOS, vibrate]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (refreshing || !canPull()) return;
    // Disable pull-to-refresh when a detail panel/modal is open
    if (typeof document !== 'undefined' && document.body.dataset.disablePullRefresh === 'true') return;
    startY.current = e.touches[0].clientY;
    isDragging.current = true;
    didVibrate.current = false;
  }, [canPull, refreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging.current || refreshing) return;
    const diff = e.touches[0].clientY - startY.current;

    if (diff > 0 && canPull()) {
      // Listener is passive (perf): le bounce iOS est déjà contenu par
      // overscrollBehavior:'none' sur ce container, donc plus de
      // preventDefault à appeler ici → le scroll natif n'est plus bloqué
      // en attente que React traite l'event.
      window.clearTimeout(restTimer.current);
      setResting(false);
      const damped = Math.min(diff * 0.3, MAX_PULL);
      setPullDistance(damped);
      setPulling(true);

      if (damped >= THRESHOLD && !didVibrate.current) {
        didVibrate.current = true;
        fireHaptic('threshold');
      }

      if (damped < THRESHOLD) {
        didVibrate.current = false;
      }
    } else if (isDragging.current) {
      isDragging.current = false;
      if (pulling) { setPullDistance(0); setPulling(false); }
    }
  }, [canPull, fireHaptic, pulling, refreshing]);

  const handleTouchEnd = useCallback((_e?: TouchEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;

    if (pullDistance >= THRESHOLD && !refreshing) {
      fireHaptic('trigger');
      setPulling(false);
      setRefreshing(true);
      setPullDistance(50);
      window.setTimeout(() => {
        window.location.reload();
      }, 620);
      return;
    }

    setPulling(false);
    setPullDistance(0);
    // Once the release transition has played, drop the transform again.
    window.clearTimeout(restTimer.current);
    restTimer.current = window.setTimeout(() => setResting(true), 340);
  }, [fireHaptic, pullDistance, refreshing]);

  useEffect(() => () => window.clearTimeout(restTimer.current), []);

  // Attache des listeners NATIFS PASSIFS plutôt que les onTouchMove/Start/End
  // JSX. Les handlers synthétiques React forcent un listener non-passif sur
  // touchmove au niveau root, ce qui bloque le scroll natif en attendant que
  // React traite l'event → jank systématique sur mobile. En passif, le browser
  // scrolle immédiatement et notre handler ne sert plus qu'à mettre à jour
  // l'état React du pull-down ; le bounce est contenu par overscrollBehavior.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const reachedThreshold = pullDistance >= THRESHOLD;
  const progress = Math.min(pullDistance / THRESHOLD, 1);
  const rotation = pulling ? pullDistance * 3 : 0;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto"
      style={{
        position: 'relative',
        background: '#0a0a14',
        overscrollBehavior: 'none',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {(pulling || refreshing) && pullDistance > 5 && (
        <div
          style={{
            position: 'fixed',
            top: 44,
            left: 0,
            right: 0,
            height: pullDistance,
            background: '#0a0a14',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 55,
            transition: pulling ? 'none' : 'height 0.3s cubic-bezier(0.2,0,0,1), opacity 0.2s',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: progress }}>
            <RefreshCw
              size={20}
              strokeWidth={2.5}
              style={{
                color: reachedThreshold ? '#818cf8' : '#4b5563',
                transform: `rotate(${refreshing ? 0 : rotation}deg)`,
                transition: pulling ? 'color 0.15s' : 'transform 0.3s, color 0.15s',
                animation: refreshing ? 'spin 0.7s linear infinite' : 'none',
                filter: reachedThreshold ? 'drop-shadow(0 0 8px rgba(129,140,248,0.5))' : 'none',
              }}
            />
            {!refreshing && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: reachedThreshold ? '#818cf8' : '#4b5563',
                  letterSpacing: 0.5,
                }}
              >
                {reachedThreshold ? 'Relâcher' : 'Tirer pour rafraîchir'}
              </span>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          transform: (resting && !pulling && !refreshing && pullDistance === 0) ? undefined : `translateY(${pullDistance}px)`,
          transition: pulling ? 'none' : 'transform 0.3s cubic-bezier(0.2,0,0,1)',
          minHeight: '100%',
          background: '#0a0a14',
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default PullToRefresh;

