import type { DiscoveryFeed, Locale } from '@hogulink/contracts';
import { discoveryQuery } from '@/lib/discovery-feed-model';
import { H5DiscoveryFeed } from './h5-discovery-feed';
export function DiscoveryHub({
  locale,
  q,
  feed,
}: {
  locale: Locale;
  q: Record<string, string>;
  feed: DiscoveryFeed | null;
}) {
  return (
    <main id="main" className="wrap discovery-page h5-surface">
      <H5DiscoveryFeed locale={locale} initial={feed} q={discoveryQuery(q)} />
    </main>
  );
}
