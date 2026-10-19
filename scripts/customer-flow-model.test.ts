import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address, SavedAddress } from '@hogulink/contracts';
import {
  addressFit,
  applyAddress,
  bookingStage,
  checkoutDraft,
  packCheckoutDraft,
  clearFlowDrafts,
  readAddressSelection,
  flowDraftPrefix,
} from '../hogulink-web/src/lib/customer-flow-model';
const saved: SavedAddress = {
  id: 'address_00000000-0000-4000-8000-000000000000',
  label: 'Hotel',
  address: {
    name: 'QA Guest',
    type: 'HOTEL',
    area: 'shinjuku',
    detail: 'QA street 123',
    hotelName: 'QA Hotel',
  },
  updatedAt: 1,
};
const visit: Address = { ...saved.address, room: '201', hotelPermission: true };
test('address compatibility does not silently change booked area or disguise a home as a hotel', () => {
  assert.equal(addressFit(saved, 'taito', false), 'AREA');
  assert.equal(
    addressFit({ ...saved, address: { ...saved.address, type: 'HOME' } }, 'shinjuku', true),
    'HOTEL',
  );
  assert.equal(applyAddress(saved, 'taito', false), null);
});
test('saved hotel selection copies static fields and always clears room and per-visit permission', () => {
  const next = applyAddress(saved, 'shinjuku', true)!;
  assert.equal(next.hotelName, 'QA Hotel');
  assert.equal(next.room, '');
  assert.equal(next.hotelPermission, false);
  assert.notEqual(next, saved.address);
});
test('checkout drafts are scoped to the verified owner and expire after thirty minutes', () => {
  const raw = packCheckoutDraft('owner', visit, 1000);
  assert(checkoutDraft(raw, 'owner', 'shinjuku', false, 1001));
  assert.equal(checkoutDraft(raw, 'other', 'shinjuku', false, 1001), null);
  assert.equal(checkoutDraft(raw, 'owner', 'shinjuku', false, 1801000), null);
  assert.equal(checkoutDraft('bad json', 'owner', 'shinjuku', false, 1001), null);
});
test('draft restoration keeps same-visit room but never restores consent, and area changes clear location data', () => {
  const raw = packCheckoutDraft('owner', visit, 1000),
    same = checkoutDraft(raw, 'owner', 'shinjuku', false, 1001)!,
    other = checkoutDraft(raw, 'owner', 'taito', false, 1001)!;
  assert.equal(same.room, '201');
  assert.equal(same.hotelPermission, false);
  assert.equal(other.detail, '');
  assert.equal(other.room, '');
  assert.equal(other.hotelName, '');
});
test('a home draft is not converted to a hotel address for a hotel-only therapist', () => {
  const raw = packCheckoutDraft('owner', { ...visit, type: 'HOME', hotelName: '', room: '' }, 1000),
    next = checkoutDraft(raw, 'owner', 'shinjuku', true, 1001)!;
  assert.equal(next.type, 'HOTEL');
  assert.equal(next.detail, '');
  assert.equal(next.hotelPermission, false);
});
test('logout cleanup removes new and legacy private checkout data but leaves unrelated preferences', () => {
  const map = new Map([
    ['unrelated', 'keep'],
    [`${flowDraftPrefix}owner:hold`, 'private'],
    ['checkout:legacy', 'private'],
    ['checkout-edit-draft', 'private'],
    ['booking-key:legacy', 'key'],
    ['hogulink-address-selection-v1', 'id'],
  ]);
  const storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  clearFlowDrafts(storage);
  assert.deepEqual([...map], [['unrelated', 'keep']]);
  assert.doesNotThrow(() =>
    clearFlowDrafts({
      get length() {
        throw Error('storage disabled');
      },
      key: () => null,
      removeItem: () => {},
    }),
  );
});
test('selected address reference is short-lived, contains no address text and rejects malformed IDs', () => {
  assert.equal(readAddressSelection(JSON.stringify({ id: saved.id, at: 1000 }), 1001), saved.id);
  assert.equal(readAddressSelection(JSON.stringify({ id: saved.id, at: 1000 }), 1801000), null);
  assert.equal(
    readAddressSelection(JSON.stringify({ id: 'some private text', at: 1000 }), 1001),
    null,
  );
  assert.equal(readAddressSelection(JSON.stringify({ id: saved.id, at: 1002 }), 1001), null);
});
test('order progress distinguishes live stages from cancellation and never paints a closed failure as completed', () => {
  assert.equal(bookingStage('REQUESTED'), 0);
  assert.equal(bookingStage('CONFIRMED'), 1);
  for (const s of ['EN_ROUTE', 'ARRIVED', 'IN_SERVICE']) assert.equal(bookingStage(s), 2);
  assert.equal(bookingStage('COMPLETED'), 3);
  for (const s of ['CANCELLED', 'EXPIRED', 'REJECTED', 'unknown'])
    assert.equal(bookingStage(s), null);
});
