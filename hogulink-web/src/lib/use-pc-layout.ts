'use client';
import { useSyncExternalStore } from 'react';

const query = '(min-width: 1101px)';
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
/** Match the existing PC boundary without changing H5 rendering or using device detection. */
export function usePcLayout() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
