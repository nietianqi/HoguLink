'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Check, ChevronDown, ChevronLeft, Search } from 'lucide-react';
import type { Locale, Listing } from '@hogulink/contracts';
import { areaName, areas, t } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { h5Portrait } from '@/lib/h5-media';
import { MobileSheet } from './mobile-ui';
import { useSession } from './booking-form';
import { api } from '@/lib/api';
import { historyKey } from '@/lib/consumer-model';
import { ut } from '@/lib/consumer-i18n';
import { qualityError } from '@/lib/quality-i18n';

export function H5PageHeading({
  locale,
  title,
  back = 'account',
}: {
  locale: Locale;
  title: string;
  back?: string;
}) {
  return (
    <header className="h5-page-heading">
      <Link href={`/${locale}/${back}`} aria-label={ht(locale, 'back')}>
        <ChevronLeft size={23} />
      </Link>
      <h1>{title}</h1>
      <span aria-hidden="true" />
    </header>
  );
}

export function H5AreaPicker({
  locale: l,
  serviceAreas,
  q,
}: {
  locale: Locale;
  serviceAreas: string[];
  q: Record<string, string>;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState('');
  const available = serviceAreas.filter((a) => a in areas);
  const visible = available.filter((a) =>
    `${a} ${areaName(l, a)}`
      .normalize('NFKC')
      .toLocaleLowerCase()
      .includes(search.normalize('NFKC').trim().toLocaleLowerCase()),
  );
  const href = (area: string) =>
    `/${l}/therapists?${new URLSearchParams({ ...q, cursor: '', area })}`;
  return (
    <>
      <label className="h5-area-picker h5-area-desktop">
        <span className="sr-only">{ht(l, 'chooseArea')}</span>
        <select name="area" aria-label={ht(l, 'chooseArea')} defaultValue={q.area ?? ''}>
          <option value="">{ht(l, 'tokyo')}</option>
          {available.map((a) => (
            <option key={a} value={a}>
              {areaName(l, a)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="h5-area-mobile"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {q.area && q.area in areas ? areaName(l, q.area) : ht(l, 'tokyo')}
        <ChevronDown size={13} />
      </button>
      <MobileSheet
        open={open}
        onClose={() => setOpen(false)}
        title={ht(l, 'chooseArea')}
        locale={l}
        className="h5-area-sheet"
      >
        <label className="h5-area-search">
          <Search size={17} />
          <span className="sr-only">{ht(l, 'searchArea')}</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={ht(l, 'searchArea')}
          />
        </label>
        <h3>{ht(l, 'currentArea')}</h3>
        <Link className="h5-current-area" href={href(q.area ?? '')}>
          {ht(l, 'tokyo')}
          {q.area && ` · ${areaName(l, q.area)}`}
          <Check size={17} />
        </Link>
        <h3>{ht(l, 'regions')}</h3>
        <div className="h5-area-options">
          <Link href={href('')} aria-current={!q.area ? 'page' : undefined}>
            {ht(l, 'allAreas')}
          </Link>
          {visible.map((area) => (
            <Link key={area} href={href(area)} aria-current={q.area === area ? 'page' : undefined}>
              {areaName(l, area)}
            </Link>
          ))}
        </div>
        {!visible.length && (
          <p className="h5-area-no-match" role="status">
            {ht(l, 'noArea')}
          </p>
        )}
        <p className="h5-footnote">{ht(l, 'manualArea')}</p>
      </MobileSheet>
    </>
  );
}

export function H5PortraitPreview({
  locale: l,
  listing,
  demo,
  available,
}: {
  locale: Locale;
  listing: Listing;
  demo: boolean;
  available?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const photo = h5Portrait(listing, demo),
    generated = photo.startsWith('/images/h5-therapist-');
  return (
    <>
      <button
        type="button"
        className="h5-therapist-avatar"
        aria-label={`${ht(l, 'previewPhoto')} · ${listing.name[l]}`}
        onClick={() => setOpen(true)}
      >
        {generated ? (
          <Image
            src={photo}
            width={68}
            height={68}
            sizes="68px"
            alt={listing.name[l]}
            loading="eager"
          />
        ) : (
          <img src={photo} width={68} height={68} alt={listing.name[l]} />
        )}
        <span className={available === false ? 'is-unavailable' : undefined}>
          {available === undefined
            ? t(l, listing.onDuty ? 'available' : 'byAppointment')
            : ht(l, available ? 'bookable' : 'noAvailability')}
        </span>
      </button>
      <MobileSheet
        open={open}
        onClose={() => setOpen(false)}
        title={listing.name[l]}
        locale={l}
        className="h5-portrait-sheet"
      >
        {generated ? (
          <Image
            src={photo}
            width={600}
            height={900}
            sizes="(max-width:760px) 100vw, 600px"
            alt={listing.name[l]}
          />
        ) : (
          <img src={photo} alt={listing.name[l]} />
        )}
        {demo && <p>{ht(l, 'samplePhoto')}</p>}
      </MobileSheet>
    </>
  );
}

export function H5PortraitThumbnail({
  photo,
  size,
  alt = '',
}: {
  photo: string;
  size: number;
  alt?: string;
}) {
  return photo.startsWith('/images/h5-therapist-') ? (
    <Image src={photo} width={size} height={size} sizes={`${size}px`} alt={alt} />
  ) : (
    <img src={photo} width={size} height={size} alt={alt} />
  );
}

export function H5AccountSession({ locale: l }: { locale: Locale }) {
  const { actor, loading } = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (loading || actor?.role !== 'CUSTOMER') return null;
  return (
    <section className="h5-settings-session">
      <p>{ut(l, 'logoutHelp')}</p>
      {error && (
        <p className="quality-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="quality-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await api('auth/logout', {});
            try {
              localStorage.removeItem(historyKey);
            } catch {}
            window.location.assign(`/${l}/account`);
          } catch (e) {
            setError(qualityError(l, e));
            setBusy(false);
          }
        }}
      >
        {ut(l, 'logout')}
      </button>
    </section>
  );
}

/** HoguLink's own empty-state illustration: two soft message bubbles and a leaf. */
export function H5EmptyArt({ label }: { label?: string }) {
  return (
    <svg
      className="h5-empty-art"
      width="166"
      height="166"
      viewBox="0 0 166 166"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <ellipse cx="83" cy="146" rx="52" ry="7" fill="#dcefe6" />
      <circle cx="83" cy="80" r="60" fill="#eef8f3" />
      <rect
        x="36"
        y="46"
        width="70"
        height="48"
        rx="16"
        fill="#ffffff"
        stroke="#bfe3d2"
        strokeWidth="2"
      />
      <path
        d="M52 94 46 108l18-14"
        fill="#ffffff"
        stroke="#bfe3d2"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="50" y="62" width="40" height="5" rx="2.5" fill="#cfe9dd" />
      <rect x="50" y="73" width="26" height="5" rx="2.5" fill="#cfe9dd" />
      <rect x="72" y="76" width="62" height="42" rx="15" fill="#22b37a" />
      <path d="M118 118 126 130l-22-12" fill="#22b37a" />
      <circle cx="91" cy="97" r="3.5" fill="#fff" />
      <circle cx="103" cy="97" r="3.5" fill="#fff" />
      <circle cx="115" cy="97" r="3.5" fill="#fff" />
      <path d="M124 40c-12 0-20 8-20 20 12 0 20-8 20-20Z" fill="#9fd9bd" />
      <path
        d="M104 60c5-6 10-11 17-16"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
