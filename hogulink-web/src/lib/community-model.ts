import { communityContactRules, communityLimits as limits } from '@hogulink/contracts/discovery';
import type {
  CommunityLanguage,
  CommunityReplyBlock,
  DiscoveryPost,
  Locale,
  ShopUpdateTemplate,
} from '@hogulink/contracts';
import { cmHas, type CommunityText } from './community-i18n';
import { japanDay } from './desktop-model';

export const communityLanguage = (l: Locale): CommunityLanguage => (l === 'zh-cn' ? 'zh' : l);
export const languageLocale = (value: CommunityLanguage): Locale =>
  value === 'zh' ? 'zh-cn' : value;
export type DraftProblem = 'title' | 'body' | 'contact';
/** Mirrors the server's length and contact checks so people fix a draft before sending it. */
export function draftProblems(
  draft: { title?: string; body: string },
  kind: 'post' | 'reply' = 'post',
): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const body = draft.body.trim(),
    title = draft.title?.trim() ?? '';
  if (kind === 'post' && (title.length < limits.titleMin || title.length > limits.titleMax))
    problems.push('title');
  const [min, max] =
    kind === 'post' ? [limits.bodyMin, limits.bodyMax] : [limits.replyMin, limits.replyMax];
  if (body.length < min || body.length > max) problems.push('body');
  if (communityContactRules(`${title}\n${body}`).length) problems.push('contact');
  return problems;
}
export const templateNeeds = (template: ShopUpdateTemplate) => ({
  offering: template === 'NEW_MENU' || template === 'OFFER',
  expiry: template === 'OFFER' || template === 'NOTICE',
});
/**
 * JST dates whose 23:59 expiry is still in the future and within the server's 30-day limit.
 */
export function expiryBounds(now: number) {
  const today = japanDay(now);
  const last = japanDay(now + limits.offerDays * 86_400_000);
  return {
    min: expiryAt(today) > now ? today : japanDay(now + 86_400_000),
    max:
      expiryAt(last) <= now + limits.offerDays * 86_400_000
        ? last
        : japanDay(now + (limits.offerDays - 1) * 86_400_000),
  };
}
/** The end of the chosen JST day, as the server expects a timestamp. */
export const expiryAt = (date: string) => Date.parse(`${date}T23:59:00+09:00`);
export const blockText = (block: CommunityReplyBlock | undefined): CommunityText =>
  block ? (`block_${block}` as CommunityText) : 'closed';
export const errorText = (code: string | undefined): CommunityText =>
  code && cmHas(code) ? code : 'failed';
/** Business posts are labelled as the business's own words. */
export function badgeText(post: Pick<DiscoveryPost, 'kind' | 'author'>): CommunityText {
  if (post.kind === 'update') return 'shopPost';
  if (post.kind === 'note') return 'staffPost';
  return post.author.kind;
}
export function communityHref(
  l: Locale,
  post: Pick<DiscoveryPost, 'kind' | 'author' | 'community'>,
  carry: URLSearchParams,
) {
  const offering = post.community?.offering;
  if (offering) {
    const query = new URLSearchParams(carry);
    query.set('offering', offering.id);
    return { href: `/${l}/shops/${offering.storeSlug}?${query}`, label: 'viewOffering' as const };
  }
  if (post.author.kind === 'shop' && post.author.slug)
    return { href: `/${l}/shops/${post.author.slug}?${carry}`, label: 'bookShop' as const };
  if (post.author.kind === 'therapist' && post.author.slug)
    return {
      href: `/${l}/therapists/${post.author.slug}?${carry}`,
      label: 'bookTherapist' as const,
    };
  return { href: `/${l}/therapists?${carry}`, label: 'browse' as const };
}
