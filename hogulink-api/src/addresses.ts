import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor, AddressBook, SavedAddress } from '@hogulink/contracts';
import type { Records } from './repository.js';
import { ensure } from './errors.js';

const versionInput = z.object({ version: z.number().int().nonnegative() }).strict();
const input = z
  .object({
    version: z.number().int().nonnegative(),
    label: z.string().trim().min(1).max(24),
    setDefault: z.boolean().default(false),
    address: z
      .object({
        name: z.string().trim().min(2).max(80),
        type: z.enum(['HOME', 'HOTEL']),
        area: z.enum(['shinjuku', 'shibuya', 'minato', 'chuo', 'taito']),
        detail: z.string().trim().min(5).max(250),
        hotelName: z.string().trim().max(100).default(''),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.address.type === 'HOTEL' && !v.address.hotelName)
      ctx.addIssue({
        code: 'custom',
        path: ['address', 'hotelName'],
        message: 'Enter the hotel name.',
      });
  });
type StoredBook = AddressBook & { id: string };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class AddressService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private customer(actor: Actor) {
    ensure(
      actor.role === 'CUSTOMER' && actor.verificationLevel >= 1,
      'FORBIDDEN',
      'Sign in with your customer account.',
      403,
    );
  }
  private async book(tx: Records, actor: Actor): Promise<StoredBook> {
    return (
      (await tx.get<StoredBook>('addressBooks', hash(actor.id))) ?? {
        id: hash(actor.id),
        version: 0,
        defaultId: null,
        items: [],
      }
    );
  }
  private view({ id: _id, ...book }: StoredBook): AddressBook {
    return book;
  }
  async list(actor: Actor) {
    this.customer(actor);
    return this.run(async (tx) => this.view(await this.book(tx, actor)));
  }
  async save(actor: Actor, addressId: string | undefined, raw: unknown, key = '') {
    this.customer(actor);
    const d = input.parse(raw);
    if (!addressId)
      ensure(
        key.length >= 8 && key.length <= 160,
        'IDEMPOTENCY_REQUIRED',
        'A retry key is required.',
      );
    return this.run(async (tx) => {
      const book = await this.book(tx, actor),
        idem = hash([actor.id, 'address', key]),
        fingerprint = hash(d);
      if (!addressId) {
        const prior = await tx.get<{ id: string; hash: string; addressId: string }>(
          'addressIdempotency',
          idem,
        );
        if (prior) {
          ensure(
            prior.hash === fingerprint,
            'IDEMPOTENCY_CONFLICT',
            'This key was used for another address.',
            409,
          );
          ensure(
            book.items.some((i) => i.id === prior.addressId),
            'ADDRESS_REMOVED',
            'This address was removed.',
            409,
          );
          return this.view(book);
        }
      }
      ensure(book.version === d.version, 'VERSION_CONFLICT', 'Refresh your address book.', 409);
      const existing = book.items.find((i) => i.id === addressId);
      ensure(!addressId || existing, 'NOT_FOUND', 'Address not found.', 404);
      ensure(
        existing || book.items.length < 10,
        'ADDRESS_LIMIT',
        'You can save up to ten addresses.',
        409,
      );
      const item: SavedAddress = {
        id: existing?.id ?? `address_${randomUUID()}`,
        label: d.label,
        address: { ...d.address, hotelName: d.address.type === 'HOME' ? '' : d.address.hotelName },
        updatedAt: this.now(),
      };
      book.items = existing
        ? book.items.map((i) => (i.id === item.id ? item : i))
        : [...book.items, item];
      if (d.setDefault || !book.defaultId) book.defaultId = item.id;
      book.version++;
      await tx.put('addressBooks', book);
      if (!addressId)
        await tx.put('addressIdempotency', { id: idem, hash: fingerprint, addressId: item.id });
      return this.view(book);
    });
  }
  async change(actor: Actor, addressId: string, raw: unknown, operation: 'REMOVE' | 'DEFAULT') {
    this.customer(actor);
    const d = versionInput.parse(raw);
    return this.run(async (tx) => {
      const book = await this.book(tx, actor);
      ensure(book.version === d.version, 'VERSION_CONFLICT', 'Refresh your address book.', 409);
      ensure(
        book.items.some((i) => i.id === addressId),
        'NOT_FOUND',
        'Address not found.',
        404,
      );
      if (operation === 'REMOVE') {
        book.items = book.items.filter((i) => i.id !== addressId);
        if (book.defaultId === addressId) book.defaultId = book.items[0]?.id ?? null;
      } else book.defaultId = addressId;
      book.version++;
      await tx.put('addressBooks', book);
      return this.view(book);
    });
  }
}
