import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  listingSupports,
  venueAvailable,
  type Actor,
  type Audit,
  type Listing,
  type Offering,
  type ServiceProposal,
  type ServiceProposalReview,
  type Store,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { requireAdmin, currentAdmin } from './admin-access.js';
import { ensure } from './errors.js';

const text = z.string().trim().min(2).max(80);
const proposalInput = z
  .object({
    name: z.object({ ja: text, en: text, 'zh-cn': text }).strict(),
    durationMinutes: z.number().int().min(30).max(240).multipleOf(15),
    fulfillmentMode: z.enum(['HOME_VISIT', 'IN_STORE']),
    price: z.number().int().min(1000).max(200000),
    transportFee: z.number().int().min(0).max(20000),
    listingIds: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict();

export class MerchantServiceCatalog {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private async shop(tx: Records, actor: Actor) {
    ensure(actor.role === 'MERCHANT' && actor.storeId, 'FORBIDDEN', 'Shop account required.', 403);
    const store = await tx.get<Store>('stores', actor.storeId);
    ensure(store?.active && store.approved, 'FORBIDDEN', 'Approved shop required.', 403);
    return store;
  }
  private async members(
    tx: Records,
    store: Store,
    data: Pick<ServiceProposal, 'listingIds' | 'fulfillmentMode'>,
  ) {
    ensure(
      data.fulfillmentMode !== 'IN_STORE' || venueAvailable(store),
      'VENUE_UNAVAILABLE',
      'An approved operating venue is required.',
      409,
    );
    const members: Listing[] = [];
    for (const id of new Set(data.listingIds)) {
      const member = await tx.get<Listing>('listings', id);
      ensure(
        member?.storeId === store.id &&
          member.membershipActive &&
          member.identityVerified &&
          member.portraitConsent &&
          member.publicationStatus === 'PUBLISHED_INDEXABLE' &&
          listingSupports(member, data.fulfillmentMode),
        'INVALID_SERVICE_TEAM',
        'Select eligible members of this shop and service mode.',
        409,
      );
      members.push(member);
    }
    return members;
  }
  async list(actor: Actor) {
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor);
      return (await tx.find<ServiceProposal>('serviceProposals', { storeId: store.id })).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    });
  }
  async submit(actor: Actor, input: unknown, key: string) {
    const data = proposalInput.parse(input);
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    ensure(
      data.fulfillmentMode !== 'IN_STORE' || data.transportFee === 0,
      'INVALID_TRANSPORT_FEE',
      'In-store services have no travel fee.',
    );
    return this.run(async (tx) => {
      const store = await this.shop(tx, actor);
      const id = `service_${createHash('sha256').update(`${store.id}:${key}`).digest('hex')}`;
      const normalized = { ...data, listingIds: [...new Set(data.listingIds)].sort() };
      const prior = await tx.get<ServiceProposal>('serviceProposals', id);
      if (prior) {
        const original = Object.fromEntries(
          Object.keys(normalized).map((k) => [k, prior[k as keyof ServiceProposal]]),
        );
        ensure(
          JSON.stringify(original) === JSON.stringify(normalized),
          'IDEMPOTENCY_CONFLICT',
          'Retry content changed.',
          409,
        );
        return prior;
      }
      await this.members(tx, store, normalized);
      ensure(
        (
          await tx.find<ServiceProposal>('serviceProposals', {
            storeId: store.id,
            status: 'PENDING',
          })
        ).length < 20,
        'SERVICE_QUEUE_FULL',
        'Resolve pending projects before submitting more.',
        409,
      );
      const proposal: ServiceProposal = {
        id,
        storeId: store.id,
        version: 1,
        status: 'PENDING',
        ...normalized,
        createdAt: this.now(),
      };
      await tx.put('serviceProposals', proposal);
      await tx.put<Audit>('audit', {
        id: randomUUID(),
        actorId: actor.id,
        actorRole: actor.role,
        action: 'SERVICE_SUBMITTED',
        detail: id,
        at: this.now(),
      });
      return proposal;
    });
  }
  async queue(actor: Actor): Promise<ServiceProposalReview[]> {
    return this.run(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.read');
      const items: ServiceProposalReview[] = [];
      for (const p of await tx.find<ServiceProposal>('serviceProposals', { status: 'PENDING' })) {
        const s = await tx.get<Store>('stores', p.storeId);
        if (!s) continue;
        const staffNames = [];
        for (const id of p.listingIds) {
          const x = await tx.get<Listing>('listings', id);
          if (x?.storeId === s.id) staffNames.push(x.name);
        }
        items.push({ ...p, storeName: s.name, staffNames });
      }
      return items.sort((a, b) => a.createdAt - b.createdAt);
    });
  }
  async review(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({
        version: z.number().int().positive(),
        approve: z.boolean(),
        feedback: z.string().trim().min(3).max(1000),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.write');
      const p = await tx.get<ServiceProposal>('serviceProposals', id);
      ensure(p, 'NOT_FOUND', 'Project not found.', 404);
      ensure(p.version === d.version, 'VERSION_CONFLICT', 'Project changed.', 409);
      ensure(p.status === 'PENDING', 'INVALID_STATE', 'Project already reviewed.', 409);
      if (d.approve) {
        const s = await tx.get<Store>('stores', p.storeId);
        ensure(s?.active && s.approved, 'FORBIDDEN', 'Shop unavailable.', 403);
        const members = await this.members(tx, s, p);
        const o: Offering = {
          id: p.id,
          storeId: p.storeId,
          name: p.name,
          durationMinutes: p.durationMinutes,
          fulfillmentMode: p.fulfillmentMode,
          price: p.price,
          transportFee: p.transportFee,
          approved: true,
          active: true,
          version: 1,
          regulatoryCategory: 'RELAXATION',
          priceSince: this.now(),
        };
        await tx.put('offerings', o);
        for (const x of members)
          await tx.put('listings', { ...x, offeringIds: [...new Set([...x.offeringIds, o.id])] });
        p.offeringId = o.id;
      }
      p.status = d.approve ? 'APPROVED' : 'REJECTED';
      p.version++;
      p.feedback = d.feedback;
      p.reviewedAt = this.now();
      await tx.put('serviceProposals', p);
      await tx.put<Audit>('audit', {
        id: randomUUID(),
        actorId: actor.id,
        actorRole: actor.role,
        action: d.approve ? 'SERVICE_APPROVED' : 'SERVICE_REJECTED',
        detail: id,
        at: this.now(),
      });
      return p;
    });
  }
}
