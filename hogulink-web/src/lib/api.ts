import type { Listing, Offering, Store, Quote } from '@hogulink/contracts';
import { clearFlowDrafts } from './customer-flow-model';
export type PublicStore = import('@hogulink/contracts').PublicStore;
export type BookingRules = {
  nominationFee: number;
  cancellationPolicy: Quote['cancellationPolicy'];
};
export function bookingRulesFor(store: Pick<PublicStore, 'bookingRules'>, fallback?: BookingRules) {
  return store.bookingRules ?? fallback;
}
export function nominationFeeFor(
  store: Pick<PublicStore, 'bookingRules'>,
  fallback?: BookingRules,
) {
  return bookingRulesFor(store, fallback)?.nominationFee ?? 500;
}
export type Catalog = {
  listings: Listing[];
  stores: PublicStore[];
  offerings: Offering[];
  demo: boolean;
  bookingRules?: BookingRules;
};
export async function serverApi<T>(path: string): Promise<T> {
  const response = await fetch(
    `${process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'}/v1/${path}`,
    { cache: 'no-store', signal: AbortSignal.timeout(8000) },
  );
  if (!response.ok)
    throw new Error('HoguLink API is not available. Start both workspace services.');
  return response.json();
}
export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
let sessionEpoch = 0;
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
  key?: string,
): Promise<T> {
  const epoch = sessionEpoch;
  const response = await fetch(`/v1/${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (
    response.status === 401 &&
    epoch === sessionEpoch &&
    typeof window !== 'undefined' &&
    (path === 'auth/session' || !path.startsWith('auth/'))
  ) {
    try {
      clearFlowDrafts(window.sessionStorage);
    } catch {}
    window.dispatchEvent(new Event('hogulink-session-invalid'));
  }
  if (!response.ok)
    throw new ClientError(data.error?.code ?? 'error', data.error?.message ?? 'Request failed');
  if (
    typeof window !== 'undefined' &&
    path.startsWith('auth/') &&
    path !== 'auth/session' &&
    (data?.role || path === 'auth/logout')
  ) {
    sessionEpoch++;
    try {
      clearFlowDrafts(window.sessionStorage);
    } catch {}
    window.dispatchEvent(new Event('hogulink-session-changed'));
  }
  return data;
}
