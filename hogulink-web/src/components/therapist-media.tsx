'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Flag, Maximize2, Play } from 'lucide-react';
import type { ListingMediaReportReason, Locale, PublicListingMedia } from '@hogulink/contracts';
import { api } from '@/lib/api';
import { clock, md } from '@/lib/media-i18n';
import { MobileSheet } from './mobile-ui';
import { useSession } from './booking-form';

type Slide = PublicListingMedia & { main?: boolean };
const REASONS: ListingMediaReportReason[] = [
  'NOT_THE_PERSON',
  'INAPPROPRIATE',
  'CONTACT_INFO',
  'OTHER',
];
/** The main photo is a gallery item when the therapist chose one as their cover. */
const mediaId = (url: string) => url.match(/\/listing-media\/(media_[0-9a-f-]{36})$/)?.[1];

/**
 * Profile media: main photo, introduction video, then other approved photos. Swipe or use the
 * thumbnails; photos open larger, the video plays only when tapped.
 */
export function TherapistMedia({
  locale: l,
  name,
  photo,
  sample,
  media = [],
}: {
  locale: Locale;
  name: string;
  photo: string;
  sample: boolean;
  media?: PublicListingMedia[];
}) {
  const slides: Slide[] = [
    { id: mediaId(photo) ?? 'main', kind: 'PHOTO', url: photo, main: true },
    ...media.filter((m) => m.kind === 'VIDEO'),
    ...media.filter((m) => m.kind === 'PHOTO'),
  ];
  const videoIndex = slides.findIndex((s) => s.kind === 'VIDEO');
  const track = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [zoom, setZoom] = useState<number | null>(null),
    [reporting, setReporting] = useState(false);
  const go = useCallback(
    (target: number) => {
      const el = track.current;
      if (!el) return;
      const next = Math.max(0, Math.min(slides.length - 1, target));
      el.scrollTo({
        left: next * el.clientWidth,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
      setIndex(next);
    },
    [slides.length],
  );
  useEffect(() => {
    // Cards link straight to the introduction video.
    if (videoIndex > 0 && window.location.hash === '#therapist-video') {
      const el = track.current;
      if (el) el.scrollLeft = videoIndex * el.clientWidth;
      setIndex(videoIndex);
    }
  }, [videoIndex]);
  const current = slides[index];
  const photos = slides.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'PHOTO');
  return (
    <section
      className="therapist-media"
      id="therapist-media"
      aria-roledescription="carousel"
      aria-label={`${md(l, 'gallery')} · ${name}`}
    >
      <div className="therapist-media-stage">
        <div
          className="therapist-media-track"
          ref={track}
          onScroll={(e) => {
            const el = e.currentTarget;
            const at = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
            if (at !== index) setIndex(at);
            // Swiping away pauses the video; it stays loaded so coming back resumes it.
            if (at !== videoIndex) video.current?.pause();
          }}
        >
          {slides.map((s, i) => (
            <div
              key={s.id + i}
              className={`therapist-media-slide ${s.kind === 'VIDEO' ? 'is-video' : ''}`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} / ${slides.length}`}
              id={s.kind === 'VIDEO' ? 'therapist-video' : undefined}
            >
              {s.kind === 'VIDEO' ? (
                playing ? (
                  <video
                    ref={video}
                    src={s.url}
                    poster={s.posterUrl}
                    controls
                    autoPlay
                    playsInline
                    preload="none"
                    aria-label={`${md(l, 'video')} · ${name}`}
                  />
                ) : (
                  <button
                    type="button"
                    className="therapist-media-poster"
                    onClick={() => {
                      go(i);
                      setPlaying(true);
                    }}
                    aria-label={`${md(l, 'playIntro')} · ${name} · ${clock(s.durationSeconds)}`}
                  >
                    {s.posterUrl && <img src={s.posterUrl} alt="" />}
                    <span className="therapist-media-play">
                      <Play size={26} fill="currentColor" aria-hidden="true" />
                    </span>
                    <span className="therapist-media-duration">
                      {md(l, 'video')} · {clock(s.durationSeconds)}
                    </span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="therapist-media-photo"
                  onClick={() => setZoom(i)}
                  aria-label={`${md(l, 'enlarge')} · ${s.main ? md(l, 'mainPhoto') : md(l, 'photo')}`}
                >
                  <img
                    src={s.url}
                    alt={s.main ? name : `${name} · ${md(l, 'photo')} ${i}`}
                    loading={i === 0 ? 'eager' : 'lazy'}
                  />
                  <Maximize2 size={16} className="therapist-media-zoom" aria-hidden="true" />
                </button>
              )}
              {s.main && sample && (
                <span className="therapist-media-sample">{md(l, 'samplePhoto')}</span>
              )}
            </div>
          ))}
        </div>
        {slides.length > 1 && (
          <>
            <button
              type="button"
              className="therapist-media-arrow is-prev"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label={md(l, 'previous')}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              className="therapist-media-arrow is-next"
              onClick={() => go(index + 1)}
              disabled={index === slides.length - 1}
              aria-label={md(l, 'next')}
            >
              <ChevronRight size={20} />
            </button>
            <span className="therapist-media-count" aria-live="polite">
              {index + 1} / {slides.length}
            </span>
          </>
        )}
      </div>
      {slides.length > 1 && (
        <div className="therapist-media-thumbs" aria-label={md(l, 'gallery')}>
          {slides.map((s, i) => (
            <button
              key={s.id + i}
              type="button"
              aria-current={i === index ? 'true' : undefined}
              aria-label={`${s.kind === 'VIDEO' ? md(l, 'video') : md(l, 'photo')} ${i + 1}`}
              className={i === index ? 'is-active' : undefined}
              onClick={() => {
                go(i);
                if (s.kind !== 'VIDEO') video.current?.pause();
              }}
            >
              <img src={s.kind === 'VIDEO' ? s.posterUrl : s.url} alt="" loading="lazy" />
              {s.kind === 'VIDEO' && (
                <span>
                  <Play size={11} fill="currentColor" aria-hidden="true" />
                  {clock(s.durationSeconds)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="therapist-media-foot">
        {videoIndex > 0 && index !== videoIndex && (
          <button
            type="button"
            className="therapist-media-video-link"
            onClick={() => {
              go(videoIndex);
              setPlaying(true);
              void video.current?.play().catch(() => {});
            }}
          >
            <Play size={13} fill="currentColor" aria-hidden="true" />
            {md(l, 'video')} · {clock(slides[videoIndex].durationSeconds)}
          </button>
        )}
        {/* Only reviewed uploads can be reported; the onboarding portrait follows its own consent. */}
        {current && current.id !== 'main' && (
          <button
            type="button"
            className="therapist-media-report"
            onClick={() => setReporting(true)}
          >
            <Flag size={12} aria-hidden="true" />
            {md(l, 'report')}
          </button>
        )}
      </div>
      <MobileSheet
        open={zoom !== null}
        onClose={() => setZoom(null)}
        title={`${name} · ${(zoom ?? 0) + 1} / ${slides.length}`}
        locale={l}
        className="therapist-media-lightbox"
      >
        {zoom !== null && slides[zoom]?.kind === 'PHOTO' && (
          <div className="therapist-media-large">
            <img src={slides[zoom].url} alt={name} />
            {photos.length > 1 && (
              <div className="therapist-media-large-nav">
                {(['previous', 'next'] as const).map((dir) => {
                  const at = photos.findIndex(({ i }) => i === zoom);
                  const target = photos[at + (dir === 'next' ? 1 : -1)];
                  return (
                    <button
                      key={dir}
                      type="button"
                      className="quality-button"
                      disabled={!target}
                      onClick={() => target && setZoom(target.i)}
                    >
                      {dir === 'next' ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                      {md(l, dir)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </MobileSheet>
      <ReportSheet
        locale={l}
        open={reporting}
        onClose={() => setReporting(false)}
        target={current && current.id !== 'main' ? current.id : ''}
      />
    </section>
  );
}

function ReportSheet({
  locale: l,
  open,
  onClose,
  target,
}: {
  locale: Locale;
  open: boolean;
  onClose: () => void;
  target: string;
}) {
  const { actor } = useSession();
  const [reason, setReason] = useState<ListingMediaReportReason>('NOT_THE_PERSON'),
    [detail, setDetail] = useState(''),
    [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  return (
    <MobileSheet
      open={open}
      onClose={() => {
        onClose();
        setState('idle');
      }}
      title={md(l, 'report')}
      locale={l}
      className="therapist-media-report-sheet"
    >
      {actor?.role !== 'CUSTOMER' ? (
        <Link
          className="h5-primary"
          href={`/${l}/account/access?${new URLSearchParams({ returnTo: typeof window === 'undefined' ? `/${l}` : window.location.pathname })}`}
        >
          {md(l, 'reportLogin')}
        </Link>
      ) : state === 'sent' ? (
        <p role="status">{md(l, 'reportSent')}</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!target) return;
            setState('busy');
            try {
              await api(`customer/listing-media/${target}/report`, {
                reason,
                ...(detail.trim() ? { detail: detail.trim() } : {}),
              });
              setState('sent');
            } catch {
              setState('error');
            }
          }}
        >
          <fieldset>
            <legend>{md(l, 'reportTitle')}</legend>
            {REASONS.map((r) => (
              <label key={r} className="therapist-media-reason">
                <input
                  type="radio"
                  name="media-report"
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
                {md(l, r)}
              </label>
            ))}
          </fieldset>
          <label className="therapist-media-reason-detail">
            {md(l, 'reportDetail')}
            <textarea
              value={detail}
              maxLength={300}
              rows={3}
              onChange={(e) => setDetail(e.target.value)}
            />
          </label>
          {state === 'error' && (
            <p className="quality-error" role="alert">
              {md(l, 'failed')}
            </p>
          )}
          <button className="h5-primary" disabled={state === 'busy' || !target}>
            {md(l, 'reportSend')}
          </button>
        </form>
      )}
    </MobileSheet>
  );
}
