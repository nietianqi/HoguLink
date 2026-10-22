import { effectiveServicePrice } from '@hogulink/contracts';
import type { Address, Listing, Offering } from '@hogulink/contracts';

/** Carry browsing preferences between providers, never a hold, payment or old timeslot. */
export function visitPreferences(raw: Record<string, unknown>): Record<string, string> {
  return {
    ...(typeof raw.area === 'string' && raw.area ? { area: raw.area } : {}),
    ...(typeof raw.language === 'string' && raw.language ? { language: raw.language } : {}),
    ...(raw.mode === 'INSTANT' || raw.mode === 'SCHEDULED' ? { mode: raw.mode } : {}),
  };
}

/** Returning to the same provider may keep a selection, never checkout credentials. */
export function visitSelection(raw: Record<string, unknown>): Record<string, string> {
  return {
    ...visitPreferences(raw),
    ...(typeof raw.offering === 'string' && raw.offering.length > 0 && raw.offering.length <= 120
      ? { offering: raw.offering }
      : {}),
    ...(raw.nomination === 'FREE' || raw.nomination === 'NOMINATED'
      ? { nomination: raw.nomination }
      : {}),
    ...(typeof raw.start === 'string' && /^\d{1,15}$/.test(raw.start) && Number(raw.start) > 0
      ? { start: raw.start }
      : {}),
  };
}

export function visitServices(
  offerings: Offering[],
  listing: Listing,
  team: Listing[],
  nomination: string,
) {
  const members =
    nomination === 'FREE' ? team.filter((x) => x.storeId === listing.storeId) : [listing];
  return offerings
    .filter(
      (o) =>
        o.approved &&
        o.regulatoryCategory === 'RELAXATION' &&
        o.storeId === listing.storeId &&
        members.some((x) => x.offeringIds.includes(o.id)),
    )
    .sort((a, b) => a.durationMinutes - b.durationMinutes || a.price - b.price);
}
export function visitTeam(
  team: Listing[],
  listing: Listing,
  offeringId: string,
  nomination: string,
  language = '',
  mode = 'SCHEDULED',
) {
  return (nomination === 'FREE' ? team : [listing]).filter(
    (x) =>
      x.storeId === listing.storeId &&
      x.offeringIds.includes(offeringId) &&
      (!language || x.languages.includes(language)) &&
      (mode !== 'INSTANT' || x.onDuty),
  );
}
export function visitTotal(offering: Offering, nomination: string, fee: number, now = Date.now()) {
  const priced = effectiveServicePrice(offering, now);
  const nominationFee = nomination === 'FREE' ? 0 : fee;
  return {
    serviceFee: priced.price,
    transportFee: offering.transportFee,
    nominationFee,
    total: priced.price + offering.transportFee + nominationFee,
    /** Regular total, only when a fair struck-through comparison is allowed. */
    compareTotal:
      priced.comparePrice === undefined
        ? undefined
        : priced.comparePrice + offering.transportFee + nominationFee,
    promotionEndsAt: priced.promotion?.endsAt,
  };
}
export function restoreVisitAddress(value: unknown, area: string, hotelOnly: boolean): Address {
  const saved =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const text = (key: string, max: number) =>
    typeof saved[key] === 'string' ? (saved[key] as string).slice(0, max) : '';
  const sameArea = saved.area === area;
  const type = hotelOnly || saved.type !== 'HOME' ? 'HOTEL' : 'HOME';
  return {
    name: text('name', 80),
    area,
    type,
    detail: sameArea ? text('detail', 250) : '',
    hotelName: sameArea ? text('hotelName', 100) : '',
    room: sameArea ? text('room', 30) : '',
    hotelPermission:
      sameArea && type === 'HOTEL' && saved.type === 'HOTEL' && saved.hotelPermission === true,
  };
}
