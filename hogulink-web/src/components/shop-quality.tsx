'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Booking, Locale, Localized } from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { dateTime, errorText, statusText } from '@/lib/i18n';
import { sq } from '@/lib/supply-quality-i18n';

type Row = {
  storeId: string;
  name: Localized;
  orders: number;
  completed: number;
  shopCancelled: number;
  expired: number;
  customerFees: number;
  disputes: number;
  complaints: number;
  safetyEvents: number;
  flags: ('SHOP_FAILURES' | 'CUSTOMER_FEES' | 'COMPLAINTS' | 'SAFETY')[];
};
type Impact = {
  targetType: 'STORE' | 'LISTING' | 'VENUE';
  targetId: string;
  name: Localized;
  bookings: { id: string; startAt: number; status: Booking['status']; mode: string }[];
};
const rate = (n: number, of: number) => (of ? ` · ${Math.round((n / of) * 100)}%` : '');

function useAdminData<T>(path: string, l: Locale) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    api<T>(path)
      .then((value) => live && setData(value))
      .catch((e) => live && setError(errorText(l, e instanceof ClientError ? e.code : undefined)));
    return () => {
      live = false;
    };
  }, [path, l, retry]);
  return { data, error, reload: () => setRetry((n) => n + 1) };
}

/** Per-shop reliability facts from bookings and cases; flags are prompts to check, not verdicts. */
export function ShopQuality({ locale: l }: { locale: Locale }) {
  const { data, error, reload } = useAdminData<Row[]>('admin/shop-quality?days=30', l);
  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <h2>{sq(l, 'title')}</h2>
        <span>{data?.filter((x) => x.flags.length).length ?? 0}</span>
      </div>
      <p className="muted">{sq(l, 'help')}</p>
      {error && (
        <p role="alert" className="error-message">
          {error}{' '}
          <button className="text-button" onClick={reload}>
            {sq(l, 'retry')}
          </button>
        </p>
      )}
      {data && !data.length && <p>{sq(l, 'none')}</p>}
      {!!data?.length && (
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{sq(l, 'shop')}</th>
                <th>{sq(l, 'orders')}</th>
                <th>{sq(l, 'completed')}</th>
                <th>{sq(l, 'shopFailures')}</th>
                <th>{sq(l, 'customerFees')}</th>
                <th>{sq(l, 'disputes')}</th>
                <th>{sq(l, 'complaints')}</th>
                <th>{sq(l, 'safety')}</th>
                <th>{sq(l, 'flags')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.storeId}>
                  <td>{r.name[l]}</td>
                  <td>{r.orders}</td>
                  <td>{r.completed}</td>
                  <td>
                    {r.shopCancelled + r.expired}
                    {rate(r.shopCancelled + r.expired, r.orders)}
                  </td>
                  <td>
                    {r.customerFees}
                    {rate(r.customerFees, r.orders)}
                  </td>
                  <td>{r.disputes}</td>
                  <td>{r.complaints}</td>
                  <td>{r.safetyEvents}</td>
                  <td>
                    {r.flags.map((f) => (
                      <span className="admin-pill warning" key={f}>
                        {sq(l, f)}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Open bookings under suspended shops, therapists or venues, so none is forgotten. */
export function SuspensionImpactPanel({
  locale: l,
  orderHref,
}: {
  locale: Locale;
  orderHref: (bookingId: string) => string;
}) {
  const { data, error, reload } = useAdminData<Impact[]>('admin/suspension-impact', l);
  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <h2>{sq(l, 'impactTitle')}</h2>
        <span>{data?.reduce((n, x) => n + x.bookings.length, 0) ?? 0}</span>
      </div>
      <p className="muted">{sq(l, 'impactHelp')}</p>
      {error && (
        <p role="alert" className="error-message">
          {error}{' '}
          <button className="text-button" onClick={reload}>
            {sq(l, 'retry')}
          </button>
        </p>
      )}
      {data && !data.length && <p>{sq(l, 'impactNone')}</p>}
      {data?.map((x) => (
        <article className="admin-safety-item" key={`${x.targetType}:${x.targetId}`}>
          <div>
            <strong>{x.name[l]}</strong>
            <span className="admin-pill warning">{sq(l, x.targetType)}</span>
          </div>
          <ul>
            {x.bookings.map((b) => (
              <li key={b.id}>
                <Link href={orderHref(b.id)}>
                  {b.id.slice(-8)} · {dateTime(l, b.startAt)} · {statusText(l, b.status)}
                </Link>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
