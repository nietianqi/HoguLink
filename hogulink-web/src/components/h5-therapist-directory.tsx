'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  nearestArea,
  type Locale,
  type MobileBootstrap,
  type MobileTherapists,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { ht } from '@/lib/h5-i18n';
import { cui } from '@/lib/customer-ui-i18n';
import { directoryHref } from '@/lib/therapist-directory-model';
import { useDeviceLocation } from './h5-business';
import { CustomerTherapistCard } from './customer-therapist-card';
import { Button, EmptyState } from './ui';

export function H5TherapistDirectory({
  locale: l,
  initial,
  bootstrap,
  q,
}: {
  locale: Locale;
  initial: MobileTherapists;
  bootstrap: MobileBootstrap;
  q: Record<string, string>;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [locationNote, setLocationNote] = useState('');
  const [pending, startTransition] = useTransition();
  const location = useDeviceLocation(),
    generation = useRef(0),
    inFlight = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function nearMe() {
    setLocationNote('');
    const point = location.point ?? (await location.request());
    const near = point && nearestArea(point, bootstrap.serviceAreas);
    if (!near) return setLocationNote(ht(l, 'locationDenied'));
    if (near.km > 15) setLocationNote(ht(l, 'locationFar'));
    startTransition(() =>
      router.push(directoryHref(l, { ...q, sort: 'distance', near: near.area })),
    );
  }
  async function more() {
    if (!data.nextCursor || inFlight.current) return;
    const gen = generation.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      let next: MobileTherapists,
        replace = false;
      try {
        next = await api<MobileTherapists>(
          `public/h5/therapists?${new URLSearchParams({ ...q, cursor: data.nextCursor })}`,
        );
      } catch (e) {
        if (!(e instanceof ClientError) || e.code !== 'INVALID_CURSOR') throw e;
        next = await api<MobileTherapists>(`public/h5/therapists?${new URLSearchParams(q)}`);
        replace = true;
      }
      if (gen === generation.current)
        setData((old) => ({
          ...next,
          items: replace
            ? next.items
            : [
                ...old.items,
                ...next.items.filter(
                  (item) => !old.items.some((row) => row.listing.id === item.listing.id),
                ),
              ],
        }));
    } catch {
      if (gen === generation.current) setError(ht(l, 'retry'));
    } finally {
      inFlight.current = false;
      if (gen === generation.current) setBusy(false);
    }
  }
  return (
    <section className="ui-directory" aria-busy={pending} aria-label={cui(l, 'therapists')}>
      <div className="ui-directory-tools">
        <p className="ui-note">{cui(l, 'fees')}</p>
        {bootstrap.features.gpsDistance && (
          <button onClick={() => void nearMe()} disabled={pending || location.state === 'locating'}>
            {ht(l, 'nearMe')}
          </button>
        )}
      </div>
      {locationNote && (
        <p className="ui-note" role="status">
          {locationNote}
        </p>
      )}
      {pending && <p role="status">{ht(l, 'loading')}</p>}
      <div className="ui-therapist-grid">
        {data.items.map((item) => (
          <CustomerTherapistCard
            key={item.listing.id}
            locale={l}
            item={item}
            q={q}
            checkedAt={data.checkedAt}
            demo={bootstrap.demo}
          />
        ))}
      </div>
      {!data.items.length && (
        <EmptyState href={`/${l}/therapists`} action={cui(l, 'clear')}>
          {cui(l, 'noMatch')}
        </EmptyState>
      )}
      <p className="ui-note" role="status">
        {ht(l, 'directoryResult')
          .replace('{shown}', String(data.items.length))
          .replace('{total}', String(data.total))}
      </p>
      {error && (
        <p className="quality-error" role="alert">
          {error}
        </p>
      )}
      {data.nextCursor && (
        <Button variant="secondary" disabled={busy || pending} onClick={() => void more()}>
          {ht(l, busy ? 'loading' : error ? 'retryAction' : 'more')}
        </Button>
      )}
      {bootstrap.demo && <p className="ui-note">{ht(l, 'sampleNote')}</p>}
    </section>
  );
}
