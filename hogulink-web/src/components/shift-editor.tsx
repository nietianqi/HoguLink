'use client';
import { useState } from 'react';
import type { Locale, ShiftWindow, StaffShifts } from '@hogulink/contracts';
import { ClientError } from '@/lib/api';
import { errorText } from '@/lib/i18n';
import { sh } from '@/lib/shift-i18n';

const clock = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutes = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
};
type Row = { on: boolean; start: string; end: string };
const row = (w?: ShiftWindow): Row =>
  w
    ? { on: true, start: clock(w.startMinute), end: clock(w.endMinute) }
    : { on: false, start: '10:00', end: '20:00' };
const toWindow = (r: Row): ShiftWindow => ({
  startMinute: minutes(r.start),
  // A 00:00 end means midnight, the end of the day.
  endMinute: minutes(r.end) || 1440,
});

/** Weekly working windows plus date-specific changes; one window per day is edited here. */
export function ShiftEditor({
  locale: l,
  shifts,
  onSave,
}: {
  locale: Locale;
  shifts?: StaffShifts;
  onSave: (input: unknown) => Promise<unknown>;
}) {
  const [weekly, setWeekly] = useState<Row[]>(() =>
    Array.from({ length: 7 }, (_, d) => row(shifts?.weekly[d]?.[0])),
  );
  const [dates, setDates] = useState<(Row & { date: string })[]>(() =>
    (shifts?.exceptions ?? []).map((x) => ({
      date: x.date,
      ...row(x.windows[0]),
    })),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const day = (d: number) =>
    new Intl.DateTimeFormat(l, { weekday: 'short', timeZone: 'UTC' }).format(
      Date.UTC(2026, 9, 25 + d),
    );
  return (
    <form
      className="shift-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        setNotice('');
        try {
          await onSave({
            version: shifts?.version ?? 0,
            // Additional windows saved elsewhere are kept as they are.
            weekly: weekly.map((r, d) =>
              r.on ? [toWindow(r), ...(shifts?.weekly[d]?.slice(1) ?? [])] : [],
            ),
            exceptions: dates
              .filter((x) => x.date)
              .map((x) => ({ date: x.date, windows: x.on ? [toWindow(x)] : [] })),
          });
          setNotice(sh(l, 'saved'));
        } catch (e) {
          const value = e instanceof ClientError ? e.code : undefined;
          setError(value === 'SHIFT_HAS_BOOKINGS' ? sh(l, value) : errorText(l, value));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="flow-muted">
        {shifts ? sh(l, 'help') : `${sh(l, 'notSet')} · ${sh(l, 'help')}`}
      </p>
      <fieldset disabled={busy}>
        {weekly.map((r, d) => (
          <div className="shift-row" key={d}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={r.on}
                onChange={(e) =>
                  setWeekly((all) =>
                    all.map((x, i) => (i === d ? { ...x, on: e.target.checked } : x)),
                  )
                }
              />
              {day(d)} · {sh(l, 'working')}
            </label>
            {r.on && (
              <>
                <input
                  type="time"
                  step={1800}
                  aria-label={`${day(d)} ${sh(l, 'start')}`}
                  value={r.start}
                  onChange={(e) =>
                    setWeekly((all) =>
                      all.map((x, i) => (i === d ? { ...x, start: e.target.value } : x)),
                    )
                  }
                />
                <input
                  type="time"
                  step={1800}
                  aria-label={`${day(d)} ${sh(l, 'end')}`}
                  value={r.end}
                  onChange={(e) =>
                    setWeekly((all) =>
                      all.map((x, i) => (i === d ? { ...x, end: e.target.value } : x)),
                    )
                  }
                />
              </>
            )}
          </div>
        ))}
        <h4>{sh(l, 'exceptions')}</h4>
        {dates.map((r, i) => (
          <div className="shift-row" key={i}>
            <input
              type="date"
              value={r.date}
              aria-label={sh(l, 'exceptions')}
              onChange={(e) =>
                setDates((all) => all.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))
              }
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!r.on}
                onChange={(e) =>
                  setDates((all) =>
                    all.map((x, j) => (j === i ? { ...x, on: !e.target.checked } : x)),
                  )
                }
              />
              {sh(l, 'dayOff')}
            </label>
            {r.on && (
              <>
                <input
                  type="time"
                  step={1800}
                  aria-label={`${r.date} ${sh(l, 'start')}`}
                  value={r.start}
                  onChange={(e) =>
                    setDates((all) =>
                      all.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)),
                    )
                  }
                />
                <input
                  type="time"
                  step={1800}
                  aria-label={`${r.date} ${sh(l, 'end')}`}
                  value={r.end}
                  onChange={(e) =>
                    setDates((all) =>
                      all.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                    )
                  }
                />
              </>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() => setDates((all) => all.filter((_, j) => j !== i))}
            >
              {sh(l, 'remove')}
            </button>
          </div>
        ))}
        <div className="button-row">
          <button
            type="button"
            className="button secondary small"
            onClick={() =>
              setDates((all) => [...all, { date: '', on: false, start: '10:00', end: '20:00' }])
            }
          >
            {sh(l, 'addDate')}
          </button>
          <button className="button small">{sh(l, 'save')}</button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
