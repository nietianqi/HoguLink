import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import sharp from 'sharp';
import { saveEvidence, loadEvidence } from './evidence-storage.js';
import { enqueueEmail, invitationEmail } from './notifications.js';
import type {
  Actor,
  ApplicationHistory,
  ApplicationReviewItem,
  EvidenceInfo,
  Listing,
  Localized,
  Offering,
  PartnerApplication,
  PartnerDraft,
  PartnerInvitation,
  PartnerSnapshot,
  PortraitConsent,
  Store,
  Booking,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { ensure } from './errors.js';
import { currentAdmin, requireAdmin } from './admin-access.js';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const uid = (p: string) => `${p}_${randomUUID()}`;
const DAY = 86400000;
export const CONSENT_TERMS = 'portrait-2026-10-v1';
export const PARTNER_TERMS = 'partner-2026-10-v1';
type Account = {
  id: string;
  role: 'MERCHANT' | 'STAFF';
  email: string;
  name: string;
  salt: string;
  passwordHash: string;
  storeId?: string;
  staffId?: string;
  createdAt: number;
};
type Invitation = PartnerInvitation & { tokenHash: string };
type Evidence = EvidenceInfo & { ownerId: string; data?: string; storageKey?: string };
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).max(128);
const localized = z
  .object({
    ja: z.string().trim().min(1).max(80),
    en: z.string().trim().min(1).max(80),
    'zh-cn': z.string().trim().min(1).max(80),
  })
  .strict();
const draftSchema = z
  .object({
    legalName: z.string().trim().max(120),
    displayName: localized,
    description: z
      .object({
        ja: z.string().trim().max(800),
        en: z.string().trim().max(800),
        'zh-cn': z.string().trim().max(800),
      })
      .strict(),
    contact: z.string().trim().max(150),
    legalAddress: z.string().trim().max(300),
    emergencyContact: z.string().trim().max(150),
    businessType: z.enum(['COMPANY', 'SOLE_PROPRIETOR']),
    category: z.enum(['RELAXATION', 'LICENSED']),
    serviceScope: z.string().trim().max(1000),
    areas: z
      .array(z.enum(['shinjuku', 'shibuya', 'minato', 'chuo', 'taito']))
      .min(1)
      .max(5),
    languages: z
      .array(z.enum(['ja', 'en', 'zh']))
      .min(1)
      .max(3),
    evidenceIds: z.array(z.string().max(100)).max(8),
    portraitId: z.string().max(100),
    offeringIds: z.array(z.string().max(100)).max(30),
    serviceName: localized,
    durationMinutes: z.number().int().min(30).max(180),
    price: z.number().int().min(1000).max(100000),
    transportFee: z.number().int().min(0).max(30000),
    termsAccepted: z.boolean(),
    antisocialDeclaration: z.boolean(),
  })
  .strict();
const secret = (pass: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(pass, salt, 64, (e, key) => (e ? reject(e) : resolve(key))),
  );
const publicInvite = ({ tokenHash: _t, ...i }: Invitation): PartnerInvitation => i;
const evidenceInfo = ({ ownerId: _o, data: _d, storageKey: _s, ...e }: Evidence): EvidenceInfo => e;
const tr = (v: string): Localized => ({ ja: v, en: v, 'zh-cn': v });
const blank = (name: string, contact: string): PartnerDraft => ({
  legalName: '',
  displayName: tr(name),
  description: tr(''),
  contact,
  legalAddress: '',
  emergencyContact: '',
  businessType: 'SOLE_PROPRIETOR',
  category: 'RELAXATION',
  serviceScope: '',
  areas: ['shinjuku'],
  languages: ['ja'],
  evidenceIds: [],
  portraitId: '',
  offeringIds: [],
  serviceName: tr('Relaxation'),
  durationMinutes: 60,
  price: 7200,
  transportFee: 0,
  termsAccepted: false,
  antisocialDeclaration: false,
});
export function profileHash(d: PartnerDraft) {
  return hash(
    JSON.stringify({
      displayName: d.displayName,
      description: d.description,
      portraitId: d.portraitId,
      languages: d.languages,
      offeringIds: d.offeringIds,
    }),
  );
}
export async function requireCurrentQualifications(
  tx: Records,
  storeId: string,
  listingId: string | null | undefined,
  now: number,
) {
  for (const id of [storeId, listingId].filter((id): id is string => !!id)) {
    const a = await tx.get<PartnerApplication>('partnerApplications', id);
    ensure(
      !a || (a.status === 'APPROVED' && !!a.validUntil && a.validUntil > now),
      'QUALIFICATION_UNAVAILABLE',
      'Current qualifications are required. The shop must arrange a replacement or cancellation.',
      409,
    );
  }
}
function consentValid(c: PortraitConsent | undefined, contentHash: string, now: number) {
  return (
    !!c &&
    c.status === 'GRANTED' &&
    c.contentHash === contentHash &&
    c.termsVersion === CONSENT_TERMS &&
    c.startsAt <= now &&
    c.endsAt > now
  );
}
async function recordConsent(
  tx: Records,
  c: PortraitConsent,
  actorId: string,
  action: string,
  now: number,
) {
  await tx.put('portraitConsents', c);
  await tx.put('portraitConsentHistory', {
    ...c,
    id: uid('consent_event'),
    consentId: c.id,
    actorId,
    action,
    at: now,
  });
}
async function event(
  tx: Records,
  actor: Actor,
  a: PartnerApplication,
  action: string,
  now: number,
  feedback?: string,
) {
  const entry: ApplicationHistory = {
    id: uid('application_event'),
    applicationId: a.id,
    action,
    revision: a.revision,
    at: now,
    actorId: actor.id,
    ...(feedback ? { feedback } : {}),
  };
  await tx.put('applicationHistory', entry);
  await tx.put('audit', { id: uid('audit'), actorId: actor.id, action, detail: a.id, at: now });
  await tx.put('outbox', {
    id: uid('outbox'),
    type: action,
    target: a.id,
    createdAt: now,
    status: 'PENDING',
    delivery: 'DEMO_LOCAL_ONLY',
  });
}
async function suppress(tx: Records, a: PartnerApplication) {
  if (a.type === 'MERCHANT') {
    const s = await tx.get<Store>('stores', a.storeId);
    if (s)
      await tx.put('stores', {
        ...s,
        active: false,
        approved: false,
        ruleVersion: s.ruleVersion + 1,
        moderationVersion: (s.moderationVersion ?? 1) + 1,
      });
  } else {
    const l = await tx.get<Listing>('listings', a.listingId!);
    if (l)
      await tx.put('listings', {
        ...l,
        identityVerified: false,
        publicationStatus: 'SUSPENDED',
        onDuty: false,
        moderationVersion: (l.moderationVersion ?? 1) + 1,
      });
  }
}
// Runs inside the same transaction as discovery, quoting and hold/booking creation.
export async function sweepOnboarding(tx: Records, now: number) {
  const apps = await tx.list<PartnerApplication>('partnerApplications');
  const system: Actor = { id: 'system', role: 'ADMIN', verificationLevel: 3 };
  for (const a of apps)
    if (a.status === 'APPROVED' && (!a.validUntil || a.validUntil <= now)) {
      a.status = 'EXPIRED';
      a.version++;
      a.updatedAt = now;
      await tx.put('partnerApplications', a);
      await suppress(tx, a);
      await event(tx, system, a, 'QUALIFICATION_EXPIRED', now);
    }
  for (const c of await tx.list<PortraitConsent>('portraitConsents'))
    if (c.status === 'GRANTED') {
      const a = apps.find((v) => v.listingId === c.listingId);
      if (c.endsAt <= now || (a && c.contentHash !== a.contentHash)) {
        await recordConsent(
          tx,
          { ...c, status: 'EXPIRED', version: c.version + 1 },
          'system',
          'EXPIRED',
          now,
        );
        const l = await tx.get<Listing>('listings', c.listingId);
        if (l)
          await tx.put('listings', {
            ...l,
            portraitConsent: false,
            publicationStatus: 'SUSPENDED',
            onDuty: false,
            moderationVersion: (l.moderationVersion ?? 1) + 1,
          });
        await tx.put('audit', {
          id: uid('audit'),
          actorId: 'system',
          action: 'PORTRAIT_CONSENT_EXPIRED',
          detail: c.id,
          at: now,
        });
      }
    }
  for (const i of await tx.list<Invitation>('partnerInvitations'))
    if (i.status === 'PENDING' && i.expiresAt <= now)
      await tx.put('partnerInvitations', { ...i, status: 'EXPIRED', version: i.version + 1 });
}

export class OnboardingService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  async register(input: unknown) {
    const d = z
      .object({
        role: z.enum(['MERCHANT', 'STAFF']),
        email,
        password,
        name: z.string().trim().min(2).max(80),
      })
      .strict()
      .parse(input);
    const salt = randomBytes(16).toString('hex'),
      passwordHash = (await secret(d.password, salt)).toString('hex');
    return this.run(async (tx) => {
      ensure(
        !(await tx.list<Account>('partnerAccounts')).some(
          (a) => a.email === d.email && a.role === d.role,
        ),
        'ACCOUNT_EXISTS',
        'An account with this email already exists.',
        409,
      );
      const account: Account = {
        id: uid('partner'),
        role: d.role,
        email: d.email,
        name: d.name,
        salt,
        passwordHash,
        createdAt: this.now(),
        ...(d.role === 'STAFF' ? { staffId: uid('staff') } : { storeId: uid('store') }),
      };
      await tx.put('partnerAccounts', account);
      if (account.role === 'MERCHANT') {
        const store: Store = {
          id: account.storeId!,
          merchantId: account.id,
          slug: `shop-${account.storeId!.slice(-12)}`,
          name: tr(account.name),
          legalName: '',
          legalAddress: '',
          contact: '',
          emergencyContact: '',
          acceptanceMode: 'MANUAL',
          active: false,
          approved: false,
          pspAccount: '',
          areas: [],
          plan: 'TRIAL',
          ruleVersion: 1,
          moderationVersion: 1,
        };
        await tx.put('stores', store);
        const draft = blank(account.name, account.email);
        const a: PartnerApplication = {
          id: store.id,
          type: 'MERCHANT',
          ownerId: account.id,
          storeId: store.id,
          status: 'DRAFT',
          version: 1,
          revision: 1,
          draft,
          contentHash: profileHash(draft),
          createdAt: this.now(),
          updatedAt: this.now(),
        };
        await tx.put('partnerApplications', a);
        await event(tx, this.accountActor(account), a, 'APPLICATION_CREATED', this.now());
      }
      return this.accountActor(account);
    });
  }
  async login(input: unknown) {
    const d = z
      .object({ role: z.enum(['MERCHANT', 'STAFF']), email, password })
      .strict()
      .parse(input);
    const a = await this.run(async (tx) =>
      (await tx.list<Account>('partnerAccounts')).find(
        (x) => x.role === d.role && x.email === d.email,
      ),
    );
    const candidate = await secret(d.password, a?.salt ?? 'missing-account-fixed-salt');
    ensure(
      a && timingSafeEqual(candidate, Buffer.from(a.passwordHash, 'hex')),
      'INVALID_CREDENTIALS',
      'Check your email and password.',
      401,
    );
    return this.accountActor(a);
  }
  private accountActor(a: Account): Actor {
    return {
      id: a.id,
      partnerAccountId: a.id,
      role: a.role,
      staffId: a.staffId,
      storeId: a.storeId,
      displayName: a.name,
      verificationLevel: 1,
    };
  }
  async resolveActor(actor: Actor) {
    return this.run(async (tx) => {
      const a = await tx.get<Account>('partnerAccounts', actor.partnerAccountId!);
      ensure(
        a && a.id === actor.id && a.role === actor.role,
        'UNAUTHENTICATED',
        'This account is unavailable.',
        401,
      );
      const resolved = this.accountActor(a);
      if (a.role === 'STAFF')
        resolved.onboardingOnly = !(await tx.list<Listing>('listings')).some(
          (l) => l.storeId === a.storeId && l.staffId === a.staffId && l.membershipActive,
        );
      return resolved;
    });
  }
  private async own(tx: Records, actor: Actor) {
    ensure(
      ['MERCHANT', 'STAFF'].includes(actor.role),
      'FORBIDDEN',
      'A partner account is required.',
      403,
    );
    const a = (await tx.list<PartnerApplication>('partnerApplications')).find(
      (v) => v.ownerId === actor.id && v.type === actor.role && v.storeId === actor.storeId,
    );
    ensure(a, 'NOT_FOUND', 'Accept a shop invitation before completing your application.', 404);
    return a;
  }
  private async shop(tx: Records, actor: Actor) {
    ensure(
      actor.role === 'MERCHANT' && actor.storeId,
      'FORBIDDEN',
      'A shop account is required.',
      403,
    );
    const s = await tx.get<Store>('stores', actor.storeId);
    ensure(s, 'NOT_FOUND', 'Shop not found.', 404);
    return s;
  }
  async snapshot(actor: Actor): Promise<PartnerSnapshot> {
    return this.run(async (tx) => {
      ensure(
        ['MERCHANT', 'STAFF'].includes(actor.role),
        'FORBIDDEN',
        'A partner account is required.',
        403,
      );
      const application = (await tx.list<PartnerApplication>('partnerApplications')).find(
        (a) => a.ownerId === actor.id && a.type === actor.role && a.storeId === actor.storeId,
      );
      const listings = (await tx.list<Listing>('listings')).filter(
        (l) =>
          l.storeId === actor.storeId && (actor.role === 'MERCHANT' || l.staffId === actor.staffId),
      );
      const apps = await tx.list<PartnerApplication>('partnerApplications'),
        consents = await tx.list<PortraitConsent>('portraitConsents'),
        bookings = actor.storeId
          ? await tx.find<Booking>('bookings', { storeId: actor.storeId })
          : [];
      return {
        application,
        legacy: !application && !!actor.storeId,
        consentTermsVersion: CONSENT_TERMS,
        consent:
          actor.role === 'STAFF'
            ? consents.find((c) => listings.some((l) => l.id === c.listingId))
            : undefined,
        evidence: (await tx.list<Evidence>('partnerEvidence'))
          .filter((e) => e.ownerId === actor.id)
          .map(evidenceInfo),
        history: application
          ? (await tx.list<ApplicationHistory>('applicationHistory'))
              .filter((h) => h.applicationId === application.id)
              .sort((a, b) => b.at - a.at)
              .slice(0, 50)
          : [],
        invitations:
          actor.role === 'MERCHANT'
            ? (await tx.list<Invitation>('partnerInvitations'))
                .filter((i) => i.storeId === actor.storeId)
                .map(publicInvite)
                .sort((a, b) => b.createdAt - a.createdAt)
            : [],
        members: listings.map((listing) => {
          const a = apps.find((x) => x.listingId === listing.id);
          return {
            applicationId: a?.id,
            listing,
            profile:
              a && a.status !== 'DRAFT'
                ? {
                    displayName: a.draft.displayName,
                    description: a.draft.description,
                    languages: a.draft.languages,
                    offeringIds: a.draft.offeringIds,
                    portraitId: a.draft.portraitId,
                  }
                : undefined,
            status: a?.status,
            version: a?.version,
            merchantApproved: a ? a.merchantContentHash === a.contentHash : true,
            consent: consents.find((c) => c.listingId === listing.id),
            openBookings: bookings
              .filter(
                (b) =>
                  (b.assignedListingId === listing.id ||
                    (!b.assignedListingId && b.selectedStaffListingId === listing.id)) &&
                  !['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status),
              )
              .map((b) => b.id),
          };
        }),
        offerings: (await tx.list<Offering>('offerings')).filter(
          (o) => o.storeId === actor.storeId,
        ),
        storeName: actor.storeId ? (await tx.get<Store>('stores', actor.storeId))?.name : undefined,
      };
    });
  }
  async upload(actor: Actor, input: unknown) {
    const d = z
      .object({
        name: z.string().trim().min(1).max(120),
        mime: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
        kind: z.enum(['IDENTITY', 'BUSINESS', 'QUALIFICATION', 'PORTRAIT']),
        data: z
          .string()
          .min(8)
          .max(470000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .parse(input);
    let bytes: Buffer = Buffer.from(d.data, 'base64');
    ensure(
      bytes.length <= 350000 && bytes.toString('base64') === d.data,
      'INVALID_EVIDENCE',
      'Select a file no larger than 350 KB.',
    );
    const magic =
      d.mime === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : d.mime === 'image/jpeg'
          ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) &&
            bytes.subarray(-2).equals(Buffer.from([255, 217]))
          : bytes.subarray(0, 5).toString() === '%PDF-';
    ensure(
      magic && (d.kind !== 'PORTRAIT' || d.mime !== 'application/pdf'),
      'INVALID_EVIDENCE',
      'The document format does not match the file.',
    );
    if (d.kind === 'PORTRAIT') {
      try {
        bytes = await sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning' })
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
      } catch {
        ensure(false, 'INVALID_EVIDENCE', 'Select a valid JPEG or PNG portrait.');
      }
      ensure(bytes.length <= 350000, 'INVALID_EVIDENCE', 'Select a smaller portrait photograph.');
      d.mime = 'image/jpeg';
      d.data = bytes.toString('base64');
      d.name = d.name.replace(/\.[^.]+$/, '').slice(0, 116) + '.jpg';
    }
    return this.run(async (tx) => {
      ensure(
        ['MERCHANT', 'STAFF'].includes(actor.role),
        'FORBIDDEN',
        'A partner account is required.',
        403,
      );
      const own = (await tx.list<Evidence>('partnerEvidence')).filter(
        (e) => e.ownerId === actor.id,
      );
      const existing = own.find((e) => e.hash === hash(d.data) && e.kind === d.kind);
      if (existing) return evidenceInfo(existing);
      ensure(own.length < 30, 'EVIDENCE_LIMIT', 'The document limit has been reached.', 409);
      const evidenceId = uid('evidence'),
        { data: _data, ...info } = d;
      const e: Evidence = {
        ...info,
        id: evidenceId,
        storageKey: await saveEvidence(evidenceId, bytes),
        ownerId: actor.id,
        hash: hash(d.data),
        size: bytes.length,
        createdAt: this.now(),
      };
      await tx.put('partnerEvidence', e);
      return evidenceInfo(e);
    });
  }
  async evidence(actor: Actor, evidenceId: string) {
    return this.run(async (tx) => {
      const e = await tx.get<Evidence>('partnerEvidence', evidenceId);
      if (actor.role === 'ADMIN') {
        actor = await currentAdmin(tx, actor);
        requireAdmin(actor, 'supply.write');
      }
      const apps = await tx.list<PartnerApplication>('partnerApplications');
      ensure(
        e &&
          (e.ownerId === actor.id ||
            (actor.role === 'ADMIN' &&
              apps.some(
                (a) =>
                  a.status !== 'DRAFT' &&
                  [...a.draft.evidenceIds, a.draft.portraitId].includes(e.id),
              )) ||
            (actor.role === 'MERCHANT' &&
              e.kind === 'PORTRAIT' &&
              apps.some(
                (a) =>
                  a.type === 'STAFF' &&
                  a.storeId === actor.storeId &&
                  a.status !== 'DRAFT' &&
                  a.draft.portraitId === e.id,
              ))),
        'NOT_FOUND',
        'Document not found.',
        404,
      );
      await tx.put('audit', {
        id: uid('audit'),
        actorId: actor.id,
        action: 'PRIVATE_EVIDENCE_VIEWED',
        detail: e.id,
        at: this.now(),
      });
      return { ...evidenceInfo(e), data: (await loadEvidence(e)).toString('base64') };
    });
  }
  async save(actor: Actor, input: unknown) {
    const d = z
      .object({ version: z.number().int().positive(), draft: draftSchema })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const a = await this.own(tx, actor);
      ensure(
        a.version === d.version,
        'VERSION_CONFLICT',
        'Refresh the application before editing.',
        409,
      );
      ensure(
        a.status !== 'SUBMITTED',
        'INVALID_STATE',
        'Wait for review before editing submitted materials.',
        409,
      );
      if (a.type === 'STAFF') {
        const listing = await tx.get<Listing>('listings', a.listingId!);
        ensure(
          listing?.membershipActive,
          'MEMBERSHIP_ENDED',
          'This shop membership has ended.',
          409,
        );
        const offerings = await tx.list<Offering>('offerings');
        ensure(
          d.draft.offeringIds.every((id) =>
            offerings.some(
              (o) =>
                o.id === id &&
                o.storeId === a.storeId &&
                o.regulatoryCategory === d.draft.category &&
                o.active !== false,
            ),
          ),
          'INVALID_OFFERING',
          'Select services offered by this shop.',
        );
      }
      for (const id of [
        ...d.draft.evidenceIds,
        ...(d.draft.portraitId ? [d.draft.portraitId] : []),
      ]) {
        const e = await tx.get<Evidence>('partnerEvidence', id);
        ensure(e?.ownerId === actor.id, 'INVALID_EVIDENCE', 'Select your own uploaded documents.');
        if (id === d.draft.portraitId)
          ensure(e.kind === 'PORTRAIT', 'INVALID_EVIDENCE', 'Select a portrait photograph.');
      }
      a.draft = d.draft;
      a.contentHash = profileHash(d.draft);
      a.merchantContentHash = undefined;
      a.status = 'DRAFT';
      a.version++;
      a.revision++;
      a.updatedAt = this.now();
      a.feedback = undefined;
      a.validUntil = undefined;
      await tx.put('partnerApplications', a);
      await suppress(tx, a);
      if (a.type === 'STAFF') {
        const l = await tx.get<Listing>('listings', a.listingId!);
        if (l) await tx.put('listings', { ...l, portraitConsent: false });
        const c = await tx.get<PortraitConsent>('portraitConsents', a.listingId!);
        if (c?.status === 'GRANTED')
          await recordConsent(
            tx,
            {
              ...c,
              status: 'REVOKED',
              revokedAt: this.now(),
              version: c.version + 1,
            },
            actor.id,
            'PROFILE_CHANGED',
            this.now(),
          );
      }
      await event(tx, actor, a, 'APPLICATION_SAVED', this.now());
      return a;
    });
  }
  async submit(actor: Actor, input: unknown) {
    const d = z.object({ version: z.number().int().positive() }).strict().parse(input);
    return this.run(async (tx) => {
      const a = await this.own(tx, actor);
      ensure(
        a.version === d.version,
        'VERSION_CONFLICT',
        'Refresh the application before submitting.',
        409,
      );
      ensure(
        a.status === 'DRAFT',
        'INVALID_STATE',
        'Save the corrected draft before submitting.',
        409,
      );
      draftSchema.parse(a.draft);
      ensure(
        a.draft.legalName.length >= 2 &&
          a.draft.contact.length >= 5 &&
          a.draft.serviceScope.length >= 10 &&
          Object.values(a.draft.description).every((v) => v.length >= 5) &&
          (a.type === 'MERCHANT'
            ? a.draft.legalAddress.length >= 5 && a.draft.emergencyContact.length >= 5
            : a.draft.offeringIds.length > 0),
        'INVALID_APPLICATION',
        'Complete the required identity, public profile and service details.',
      );
      ensure(
        a.draft.termsAccepted && (a.type !== 'MERCHANT' || a.draft.antisocialDeclaration),
        'DECLARATION_REQUIRED',
        'Read and accept the applicable declarations.',
      );
      const evidence = await tx.list<Evidence>('partnerEvidence'),
        docs = evidence.filter((e) => a.draft.evidenceIds.includes(e.id) && e.ownerId === actor.id);
      ensure(
        docs.some((e) => e.kind === 'IDENTITY') &&
          (a.type !== 'MERCHANT' || docs.some((e) => e.kind === 'BUSINESS')) &&
          (a.draft.category !== 'LICENSED' || docs.some((e) => e.kind === 'QUALIFICATION')),
        'EVIDENCE_REQUIRED',
        'Upload all documents required for this service category.',
      );
      if (a.type === 'STAFF') {
        const l = await tx.get<Listing>('listings', a.listingId!);
        ensure(l?.membershipActive, 'MEMBERSHIP_ENDED', 'This shop membership has ended.', 409);
        ensure(
          a.draft.portraitId &&
            consentValid(
              await tx.get<PortraitConsent>('portraitConsents', a.listingId!),
              a.contentHash,
              this.now(),
            ),
          'CONSENT_REQUIRED',
          'The person shown must authorize this profile before submission.',
        );
      }
      a.status = 'SUBMITTED';
      a.version++;
      a.submittedAt = this.now();
      a.updatedAt = this.now();
      await tx.put('partnerApplications', a);
      await tx.put('applicationSubmissions', { ...a, id: `${a.id}:${a.revision}` });
      await tx.put('partnerTermsReceipts', {
        id: `${a.id}:${a.revision}`,
        applicationId: a.id,
        actorId: actor.id,
        termsVersion: PARTNER_TERMS,
        acceptedAt: this.now(),
        antisocialDeclaration: a.draft.antisocialDeclaration,
      });
      await event(tx, actor, a, 'APPLICATION_SUBMITTED', this.now());
      return a;
    });
  }
  async invite(actor: Actor, input: unknown) {
    const d = z
      .object({ email, name: z.string().trim().min(2).max(80) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const s = await this.shop(tx, actor);
      ensure(
        (await tx.list<Invitation>('partnerInvitations')).filter(
          (i) => i.storeId === s.id && i.status === 'PENDING',
        ).length < 50,
        'INVITATION_LIMIT',
        'Resolve existing invitations before creating more.',
        409,
      );
      ensure(
        !(await tx.list<Invitation>('partnerInvitations')).some(
          (i) => i.storeId === s.id && i.email === d.email && i.status === 'PENDING',
        ),
        'INVITATION_EXISTS',
        'There is already a pending invitation for this email.',
        409,
      );
      const token = randomBytes(32).toString('hex'),
        invitation: Invitation = {
          id: uid('invitation'),
          storeId: s.id,
          email: d.email,
          name: d.name,
          status: 'PENDING',
          version: 1,
          createdAt: this.now(),
          expiresAt: this.now() + 3 * DAY,
          tokenHash: hash(token),
        };
      await tx.put('partnerInvitations', invitation);
      await enqueueEmail(
        tx,
        invitationEmail(d.email, token, 'staff'),
        'STAFF_INVITATION',
        this.now(),
      );
      await tx.put('audit', {
        id: uid('audit'),
        actorId: actor.id,
        action: 'STAFF_INVITED',
        detail: invitation.id,
        at: this.now(),
      });
      return { invitation: publicInvite(invitation), token, delivery: 'COPY_LINK' };
    });
  }
  async invitationAction(actor: Actor, invitationId: string, input: unknown) {
    const d = z
      .object({ version: z.number().int().positive(), action: z.enum(['REVOKE', 'RESEND']) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      await this.shop(tx, actor);
      const i = await tx.get<Invitation>('partnerInvitations', invitationId);
      ensure(i && i.storeId === actor.storeId, 'NOT_FOUND', 'Invitation not found.', 404);
      ensure(i.version === d.version, 'VERSION_CONFLICT', 'Refresh this invitation.', 409);
      ensure(i.status !== 'ACCEPTED', 'INVALID_STATE', 'End the membership instead.', 409);
      const token = randomBytes(32).toString('hex');
      i.status = d.action === 'REVOKE' ? 'REVOKED' : 'PENDING';
      i.version++;
      i.tokenHash = hash(token);
      i.expiresAt = this.now() + 3 * DAY;
      await tx.put('partnerInvitations', i);
      if (d.action === 'RESEND')
        await enqueueEmail(
          tx,
          invitationEmail(i.email, token, 'staff'),
          'STAFF_INVITATION',
          this.now(),
        );
      await tx.put('audit', {
        id: uid('audit'),
        actorId: actor.id,
        action: `STAFF_INVITATION_${d.action}`,
        detail: i.id,
        at: this.now(),
      });
      return {
        invitation: publicInvite(i),
        ...(d.action === 'RESEND' ? { token, delivery: 'COPY_LINK' } : {}),
      };
    });
  }
  private async tokenInvitation(tx: Records, token: string) {
    const i = (await tx.list<Invitation>('partnerInvitations')).find(
      (i) => i.tokenHash === hash(token),
    );
    ensure(
      i && i.status === 'PENDING' && i.expiresAt > this.now(),
      'INVITATION_UNAVAILABLE',
      'This invitation has expired or is no longer available.',
      410,
    );
    return i;
  }
  async inspectInvitation(input: unknown) {
    const { token } = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const i = await this.tokenInvitation(tx, token);
      const s = await tx.get<Store>('stores', i.storeId);
      ensure(s, 'NOT_FOUND', 'Shop not found.', 404);
      return {
        id: i.id,
        shopName: s.name,
        name: i.name,
        emailHint: i.email.replace(/^(.).+(@.+)$/, '$1***$2'),
        expiresAt: i.expiresAt,
      };
    });
  }
  async respondInvitation(actor: Actor, input: unknown) {
    const d = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        action: z.enum(['ACCEPT', 'DECLINE']),
        bindingAccepted: z.boolean(),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      ensure(
        actor.role === 'STAFF' && actor.partnerAccountId,
        'FORBIDDEN',
        'Sign in with your personal staff account.',
        403,
      );
      const account = await tx.get<Account>('partnerAccounts', actor.id),
        i = await this.tokenInvitation(tx, d.token);
      ensure(
        account?.email === i.email,
        'INVITATION_ACCOUNT_MISMATCH',
        'Sign in with the email addressed by this invitation.',
        403,
      );
      if (d.action === 'DECLINE') {
        i.status = 'DECLINED';
        i.version++;
        await tx.put('partnerInvitations', i);
        return { invitation: publicInvite(i) };
      }
      ensure(
        d.bindingAccepted,
        'DECLARATION_REQUIRED',
        'Confirm your relationship with this shop.',
      );
      ensure(
        !(await tx.list<Listing>('listings')).some(
          (l) => l.staffId === account.staffId && l.membershipActive,
        ),
        'MEMBERSHIP_EXISTS',
        'End the current shop membership before accepting a new one.',
        409,
      );
      const listingId = uid('listing'),
        draft = blank(account.name, account.email),
        store = await tx.get<Store>('stores', i.storeId);
      ensure(store, 'NOT_FOUND', 'Shop not found.', 404);
      draft.offeringIds = (await tx.list<Offering>('offerings'))
        .filter(
          (o) =>
            o.storeId === i.storeId && o.active !== false && o.regulatoryCategory === 'RELAXATION',
        )
        .map((o) => o.id);
      draft.areas = store.areas.length ? store.areas : ['shinjuku'];
      const l: Listing = {
        id: listingId,
        slug: `staff-${listingId.slice(-12)}`,
        storeId: i.storeId,
        staffId: account.staffId!,
        name: tr(account.name),
        description: tr(''),
        languages: ['ja'],
        initials: account.name.slice(0, 2),
        color: '#e7ede8',
        publicationStatus: 'SUSPENDED',
        moderationVersion: 1,
        membershipActive: true,
        portraitConsent: false,
        identityVerified: false,
        onDuty: false,
        dutyUpdatedAt: this.now(),
        offeringIds: [],
        hotelOnly: false,
        photo: '/portraits/placeholder.svg',
      };
      const a: PartnerApplication = {
        id: listingId,
        type: 'STAFF',
        ownerId: account.id,
        storeId: i.storeId,
        staffId: account.staffId,
        listingId,
        status: 'DRAFT',
        version: 1,
        revision: 1,
        draft,
        contentHash: profileHash(draft),
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      i.status = 'ACCEPTED';
      i.version++;
      i.acceptedAt = this.now();
      i.applicationId = a.id;
      account.storeId = i.storeId;
      await tx.put('partnerAccounts', account);
      await tx.put('listings', l);
      await tx.put('partnerApplications', a);
      await tx.put('partnerInvitations', i);
      await event(tx, actor, a, 'STAFF_MEMBERSHIP_ACCEPTED', this.now());
      // SOLO must exit in the acceptance transaction, before the next quote can observe it.
      if (store.acceptanceMode === 'SOLO') {
        store.acceptanceMode = 'MANUAL';
        store.ruleVersion++;
        await tx.put('stores', store);
        await tx.put('audit', {
          id: uid('audit'),
          actorId: actor.id,
          action: 'SOLO_EXITED',
          detail: store.id,
          at: this.now(),
        });
      }
      return { invitation: publicInvite(i), application: a };
    });
  }
  async consent(actor: Actor, input: unknown) {
    const d = z
      .object({
        version: z.number().int().nonnegative(),
        action: z.enum(['GRANT', 'REVOKE']),
        termsVersion: z.literal(CONSENT_TERMS),
        startsAt: z.number().int(),
        endsAt: z.number().int(),
        acknowledged: z.boolean(),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      ensure(
        actor.role === 'STAFF' && actor.staffId && actor.storeId,
        'FORBIDDEN',
        'Only the person shown can manage portrait authorization.',
        403,
      );
      const l = (await tx.list<Listing>('listings')).find(
        (l) => l.staffId === actor.staffId && l.storeId === actor.storeId && l.membershipActive,
      );
      ensure(l, 'NOT_FOUND', 'Active membership not found.', 404);
      const a = await tx.get<PartnerApplication>('partnerApplications', l.id),
        old = await tx.get<PortraitConsent>('portraitConsents', l.id);
      ensure(
        (old?.version ?? 0) === d.version,
        'VERSION_CONFLICT',
        'Refresh the current authorization.',
        409,
      );
      const contentHash =
        a?.contentHash ??
        hash(JSON.stringify({ name: l.name, description: l.description, photo: l.photo }));
      if (d.action === 'GRANT') {
        ensure(
          d.acknowledged && (!a || a.draft.portraitId),
          'CONSENT_REQUIRED',
          'Review your profile and photograph before authorizing.',
        );
        ensure(
          d.startsAt <= this.now() &&
            d.startsAt >= this.now() - DAY &&
            d.endsAt > this.now() &&
            d.endsAt <= this.now() + 366 * DAY,
          'INVALID_CONSENT_PERIOD',
          'Authorization must start now and end within one year.',
        );
      } else
        ensure(
          old?.status === 'GRANTED' || l.portraitConsent,
          'INVALID_STATE',
          'There is no active authorization to withdraw.',
          409,
        );
      const c: PortraitConsent = {
        id: l.id,
        listingId: l.id,
        staffId: l.staffId,
        storeId: l.storeId,
        version: (old?.version ?? 0) + 1,
        termsVersion: CONSENT_TERMS,
        contentHash,
        status: d.action === 'GRANT' ? 'GRANTED' : 'REVOKED',
        startsAt: d.action === 'GRANT' ? d.startsAt : (old?.startsAt ?? this.now()),
        endsAt: d.action === 'GRANT' ? d.endsAt : (old?.endsAt ?? this.now()),
        grantedAt: d.action === 'GRANT' ? this.now() : (old?.grantedAt ?? this.now()),
        ...(d.action === 'REVOKE' ? { revokedAt: this.now() } : {}),
      };
      await recordConsent(tx, c, actor.id, d.action, this.now());
      l.portraitConsent = d.action === 'GRANT';
      l.moderationVersion = (l.moderationVersion ?? 1) + 1;
      if (d.action === 'REVOKE') {
        l.publicationStatus = 'SUSPENDED';
        l.onDuty = false;
      }
      await tx.put('listings', l);
      await tx.put('audit', {
        id: uid('audit'),
        actorId: actor.id,
        action: `PORTRAIT_CONSENT_${d.action}`,
        detail: c.id,
        at: this.now(),
      });
      return c;
    });
  }
  async approveContent(actor: Actor, applicationId: string, input: unknown) {
    const d = z
      .object({
        version: z.number().int().positive(),
        approved: z.boolean(),
        feedback: z.string().trim().min(8).max(500),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      await this.shop(tx, actor);
      const a = await tx.get<PartnerApplication>('partnerApplications', applicationId);
      ensure(
        a?.type === 'STAFF' && a.storeId === actor.storeId,
        'NOT_FOUND',
        'Application not found.',
        404,
      );
      ensure(
        a.version === d.version,
        'VERSION_CONFLICT',
        'Refresh the profile before reviewing.',
        409,
      );
      ensure(
        a.status === 'SUBMITTED',
        'INVALID_STATE',
        'Only submitted profiles can be reviewed.',
        409,
      );
      a.version++;
      a.updatedAt = this.now();
      a.merchantContentHash = d.approved ? a.contentHash : undefined;
      if (!d.approved) {
        a.status = 'CHANGES_REQUIRED';
        a.feedback = d.feedback;
      }
      await tx.put('partnerApplications', a);
      await event(
        tx,
        actor,
        a,
        d.approved ? 'MERCHANT_CONTENT_APPROVED' : 'MERCHANT_CONTENT_CHANGES_REQUIRED',
        this.now(),
        d.feedback,
      );
      return { id: a.id, status: a.status, version: a.version };
    });
  }
  async endMembership(actor: Actor, listingId: string, input: unknown) {
    const d = z
      .object({ version: z.number().int().positive(), reason: z.string().trim().min(8).max(500) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      ensure(
        actor.role === 'MERCHANT' || actor.role === 'STAFF',
        'FORBIDDEN',
        'A partner account is required.',
        403,
      );
      const l = await tx.get<Listing>('listings', listingId);
      ensure(
        l &&
          l.storeId === actor.storeId &&
          (actor.role === 'MERCHANT' || l.staffId === actor.staffId),
        'NOT_FOUND',
        'Membership not found.',
        404,
      );
      ensure(
        (l.moderationVersion ?? 1) === d.version,
        'VERSION_CONFLICT',
        'Refresh the membership.',
        409,
      );
      ensure(l.membershipActive, 'INVALID_STATE', 'This membership has already ended.', 409);
      l.membershipActive = false;
      l.portraitConsent = false;
      l.publicationStatus = 'SUSPENDED';
      l.onDuty = false;
      l.moderationVersion = (l.moderationVersion ?? 1) + 1;
      await tx.put('listings', l);
      const c = await tx.get<PortraitConsent>('portraitConsents', l.id);
      if (c?.status === 'GRANTED')
        await recordConsent(
          tx,
          {
            ...c,
            status: 'REVOKED',
            revokedAt: this.now(),
            version: c.version + 1,
          },
          actor.id,
          'MEMBERSHIP_ENDED',
          this.now(),
        );
      const store = await tx.get<Store>('stores', l.storeId);
      if (store) {
        const wasSolo = store.acceptanceMode === 'SOLO';
        if (wasSolo) store.acceptanceMode = 'MANUAL';
        store.ruleVersion++;
        await tx.put('stores', store);
        if (wasSolo)
          await tx.put('audit', {
            id: uid('audit'),
            actorId: actor.id,
            action: 'SOLO_EXITED',
            detail: store.id,
            at: this.now(),
          });
      }
      const a = await tx.get<PartnerApplication>('partnerApplications', l.id);
      if (a) {
        a.status = 'SUSPENDED';
        a.version++;
        a.updatedAt = this.now();
        a.feedback = d.reason;
        await tx.put('partnerApplications', a);
        await event(tx, actor, a, 'MEMBERSHIP_ENDED', this.now(), d.reason);
      }
      await tx.put('audit', {
        id: uid('audit'),
        actorId: actor.id,
        action: 'STAFF_MEMBERSHIP_ENDED',
        detail: l.id,
        at: this.now(),
      });
      return {
        ok: true,
        openBookings: (await tx.list<Booking>('bookings'))
          .filter(
            (b) =>
              (b.assignedListingId === l.id ||
                (!b.assignedListingId && b.selectedStaffListingId === l.id)) &&
              !['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status),
          )
          .map((b) => b.id),
      };
    });
  }
  async reviewQueue(actor: Actor): Promise<ApplicationReviewItem[]> {
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'supply.write');
      const evidence = await tx.list<Evidence>('partnerEvidence'),
        history = await tx.list<ApplicationHistory>('applicationHistory');
      const items: ApplicationReviewItem[] = [];
      for (const a of (await tx.list<PartnerApplication>('partnerApplications'))
        .filter((a) => a.status !== 'DRAFT')
        .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))) {
        items.push({
          application: a,
          evidence: evidence
            .filter((e) => [...a.draft.evidenceIds, a.draft.portraitId].includes(e.id))
            .map(evidenceInfo),
          consent: a.listingId
            ? await tx.get<PortraitConsent>('portraitConsents', a.listingId)
            : undefined,
          merchantApproved: a.type === 'MERCHANT' || a.merchantContentHash === a.contentHash,
          history: history.filter((h) => h.applicationId === a.id).sort((a, b) => b.at - a.at),
        });
      }
      return items;
    });
  }
  async review(actor: Actor, applicationId: string, input: unknown) {
    const d = z
      .object({
        version: z.number().int().positive(),
        decision: z.enum(['APPROVE', 'CHANGES_REQUIRED', 'REJECT', 'SUSPEND']),
        feedback: z.string().trim().min(10).max(500),
        validUntil: z.number().int().optional(),
        checks: z
          .object({
            identity: z.boolean(),
            category: z.boolean(),
            documents: z.boolean(),
            content: z.boolean(),
            antisocial: z.boolean(),
            psp: z.boolean(),
          })
          .strict(),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'supply.write');
      const a = await tx.get<PartnerApplication>('partnerApplications', applicationId);
      ensure(a, 'NOT_FOUND', 'Application not found.', 404);
      ensure(
        a.version === d.version,
        'VERSION_CONFLICT',
        'Refresh the application before reviewing.',
        409,
      );
      ensure(
        d.decision === 'SUSPEND' ? a.status === 'APPROVED' : a.status === 'SUBMITTED',
        'INVALID_STATE',
        'This application is not awaiting this review.',
        409,
      );
      if (d.decision === 'APPROVE') {
        ensure(
          a.draft.category === 'RELAXATION',
          'REGULATED_REVIEW_REQUIRED',
          'Regulated services remain unavailable until the specialist qualification process is connected.',
          409,
        );
        ensure(
          d.checks.identity &&
            d.checks.category &&
            d.checks.documents &&
            d.checks.content &&
            (a.type !== 'MERCHANT' || (d.checks.antisocial && d.checks.psp)),
          'REVIEW_CHECKS_REQUIRED',
          'Complete each required review check.',
        );
        ensure(
          d.validUntil && d.validUntil > this.now() && d.validUntil <= this.now() + 366 * DAY,
          'INVALID_VALIDITY',
          'Set an approval validity date within one year.',
        );
        if (a.type === 'STAFF') {
          const s = await tx.get<Store>('stores', a.storeId),
            l = await tx.get<Listing>('listings', a.listingId!);
          ensure(
            s?.approved && s.active && s.pspAccount && l?.membershipActive,
            'SUPPLY_NOT_READY',
            'The shop and staff membership must be active.',
            409,
          );
          const offerings = await tx.list<Offering>('offerings');
          ensure(
            a.draft.offeringIds.length > 0 &&
              a.draft.offeringIds.every((id) =>
                offerings.some(
                  (o) =>
                    o.id === id &&
                    o.storeId === a.storeId &&
                    o.approved &&
                    o.active !== false &&
                    o.regulatoryCategory === a.draft.category,
                ),
              ),
            'INVALID_OFFERING',
            'Selected services changed. Review the current shop services before approval.',
            409,
          );
          ensure(
            a.merchantContentHash === a.contentHash,
            'MERCHANT_REVIEW_REQUIRED',
            'The shop must approve this profile first.',
            409,
          );
          ensure(
            consentValid(
              await tx.get<PortraitConsent>('portraitConsents', a.listingId!),
              a.contentHash,
              this.now(),
            ),
            'CONSENT_REQUIRED',
            'A current personal portrait authorization is required.',
            409,
          );
          l.identityVerified = true;
          l.portraitConsent = true;
          l.name = a.draft.displayName;
          l.description = a.draft.description;
          l.languages = a.draft.languages;
          l.offeringIds = a.draft.offeringIds;
          l.photo = `/v1/public/portraits/${l.id}?v=${a.revision}`;
          l.publicationStatus = 'PUBLISHED_INDEXABLE';
          l.moderationVersion = (l.moderationVersion ?? 1) + 1;
          await tx.put('listings', l);
        } else {
          const s = await tx.get<Store>('stores', a.storeId);
          ensure(s, 'NOT_FOUND', 'Shop not found.', 404);
          s.name = a.draft.displayName;
          s.legalName = a.draft.legalName;
          s.legalAddress = a.draft.legalAddress;
          s.contact = a.draft.contact;
          s.emergencyContact = a.draft.emergencyContact;
          s.areas = a.draft.areas;
          s.active = true;
          s.approved = true;
          s.pspAccount = `demo_onboarding_${s.id}`;
          s.ruleVersion++;
          s.moderationVersion = (s.moderationVersion ?? 1) + 1;
          await tx.put('stores', s);
          const existing = await tx.get<Offering>('offerings', `${s.id}-onboarding`);
          await tx.put<Offering>('offerings', {
            id: `${s.id}-onboarding`,
            storeId: s.id,
            name: a.draft.serviceName,
            durationMinutes: a.draft.durationMinutes,
            price: a.draft.price,
            transportFee: a.draft.transportFee,
            version: (existing?.version ?? 0) + 1,
            approved: true,
            active: true,
            regulatoryCategory: 'RELAXATION',
          });
        }
        a.status = 'APPROVED';
        a.validUntil = d.validUntil;
      } else {
        a.status =
          d.decision === 'REJECT'
            ? 'REJECTED'
            : d.decision === 'SUSPEND'
              ? 'SUSPENDED'
              : 'CHANGES_REQUIRED';
        await suppress(tx, a);
      }
      a.feedback = d.feedback;
      a.version++;
      a.reviewedAt = this.now();
      a.updatedAt = this.now();
      await tx.put('partnerApplications', a);
      await tx.put('applicationReviews', {
        id: uid('qualification_review'),
        applicationId: a.id,
        revision: a.revision,
        reviewerId: actor.id,
        at: this.now(),
        ...d,
        termsVersion: PARTNER_TERMS,
      });
      await event(tx, actor, a, `APPLICATION_${d.decision}`, this.now(), d.feedback);
      return a;
    });
  }
  async publicPortrait(listingId: string) {
    return this.run(async (tx) => {
      const l = await tx.get<Listing>('listings', listingId),
        a = await tx.get<PartnerApplication>('partnerApplications', listingId),
        s = l && (await tx.get<Store>('stores', l.storeId)),
        c = await tx.get<PortraitConsent>('portraitConsents', listingId);
      ensure(
        l &&
          a &&
          s?.active &&
          s.approved &&
          l.membershipActive &&
          l.identityVerified &&
          l.portraitConsent &&
          l.publicationStatus === 'PUBLISHED_INDEXABLE' &&
          a.status === 'APPROVED' &&
          consentValid(c, a.contentHash, this.now()),
        'NOT_FOUND',
        'Portrait not available.',
        404,
      );
      const e = await tx.get<Evidence>('partnerEvidence', a.draft.portraitId);
      ensure(e?.kind === 'PORTRAIT', 'NOT_FOUND', 'Portrait not available.', 404);
      return { mime: e.mime, bytes: await loadEvidence(e) };
    });
  }
}
