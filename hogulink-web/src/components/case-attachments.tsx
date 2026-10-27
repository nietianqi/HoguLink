'use client';
import { useState } from 'react';
import type { Locale, TicketAttachment } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, errorText } from '@/lib/i18n';
import { ct } from '@/lib/care-i18n';
import { compressImage, fileBase64 } from '@/lib/image-upload';

/** Evidence photos of a case, served only through the case's own visibility rules. */
export function CaseAttachments({
  locale: l,
  ticketId,
  initial,
  canAdd,
}: {
  locale: Locale;
  ticketId: string;
  initial: TicketAttachment[];
  canAdd: boolean;
}) {
  const [items, setItems] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function add(files: File[]) {
    setBusy(true);
    setError('');
    try {
      for (const file of files.slice(0, 10 - items.length)) {
        if (!['image/jpeg', 'image/png'].includes(file.type)) {
          setError(errorText(l, 'INVALID_PHOTO'));
          break;
        }
        const image = await compressImage(file);
        const added = await api<TicketAttachment>(`support-tickets/${ticketId}/attachments`, {
          mime: image.type,
          data: await fileBase64(image),
        });
        setItems((all) => [...all, added]);
      }
    } catch (e) {
      setError(errorText(l, e instanceof ClientError ? e.code : 'INVALID_PHOTO'));
    } finally {
      setBusy(false);
    }
  }
  if (!items.length && !canAdd) return null;
  return (
    <section className="case-attachments">
      <strong>{ct(l, 'attachments')}</strong>
      {!!items.length && (
        <div className="venue-photo-list">
          {items.map((a) => {
            const src = `/v1/support-tickets/${ticketId}/attachments/${a.id}`;
            return (
              <a key={a.id} href={src} target="_blank" rel="noopener noreferrer">
                <img
                  src={src}
                  width={120}
                  height={90}
                  alt={`${ct(l, 'attachments')} · ${dateTime(l, a.createdAt)}`}
                  loading="lazy"
                />
              </a>
            );
          })}
        </div>
      )}
      {canAdd && items.length < 10 && (
        <>
          <label className="button secondary small venue-photo-add">
            {ct(l, 'addPhotos')}
            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              hidden
              disabled={busy}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                if (files.length) void add(files);
              }}
            />
          </label>
          <small className="flow-muted">{ct(l, 'attachmentsHelp')}</small>
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
