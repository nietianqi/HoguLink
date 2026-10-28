'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Booking, Locale } from '@hogulink/contracts';
import { merchantAttentionKeys, merchantNewAttention } from '@/lib/merchant-model';
import { mo } from '@/lib/merchant-operations-i18n';
export function MerchantAlerts({
  locale: l,
  bookings,
  loaded,
}: {
  locale: Locale;
  bookings: Booking[];
  loaded: boolean;
}) {
  const prior = useRef<Set<string> | null>(null),
    audio = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false),
    [pageOnly, setPageOnly] = useState(false),
    [newCount, setNewCount] = useState(0);
  useEffect(() => {
    if (!loaded) return;
    const ids = merchantAttentionKeys(bookings);
    const count = merchantNewAttention(prior.current, ids);
    prior.current = ids;
    if (!count) return;
    setNewCount(count);
    if (!enabled) return;
    try {
      const ctx = audio.current;
      if (ctx?.state === 'running') {
        const tone = ctx.createOscillator(),
          gain = ctx.createGain();
        tone.frequency.value = 740;
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
        tone.connect(gain);
        gain.connect(ctx.destination);
        tone.start();
        tone.stop(ctx.currentTime + 0.45);
      }
    } catch {}
    if ('Notification' in window && Notification.permission === 'granted')
      try {
        new Notification('HoguLink', { body: mo(l, 'newWork'), tag: 'hogulink-merchant-work' });
      } catch {}
  }, [bookings, loaded, enabled, l]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  return (
    <section className="merchant-alert-control" aria-label={mo(l, 'alerts')}>
      {newCount > 0 && (
        <div role="status" className="notice">
          <Link href={`/${l}/merchant?tab=bookings`} onClick={() => setNewCount(0)}>
            {mo(l, 'newWork')} · {newCount}
          </Link>
        </div>
      )}
      <details>
        <summary>
          {mo(l, 'alerts')}
          {enabled ? ` · ${mo(l, 'alertsEnabled')}` : ''}
        </summary>
        <p>{mo(l, 'alertHelp')}</p>
        <button
          className="button secondary small"
          onClick={async () => {
            if (enabled) {
              setEnabled(false);
              return;
            }
            try {
              audio.current ??= new AudioContext();
              await audio.current.resume();
            } catch {}
            setEnabled(true);
            if ('Notification' in window) {
              try {
                const permission =
                  Notification.permission === 'default'
                    ? await Notification.requestPermission()
                    : Notification.permission;
                setPageOnly(permission !== 'granted');
              } catch {
                setPageOnly(true);
              }
            } else setPageOnly(true);
          }}
        >
          {mo(l, enabled ? 'disableAlerts' : 'enableAlerts')}
        </button>
        {pageOnly && enabled && <p role="status">{mo(l, 'pageAlerts')}</p>}
      </details>
    </section>
  );
}
