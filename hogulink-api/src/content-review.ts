import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '@hogulink/contracts';
import type { Repository, Records } from './repository.js';
import { seal, unseal } from './secrets.js';
import { ensure } from './errors.js';
import { requireAdmin, inAdminTeam } from './admin-access.js';
const rules = [
  {
    id: 'sexual-service-en',
    pattern:
      /happy\s*ending|erotic|nuru|sexual\s*(service|massage)|hand\s*job|blow\s*job|sex\s*service/i,
  },
  {
    id: 'sexual-service-zh',
    pattern: /特殊服[务務]|全套|色情|性服[务務]|打[飞飛][机機]|口交|援交/,
  },
  { id: 'sexual-service-ja', pattern: /ヌキ|回春|性的サービス|本番行為|裏オプション|風俗サービス/ },
];
export const contentRuleIds = (text: string) => {
  const normalized = text.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '');
  return rules.filter((r) => r.pattern.test(normalized)).map((r) => r.id);
};
type Review = {
  id: string;
  bookingId: string;
  actorId: string;
  role: Actor['role'];
  status: 'PENDING' | 'REVIEWED';
  rules: string[];
  sealedText: string;
  createdAt: number;
  decision?: string;
  note?: string;
  reviewedAt?: number;
  reviewerId?: string;
};
export async function queueContentReview(
  tx: Records,
  actor: Actor,
  bookingId: string,
  text: string,
  ruleIds: string[],
  now: number,
) {
  const id = `content_${randomUUID()}`;
  await tx.put<Review>('contentReviews', {
    id,
    bookingId,
    actorId: actor.id,
    role: actor.role,
    status: 'PENDING',
    rules: ruleIds,
    sealedText: seal(text, id),
    createdAt: now,
  });
  await tx.put('audit', {
    id: `audit_${randomUUID()}`,
    actorId: actor.id,
    action: 'MESSAGE_CONTENT_REVIEW_QUEUED',
    bookingId,
    detail: id,
    at: now,
  });
}
export class ContentReviewService {
  constructor(
    private repo: Repository,
    private now = () => Date.now(),
  ) {}
  private access(actor: Actor) {
    requireAdmin(actor, 'safety.write');
    ensure(
      inAdminTeam(actor, 'TRUST_SAFETY'),
      'FORBIDDEN',
      'Safety review access is required.',
      403,
    );
  }
  async list(actor: Actor) {
    this.access(actor);
    return this.repo.read(async (tx) =>
      (
        await tx.find<Review>(
          'contentReviews',
          {},
          { limit: 100, orderBy: 'createdAt', descending: true },
        )
      ).map(({ sealedText: _text, note: _note, actorId: _actor, ...row }) => row),
    );
  }
  async detail(actor: Actor, id: string) {
    this.access(actor);
    return this.repo.transaction(async (tx) => {
      const row = await tx.get<Review>('contentReviews', id);
      ensure(row, 'NOT_FOUND', 'Review not found.', 404);
      await tx.put('audit', {
        id: `audit_${randomUUID()}`,
        actorId: actor.id,
        action: 'CONTENT_REVIEW_VIEWED',
        detail: id,
        at: this.now(),
      });
      const { sealedText, ...safe } = row;
      return { ...safe, text: unseal(sealedText, id).toString() };
    });
  }
  async review(actor: Actor, id: string, input: unknown) {
    this.access(actor);
    const d = z
      .object({
        decision: z.enum(['POLICY_CONFIRMED', 'FALSE_POSITIVE']),
        note: z.string().trim().min(10).max(500),
      })
      .strict()
      .parse(input);
    return this.repo.transaction(async (tx) => {
      const row = await tx.get<Review>('contentReviews', id);
      ensure(
        row?.status === 'PENDING',
        'INVALID_STATE',
        'This message has already been reviewed.',
        409,
      );
      await tx.put('contentReviews', {
        ...row,
        status: 'REVIEWED',
        ...d,
        reviewedAt: this.now(),
        reviewerId: actor.id,
      });
      await tx.put('audit', {
        id: `audit_${randomUUID()}`,
        actorId: actor.id,
        action: 'CONTENT_REVIEW_COMPLETED',
        detail: id,
        at: this.now(),
      });
      return { ok: true };
    });
  }
}
