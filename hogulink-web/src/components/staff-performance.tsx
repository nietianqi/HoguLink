'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Booking, ExperienceSummary, Locale, PublicExperience } from '@hogulink/contracts';
import { api } from '@/lib/api';
import { so } from '@/lib/staff-operations-i18n';
import { staffPerformance } from '@/lib/staff-model';
import { FeedbackCard, FeedbackSummary } from './experience-ui';
import { qt } from '@/lib/quality-i18n';
import { ft } from '@/lib/staff-i18n';
export function StaffPerformance({
  locale: l,
  bookings,
  now,
}: {
  locale: Locale;
  bookings: Booking[];
  now: number;
}) {
  const [value, setValue] = useState<{ items: PublicExperience[]; summary: ExperienceSummary }>(),
    [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      setValue(await api('staff/experience'));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const metrics = staffPerformance(bookings, now);
  return (
    <div className="staff-performance">
      <section className="staff-panel">
        <h2>
          {so(l, 'month')} · {metrics.month}
        </h2>
        <p>{so(l, 'performanceHelp')}</p>
        <div className="staff-performance-metrics">
          <div>
            <span>{so(l, 'completed')}</span>
            <strong>{metrics.completed}</strong>
          </div>
          <div>
            <span>{so(l, 'serviceMinutes')}</span>
            <strong>
              {metrics.minutes}
              <small> {so(l, 'minutes')}</small>
            </strong>
          </div>
        </div>
        <p className="flow-muted">{so(l, 'incomeHelp')}</p>
      </section>
      <section className="staff-panel">
        <h2>{so(l, 'reviews')}</h2>
        <p>{so(l, 'reviewsHelp')}</p>
        {error && (
          <p role="alert">
            {so(l, 'reviewsFailed')}{' '}
            <button className="text-button" onClick={() => void load()}>
              {ftRefresh(l)}
            </button>
          </p>
        )}
        {!value && !error && <p role="status">{ft(l, 'loading')}</p>}
        {value && (
          <>
            <FeedbackSummary locale={l} value={value.summary} />
            {!value.items.length && <p>{qt(l, 'emptyReviews')}</p>}
            {value.items.map((item) => (
              <FeedbackCard key={item.id} locale={l} item={item} />
            ))}
          </>
        )}
      </section>
    </div>
  );
}
function ftRefresh(l: Locale) {
  return l === 'ja' ? '再読み込み' : l === 'en' ? 'Retry' : '重试';
}
