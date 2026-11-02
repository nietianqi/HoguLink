import type { Localized } from './index.js';

export const discoveryTabs = ['recommended', 'questions', 'notes', 'updates', 'guides'] as const;
export type DiscoveryTab = (typeof discoveryTabs)[number];
/** Tabs from before the community; the shop list itself moved to `/shops`. */
export const legacyDiscoveryTabs: Record<string, DiscoveryTab> = {
  therapists: 'notes',
  safety: 'guides',
};
export const asDiscoveryTab = (value: unknown): DiscoveryTab =>
  discoveryTabs.includes(value as DiscoveryTab)
    ? (value as DiscoveryTab)
    : typeof value === 'string' && Object.hasOwn(legacyDiscoveryTabs, value)
      ? legacyDiscoveryTabs[value]
      : 'recommended';
export type DiscoveryStats = { views: number; likes: number; saves: number };

/** Customers ask; therapists write notes; shops post updates; the platform writes editorials. */
export type CommunityPostType = 'QUESTION' | 'NOTE' | 'UPDATE' | 'EDITORIAL';
export const communityTopics = [
  'FIRST_TIME',
  'HOME_VISIT',
  'IN_STORE',
  'HOTEL',
  'SERVICES',
  'SAFETY',
  'OTHER',
] as const;
export type CommunityTopic = (typeof communityTopics)[number];
export const shopUpdateTemplates = ['NEW_MENU', 'NEW_STAFF', 'OFFER', 'NOTICE', 'VENUE'] as const;
export type ShopUpdateTemplate = (typeof shopUpdateTemplates)[number];
/** Who may reply to a therapist's note. */
export const communityReplyPolicies = ['CUSTOMERS', 'SERVED', 'NONE'] as const;
export type CommunityReplyPolicy = (typeof communityReplyPolicies)[number];
export const communityReportReasons = [
  'CONTACT',
  'SEXUAL',
  'APPEARANCE',
  'HARASSMENT',
  'PRIVACY',
  'MEDICAL',
  'SPAM',
  'OTHER',
] as const;
export type CommunityReportReason = (typeof communityReportReasons)[number];
export const communityLimits = {
  titleMin: 6,
  titleMax: 60,
  bodyMin: 10,
  bodyMax: 1000,
  replyMin: 2,
  replyMax: 500,
  images: 3,
  /** Notes per therapist and updates per shop in any 7 days. */
  weeklyBusinessPosts: 3,
  dailyQuestions: 3,
  dailyReplies: 20,
  offerDays: 30,
  /** Distinct reporters that hide published content until a reviewer decides. */
  autoHideReports: 3,
} as const;
const contactPatterns = [
  {
    id: 'contact-app',
    pattern:
      /\bline\s*(id|@|account)|ライン\s*(id|交換|で)|微信|wechat|\bwx\s*号|kakao|telegram|whatsapp|インスタ|instagram|加我\s*(line|v|vx|q)/i,
  },
  { id: 'contact-email', pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { id: 'contact-url', pattern: /https?:\/\/|www\.|\b[\w-]+\.(com|jp|net|cn|io|me|co|org)\b/i },
];
/** Japanese phone numbers, without mistaking prices, budgets or dates for one. */
function phoneNumber(text: string) {
  return [...text.matchAll(/(?<!\d)(?:\+?81|0)[\d\s()（）-]{8,16}\d(?!\d)/g)].some((m) => {
    const digits = m[0].replace(/\D/g, '');
    return digits.startsWith('81')
      ? digits.length >= 11 && digits.length <= 12
      : digits.length >= 10 && digits.length <= 11;
  });
}
/**
 * Off-platform contact moves a visit outside the shop's booking, payment and safety rules.
 * The composer warns with these rules and the server refuses with the same ones.
 */
export function communityContactRules(text: string) {
  const value = text.normalize('NFKC').replace(/[​-‍﻿]/g, '');
  return [
    ...contactPatterns.filter((r) => r.pattern.test(value)).map((r) => r.id),
    ...(phoneNumber(value) ? ['contact-phone'] : []),
  ];
}
export type CommunityStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'HIDDEN' | 'WITHDRAWN';
export type CommunityLanguage = 'ja' | 'en' | 'zh';
export type CommunityAuthorKind = 'customer' | 'therapist' | 'shop' | 'editor';
export type CommunityMeta = {
  type: CommunityPostType;
  language: CommunityLanguage;
  topic: CommunityTopic;
  area?: string;
  answers: number;
  accepted: boolean;
  publishedAt: number;
  template?: ShopUpdateTemplate;
  expiresAt?: number;
  pinned?: boolean;
  /** A real menu of the posting shop; prices are read live, never written in a post. */
  offering?: { id: string; name: Localized; durationMinutes: number; storeSlug: string };
};

export type DiscoveryPost = {
  id: string;
  kind: 'therapist' | 'shop' | 'guide' | 'safety' | 'question' | 'note' | 'update' | 'editorial';
  title: Localized;
  summary: Localized;
  images: string[];
  portrait: boolean;
  sample: boolean;
  illustration: boolean;
  author: {
    id: string;
    name: Localized;
    kind: CommunityAuthorKind;
    slug?: string;
    photo?: string;
  };
  storeId?: string;
  onDuty?: boolean;
  stats: DiscoveryStats;
  community?: CommunityMeta;
};
export type DiscoveryFeed = { items: DiscoveryPost[]; nextCursor: string | null; total: number };
export type CommunityReply = {
  id: string;
  body: string;
  language: CommunityLanguage;
  author: { kind: CommunityAuthorKind; name: Localized; slug?: string; asker?: boolean };
  publishedAt: number;
  helpful: number;
  accepted: boolean;
};
export type CommunityThread = {
  /** Customer, therapist and shop posts keep the author's own language. */
  body: Localized;
  replies: CommunityReply[];
  /** Expired updates and notes with replies turned off take no new replies. */
  closed: boolean;
};
export type DiscoveryDetail = {
  post: DiscoveryPost;
  sections: { heading: Localized; text: Localized }[];
  related: DiscoveryPost[];
  community?: CommunityThread;
};
export type DiscoveryReaction = { liked: boolean; saved: boolean; version: number };
export type DiscoverySaved = { id: string; post: DiscoveryPost | null; state: DiscoveryReaction };

export type CommunityReplyBlock =
  'SIGN_IN' | 'ROLE' | 'VERIFY' | 'MUTED' | 'CLOSED' | 'REPLIES_OFF' | 'NOT_SERVED' | 'POSTING_OFF';
export type CommunityOwnItem = {
  id: string;
  kind: 'POST' | 'REPLY';
  type: CommunityPostType;
  postId: string;
  title: string;
  body: string;
  status: CommunityStatus;
  /** Shown to the author when a reviewer returns or hides the content. */
  reason?: string;
  createdAt: number;
  publishedAt?: number;
  expiresAt?: number;
  replies?: number;
  author?: Localized;
};
export type CommunityViewer = {
  canReply: boolean;
  block?: CommunityReplyBlock;
  author: boolean;
  /** Replies this customer marked helpful. */
  helpful: string[];
  /** The viewer's own replies still waiting for review or returned. */
  pending: CommunityOwnItem[];
};
export type CommunityQuestionSummary = {
  id: string;
  title: string;
  topic: CommunityTopic;
  area?: string;
  language: CommunityLanguage;
  publishedAt: number;
  answers: number;
  /** A shop, therapist or editor reply is already published. */
  answeredByBusiness: boolean;
};
export type CommunityWorkspace = {
  /** Therapists post only after their shop turns community posting on. */
  canPost: boolean;
  staffPosting?: boolean;
  replyPolicy?: CommunityReplyPolicy;
  weeklyRemaining: number;
  photos: { id: string; url: string }[];
  offerings?: { id: string; name: Localized; durationMinutes: number }[];
  posts: CommunityOwnItem[];
  staffPosts?: CommunityOwnItem[];
  questions: CommunityQuestionSummary[];
};
export type CommunityQueueItem = {
  id: string;
  kind: 'POST' | 'REPLY';
  type: CommunityPostType;
  postId: string;
  postTitle: string;
  title?: string;
  body: string;
  language: CommunityLanguage;
  status: CommunityStatus;
  version: number;
  /** Rule ids the automatic check marked for a closer look. */
  flags: string[];
  reports: { reason: CommunityReportReason; count: number }[];
  author: {
    role: 'CUSTOMER' | 'STAFF' | 'MERCHANT' | 'ADMIN';
    ownerId: string;
    label: Localized;
    storeName?: Localized;
    mutedUntil?: number;
  };
  template?: ShopUpdateTemplate;
  offering?: Localized;
  expiresAt?: number;
  images: string[];
  createdAt: number;
};
/** Active restrictions remain manageable after their review items are resolved. */
export type CommunityMute = {
  ownerId: string;
  until: number;
  reason: string;
  createdAt: number;
  author: Pick<CommunityQueueItem['author'], 'role' | 'label' | 'storeName'>;
};
export type CommunityEditorial = {
  id: string;
  title: Localized;
  status: CommunityStatus;
  pinned: boolean;
  topic: CommunityTopic;
  version: number;
  publishedAt?: number;
};
