'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  Locale,
  StorefrontContent,
  StorefrontDraft,
  StorefrontWorkspace,
  StorefrontAsset,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { sf } from '@/lib/storefront-i18n';
import { t } from '@/lib/i18n';
import { sv } from '@/lib/service-mode-i18n';
import { pt } from '@/lib/subscription-i18n';
import { storefrontChecklist } from '@/lib/storefront-model';
import { compressImage, fileBase64 } from '@/lib/image-upload';
import { MobileSheet } from './mobile-ui';
import { ShopArtwork, ShopGallery } from './shop-brand';

function OrderedSelection({
  items,
  ids,
  onChange,
  label,
  locale: l,
  disabled,
  limit,
  help,
}: {
  items: { id: string; name: string }[];
  ids: string[];
  onChange: (ids: string[]) => void;
  label: string;
  locale: Locale;
  disabled: boolean;
  limit: number;
  help?: string;
}) {
  const selected = ids.map(
    (id) => items.find((x) => x.id === id) ?? { id, name: sf(l, 'unavailableItem') },
  );
  function move(index: number, delta: number) {
    const next = [...ids];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  }
  return (
    <fieldset disabled={disabled} className="storefront-order">
      <legend>{label}</legend>
      <p className="muted">{help ?? sf(l, 'orderHelp')}</p>
      <ol>
        {[...selected, ...items.filter((x) => !ids.includes(x.id))].map((item) => {
          const i = ids.indexOf(item.id);
          return (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={i >= 0}
                  disabled={i < 0 && ids.length >= limit}
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                    )
                  }
                />
                {item.name}
              </label>
              {i >= 0 && (
                <>
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={item.name + ' · ' + sf(l, 'up')}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={i === ids.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={item.name + ' · ' + sf(l, 'down')}
                  >
                    ↓
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}
export function StorefrontEditor({ locale: l }: { locale: Locale }) {
  const [data, setData] = useState<StorefrontWorkspace>(),
    [content, setContent] = useState<StorefrontContent>(),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [editLanguage, setEditLanguage] = useState<Locale>(l);
  const alive = useRef(false);
  const fail = (e: unknown) =>
    sf(
      l,
      e instanceof ClientError && e.code === 'VERSION_CONFLICT'
        ? 'conflict'
        : e instanceof ClientError &&
            [
              'STOREFRONT_CONTENT_REQUIRED',
              'INVALID_STOREFRONT_REFERENCE',
              'INVALID_STOREFRONT_ASSET',
              'INVALID_PHOTO',
            ].includes(e.code)
          ? 'invalid'
          : 'failed',
    );
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const next = await api<StorefrontWorkspace>('merchant/storefront');
      if (alive.current) {
        setData(next);
        setContent(next.draft.content);
        setError('');
      }
    } catch {
      if (alive.current) setError(sf(l, 'failed'));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [l]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  function patch(next: Partial<StorefrontContent>) {
    setContent((old) => (old ? { ...old, ...next } : old));
    setMessage('');
  }
  async function action(kind: 'save' | 'submit' | 'withdraw') {
    if (!data || !content) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let draft: StorefrontDraft;
      if (kind === 'withdraw')
        draft = await api<StorefrontDraft>('merchant/storefront/withdraw', {
          version: data.draft.version,
        });
      else {
        draft = await api<StorefrontDraft>(
          'merchant/storefront',
          { version: data.draft.version, content },
          'PUT',
        );
        // A failed submission must retain the version of the successfully saved draft.
        if (alive.current) setData((old) => (old ? { ...old, draft } : old));
        if (kind === 'submit')
          draft = await api<StorefrontDraft>('merchant/storefront/submit', {
            version: draft.version,
          });
      }
      if (alive.current) {
        setData((old) => (old ? { ...old, draft } : old));
        setContent(draft.content);
        setMessage(sf(l, kind === 'save' ? 'saved' : kind === 'submit' ? 'sent' : 'withdrawn'));
      }
    } catch (e) {
      if (alive.current) setError(fail(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (!['image/jpeg', 'image/png'].includes(file.type))
        throw new ClientError('INVALID_PHOTO', '');
      const compressed = await compressImage(file);
      const asset = await api<StorefrontAsset>('merchant/storefront/images', {
        mime: compressed.type,
        data: await fileBase64(compressed),
      });
      if (alive.current) setData((old) => (old ? { ...old, assets: [asset, ...old.assets] } : old));
    } catch (e) {
      if (alive.current) setError(fail(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function removeImage(id: string) {
    setBusy(true);
    setError('');
    try {
      await api('merchant/storefront/images/' + id, undefined, 'DELETE');
      if (alive.current) {
        setData((old) => (old ? { ...old, assets: old.assets.filter((a) => a.id !== id) } : old));
        setMessage(sf(l, 'imageRemoved'));
      }
    } catch (e) {
      if (alive.current) setError(fail(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (!data || !content)
    return (
      <section className="merchant-panel storefront-editor">
        <h2>{sf(l, 'title')}</h2>
        {error ? <p role="alert">{error}</p> : <p>{sf(l, 'busy')}</p>}
        <button type="button" disabled={busy} onClick={() => void load()}>
          {sf(l, 'retry')}
        </button>
      </section>
    );
  const pending = data.draft.status === 'PENDING',
    locked = pending || busy,
    checks = storefrontChecklist(content),
    asset = (id: string | null) => data.assets.find((x) => x.id === id),
    photos = content.photoIds.flatMap((id) => asset(id) ?? []);
  const profile = {
    version: data.draft.version,
    publishedAt: 0,
    tagline: content.tagline,
    about: content.about,
    logo: asset(content.logoId),
    cover: asset(content.coverId),
    photos,
    featuredOfferingIds: content.featuredOfferingIds,
    teamListingIds: content.teamListingIds,
  };
  const usedImages = new Set([
    content.logoId,
    content.coverId,
    ...content.photoIds,
    data.draft.content.logoId,
    data.draft.content.coverId,
    ...data.draft.content.photoIds,
    data.published?.logo?.id,
    data.published?.cover?.id,
    ...(data.published?.photos ?? []).map((p) => p.id),
  ]);
  return (
    <section className="merchant-panel storefront-editor">
      <header>
        <h2>
          {sf(l, 'title')} <span className="storefront-status">{sf(l, data.draft.status)}</span>
        </h2>
        <p>{sf(l, 'editorHelp')}</p>
        <div className="storefront-actions">
          <Link href={`/${l}/shops/${data.store.slug}`} target="_blank">
            {sf(l, 'published')} ↗
          </Link>
          <button type="button" onClick={() => setPreview(true)}>
            {sf(l, 'preview')}
          </button>
        </div>
      </header>
      <div className="storefront-editor-stats" aria-label={sf(l, 'stats')}>
        {(
          [
            ['favorites', data.stats.favorites],
            ['completed', data.stats.completed90d],
            ['reviews', data.stats.reviewCount],
          ] as const
        ).map(([key, value]) => (
          <div key={key}>
            <strong>{value}</strong>
            <small>{sf(l, key)}</small>
          </div>
        ))}
      </div>
      <p className="muted">
        {sf(l, 'planHelp')}{' '}
        <Link href={`/${l}/merchant?tab=finance`}>{pt(l, data.store.plan)} ↗</Link>
      </p>
      {data.draft.note && <p className="notice">{data.draft.note}</p>}
      {error && (
        <p role="alert" className="quality-error">
          {error}{' '}
          <button type="button" onClick={() => void load()} disabled={busy}>
            {sf(l, 'retry')}
          </button>
        </p>
      )}
      <p role="status">{message}</p>
      <div className="storefront-checklist">
        <strong>{sf(l, 'completeness')}</strong>
        {Object.entries(checks).map(([key, value]) => (
          <span key={key}>
            {sf(l, key === 'gallery' ? 'galleryLabel' : (key as keyof typeof checks))} ·{' '}
            {sf(l, value ? 'ready' : 'missing')}
          </span>
        ))}
      </div>
      <fieldset disabled={locked}>
        <legend>{sf(l, 'library')}</legend>
        <p>
          {sf(l, 'imagesHelp')} {sf(l, 'photoLimit')}
        </p>
        <p className="muted">
          {sf(l, 'imageLibraryLimit')} {sf(l, 'removeHelp')}
        </p>
        <label className="storefront-upload">
          {sf(l, 'upload')}
          <input
            type="file"
            accept="image/jpeg,image/png"
            disabled={data.assets.length >= 50}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <div className="storefront-selects">
          {(['logoId', 'coverId'] as const).map((key) => (
            <label key={key}>
              {sf(l, key === 'logoId' ? 'logo' : 'cover')}
              <select
                value={content[key] ?? ''}
                onChange={(e) => patch({ [key]: e.target.value || null })}
              >
                <option value="">{sf(l, 'none')}</option>
                {data.assets.map((a, i) => (
                  <option key={a.id} value={a.id}>
                    {sf(l, 'photo')} {data.assets.length - i}
                  </option>
                ))}
              </select>
              {asset(content[key]) && (
                <img
                  className="storefront-selected-image"
                  src={asset(content[key])!.url}
                  alt={sf(l, key === 'logoId' ? 'logo' : 'cover')}
                />
              )}
            </label>
          ))}
        </div>
        <div className="storefront-library">
          {data.assets.map((a, i) => (
            <div className="storefront-library-item" key={a.id}>
              <img src={a.url} alt={sf(l, 'photo') + ' ' + (data.assets.length - i)} />
              <span>
                {sf(l, 'photo')} {data.assets.length - i}
              </span>
              <button
                type="button"
                disabled={locked || usedImages.has(a.id)}
                onClick={() => void removeImage(a.id)}
              >
                {sf(l, 'removeImage')}
              </button>
            </div>
          ))}
        </div>
        <OrderedSelection
          locale={l}
          label={sf(l, 'galleryOrder')}
          help={sf(l, 'galleryOrderHelp')}
          disabled={locked}
          limit={12}
          ids={content.photoIds}
          items={data.assets.map((a, i) => ({
            id: a.id,
            name: `${sf(l, 'photo')} ${data.assets.length - i}`,
          }))}
          onChange={(photoIds) => patch({ photoIds })}
        />
      </fieldset>
      <fieldset disabled={locked}>
        <legend>{sf(l, 'introduction')}</legend>
        <div className="storefront-actions" role="group" aria-label={sf(l, 'introduction')}>
          {(['ja', 'en', 'zh-cn'] as const).map((lang) => (
            <button
              type="button"
              aria-pressed={editLanguage === lang}
              key={lang}
              onClick={() => setEditLanguage(lang)}
            >
              {lang === 'ja' ? '日本語' : lang === 'en' ? 'English' : '简体中文'}
            </button>
          ))}
        </div>
        <label>
          {sf(l, 'tagline')}
          <input
            lang={editLanguage}
            value={content.tagline[editLanguage]}
            maxLength={90}
            onChange={(e) =>
              patch({ tagline: { ...content.tagline, [editLanguage]: e.target.value } })
            }
          />
        </label>
        <label>
          {sf(l, 'introduction')}
          <textarea
            rows={6}
            lang={editLanguage}
            maxLength={1800}
            value={content.about[editLanguage]}
            onChange={(e) => patch({ about: { ...content.about, [editLanguage]: e.target.value } })}
          />
        </label>
        <p className="muted">{sf(l, 'textHelp')}</p>
      </fieldset>
      <OrderedSelection
        locale={l}
        label={sf(l, 'featured')}
        disabled={locked}
        limit={6}
        items={data.offerings.map((o) => ({
          id: o.id,
          name: `${o.name[l]} · ${o.durationMinutes} ${t(l, 'minutes')} · ${sv(l, o.fulfillmentMode)}`,
        }))}
        ids={content.featuredOfferingIds}
        onChange={(featuredOfferingIds) => patch({ featuredOfferingIds })}
      />
      <OrderedSelection
        locale={l}
        label={sf(l, 'teamOrder')}
        disabled={locked}
        limit={30}
        items={data.team.map((x) => ({ id: x.id, name: x.name[l] }))}
        ids={content.teamListingIds}
        onChange={(teamListingIds) => patch({ teamListingIds })}
      />
      <div className="storefront-actions">
        {pending ? (
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => void action('withdraw')}
          >
            {sf(l, 'withdraw')}
          </button>
        ) : (
          <>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => void action('save')}
            >
              {sf(l, 'save')}
            </button>
            <button
              className="button"
              type="button"
              disabled={busy || !checks.introduction}
              onClick={() => void action('submit')}
            >
              {sf(l, 'submit')}
            </button>
          </>
        )}
      </div>
      <MobileSheet
        locale={l}
        title={sf(l, 'draftOnly')}
        open={preview}
        onClose={() => setPreview(false)}
        className="storefront-preview"
      >
        <ShopArtwork locale={l} name={data.store.name[editLanguage]} profile={profile} />
        <h2>{data.store.name[editLanguage]}</h2>
        <p>{content.tagline[editLanguage]}</p>
        <p className="storefront-prose">{content.about[editLanguage]}</p>
        <ShopGallery locale={l} name={data.store.name[l]} photos={photos} />
        <h3>{sf(l, 'featured')}</h3>
        <ol>
          {content.featuredOfferingIds.map((id) => {
            const o = data.offerings.find((x) => x.id === id);
            return (
              <li key={id}>
                {o
                  ? `${o.name[editLanguage]} · ${o.durationMinutes} ${t(editLanguage, 'minutes')} · ${sv(editLanguage, o.fulfillmentMode)}`
                  : sf(l, 'unavailableItem')}
              </li>
            );
          })}
        </ol>
        <h3>{sf(l, 'teamOrder')}</h3>
        <ol>
          {content.teamListingIds.map((id) => (
            <li key={id}>
              {data.team.find((x) => x.id === id)?.name[editLanguage] ?? sf(l, 'unavailableItem')}
            </li>
          ))}
        </ol>
      </MobileSheet>
    </section>
  );
}
