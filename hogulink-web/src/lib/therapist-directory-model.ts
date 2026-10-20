import type { Locale, MobileTherapist } from '@hogulink/contracts';

// URLs are shareable filters, never checkout state or a partially loaded page.
const wards = ['shinjuku', 'shibuya', 'minato', 'chuo', 'taito'];
export function directoryQuery(raw: Record<string, unknown>): Record<string, string> {
  // Distance sorting needs the device-computed nearest ward; never raw coordinates.
  const near = typeof raw.near === 'string' && wards.includes(raw.near) ? raw.near : '';
  const sort =
    typeof raw.sort === 'string' &&
    ['price', 'earliest', 'rating', ...(near ? ['distance'] : [])].includes(raw.sort)
      ? raw.sort
      : 'recommended';
  return {
    mode: raw.mode === 'INSTANT' ? 'INSTANT' : 'SCHEDULED',
    duration:
      typeof raw.duration === 'string' && ['60', '90', '120'].includes(raw.duration)
        ? raw.duration
        : '60',
    sort,
    ...(sort === 'distance' ? { near } : {}),
    ...(typeof raw.area === 'string' && wards.includes(raw.area) ? { area: raw.area } : {}),
    ...(typeof raw.language === 'string' && ['ja', 'en', 'zh'].includes(raw.language)
      ? { language: raw.language }
      : {}),
    ...(typeof raw.search === 'string' && raw.search.trim()
      ? { search: raw.search.normalize('NFKC').trim().slice(0, 80) }
      : {}),
    ...(raw.travel === 'free' ? { travel: 'free' } : {}),
  };
}

export function directoryHref(locale: Locale, q: Record<string, string>) {
  return `/${locale}/therapists?${new URLSearchParams(directoryQuery(q))}`;
}

export function therapistSelection(q: Record<string, string>, item: MobileTherapist) {
  return new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(directoryQuery(q)).filter(([k]) => ['area', 'language', 'mode'].includes(k)),
    ),
    nomination: 'NOMINATED',
    offering: item.offering.id,
    ...(item.earliestAt ? { start: String(item.earliestAt) } : {}),
  });
}

export function directoryTime(locale: Locale, at: number, checkedAt: number, today: string) {
  const day = (value: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  const code = locale === 'zh-cn' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-GB';
  const time = new Intl.DateTimeFormat(code, {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return day(at) === day(checkedAt)
    ? `${today} ${time}`
    : `${new Intl.DateTimeFormat(code, { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(at)} ${time}`;
}
