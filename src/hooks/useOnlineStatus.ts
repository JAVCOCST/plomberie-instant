import { useEffect, useState } from 'react';

/**
 * React hook tracking `navigator.onLine` and dispatching `online`/`offline`
 * events. Returns `true` when the browser believes we have network.
 *
 * The optional `enabled` param lets the caller mount the hook without
 * registering event listeners (used as the Vague A flag gate so that when
 * `VITE_QUOTE_MOBILE_V2` is OFF the page does not attach extra listeners).
 *
 * SSR-safe: defaults to `true` when window is undefined.
 */
export function useOnlineStatus(enabled: boolean = true): boolean {
  const [online, setOnline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  });

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [enabled]);

  return online;
}
