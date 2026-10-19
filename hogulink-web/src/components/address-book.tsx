'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowUpRight, Check, MapPin, Plus, RefreshCw, ShieldCheck, Star } from 'lucide-react';
import type { Address, AddressBook, Locale, SavedAddress } from '@hogulink/contracts';
import { api } from '@/lib/api';
import { areaName, areas, t } from '@/lib/i18n';
import { af, flowError } from '@/lib/customer-flow-i18n';
import { addressFit, addressSelectionKey, readAddressSelection } from '@/lib/customer-flow-model';
import { useSession } from './booking-form';
import { CustomerAccess } from './engagement-ui';
import { MobileSheet } from './mobile-ui';

function AddressEditor({
  locale: l,
  book,
  initial,
  seed,
  onSaved,
  onClose,
  onConflict,
}: {
  locale: Locale;
  book: AddressBook;
  initial?: SavedAddress;
  seed?: Address;
  onSaved: (book: AddressBook) => void;
  onClose: () => void;
  onConflict: () => void;
}) {
  const base = initial?.address ?? seed;
  const [label, setLabel] = useState(initial?.label ?? ''),
    [name, setName] = useState(base?.name ?? ''),
    [type, setType] = useState<'HOTEL' | 'HOME'>(base?.type ?? 'HOME'),
    [area, setArea] = useState(base?.area ?? 'shinjuku'),
    [detail, setDetail] = useState(base?.detail ?? ''),
    [hotelName, setHotelName] = useState(base?.hotelName ?? ''),
    [isDefault, setIsDefault] = useState(
      initial ? book.defaultId === initial.id : book.items.length === 0,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const retry = useRef({ body: '', key: '' }),
    inFlight = useRef(false);
  return (
    <form
      className="address-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError('');
        const body = {
          version: book.version,
          label,
          setDefault: isDefault,
          address: { name, type, area, detail, hotelName: type === 'HOME' ? '' : hotelName },
        };
        const fingerprint = JSON.stringify(body);
        if (retry.current.body !== fingerprint)
          retry.current = { body: fingerprint, key: crypto.randomUUID() };
        try {
          const next = await api<AddressBook>(
            `customer/addresses${initial ? `/${initial.id}` : ''}`,
            body,
            initial ? 'PUT' : 'POST',
            initial ? undefined : retry.current.key,
          );
          onSaved(next);
          onClose();
        } catch (e) {
          if ((e as { code?: string }).code === 'VERSION_CONFLICT') onConflict();
          setError(flowError(l, e));
        } finally {
          inFlight.current = false;
          setBusy(false);
        }
      }}
    >
      <p className="flow-muted">{af(l, 'addressIntro')}</p>
      <fieldset disabled={busy}>
        <label>
          {af(l, 'label')}
          <input
            required
            maxLength={24}
            value={label}
            placeholder={af(l, 'labelHint')}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label>
          {t(l, 'name')}
          <input
            required
            minLength={2}
            maxLength={80}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="flow-field-grid">
          <label>
            {t(l, 'addressType')}
            <select value={type} onChange={(e) => setType(e.target.value as 'HOTEL' | 'HOME')}>
              <option value="HOME">{t(l, 'home')}</option>
              <option value="HOTEL">{t(l, 'hotel')}</option>
            </select>
          </label>
          <label>
            {t(l, 'area')}
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              {Object.keys(areas).map((a) => (
                <option value={a} key={a}>
                  {areaName(l, a)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {t(l, 'address')}
          <textarea
            required
            minLength={5}
            maxLength={250}
            autoComplete="street-address"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </label>
        {type === 'HOTEL' && (
          <label>
            {t(l, 'hotelName')}
            <input
              required
              maxLength={100}
              value={hotelName}
              onChange={(e) => setHotelName(e.target.value)}
            />
          </label>
        )}
        <label className="flow-checkbox">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          <span>{af(l, 'makeDefault')}</span>
        </label>
        <p className="flow-muted">{af(l, 'privacy')}</p>
        {error && (
          <p className="quality-error" role="alert">
            {error}
          </p>
        )}
        <div className="flow-actions">
          <button type="button" className="quality-button" onClick={onClose}>
            {af(l, 'cancel')}
          </button>
          <button className="quality-primary">{af(l, 'save')}</button>
        </div>
      </fieldset>
    </form>
  );
}
export function AddressBookPage({ locale: l }: { locale: Locale }) {
  const { actor, setActor, loading } = useSession(),
    router = useRouter(),
    [book, setBook] = useState<AddressBook>(),
    [editor, setEditor] = useState<{ initial?: SavedAddress } | null>(null),
    [remove, setRemove] = useState<{ item: SavedAddress; version: number } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    authEpoch = useRef(0);
  const pageEpoch = authEpoch.current;
  useEffect(() => {
    const reset = () => {
      authEpoch.current++;
      generation.current++;
      setBook(undefined);
      setEditor(null);
      setRemove(null);
      setError('');
      setBusy(false);
    };
    window.addEventListener('hogulink-session-invalid', reset);
    window.addEventListener('hogulink-session-changed', reset);
    return () => {
      authEpoch.current++;
      window.removeEventListener('hogulink-session-invalid', reset);
      window.removeEventListener('hogulink-session-changed', reset);
    };
  }, []);
  const load = useCallback(async () => {
    const gen = ++generation.current;
    if (actor?.role !== 'CUSTOMER') {
      setBook(undefined);
      return;
    }
    try {
      const next = await api<AddressBook>('customer/addresses');
      if (gen === generation.current) {
        setBook(next);
        setError('');
      }
    } catch (e) {
      if (gen === generation.current) setError(flowError(l, e));
    }
  }, [actor, l]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  async function change(
    item: SavedAddress,
    operation: 'REMOVE' | 'DEFAULT',
    version = book?.version,
  ) {
    if (version === undefined) return;
    const epoch = authEpoch.current;
    setBusy(true);
    try {
      const next = await api<AddressBook>(
        `customer/addresses/${item.id}${operation === 'DEFAULT' ? '/default' : ''}`,
        { version },
        operation === 'DEFAULT' ? 'POST' : 'DELETE',
      );
      if (epoch !== authEpoch.current) return;
      setBook(next);
      setRemove(null);
      setError('');
    } catch (e) {
      if (epoch !== authEpoch.current) return;
      await load();
      if (epoch !== authEpoch.current) return;
      setError(flowError(l, e));
      setRemove(null);
    } finally {
      if (epoch === authEpoch.current) setBusy(false);
    }
  }
  return (
    <main id="main" className="wrap flow-page address-page">
      <header className="discovery-intro">
        <span className="quality-eyebrow">HOGULINK / YOUR PLACES</span>
        <h1>{af(l, 'addressTitle')}</h1>
        <p>{af(l, 'addressIntro')}</p>
      </header>
      {!loading && actor?.role !== 'CUSTOMER' ? (
        <CustomerAccess locale={l} actor={actor} setActor={setActor} />
      ) : (
        <>
          <div className="flow-toolbar">
            <span>
              <ShieldCheck size={17} />
              {af(l, 'limit')}
              {book && ` · ${book.items.length}/10`}
            </span>
            <div>
              <button
                className="quality-button"
                disabled={loading || busy}
                onClick={() => void load()}
              >
                <RefreshCw size={16} />
                {af(l, 'refresh')}
              </button>
              <button
                className="quality-primary"
                disabled={!book || book.items.length >= 10 || busy}
                onClick={() => setEditor({})}
              >
                <Plus size={17} />
                {af(l, 'add')}
              </button>
            </div>
          </div>
          {error && (
            <p className="quality-error" role="alert">
              {error}
            </p>
          )}
          {!book && !error && <p role="status">{af(l, 'loading')}</p>}
          {book?.items.length === 0 && (
            <section className="address-empty">
              <MapPin size={32} />
              <h2>{af(l, 'empty')}</h2>
              <p>{af(l, 'emptyHelp')}</p>
            </section>
          )}
          <div className="address-grid">
            {book?.items.map((item) => (
              <article className="address-card" key={item.id}>
                <div className="address-card-title">
                  <span className="address-symbol">
                    <MapPin size={22} />
                  </span>
                  <div>
                    <h2>{item.label}</h2>
                    <small>
                      {t(l, item.address.type === 'HOTEL' ? 'hotel' : 'home')} ·{' '}
                      {areaName(l, item.address.area)}
                    </small>
                  </div>
                  {book.defaultId === item.id && (
                    <span className="address-default">
                      <Star size={12} />
                      {af(l, 'default')}
                    </span>
                  )}
                </div>
                <p className="address-contact">{item.address.name}</p>
                <p>
                  {item.address.detail}
                  {item.address.hotelName && (
                    <>
                      <br />
                      {item.address.hotelName}
                    </>
                  )}
                </p>
                <button
                  className="address-browse"
                  onClick={() => {
                    try {
                      sessionStorage.setItem(
                        addressSelectionKey,
                        JSON.stringify({ id: item.id, at: Date.now() }),
                      );
                    } catch {}
                    router.push(`/${l}/services?area=${item.address.area}`);
                  }}
                >
                  {af(l, 'findServices')}
                  <ArrowUpRight size={16} />
                </button>
                <div className="address-card-actions">
                  <button disabled={busy} onClick={() => setEditor({ initial: item })}>
                    {af(l, 'edit')}
                  </button>
                  {book.defaultId !== item.id && (
                    <button disabled={busy} onClick={() => void change(item, 'DEFAULT')}>
                      {af(l, 'makeDefault')}
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => setRemove({ item, version: book.version })}
                  >
                    {af(l, 'remove')}
                  </button>
                </div>
              </article>
            ))}
          </div>
          <p className="flow-muted">{af(l, 'privacy')}</p>
        </>
      )}
      <MobileSheet
        locale={l}
        open={!!editor && !!book && actor?.role === 'CUSTOMER'}
        title={af(l, editor?.initial ? 'edit' : 'add')}
        onClose={() => setEditor(null)}
      >
        {editor && book && (
          <AddressEditor
            locale={l}
            book={book}
            initial={editor.initial}
            onSaved={(next) => {
              if (pageEpoch === authEpoch.current) setBook(next);
            }}
            onConflict={() => {
              if (pageEpoch === authEpoch.current) void load();
            }}
            onClose={() => setEditor(null)}
          />
        )}
      </MobileSheet>
      <MobileSheet
        locale={l}
        open={!!remove && actor?.role === 'CUSTOMER'}
        title={af(l, 'remove')}
        onClose={() => setRemove(null)}
      >
        {remove && (
          <div className="flow-sheet-content">
            <p>{af(l, 'deleteHelp')}</p>
            <strong>{remove.item.label}</strong>
            <p>{remove.item.address.detail}</p>
            <div className="flow-actions">
              <button className="quality-button" onClick={() => setRemove(null)} disabled={busy}>
                {af(l, 'cancel')}
              </button>
              <button
                className="quality-primary"
                disabled={busy}
                onClick={() => void change(remove.item, 'REMOVE', remove.version)}
              >
                {af(l, 'deleteConfirm')}
              </button>
            </div>
          </div>
        )}
      </MobileSheet>
    </main>
  );
}
export function CheckoutAddresses({
  locale: l,
  area,
  hotelOnly,
  owner,
  holdId,
  address,
  disabled,
  onChoose,
  onSuggest,
}: {
  locale: Locale;
  area: string;
  hotelOnly: boolean;
  owner: string;
  holdId: string;
  address: Address;
  disabled: boolean;
  onChoose: (item: SavedAddress) => void;
  onSuggest: (item: SavedAddress) => void;
}) {
  const [book, setBook] = useState<AddressBook>(),
    [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const callbacks = useRef({ onChoose, onSuggest });
  callbacks.current = { onChoose, onSuggest };
  const load = useCallback(async () => {
    const next = await api<AddressBook>('customer/addresses');
    setBook(next);
    setError('');
    return next;
  }, [owner]);
  useEffect(() => {
    let live = true;
    api<AddressBook>('customer/addresses')
      .then((next) => {
        if (!live) return;
        setBook(next);
        let selected: string | null = null;
        try {
          selected = readAddressSelection(sessionStorage.getItem(addressSelectionKey));
          sessionStorage.removeItem(addressSelectionKey);
        } catch {}
        const item = next.items.find((i) => i.id === (selected ?? next.defaultId));
        if (item && !addressFit(item, area, hotelOnly)) callbacks.current.onSuggest(item);
      })
      .catch((e) => {
        if (live) setError(flowError(l, e));
      });
    return () => {
      live = false;
    };
  }, [owner, holdId, area, hotelOnly, l]);
  return (
    <div className="checkout-address-book">
      <div>
        <MapPin size={19} />
        <strong>{af(l, 'addresses')}</strong>
      </div>
      <button
        type="button"
        className="quality-button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          void load().catch((e) => setError(flowError(l, e)));
        }}
      >
        {af(l, 'pick')}
        <ArrowUpRight size={15} />
      </button>
      <button
        type="button"
        className="quality-link"
        disabled={disabled || !book || book.items.length >= 10}
        onClick={() => {
          setNotice('');
          setSaving(true);
        }}
      >
        {af(l, 'saveCurrent')}
      </button>
      {notice && (
        <small className="address-save-notice" role="status">
          <Check size={16} />
          {notice}
        </small>
      )}
      <MobileSheet locale={l} open={open} title={af(l, 'pick')} onClose={() => setOpen(false)}>
        <div className="flow-sheet-content">
          <p className="flow-muted">{af(l, 'pickIntro')}</p>
          {error && (
            <p className="quality-error" role="alert">
              {error}
            </p>
          )}
          {!book && !error && <p role="status">{af(l, 'loading')}</p>}
          {book?.items.length === 0 && <p>{af(l, 'emptyHelp')}</p>}
          <div className="address-picker-list">
            {book?.items.map((item) => {
              const why = addressFit(item, area, hotelOnly);
              return (
                <button
                  type="button"
                  key={item.id}
                  disabled={!!why || disabled}
                  onClick={() => {
                    callbacks.current.onChoose(item);
                    setOpen(false);
                  }}
                >
                  <span>
                    <strong>
                      {item.label}
                      {book.defaultId === item.id && ` · ${af(l, 'default')}`}
                    </strong>
                    <small>
                      {areaName(l, item.address.area)} ·{' '}
                      {t(l, item.address.type === 'HOTEL' ? 'hotel' : 'home')}
                    </small>
                    <span>{item.address.detail}</span>
                    {item.address.hotelName && <span>{item.address.hotelName}</span>}
                    {why && (
                      <small className="address-incompatible">
                        {af(l, why === 'AREA' ? 'areaMismatch' : 'hotelMismatch')}
                      </small>
                    )}
                  </span>
                  {!why && <Check size={18} />}
                </button>
              );
            })}
          </div>
          <Link href={`/${l}/account/addresses`}>{af(l, 'addresses')} ↗</Link>
        </div>
      </MobileSheet>
      <MobileSheet
        locale={l}
        open={saving && !!book}
        title={af(l, 'saveCurrent')}
        onClose={() => setSaving(false)}
      >
        {saving && book && (
          <AddressEditor
            locale={l}
            book={book}
            seed={address}
            onSaved={(next) => {
              setBook(next);
              setNotice(af(l, 'saved'));
            }}
            onConflict={() => {
              void load().catch((e) => setError(flowError(l, e)));
            }}
            onClose={() => setSaving(false)}
          />
        )}
      </MobileSheet>
    </div>
  );
}
