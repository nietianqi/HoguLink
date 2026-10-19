'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import type { CustomerInbox } from '@hogulink/contracts';
export function InboxUnreadBadge() {
  const path = usePathname(),
    [count, setCount] = useState(0);
  useEffect(() => {
    let live = true,
      version = 0;
    const refresh = async () => {
      const gen = ++version;
      try {
        const next = await api<CustomerInbox>('customer/inbox');
        if (live && gen === version) setCount(next.unreadCount);
      } catch {
        if (live && gen === version) setCount(0);
      }
    };
    const clear = () => {
      version++;
      setCount(0);
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    window.addEventListener('hogulink-inbox-updated', refresh);
    window.addEventListener('hogulink-session-changed', refresh);
    window.addEventListener('hogulink-session-invalid', clear);
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      window.removeEventListener('hogulink-inbox-updated', refresh);
      window.removeEventListener('hogulink-session-changed', refresh);
      window.removeEventListener('hogulink-session-invalid', clear);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [path]);
  return count > 0 ? (
    <b className="inbox-nav-badge" aria-label={`${count}`}>
      {count > 99 ? '99+' : count}
    </b>
  ) : null;
}
