import type { Address, Listing, Offering } from '@hogulink/contracts';
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
export function visitTotal(offering: Offering, nomination: string, fee: number) {
  return {
    serviceFee: offering.price,
    transportFee: offering.transportFee,
    nominationFee: nomination === 'FREE' ? 0 : fee,
    total: offering.price + offering.transportFee + (nomination === 'FREE' ? 0 : fee),
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
