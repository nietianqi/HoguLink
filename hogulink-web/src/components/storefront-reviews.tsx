'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale, StorefrontReviewItem } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { sf } from '@/lib/storefront-i18n';
import { t } from '@/lib/i18n';
import { sv } from '@/lib/service-mode-i18n';
import { ShopArtwork, ShopGallery } from './shop-brand';
export function StorefrontReviews({ locale: l }: { locale: Locale }) {
  const [items, setItems] = useState<StorefrontReviewItem[]>(),
    [error, setError] = useState(''),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [checked, setChecked] = useState<Record<string, boolean>>({}),
    [busy, setBusy] = useState('');
  const alive = useRef(false);
  const load = useCallback(async () => {
    try {
      const result = await api<StorefrontReviewItem[]>('admin/storefronts');
      if (alive.current) {
        setItems(result);
        setChecked({});
        setError('');
      }
    } catch {
      if (alive.current) setError(sf(l, 'failed'));
    }
  }, [l]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  async function review(item: StorefrontReviewItem, approved: boolean) {
    setBusy(item.id);
    setError('');
    try {
      await api(`admin/storefronts/${item.storeId}/review`, {
        version: item.version,
        approved,
        note: notes[item.id]?.trim(),
      });
      await load();
    } catch (e) {
      if (alive.current)
        setError(
          sf(l, e instanceof ClientError && e.code === 'VERSION_CONFLICT' ? 'conflict' : 'failed'),
        );
    } finally {
      if (alive.current) setBusy('');
    }
  }
  return (
    <section className="admin-panel storefront-editor" id="storefront-review">
      <h2>
        {sf(l, 'reviewTitle')}
        {items && ` · ${items.length}`}
      </h2>
      <p>{sf(l, 'reviewHelp')}</p>
      {error && (
        <p role="alert" className="quality-error">
          {error}
        </p>
      )}
      <button type="button" disabled={!!busy} onClick={() => void load()}>
        {sf(l, 'retry')}
      </button>
      {items && !items.length && <p>{sf(l, 'emptyQueue')}</p>}
      {!items && !error && <p>{sf(l, 'busy')}</p>}
      {items?.map((item) => {
        const c = item.content,
          asset = (id: string | null) => item.assets.find((a) => a.id === id),
          profile = {
            version: item.version,
            publishedAt: 0,
            tagline: c.tagline,
            about: c.about,
            logo: asset(c.logoId),
            cover: asset(c.coverId),
            photos: c.photoIds.flatMap((id) => asset(id) ?? []),
            featuredOfferingIds: c.featuredOfferingIds,
            teamListingIds: c.teamListingIds,
          };
        return (
          <article key={`${item.id}:${item.version}`} className="storefront-review-item">
            <h3>{item.name[l]}</h3>
            <ShopArtwork locale={l} name={item.name[l]} profile={profile} />
            <ShopGallery locale={l} name={item.name[l]} photos={profile.photos} />
            {(['ja', 'en', 'zh-cn'] as const).map((lang) => (
              <div key={lang} lang={lang}>
                <h4>{lang}</h4>
                <strong>{c.tagline[lang]}</strong>
                <p className="storefront-prose">{c.about[lang]}</p>
              </div>
            ))}
            <h4>{sf(l, 'featured')}</h4>
            <ol>
              {c.featuredOfferingIds.map((id) => {
                const o = item.offerings.find((x) => x.id === id);
                return (
                  <li key={id}>
                    {o
                      ? `${o.name[l]} · ${o.durationMinutes} ${t(l, 'minutes')} · ${sv(l, o.fulfillmentMode)}`
                      : sf(l, 'unavailableItem')}
                  </li>
                );
              })}
            </ol>
            <h4>{sf(l, 'teamOrder')}</h4>
            <ol>
              {c.teamListingIds.map((id) => (
                <li key={id}>
                  {item.team.find((x) => x.id === id)?.name[l] ?? sf(l, 'unavailableItem')}
                </li>
              ))}
            </ol>
            <label>
              <input
                type="checkbox"
                checked={!!checked[item.id]}
                disabled={!!busy}
                onChange={(e) => setChecked({ ...checked, [item.id]: e.target.checked })}
              />
              {sf(l, 'checked')}
            </label>
            <label>
              {sf(l, 'note')}
              <textarea
                rows={2}
                maxLength={1000}
                value={notes[item.id] ?? ''}
                disabled={!!busy}
                onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })}
              />
            </label>
            <div className="storefront-actions">
              <button
                type="button"
                className="button"
                disabled={!!busy || !checked[item.id] || (notes[item.id]?.trim().length ?? 0) < 4}
                onClick={() => void review(item, true)}
              >
                {sf(l, 'approve')}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={!!busy || (notes[item.id]?.trim().length ?? 0) < 4}
                onClick={() => void review(item, false)}
              >
                {sf(l, 'reject')}
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
