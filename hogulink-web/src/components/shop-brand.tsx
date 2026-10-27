'use client';
import { useState } from 'react';
import { ArrowRight, Share2 } from 'lucide-react';
import type { Locale, PublishedStorefront, StorefrontAsset } from '@hogulink/contracts';
import { sf } from '@/lib/storefront-i18n';
import { MobileSheet } from './mobile-ui';
export function ShopArtwork({
  locale: l,
  name,
  profile,
  demo = false,
}: {
  locale: Locale;
  name: string;
  profile?: PublishedStorefront;
  demo?: boolean;
}) {
  return (
    <div className={`storefront-art ${profile?.cover ? 'has-image' : ''}`}>
      {profile?.cover ? (
        <img
          className="storefront-cover"
          src={profile.cover.url}
          alt={`${name} · ${sf(l, 'cover')}`}
          fetchPriority="high"
        />
      ) : (
        <span className="storefront-art-mark" aria-hidden="true">
          {name.slice(0, 1)}
        </span>
      )}
      <span className="storefront-logo">
        {profile?.logo ? (
          <img src={profile.logo.url} alt={`${name} · ${sf(l, 'logo')}`} />
        ) : (
          name.slice(0, 1)
        )}
      </span>
      {demo && profile?.cover && (
        <span className="storefront-demo-image">{sf(l, 'demoImage')}</span>
      )}
    </div>
  );
}
export function ShopGallery({
  locale: l,
  photos,
  name,
}: {
  locale: Locale;
  photos: StorefrontAsset[];
  name: string;
}) {
  const [selected, setSelected] = useState<number>();
  if (!photos.length) return null;
  return (
    <>
      <div className="storefront-gallery">
        {photos.map((p, i) => (
          <button
            type="button"
            key={p.id}
            onClick={() => setSelected(i)}
            aria-label={`${sf(l, 'gallery')} ${i + 1}`}
          >
            <img loading="lazy" src={p.url} alt={`${name} · ${i + 1}`} />
          </button>
        ))}
      </div>
      <MobileSheet
        locale={l}
        title={sf(l, 'photo')}
        open={selected !== undefined}
        onClose={() => setSelected(undefined)}
        className="storefront-lightbox"
      >
        {selected !== undefined && (
          <>
            <img src={photos[selected].url} alt={`${name} · ${selected + 1}`} />
            <div className="storefront-actions">
              <button
                type="button"
                disabled={selected === 0}
                onClick={() => setSelected(selected - 1)}
              >
                ←
              </button>
              <span>
                {selected + 1} / {photos.length}
              </span>
              <button
                type="button"
                disabled={selected === photos.length - 1}
                onClick={() => setSelected(selected + 1)}
              >
                →
              </button>
            </div>
          </>
        )}
      </MobileSheet>
    </>
  );
}
export function ShopShare({ locale: l, name }: { locale: Locale; name: string }) {
  const [message, setMessage] = useState('');
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: name, url: window.location.href });
      else {
        await navigator.clipboard.writeText(window.location.href);
        setMessage(sf(l, 'copied'));
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setMessage(sf(l, 'shareFailed'));
    }
  }
  return (
    <span className="storefront-share">
      <button className="button secondary" type="button" onClick={share}>
        <Share2 size={16} />
        {sf(l, 'share')}
      </button>
      <span className="sr-only" role="status">
        {message}
      </span>
    </span>
  );
}
export function ShopBookingDock({ locale: l, name }: { locale: Locale; name: string }) {
  return (
    <div className="storefront-dock">
      <div>
        <strong>{name}</strong>
        <small>{sf(l, 'arranged')}</small>
      </div>
      <a className="button" href="#reserve">
        {sf(l, 'book')}
        <ArrowRight size={16} />
      </a>
    </div>
  );
}
