import type { Listing, Offering } from '@hogulink/contracts';

// These original photos belong only to the stock demo profiles. Uploaded or
// production portraits always remain the provider's own consented asset.
const demoPortraits: Record<string, string> = {
  aoi: 'woman',
  ren: 'man',
  mio: 'mio',
  haru: 'haru',
  yuki: 'yuki',
  saki: 'saki',
};
export function h5Portrait(listing: Pick<Listing, 'slug' | 'photo'>, demo: boolean): string {
  const stock = Object.keys(demoPortraits).find(
    (key) => listing.slug === `${key}-tokyo` && listing.photo === `/portraits/${key}.svg`,
  );
  return demo && stock ? `/images/h5-therapist-${demoPortraits[stock]}.png` : listing.photo;
}

export function h5ServiceImage(offering: Pick<Offering, 'id' | 'durationMinutes'>, demo: boolean) {
  if (demo) {
    if (offering.id === 'store-mori-leg-60') return '/images/h5-service-120.png';
    if (offering.id === 'store-mori-shoulder-60') return '/images/h5-service-90.png';
    if (offering.id === 'store-mori-fullbody-90') return '/images/h5-treatment.png';
    if (offering.id === 'store-sora-back-90') return '/images/h5-treatment.png';
  }
  return offering.durationMinutes === 120
    ? '/images/h5-service-120.png'
    : offering.durationMinutes === 90
      ? '/images/h5-service-90.png'
      : '/images/h5-treatment.png';
}
