import type { Listing } from '@hogulink/contracts';

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
