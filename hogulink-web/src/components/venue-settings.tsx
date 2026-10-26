'use client';
import { useEffect, useState } from 'react';
import {
  editableVenue,
  fulfillmentMode,
  type Listing,
  type Locale,
  type Offering,
  type Store,
  type Venue,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { areas, areaName, errorText, money, t } from '@/lib/i18n';
import { serviceModeError, sv } from '@/lib/service-mode-i18n';
import { compressImage, fileBase64 } from '@/lib/image-upload';

const clock = (n: number) =>
  `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const minutes = (value: FormDataEntryValue | null) => {
  const [h, m] = String(value).split(':').map(Number);
  return h * 60 + m;
};
export function VenueSettings({
  locale: l,
  store,
  listings,
  offerings,
  onChanged,
}: {
  locale: Locale;
  store: Omit<Store, 'pspAccount'>;
  listings: Listing[];
  offerings: Offering[];
  onChanged: () => Promise<unknown>;
}) {
  // The form edits pending reviewed facts over the live settings; bookings use the live venue.
  const venue = editableVenue(store);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [photos, setPhotos] = useState<string[]>(venue?.photos ?? []);
  useEffect(() => setPhotos(venue?.photos ?? []), [store.id, venue?.version]);
  async function addPhotos(files: File[]) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const added: string[] = [];
      for (const file of files.slice(0, 8 - photos.length)) {
        if (!['image/jpeg', 'image/png'].includes(file.type)) {
          setError(sv(l, 'INVALID_PHOTO'));
          break;
        }
        const image = await compressImage(file);
        const uploaded = await api<{ url: string }>('merchant/venue/photos', {
          mime: image.type,
          data: await fileBase64(image),
        });
        added.push(uploaded.url);
      }
      setPhotos((all) => [...all, ...added].slice(0, 8));
    } catch (e) {
      const code = e instanceof ClientError ? e.code : 'INVALID_PHOTO';
      setError(serviceModeError(l, code) ?? errorText(l, code));
    } finally {
      setBusy(false);
    }
  }
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await onChanged();
      setNotice(sv(l, 'saved'));
    } catch (e) {
      const code = e instanceof ClientError ? e.code : undefined;
      setError(serviceModeError(l, code) ?? errorText(l, code));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="merchant-panel venue-settings">
      <h2>{sv(l, 'venueSettings')}</h2>
      <p className="flow-muted">{sv(l, 'venueInfoHelp')}</p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={store.homeVisitsEnabled !== false}
          disabled={busy}
          onChange={(e) =>
            void run(() =>
              api(
                'merchant/home-visits',
                { version: store.ruleVersion, enabled: e.target.checked },
                'PUT',
              ),
            )
          }
        />
        {sv(l, 'homeEnabled')}
      </label>
      {venue && (
        <p role="status">
          {sv(l, venue.status)} · v{venue.version}
          {venue.reviewNote ? ` · ${venue.reviewNote}` : ''}
        </p>
      )}
      {store.venueDraft && store.venue?.status === 'APPROVED' && (
        <p className="flow-muted">{sv(l, 'liveWhileReview')}</p>
      )}
      <form
        key={`${store.id}:${venue?.version ?? 0}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!photos.length) {
            setError(sv(l, 'photosRequired'));
            return;
          }
          const f = new FormData(e.currentTarget);
          const resourceNames = String(f.get('resources'))
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean);
          void run(() =>
            api(
              'merchant/venue',
              {
                version: venue?.version ?? 0,
                enabled: f.has('enabled'),
                address: String(f.get('address')),
                area: String(f.get('area')),
                latitude: Number(f.get('latitude')),
                longitude: Number(f.get('longitude')),
                contact: String(f.get('contact')),
                directions: String(f.get('directions')),
                photos,
                businessHours: {
                  startMinute: minutes(f.get('opens')),
                  endMinute: minutes(f.get('closes')) || 1440,
                },
                closedDates: String(f.get('closedDates'))
                  .split('\n')
                  .map((x) => x.trim())
                  .filter(Boolean),
                closedWeekdays: f.getAll('closedWeekdays').map(Number),
                turnoverMinutes: Number(f.get('turnover')),
                nominationFee: Number(f.get('nominationFee')),
                cancellationTemplateId: f.get('cancellationTemplateId'),
                timeSurcharges: [0, 1].flatMap((i) =>
                  Number(f.get(`surchargeAmount-${i}`)) > 0
                    ? [
                        {
                          startMinute: minutes(f.get(`surchargeStart-${i}`)),
                          endMinute: minutes(f.get(`surchargeEnd-${i}`)) || 1440,
                          amount: Number(f.get(`surchargeAmount-${i}`)),
                        },
                      ]
                    : [],
                ),
                resources: resourceNames.map((name, i) => ({
                  id:
                    venue?.resources.find((r) => r.name === name)?.id ??
                    venue?.resources[i]?.id ??
                    `unit-${crypto.randomUUID()}`,
                  name,
                  active: true,
                })),
              },
              'PUT',
            ),
          );
        }}
      >
        <fieldset disabled={busy}>
          <label className="checkbox">
            <input type="checkbox" name="enabled" defaultChecked={venue?.enabled ?? true} />
            {sv(l, 'enabled')}
          </label>
          <label className="field">
            {sv(l, 'address')}
            <input
              name="address"
              required
              minLength={5}
              maxLength={300}
              defaultValue={venue?.address ?? ''}
            />
          </label>
          <div className="field-grid">
            <label className="field">
              {t(l, 'area')}
              <select name="area" defaultValue={venue?.area ?? store.areas[0]}>
                {Object.keys(areas).map((a) => (
                  <option value={a} key={a}>
                    {areaName(l, a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {sv(l, 'phone')}
              <input
                name="contact"
                required
                minLength={3}
                maxLength={100}
                defaultValue={venue?.contact ?? ''}
              />
            </label>
          </div>
          <div className="field-grid">
            <label className="field">
              {sv(l, 'latitude')}
              <input
                name="latitude"
                type="number"
                step="any"
                min={-90}
                max={90}
                required
                defaultValue={venue?.latitude}
              />
            </label>
            <label className="field">
              {sv(l, 'longitude')}
              <input
                name="longitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                required
                defaultValue={venue?.longitude}
              />
            </label>
          </div>
          <label className="field">
            {sv(l, 'directions')}
            <input name="directions" maxLength={500} defaultValue={venue?.directions ?? ''} />
          </label>
          <div className="field">
            <span>{sv(l, 'photos')}</span>
            {photos.length > 0 && (
              <div className="venue-photo-list">
                {photos.map((src) => (
                  <span className="venue-photo-item" key={src}>
                    <img src={src} width={120} height={90} alt={sv(l, 'venue')} loading="lazy" />
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setPhotos((all) => all.filter((x) => x !== src))}
                    >
                      {sv(l, 'removePhoto')}
                    </button>
                  </span>
                ))}
              </div>
            )}
            {photos.length < 8 && (
              <label className="button secondary small venue-photo-add">
                {sv(l, 'addPhotos')}
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = '';
                    if (files.length) void addPhotos(files);
                  }}
                />
              </label>
            )}
            <small className="flow-muted">{sv(l, 'photosHelp')}</small>
          </div>
          <div className="field-grid">
            <label className="field">
              {sv(l, 'opens')}
              <input
                name="opens"
                type="time"
                step={1800}
                required
                defaultValue={clock(venue?.businessHours.startMinute ?? 540)}
              />
            </label>
            <label className="field">
              {sv(l, 'closes')}
              <input
                name="closes"
                type="time"
                step={1800}
                required
                defaultValue={clock(venue?.businessHours.endMinute ?? 1320)}
              />
            </label>
          </div>
          <fieldset>
            <legend>{sv(l, 'closedWeekdays')}</legend>
            <div className="booking-actions">
              {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                <label className="checkbox" key={day}>
                  <input
                    type="checkbox"
                    name="closedWeekdays"
                    value={day}
                    defaultChecked={venue?.closedWeekdays?.includes(day)}
                  />
                  {new Intl.DateTimeFormat(l, { weekday: 'short', timeZone: 'UTC' }).format(
                    Date.UTC(2026, 9, 25 + day),
                  )}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            {sv(l, 'closedDates')}
            <textarea name="closedDates" defaultValue={venue?.closedDates?.join('\n') ?? ''} />
          </label>
          <div className="field-grid">
            <label className="field">
              {sv(l, 'turnover')}
              <input
                name="turnover"
                type="number"
                min={5}
                max={120}
                step={5}
                required
                defaultValue={venue?.turnoverMinutes ?? 15}
              />
            </label>
            <label className="field">
              {sv(l, 'nominationFee')}
              <input
                name="nominationFee"
                type="number"
                min={0}
                max={20000}
                required
                defaultValue={venue?.nominationFee ?? 500}
              />
            </label>
          </div>
          <label className="field">
            {sv(l, 'resources')}
            <textarea
              name="resources"
              required
              defaultValue={
                venue?.resources
                  .filter((r) => r.active)
                  .map((r) => r.name)
                  .join('\n') ?? ''
              }
            />
          </label>
          <label className="field">
            {sv(l, 'policy')}
            <select
              name="cancellationTemplateId"
              defaultValue={venue?.cancellationTemplateId ?? 'FLEXIBLE_2H'}
            >
              <option value="FLEXIBLE_2H">{sv(l, 'flexible')}</option>
              <option value="STANDARD_24H">{sv(l, 'standard')}</option>
            </select>
          </label>
          <details>
            <summary>
              {l === 'zh-cn'
                ? '到店时段附加费'
                : l === 'ja'
                  ? '来店時間帯の追加料金'
                  : 'In-store time surcharge'}
            </summary>
            {[0, 1].map((i) => (
              <div key={i}>
                <div className="field-grid">
                  <label className="field">
                    {sv(l, 'surchargeStart')}
                    <input
                      name={`surchargeStart-${i}`}
                      type="time"
                      step={900}
                      defaultValue={clock(venue?.timeSurcharges?.[i]?.startMinute ?? 1200)}
                    />
                  </label>
                  <label className="field">
                    {sv(l, 'surchargeEnd')}
                    <input
                      name={`surchargeEnd-${i}`}
                      type="time"
                      step={900}
                      defaultValue={clock(venue?.timeSurcharges?.[i]?.endMinute ?? 1440)}
                    />
                  </label>
                </div>
                <label className="field">
                  JPY
                  <input
                    name={`surchargeAmount-${i}`}
                    type="number"
                    min={0}
                    max={20000}
                    step={100}
                    defaultValue={venue?.timeSurcharges?.[i]?.amount ?? 0}
                  />
                </label>
              </div>
            ))}
          </details>
          <button className="button small" disabled={busy}>
            {sv(l, 'submit')}
          </button>
        </fieldset>
      </form>
      <h3>{sv(l, 'staffModes')}</h3>
      {listings
        .filter((x) => x.membershipActive)
        .map((person) => (
          <div className="venue-staff-mode" key={person.id}>
            <strong>{person.name[l]}</strong>
            {(['HOME_VISIT', 'IN_STORE'] as const).map((mode) => (
              <label className="checkbox" key={mode}>
                <input
                  type="checkbox"
                  checked={(person.fulfillmentModes ?? ['HOME_VISIT']).includes(mode)}
                  disabled={busy}
                  onChange={(e) => {
                    const next = new Set(person.fulfillmentModes ?? ['HOME_VISIT']);
                    if (e.target.checked) next.add(mode);
                    else next.delete(mode);
                    if (next.size)
                      void run(() =>
                        api(
                          `merchant/team/${person.id}/service-modes`,
                          { version: person.serviceModesVersion ?? 0, modes: [...next] },
                          'PUT',
                        ),
                      );
                  }}
                />
                {sv(l, mode)}
              </label>
            ))}
          </div>
        ))}
      <h3>{sv(l, 'price')}</h3>
      {offerings
        .filter((o) => fulfillmentMode(o) === 'HOME_VISIT' && o.approved)
        .map((o) => {
          const existing = offerings.find((next) => next.id === `${o.id}-in-store`);
          return (
            <form
              className="venue-menu-row"
              key={`${o.id}:${o.version}:${existing?.version ?? 0}`}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(() =>
                  existing
                    ? api(
                        `merchant/services/${existing.id}`,
                        {
                          version: existing.version,
                          price: Number(f.get('price')),
                          transportFee: 0,
                          active: f.has('active'),
                        },
                        'PUT',
                      )
                    : api(
                        `merchant/services/${o.id}/in-store`,
                        {
                          version: o.version,
                          price: Number(f.get('price')),
                          active: f.has('active'),
                        },
                        'POST',
                      ),
                );
              }}
            >
              <span>
                {o.name[l]} · {o.durationMinutes} {t(l, 'minutes')}
              </span>
              <label className="field">
                {sv(l, 'price')}
                <input
                  name="price"
                  aria-label={`${o.name[l]} ${o.durationMinutes} ${sv(l, 'price')}`}
                  type="number"
                  min={1000}
                  max={200000}
                  required
                  defaultValue={existing?.price ?? o.price}
                />
              </label>
              <label className="checkbox">
                <input type="checkbox" name="active" defaultChecked={existing?.active !== false} />
                {sv(l, 'menuEnabled')}
              </label>
              <button className="button secondary small" disabled={busy}>
                {existing ? sv(l, 'save') : sv(l, 'createService')}
              </button>
            </form>
          );
        })}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

export function VenueReviews({ locale: l }: { locale: Locale }) {
  const [rows, setRows] = useState<
      { storeId: string; name: Store['name']; venue: Venue; live?: Venue }[]
    >([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    api<typeof rows>('admin/venues')
      .then((data) => {
        if (live) setRows(data);
      })
      .catch((e) => {
        if (live) setError(errorText(l, e instanceof ClientError ? e.code : undefined));
      });
    return () => {
      live = false;
    };
  }, [retry, l]);
  return (
    <section className="admin-panel venue-reviews">
      <h2>{sv(l, 'reviewTitle')}</h2>
      {rows
        .filter((x) => x.venue.status === 'PENDING')
        .map((row) => (
          <form
            className="exception-panel"
            key={`${row.storeId}:${row.venue.version}`}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const decision = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
              setBusy(true);
              setError('');
              try {
                await api(
                  `admin/venues/${row.storeId}/review`,
                  { version: row.venue.version, decision, note: f.get('note') },
                  'POST',
                );
                setRetry((n) => n + 1);
              } catch (e) {
                setError(errorText(l, e instanceof ClientError ? e.code : undefined));
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>{row.name[l]}</h3>
            <p>
              {row.venue.address} · {row.venue.contact}
            </p>
            {row.live && (
              <p className="flow-muted">
                {sv(l, 'currentVenue')}: {row.live.address} · {row.live.contact}
              </p>
            )}
            <p>
              {sv(l, 'capacity')}: {row.venue.resources.filter((r) => r.active).length}
            </p>
            <div className="venue-photo-list">
              {row.venue.photos.map((src) => (
                <a key={src} href={src} target="_blank" rel="noopener noreferrer">
                  <img src={src} width={120} height={90} alt={sv(l, 'venue')} loading="lazy" />
                </a>
              ))}
            </div>
            <label className="field">
              {sv(l, 'reviewNote')}
              <textarea name="note" required minLength={3} maxLength={500} />
            </label>
            <div className="booking-actions">
              <button className="button small" value="APPROVED" disabled={busy}>
                {sv(l, 'approve')}
              </button>
              <button className="button secondary small" value="REJECTED" disabled={busy}>
                {sv(l, 'reject')}
              </button>
            </div>
          </form>
        ))}
      {!rows.some((x) => x.venue.status === 'PENDING') && <p>{sv(l, 'noVenues')}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
          <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
            {sv(l, 'retry')}
          </button>
        </p>
      )}
    </section>
  );
}
