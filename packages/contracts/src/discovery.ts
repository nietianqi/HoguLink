import type { Localized } from './index.js';

export const discoveryTabs = ['recommended', 'shops', 'guides', 'therapists', 'safety'] as const;
export type DiscoveryTab = (typeof discoveryTabs)[number];
export type DiscoveryStats = { views: number; likes: number; saves: number };
export type DiscoveryPost = {
  id: string;
  kind: 'therapist' | 'shop' | 'guide' | 'safety';
  title: Localized;
  summary: Localized;
  images: string[];
  portrait: boolean;
  sample: boolean;
  illustration: boolean;
  author: {
    id: string;
    name: Localized;
    kind: 'therapist' | 'shop' | 'editor';
    slug?: string;
    photo?: string;
  };
  storeId?: string;
  onDuty?: boolean;
  stats: DiscoveryStats;
};
export type DiscoveryFeed = { items: DiscoveryPost[]; nextCursor: string | null; total: number };
export type DiscoveryDetail = {
  post: DiscoveryPost;
  sections: { heading: Localized; text: Localized }[];
  related: DiscoveryPost[];
};
export type DiscoveryReaction = { liked: boolean; saved: boolean; version: number };
export type DiscoverySaved = { id: string; post: DiscoveryPost | null; state: DiscoveryReaction };
