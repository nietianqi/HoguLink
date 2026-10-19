import { createHash } from 'node:crypto';
import type { Repository } from './repository.js';
import { ensure } from './errors.js';
export class RateLimiter {
  constructor(
    private repo: Repository,
    private now = () => Date.now(),
  ) {}
  async check(scope: string, key: string, limit: number, windowMs = 60000) {
    const id = createHash('sha256').update(`${scope}:${key}`).digest('hex');
    const allowed = await this.repo.transaction(async (tx) => {
      const previous = await tx.get<{ id: string; count: number; resetAt: number }>(
        'rateLimits',
        id,
      );
      const row =
        previous && previous.resetAt > this.now()
          ? previous
          : { id, count: 0, resetAt: this.now() + windowMs };
      row.count++;
      await tx.put('rateLimits', row);
      return row.count <= limit;
    });
    ensure(allowed, 'RATE_LIMITED', 'Too many requests. Please try again later.', 429);
  }
  async prune() {
    await this.repo.transaction(async (tx) => {
      for (const row of await tx.find<{ id: string }>(
        'rateLimits',
        { resetAt: { lte: this.now() } },
        { limit: 1000 },
      ))
        await tx.remove('rateLimits', row.id);
    });
  }
}
