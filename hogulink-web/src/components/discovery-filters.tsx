'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SlidersHorizontal, ShieldCheck, ArrowUpRight } from 'lucide-react';
import type { Locale } from '@hogulink/contracts';
import { dt } from '@/lib/desktop-i18n';
import { money, t, areas, areaName } from '@/lib/i18n';
import { mt } from '@/lib/mobile-i18n';
import { MobileSheet } from './mobile-ui';
import { japanDay } from '@/lib/desktop-model';
import { sv } from '@/lib/service-mode-i18n';
import { pc } from '@/lib/pc-consumer-i18n';
export function DiscoveryFilters({
  locale: l,
  q,
  mode,
  duration,
  standalone = false,
}: {
  locale: Locale;
  q: Record<string, string>;
  mode: string;
  duration: number;
  standalone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draftMode, setDraftMode] = useState(mode);
  const [draftFulfillment, setDraftFulfillment] = useState(q.fulfillmentMode ?? '');
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const count =
    ['area', 'language', 'date', 'acceptance', 'fulfillmentMode'].filter((key) => q[key]).length +
    Number(duration !== 60) +
    Number(Number(q.maxTotal) > 0);
  const form = (mobile = false) => (
    <form
      action={standalone ? `/${l}/therapists` : `/${l}#discover`}
      key={JSON.stringify(q)}
      onSubmit={
        mobile || standalone
          ? (event) => {
              event.preventDefault();
              const values = new URLSearchParams();
              new FormData(event.currentTarget).forEach((value, key) => {
                if (typeof value === 'string' && value) values.set(key, value);
              });
              if (values.get('fulfillmentMode') === 'IN_STORE') values.set('mode', 'SCHEDULED');
              if (values.get('mode') === 'INSTANT') {
                values.delete('date');
                if (values.get('sort') === 'earliest') values.delete('sort');
              }
              setOpen(false);
              startTransition(() =>
                router.push(standalone ? `/${l}/therapists?${values}` : `/${l}?${values}#discover`),
              );
            }
          : undefined
      }
    >
      {standalone && <input type="hidden" name="filters" value="advanced" />}
      {!mobile && (
        <h3>
          <SlidersHorizontal size={17} />
          {dt(l, 'refine')}
        </h3>
      )}
      {(mobile || standalone ? ['view'] : ['mode', 'area', 'language', 'view']).map((key) => (
        <input type="hidden" key={key} name={key} value={key === 'mode' ? mode : (q[key] ?? '')} />
      ))}
      <label className="field">
        {sv(l, 'mode')}
        <select
          name="fulfillmentMode"
          value={draftFulfillment}
          onChange={(event) => {
            setDraftFulfillment(event.target.value);
            if (event.target.value === 'IN_STORE') setDraftMode('SCHEDULED');
          }}
        >
          <option value="">{t(l, 'all')}</option>
          <option value="HOME_VISIT">{sv(l, 'HOME_VISIT')}</option>
          <option value="IN_STORE">{sv(l, 'IN_STORE')}</option>
        </select>
      </label>
      {(mobile || standalone) && (
        <>
          <label className="field">
            {t(l, 'mode')}
            <select
              name="mode"
              value={draftMode}
              onChange={(event) => setDraftMode(event.target.value)}
            >
              <option value="SCHEDULED">{t(l, 'scheduled')}</option>
              <option value="INSTANT" disabled={draftFulfillment === 'IN_STORE'}>
                {t(l, 'instant')}
              </option>
            </select>
          </label>
          <label className="field">
            {draftFulfillment === 'IN_STORE'
              ? pc(l, 'venueArea')
              : draftFulfillment === 'HOME_VISIT'
                ? t(l, 'area')
                : pc(l, 'searchArea')}
            <select name="area" defaultValue={q.area ?? ''}>
              <option value="">{mt(l, 'area')}</option>
              {Object.keys(areas).map((area) => (
                <option key={area} value={area}>
                  {areaName(l, area)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t(l, 'language')}
            <select name="language" defaultValue={q.language ?? ''}>
              <option value="">{t(l, 'allLanguages')}</option>
              <option value="ja">日本語</option>
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </label>
        </>
      )}
      <label className="field">
        {dt(l, 'duration')}
        <select name="duration" defaultValue={duration} aria-label={dt(l, 'duration')}>
          {[60, 90, 120].map((n) => (
            <option value={n} key={n}>
              {n} {t(l, 'minutes')}
            </option>
          ))}
        </select>
      </label>
      {(mobile || standalone ? draftMode : mode) === 'SCHEDULED' && (
        <label className="field">
          {dt(l, 'date')}
          <input
            type="date"
            name="date"
            aria-label={dt(l, 'date')}
            defaultValue={q.date ?? ''}
            min={japanDay(Date.now())}
            max={japanDay(Date.now() + 72 * 3600_000)}
          />
          <small>{dt(l, 'dateHint')}</small>
        </label>
      )}
      <label className="field">
        {dt(l, 'budget')}
        <select name="maxTotal" defaultValue={q.maxTotal ?? '0'} aria-label={dt(l, 'budget')}>
          <option value="0">{dt(l, 'anyBudget')}</option>
          {[10000, 15000, 20000].map((n) => (
            <option value={n} key={n}>
              ≤ {money(l, n)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {dt(l, 'provider')}
        <select name="acceptance" defaultValue={q.acceptance ?? ''} aria-label={dt(l, 'provider')}>
          <option value="">{dt(l, 'anyProvider')}</option>
          <option value="auto">{dt(l, 'auto')}</option>
          <option value="manual" disabled={(mobile || standalone) && draftMode === 'INSTANT'}>
            {dt(l, 'manual')}
          </option>
        </select>
      </label>
      <label className="field">
        {l === 'ja' ? '並び順' : l === 'en' ? 'Sort results' : '结果排序'}
        <select
          name="sort"
          defaultValue={q.sort ?? 'recommended'}
          aria-label={l === 'ja' ? '並び順' : l === 'en' ? 'Sort results' : '结果排序'}
        >
          <option value="recommended">
            {l === 'ja' ? 'おすすめ順' : l === 'en' ? 'Recommended' : '推荐排序'}
          </option>
          <option value="price">
            {l === 'ja' ? '総額が安い順' : l === 'en' ? 'Total price: low to high' : '总价从低到高'}
          </option>
          {(mobile || standalone ? draftMode : mode) === 'SCHEDULED' && (
            <option value="earliest">{dt(l, 'next')}</option>
          )}
        </select>
      </label>
      <div className={mobile ? 'sheet-form-actions' : undefined}>
        <button className="button full">{mobile ? mt(l, 'show') : dt(l, 'apply')}</button>
        <Link
          className="filter-reset"
          href={standalone ? `/${l}/therapists?mode=${mode}` : `/${l}?mode=${mode}#discover`}
          onClick={() => setOpen(false)}
        >
          {dt(l, 'reset')}
        </Link>
      </div>
    </form>
  );
  return (
    <>
      <div className="mobile-discovery-tools" aria-busy={pending}>
        <div className="mobile-duration-tabs" aria-label={dt(l, 'duration')}>
          {[60, 90, 120].map((n) => (
            <Link
              key={n}
              aria-current={duration === n ? 'true' : undefined}
              href={
                standalone
                  ? `/${l}/therapists?${new URLSearchParams({ ...q, duration: String(n), filters: 'advanced' })}`
                  : `/${l}?${new URLSearchParams({ ...q, duration: String(n) })}#discover`
              }
            >
              {n}
              <small>{t(l, 'minutes')}</small>
            </Link>
          ))}
        </div>
        <button
          type="button"
          className="mobile-filter-button"
          onClick={() => {
            setDraftMode(mode);
            setDraftFulfillment(q.fulfillmentMode ?? '');
            setOpen(true);
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <SlidersHorizontal size={17} />
          {mt(l, 'filters')}
          {count > 0 && <span>{count}</span>}
        </button>
      </div>
      <MobileSheet open={open} onClose={() => setOpen(false)} title={mt(l, 'filters')} locale={l}>
        {form(true)}
      </MobileSheet>
      <aside className="discovery-sidebar">
        {form()}
        <div className="discovery-aside-note">
          <ShieldCheck size={24} />
          <h4>{t(l, 'transparent')}</h4>
          <p>{dt(l, 'availabilityNote')}</p>
          <Link href={`/${l}/guides/booking-and-safety`}>
            {t(l, 'safety')}
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </aside>
    </>
  );
}
