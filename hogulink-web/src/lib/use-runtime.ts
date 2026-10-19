'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
export function useDemoAccess() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ demoAccessEnabled: boolean }>('health')
      .then((health) => {
        if (active) setEnabled(health.demoAccessEnabled === true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return enabled;
}
