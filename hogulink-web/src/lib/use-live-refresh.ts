'use client';
import { useEffect, useRef } from 'react';
/** Updates only visible pages, preserves drafts, and avoids overlapping background reads. */
export function useLiveRefresh(
  refresh: () => Promise<unknown>,
  enabled: boolean,
  identity: string,
) {
  const callback = useRef(refresh);
  callback.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let running = false,
      live = true;
    const tick = async () => {
      if (!live || running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        await callback.current();
      } catch {
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void tick(), 10000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enabled, identity]);
}
