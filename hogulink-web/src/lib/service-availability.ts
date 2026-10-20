import type { Listing } from '@hogulink/contracts';
import { api } from './api';

/** Recheck the exact service, area and language before advertising an instant provider. */
export async function instantServiceMembers<T extends Pick<Listing, 'id'>>(
  members: T[],
  offeringId: string,
  filters: { area?: string; language?: string },
): Promise<T[]> {
  const params = new URLSearchParams({
    offeringId,
    mode: 'INSTANT',
    area: filters.area ?? '',
    language: filters.language ?? '',
  });
  const checked = await Promise.all(
    members.map(async (member) => ({
      member,
      slots: (
        await api<{ slots: number[] }>(
          `public/staff-listings/${encodeURIComponent(member.id)}/availability?${params}`,
        )
      ).slots,
    })),
  );
  return checked.filter((x) => x.slots.length > 0).map((x) => x.member);
}
