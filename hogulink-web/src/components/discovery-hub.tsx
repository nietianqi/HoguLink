import type { DiscoveryFeed, Locale } from '@hogulink/contracts';
import { discoveryQuery } from '@/lib/discovery-feed-model';
import { xt } from '@/lib/discovery-i18n';
import { H5DiscoveryFeed } from './h5-discovery-feed';

/** One community feed at every width; the shop directory itself lives at `/shops`. */
export function DiscoveryHub({
  locale: l,
  q,
  feed,
}: {
  locale: Locale;
  q: Record<string, string>;
  feed: DiscoveryFeed | null;
}) {
  const query = discoveryQuery(q);
  return (
    <main id="main" className="wrap discovery-page h5-surface" data-tab={query.tab}>
      <H5DiscoveryFeed locale={l} initial={feed} q={query} />
      <header className="discovery-intro">
        <h1>{xt(l, 'title')}</h1>
        <p>{xt(l, 'intro')}</p>
      </header>
    </main>
  );
}
