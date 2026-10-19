import type { Address, SavedAddress } from '@hogulink/contracts';
import { restoreVisitAddress } from './visit-model';
export function bookingStage(status: string): number | null {
  return (
    (
      {
        REQUESTED: 0,
        ACCEPTED: 0,
        CONFIRMED: 1,
        EN_ROUTE: 2,
        ARRIVED: 2,
        IN_SERVICE: 2,
        AWAITING_COMPLETION: 2,
        COMPLETED: 3,
      } as Record<string, number>
    )[status] ?? null
  );
}
export const flowDraftPrefix = 'hogulink-checkout-v2:';
export const addressSelectionKey = 'hogulink-address-selection-v1';
export function addressFit(item: SavedAddress, area: string, hotelOnly: boolean) {
  return item.address.area !== area
    ? 'AREA'
    : hotelOnly && item.address.type !== 'HOTEL'
      ? 'HOTEL'
      : null;
}
export function applyAddress(item: SavedAddress, area: string, hotelOnly: boolean): Address | null {
  return addressFit(item, area, hotelOnly)
    ? null
    : { ...item.address, room: '', hotelPermission: false };
}
export function checkoutDraft(
  raw: string | null,
  owner: string,
  area: string,
  hotelOnly: boolean,
  now = Date.now(),
): Address | null {
  try {
    const d = JSON.parse(raw ?? 'null');
    if (
      !d ||
      d.owner !== owner ||
      !Number.isSafeInteger(d.expiresAt) ||
      d.expiresAt <= now ||
      d.expiresAt > now + 30 * 60000 ||
      !d.address
    )
      return null;
    const address = restoreVisitAddress(d.address, area, hotelOnly);
    if (hotelOnly && d.address.type === 'HOME') {
      address.detail = '';
      address.hotelName = '';
      address.room = '';
    }
    if (address.type === 'HOME') {
      address.hotelName = '';
      address.room = '';
    }
    return { ...address, hotelPermission: false };
  } catch {
    return null;
  }
}
export function packCheckoutDraft(owner: string, address: Address, now = Date.now()) {
  return JSON.stringify({ owner, expiresAt: now + 30 * 60000, address });
}
export function clearFlowDrafts(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>) {
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const k = storage.key(i);
      if (
        k &&
        (k.startsWith(flowDraftPrefix) ||
          k.startsWith('checkout:') ||
          k === 'checkout-edit-draft' ||
          k.startsWith('booking-key:') ||
          k === addressSelectionKey)
      )
        storage.removeItem(k);
    }
  } catch {}
}
export function readAddressSelection(raw: string | null, now = Date.now()): string | null {
  try {
    const v = JSON.parse(raw ?? 'null');
    return v &&
      typeof v.id === 'string' &&
      /^address_[a-f0-9-]{36}$/.test(v.id) &&
      Number.isSafeInteger(v.at) &&
      v.at <= now &&
      v.at > now - 30 * 60000
      ? v.id
      : null;
  } catch {
    return null;
  }
}
