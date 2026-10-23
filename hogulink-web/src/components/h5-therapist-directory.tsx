'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  Info,
  LocateFixed,
  MapPin,
  Search,
  Store,
  X,
} from 'lucide-react';
import {
  nearestArea,
  type Locale,
  type MobileBootstrap,
  type MobileTherapist,
  type MobileTherapists,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { areaName, languageNames, money, t } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import {
  directoryHref,
  directoryQuery,
  directoryTime,
  therapistSelection,
} from '@/lib/therapist-directory-model';
import { H5AreaPicker, H5PortraitPreview } from './h5-overlays';
import { MobileSheet } from './mobile-ui';
import { H5Badges, H5Price, H5Stats, useDeviceLocation } from './h5-business';
import { PriceLines } from './catalog';
import { visitPreferences } from '@/lib/visit-model';
import { TherapistFacts } from './therapist-facts';

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
    [search, setSearch] = useState(q.search ?? '');
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(q);
  const [fee, setFee] = useState<MobileTherapist | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const location = useDeviceLocation(),
    [locationNote, setLocationNote] = useState('');
  const [pending, startTransition] = useTransition();
  const generation = useRef(0),
    inFlight = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const current: Record<string, string> = { ...q, search };
  const href = (changes: Record<string, string>) => directoryHref(l, { ...current, ...changes });
  function navigate(values: Record<string, string>) {
    setOpen(false);
    startTransition(() => router.push(directoryHref(l, values)));
  }
  // Only the nearest served ward leaves the device; coordinates never do.
  async function nearMe() {
    setLocationNote('');
    const point = location.point ?? (await location.request());
    const near = point && nearestArea(point, bootstrap.serviceAreas);
    if (!near) return setLocationNote(ht(l, 'locationDenied'));
    if (near.km > 15) setLocationNote(ht(l, 'locationFar'));
    navigate({ ...current, sort: 'distance', near: near.area });
  }
  async function locateDistance() {
    setLocationNote('');
    const point = await location.request();
    if (!point) setLocationNote(ht(l, 'locationDenied'));
  }
  async function more() {
    if (!data.nextCursor || inFlight.current) return;
    const gen = generation.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      let next: MobileTherapists;
      let replace = false;
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
  const quick = (expanded = false) => {
    const values = expanded ? draft : current;
    const pill = (
      label: string,
      changes: Record<string, string>,
      active: boolean,
      className?: string,
    ) =>
      expanded ? (
        <button
          key={label}
          type="button"
          className={className}
          aria-pressed={active}
          onClick={() => navigate({ ...draft, ...changes })}
        >
          {label}
        </button>
      ) : (
        <Link
          key={label}
          prefetch={false}
          className={className}
          href={href(changes)}
          aria-current={active ? 'page' : undefined}
        >
          {label}
        </Link>
      );
    return (
      <nav
        className={`h5-directory-quick ${expanded ? 'is-expanded' : ''}`}
        aria-label={ht(l, 'filters')}
      >
        <div>
          {pill(ht(l, 'recommended'), { sort: 'recommended' }, values.sort === 'recommended')}
          {!expanded && (
            <button
              type="button"
              className="h5-directory-near"
              aria-pressed={values.sort === 'distance'}
              disabled={location.state === 'locating' || pending}
              onClick={() => void nearMe()}
            >
              <LocateFixed size={13} aria-hidden="true" />
              {ht(l, location.state === 'locating' ? 'locating' : 'nearMe')}
            </button>
          )}
          {[60, 90, ...(expanded ? [120] : [])].map((n) =>
            pill(`${n} ${t(l, 'minutes')}`, { duration: String(n) }, values.duration === String(n)),
          )}
          {pill(
            ht(l, 'freeTravel'),
            { travel: values.travel === 'free' ? '' : 'free' },
            values.travel === 'free',
          )}
          {pill(
            ht(l, 'instant'),
            { mode: values.mode === 'INSTANT' ? 'SCHEDULED' : 'INSTANT' },
            values.mode === 'INSTANT',
            'h5-directory-instant',
          )}
        </div>
        {!expanded && (
          <button
            type="button"
            aria-label={ht(l, 'filters')}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => {
              setDraft(current);
              setOpen(true);
            }}
          >
            <ChevronDown size={18} />
          </button>
        )}
      </nav>
    );
  };
  const searchBar = (
    <div className="h5-search-bar">
      <H5AreaPicker locale={l} serviceAreas={bootstrap.serviceAreas} q={current} />
      <Search size={16} aria-hidden="true" />
      <label className="h5-search-input">
        <span className="sr-only">{ht(l, 'search')}</span>
        <input
          type="search"
          name="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={80}
          placeholder={ht(l, 'search')}
        />
      </label>
      <button disabled={pending}>{ht(l, 'searchAction')}</button>
    </div>
  );
  const chips: Array<{ key: string; label: string; reset: string }> = [
    ...(q.area ? [{ key: 'area', label: areaName(l, q.area), reset: '' }] : []),
    ...(q.language ? [{ key: 'language', label: languageNames[q.language], reset: '' }] : []),
    ...(q.search ? [{ key: 'search', label: q.search, reset: '' }] : []),
    ...(q.sort !== 'recommended'
      ? [
          {
            key: 'sort',
            label: ht(
              l,
              q.sort === 'price'
                ? 'price'
                : q.sort === 'rating'
                  ? 'sortRating'
                  : q.sort === 'distance'
                    ? 'sortDistance'
                    : 'earliest',
            ),
            reset: 'recommended',
          },
        ]
      : []),
    ...(q.duration === '120'
      ? [{ key: 'duration', label: `120 ${t(l, 'minutes')}`, reset: '60' }]
      : []),
  ];
  return (
    <main id="main" className="h5-directory h5-directory-v2 h5-surface wrap" aria-busy={pending}>
      <h1 className="h5-desktop-title">{t(l, 'explore')}</h1>
      <div className="h5-directory-header">
        <form
          action={`/${l}/therapists`}
          className="h5-directory-form"
          onSubmit={(e) => {
            e.preventDefault();
            navigate({
              ...q,
              ...Object.fromEntries(new FormData(e.currentTarget).entries()),
            } as Record<string, string>);
          }}
        >
          {searchBar}
          {Object.entries(q)
            .filter(([k]) => !['search', 'area'].includes(k))
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
        </form>
        {quick()}
        {!!chips.length && (
          <div className="h5-directory-chips">
            {chips.map((chip) => (
              <Link
                key={chip.key}
                prefetch={false}
                href={href({ [chip.key]: chip.reset })}
                aria-label={`${ht(l, 'reset')} · ${chip.label}`}
              >
                <span>{chip.label}</span>
                <X size={11} />
              </Link>
            ))}
            <Link href={`/${l}/therapists`} prefetch={false}>
              {ht(l, 'reset')}
            </Link>
          </div>
        )}
      </div>
      <p className="h5-area-note">
        <MapPin size={14} />
        {ht(l, 'manualArea')}
      </p>
      {locationNote && (
        <p className="h5-location-note" role="status">
          {locationNote}
        </p>
      )}
      {pending && (
        <p className="h5-directory-progress" role="status">
          {ht(l, 'loading')}
        </p>
      )}
      <div className="h5-therapist-list">
        {data.items.map((item) => {
          const { listing, store, offering, total, earliestAt, stats, badges } = item;
          const selection = therapistSelection(q, item);
          return (
            <article className="h5-therapist-card" key={listing.id}>
              <H5PortraitPreview
                locale={l}
                listing={listing}
                demo={bootstrap.demo}
                available={!!earliestAt}
              />
              <div className="h5-therapist-copy">
                <div className="h5-therapist-heading">
                  <h2>
                    <Link href={`/${l}/therapists/${listing.slug}?${selection}`}>
                      {listing.name[l]}
                    </Link>
                  </h2>
                  <H5Badges
                    locale={l}
                    verified={bootstrap.demo ? ht(l, 'sample') : t(l, 'verified')}
                  />
                </div>
                <H5Stats locale={l} stats={stats} compact showReviews={false} />
                <Link
                  className="h5-shop-name"
                  href={`/${l}/shops/${store.slug}?${new URLSearchParams({ ...visitPreferences(q), offering: offering.id })}`}
                >
                  <Store size={11} aria-hidden="true" />
                  <span>{store.name[l]}</span>
                  <ChevronRight size={11} aria-hidden="true" />
                </Link>
                <p>{listing.languages.map((lang) => languageNames[lang]).join(' · ')}</p>
                <H5Badges
                  locale={l}
                  promotion={!!item.promotionEndsAt}
                  instantNow={badges.instantNow}
                  freeTravel={badges.freeTravel}
                />
                <button
                  type="button"
                  className="h5-directory-price"
                  aria-label={`${ht(l, 'feeDetails')} · ${listing.name[l]} · ${money(l, total)}`}
                  onClick={() => setFee(item)}
                >
                  <H5Price
                    locale={l}
                    total={total}
                    compareTotal={item.compareTotal}
                    durationMinutes={offering.durationMinutes}
                  />
                  <Info size={11} />
                </button>
                <TherapistFacts
                  locale={l}
                  name={listing.name[l]}
                  stats={stats}
                  point={location.point}
                  areas={store.areas}
                  locating={location.state === 'locating'}
                  disabled={pending}
                  onLocate={() => void locateDistance()}
                />
              </div>
              <div className="h5-therapist-action">
                <small>
                  {earliestAt ? (
                    <>
                      <Clock3 size={10} />
                      <span>
                        {ht(l, 'earliestShort')}
                        <br />
                        <time dateTime={new Date(earliestAt).toISOString()}>
                          {directoryTime(l, earliestAt, data.checkedAt, ht(l, 'today'))}
                        </time>
                      </span>
                    </>
                  ) : (
                    ht(l, 'noSlots')
                  )}
                </small>
                <Link
                  className="h5-primary"
                  href={`/${l}/${earliestAt ? 'book' : 'therapists'}/${listing.slug}?${selection}`}
                >
                  {ht(l, earliestAt ? 'reserve' : 'chooseTime')}
                </Link>
              </div>
            </article>
          );
        })}
      </div>
      {!data.items.length && (
        <div className="h5-empty">
          <Search size={36} />
          <h2>{ht(l, 'noResults')}</h2>
          <p>{ht(l, 'regionsHelp')}</p>
          <Link href={`/${l}/therapists`}>{ht(l, 'reset')}</Link>
        </div>
      )}
      <p className="h5-directory-count" role="status">
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
        <button
          className="quality-button h5-load-more"
          disabled={busy || pending}
          onClick={() => void more()}
        >
          {ht(l, busy ? 'loading' : error ? 'retryAction' : 'more')}
        </button>
      )}
      <p className="h5-footnote">
        {ht(l, 'distanceNote')} · {ht(l, 'total')}
      </p>
      <p className="h5-footnote">{ht(l, 'realStats')}</p>
      {bootstrap.demo && <p className="h5-footnote">{ht(l, 'sampleNote')}</p>}
      <MobileSheet
        open={open}
        onClose={() => setOpen(false)}
        title={ht(l, 'filters')}
        locale={l}
        className="h5-directory-sheet"
        closeIcon={<ChevronUp size={18} />}
      >
        <form
          action={`/${l}/therapists`}
          onSubmit={(e) => {
            e.preventDefault();
            navigate(draft);
          }}
        >
          <div className="h5-directory-draft-search">
            <label className="h5-directory-draft-area">
              <span className="sr-only">{ht(l, 'chooseArea')}</span>
              <select
                name="area"
                value={draft.area ?? ''}
                onChange={(e) => setDraft({ ...draft, area: e.target.value })}
              >
                <option value="">{ht(l, 'tokyo')}</option>
                {bootstrap.serviceAreas.map((a) => (
                  <option key={a} value={a}>
                    {areaName(l, a)}
                  </option>
                ))}
              </select>
            </label>
            <Search size={16} />
            <label className="h5-search-input">
              <span className="sr-only">{ht(l, 'search')}</span>
              <input
                name="search"
                type="search"
                maxLength={80}
                value={draft.search ?? ''}
                onChange={(e) => setDraft({ ...draft, search: e.target.value })}
                placeholder={ht(l, 'search')}
              />
            </label>
            <button className="h5-directory-draft-submit">{ht(l, 'searchAction')}</button>
          </div>
          {quick(true)}
          <details className="h5-directory-extra">
            <summary>
              {ht(l, 'moreFilters')}
              <ChevronDown size={15} />
            </summary>
            <div className="h5-directory-fields">
              <label>
                {ht(l, 'directoryDuration')}
                <select
                  name="duration"
                  value={draft.duration}
                  onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
                >
                  {[60, 90, 120].map((n) => (
                    <option key={n} value={n}>
                      {n} {t(l, 'minutes')}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t(l, 'language')}
                <select
                  name="language"
                  value={draft.language ?? ''}
                  onChange={(e) => setDraft({ ...draft, language: e.target.value })}
                >
                  <option value="">{ht(l, 'allLanguages')}</option>
                  {['ja', 'en', 'zh'].map((lang) => (
                    <option key={lang} value={lang}>
                      {languageNames[lang]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {ht(l, 'directorySort')}
                <select
                  name="sort"
                  value={draft.sort}
                  onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
                >
                  {(['recommended', 'price', 'earliest', 'rating'] as const).map((sort) => (
                    <option key={sort} value={sort}>
                      {ht(l, sort === 'rating' ? 'sortRating' : sort)}
                    </option>
                  ))}
                  {draft.near && <option value="distance">{ht(l, 'sortDistance')}</option>}
                </select>
              </label>
              <label>
                {ht(l, 'travelFilter')}
                <select
                  name="travel"
                  value={draft.travel ?? 'any'}
                  onChange={(e) => setDraft({ ...draft, travel: e.target.value })}
                >
                  <option value="any">{ht(l, 'anyTravel')}</option>
                  <option value="free">{ht(l, 'freeTravel')}</option>
                </select>
              </label>
              <label>
                {ht(l, 'directoryMode')}
                <select
                  name="mode"
                  value={draft.mode}
                  onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
                >
                  {(['SCHEDULED', 'INSTANT'] as const).map((mode) => (
                    <option key={mode} value={mode}>
                      {ht(l, mode === 'INSTANT' ? 'instant' : 'scheduled')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="h5-directory-sheet-actions">
              <button type="button" onClick={() => setDraft(directoryQuery({}))}>
                {ht(l, 'reset')}
              </button>
              <button className="h5-primary" disabled={pending}>
                {ht(l, 'directoryApply')}
              </button>
            </div>
          </details>
        </form>
      </MobileSheet>
      <MobileSheet
        open={!!fee}
        onClose={() => setFee(null)}
        title={ht(l, 'feeDetails')}
        locale={l}
        className="h5-directory-fee-sheet"
      >
        {fee && (
          <>
            <p>
              {fee.listing.name[l]} · {fee.offering.durationMinutes} {t(l, 'minutes')}
            </p>
            <H5Price
              locale={l}
              size="lg"
              total={fee.total}
              compareTotal={fee.compareTotal}
              promotionEndsAt={fee.promotionEndsAt}
            />
            <PriceLines
              locale={l}
              quote={{
                serviceFee: fee.total - fee.offering.transportFee - fee.nominationFee,
                transportFee: fee.offering.transportFee,
                nominationFee: fee.nominationFee,
                total: fee.total,
              }}
            />
            <p className="h5-directory-fee-help">{ht(l, 'feeRecheck')}</p>
            <Link
              className="h5-primary"
              href={`/${l}/${fee.earliestAt ? 'book' : 'therapists'}/${fee.listing.slug}?${therapistSelection(q, fee)}`}
            >
              {ht(l, fee.earliestAt ? 'reserve' : 'chooseTime')}
            </Link>
          </>
        )}
      </MobileSheet>
    </main>
  );
}
