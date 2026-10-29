'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, BellRing } from 'lucide-react';
import type { Booking, Locale } from '@hogulink/contracts';
import { canRespond, staffAttentionKeys, staffNewAttention } from '@/lib/staff-model';
import { so, staffCountdown } from '@/lib/staff-operations-i18n';
export function StaffAlerts({
  locale: l,
  bookings,
  now,
}: {
  locale: Locale;
  bookings: Booking[];
  now: number;
}) {
  const previous = useRef<Set<string> | null>(null),
    audio = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false),
    [pageOnly, setPageOnly] = useState(false);
  const pending = bookings.filter(canRespond).sort((a, b) => a.deadline - b.deadline);
  const first = pending[0];
  function signal(count: number) {
    if (!count) return;
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
    try {
      navigator.vibrate?.([150, 100, 150]);
    } catch {}
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('HoguLink', {
          body: `${so(l, 'newWork')} · ${count}`,
          tag: 'hogulink-staff-tasks',
        });
      } catch {}
    }
  }
  useEffect(() => {
    const keys = staffAttentionKeys(bookings, now),
      added = staffNewAttention(previous.current, keys);
    previous.current = keys;
    if (enabled && added) signal(added);
  }, [bookings, now, enabled, l]);
  useEffect(() => {
    const update = () => {
      const title = document.title.replace(/^\(\d+\)\s*/, '');
      const next = pending.length ? `(${pending.length}) ${title}` : title;
      if (document.title !== next) document.title = next;
    };
    update();
    // Next updates title metadata during navigation. Avoid observing our own mutations:
    // a head observer can fight the router and starve the page during a transition.
    const timer = pending.length ? window.setInterval(update, 1000) : undefined;
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      document.title = document.title.replace(/^\(\d+\)\s*/, '');
    };
  }, [pending.length, l]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  return (
    <section className="staff-alerts" aria-label={so(l, 'alerts')}>
      {first && (
        <div className="staff-pending-banner" role="status">
          <BellRing size={21} aria-hidden="true" />
          <div>
            <strong>
              {so(l, 'pending')} · {pending.length}
            </strong>
            <small>
              {so(l, 'due')} {staffCountdown(l, first.deadline - now)}
            </small>
          </div>
          <Link
            href={`/${l}/staff?tab=tasks&booking=${encodeURIComponent(first.id)}#staff-task-detail`}
          >
            {so(l, 'respond')}
          </Link>
        </div>
      )}
      <details>
        <summary>
          <Bell size={15} />
          {so(l, 'alerts')}
          {enabled && ` · ${so(l, 'alertsOn')}`}
        </summary>
        <p>{so(l, 'alertsHelp')}</p>
        <button
          type="button"
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
            let permitted = false;
            if ('Notification' in window) {
              try {
                permitted =
                  (Notification.permission === 'default'
                    ? await Notification.requestPermission()
                    : Notification.permission) === 'granted';
              } catch {}
            }
            setPageOnly(!permitted);
            setEnabled(true);
            signal(pending.length);
          }}
        >
          {so(l, enabled ? 'disableAlerts' : 'enableAlerts')}
        </button>
        {enabled && pageOnly && <p role="status">{so(l, 'pageOnly')}</p>}
      </details>
    </section>
  );
}
