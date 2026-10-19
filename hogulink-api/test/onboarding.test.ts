import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  Actor,
  PartnerDraft,
  EvidenceKind,
  Listing,
  PartnerApplication,
  PortraitConsent,
  Store,
} from '@hogulink/contracts';
import { Repository } from '../src/repository.js';
import { Engine } from '../src/engine.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';
import { CONSENT_TERMS } from '../src/onboarding.js';
import sharp from 'sharp';
import { registerClock, finishVisit } from './helpers/visit-fixture.js';
const root: Actor = { id: 'demo-admin', role: 'ADMIN', verificationLevel: 3 };
const merchant: Actor = {
  id: 'demo-owner-store-nagi',
  role: 'MERCHANT',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const password = 'Onboarding-example-2026!';
const feedback = '已按具体服务内容逐项核对提交的资质材料与公开信息。';
export const png =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAoCAIAAAAQS2/OAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAQElEQVRIie3XsQkAMAwDwez+K2jgTBFIceDeYGTpdVpP51gwJ4qK8mixirjpBE4ic6gi4DXoGLpOAUmF6ueWeQHFlgJ5fGMXgwAAAABJRU5ErkJggg==';
const checks = {
  identity: true,
  category: true,
  documents: true,
  content: true,
  antisocial: true,
  psp: true,
};
const tr = (s: string) => ({ ja: s, en: s, 'zh-cn': s });
async function fixture(fn: (e: Engine, advance: (n: number) => void) => Promise<void>) {
  const repo = new Repository('', ':memory:');
  await repo.init();
  await seed(repo);
  let now = Date.now();
  const e = new Engine(repo, () => now);
  registerClock(e, (at) => {
    now = at;
  });
  try {
    await fn(e, (n) => {
      now += n;
    });
  } finally {
    await repo.close();
  }
}
async function fail(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(fn, (err: unknown) => err instanceof DomainError && err.code === code);
}
async function upload(e: Engine, actor: Actor, kind: EvidenceKind) {
  return e.onboarding.upload(actor, { name: `${kind}.png`, mime: 'image/png', kind, data: png });
}
async function complete(
  e: Engine,
  actor: Actor,
  category: 'RELAXATION' | 'LICENSED' = 'RELAXATION',
) {
  const snap = await e.onboarding.snapshot(actor),
    a = snap.application!,
    identity = await upload(e, actor, 'IDENTITY'),
    business = await upload(e, actor, 'BUSINESS'),
    qualification = await upload(e, actor, 'QUALIFICATION'),
    portrait = await upload(e, actor, 'PORTRAIT');
  const draft: PartnerDraft = {
    ...a.draft,
    legalName: 'PRIVATE LEGAL NAME',
    displayName: tr('Public Studio'),
    description: tr('A carefully considered professional relaxation service.'),
    contact: 'private@example.test',
    legalAddress: 'PRIVATE Tokyo address 1-2-3',
    emergencyContact: '03-1111-2222',
    serviceScope: 'Manual nonmedical relaxation service with no medical claims.',
    category,
    evidenceIds: [
      identity.id,
      ...(a.type === 'MERCHANT' ? [business.id] : []),
      ...(category === 'LICENSED' ? [qualification.id] : []),
    ],
    portraitId: a.type === 'STAFF' ? portrait.id : '',
    termsAccepted: true,
    antisocialDeclaration: true,
    offeringIds:
      a.type === 'STAFF'
        ? snap.offerings.filter((o) => o.regulatoryCategory === category).map((o) => o.id)
        : [],
  };
  return e.onboarding.save(actor, { version: a.version, draft });
}
async function grant(e: Engine, actor: Actor) {
  const s = await e.onboarding.snapshot(actor);
  return e.onboarding.consent(actor, {
    version: s.consent?.version ?? 0,
    action: 'GRANT',
    termsVersion: CONSENT_TERMS,
    startsAt: e.now(),
    endsAt: e.now() + 180 * 86400000,
    acknowledged: true,
  });
}
async function staff(e: Engine, email = 'staff@example.test', shop = merchant) {
  const a = await e.onboarding.register({ role: 'STAFF', email, password, name: 'Personal Staff' }),
    i = await e.onboarding.invite(shop, { email, name: 'Invited Staff' });
  await e.onboarding.respondInvitation(a, {
    token: i.token,
    action: 'ACCEPT',
    bindingAccepted: true,
  });
  return e.onboarding.resolveActor(a);
}
async function submit(e: Engine, a: Actor) {
  const v = (await e.onboarding.snapshot(a)).application!;
  return e.onboarding.submit(a, { version: v.version });
}
async function review(e: Engine, a: PartnerApplication, decision = 'APPROVE', extra = {}) {
  return e.onboarding.review(root, a.id, {
    version: a.version,
    decision,
    feedback,
    validUntil: e.now() + 180 * 86400000,
    checks,
    ...extra,
  });
}
async function approveStaff(e: Engine, actor: Actor) {
  let a = await complete(e, actor);
  await grant(e, actor);
  a = await submit(e, actor);
  const m: Actor = { ...merchant, storeId: a.storeId };
  await e.onboarding.approveContent(m, a.id, { version: a.version, approved: true, feedback });
  a = (await e.onboarding.snapshot(actor)).application!;
  return review(e, a);
}

test('merchant onboarding stores private drafts, enforces required evidence and declarations, and opens only after a checked approval', () =>
  fixture(async (e) => {
    const owner = await e.onboarding.register({
      role: 'MERCHANT',
      email: ' OWNER@EXAMPLE.TEST ',
      password,
      name: 'New studio',
    });
    assert.equal(
      (await e.publicCatalog()).stores.some((s) => s.id === owner.storeId),
      false,
    );
    await fail(() => submit(e, owner), 'INVALID_APPLICATION');
    let a = await complete(e, owner);
    a = await e.onboarding.save(owner, {
      version: a.version,
      draft: { ...a.draft, evidenceIds: [] },
    });
    await fail(() => submit(e, owner), 'EVIDENCE_REQUIRED');
    a = await complete(e, owner);
    a = await e.onboarding.save(owner, {
      version: a.version,
      draft: { ...a.draft, antisocialDeclaration: false },
    });
    await fail(() => submit(e, owner), 'DECLARATION_REQUIRED');
    a = await complete(e, owner);
    a = await submit(e, owner);
    await fail(
      () => review(e, a, 'APPROVE', { checks: { ...checks, psp: false } }),
      'REVIEW_CHECKS_REQUIRED',
    );
    await fail(
      () => e.onboarding.save(owner, { version: a.version, draft: a.draft }),
      'INVALID_STATE',
    );
    a = await review(e, a);
    assert.equal(a.status, 'APPROVED');
    const s = await e.repo.transaction((tx) => tx.get<Store>('stores', owner.storeId!));
    assert.equal(s?.plan, 'TRIAL');
    assert.equal(s?.acceptanceMode, 'MANUAL');
    assert.match(s!.pspAccount, /^demo_onboarding_/);
    const publicData = JSON.stringify(await e.publicCatalog());
    assert(!publicData.includes('passwordHash'));
    assert(!publicData.includes('evidence_'));
    assert(!publicData.includes('partnerEvidence'));
    assert(
      !(await e.publicCatalog()).stores.some((s) => s.id === owner.storeId),
      'approval alone must not expose a shop without qualified staff',
    );
    assert.equal(
      (await e.onboarding.login({ role: 'MERCHANT', email: 'owner@example.test', password })).id,
      owner.id,
    );
    await fail(
      () =>
        e.onboarding.login({
          role: 'MERCHANT',
          email: 'owner@example.test',
          password: 'Different-password!',
        }),
      'INVALID_CREDENTIALS',
    );
    await fail(
      () =>
        e.onboarding.register({
          role: 'MERCHANT',
          email: 'owner@example.test',
          password,
          name: 'Duplicate',
        }),
      'ACCOUNT_EXISTS',
    );
  }));

test('invitations are email-bound, hashed, one-use, expiring, revocable and rotated on reissue', () =>
  fixture(async (e, advance) => {
    const a = await e.onboarding.register({
        role: 'STAFF',
        email: 'invited@example.test',
        password,
        name: 'Invite Staff',
      }),
      wrong = await e.onboarding.register({
        role: 'STAFF',
        email: 'wrong@example.test',
        password,
        name: 'Wrong Staff',
      });
    let i = await e.onboarding.invite(merchant, {
      email: ' INVITED@example.test ',
      name: 'Invite Staff',
    });
    const privateRows = JSON.stringify(
      await e.repo.transaction((tx) => tx.list('partnerInvitations')),
    );
    assert(!privateRows.includes(i.token));
    assert(
      !JSON.stringify((await e.onboarding.snapshot(merchant)).invitations).includes('tokenHash'),
    );
    await fail(
      () =>
        e.onboarding.respondInvitation(wrong, {
          token: i.token,
          action: 'ACCEPT',
          bindingAccepted: true,
        }),
      'INVITATION_ACCOUNT_MISMATCH',
    );
    await fail(
      () =>
        e.onboarding.respondInvitation(a, {
          token: i.token,
          action: 'ACCEPT',
          bindingAccepted: false,
        }),
      'DECLARATION_REQUIRED',
    );
    const refreshed = await e.onboarding.invitationAction(merchant, i.invitation.id, {
      version: 1,
      action: 'RESEND',
    });
    await fail(() => e.onboarding.inspectInvitation({ token: i.token }), 'INVITATION_UNAVAILABLE');
    await e.onboarding.respondInvitation(a, {
      token: refreshed.token!,
      action: 'ACCEPT',
      bindingAccepted: true,
    });
    await fail(
      () =>
        e.onboarding.respondInvitation(a, {
          token: refreshed.token!,
          action: 'ACCEPT',
          bindingAccepted: true,
        }),
      'INVITATION_UNAVAILABLE',
    );
    i = await e.onboarding.invite(merchant, { email: 'other@example.test', name: 'Other Staff' });
    advance(3 * 86400000 + 1);
    await fail(() => e.onboarding.inspectInvitation({ token: i.token }), 'INVITATION_UNAVAILABLE');
    const expired = (await e.onboarding.snapshot(merchant)).invitations.find(
      (x) => x.id === i.invitation.id,
    )!;
    assert.equal(expired.status, 'EXPIRED');
    const r = await e.onboarding.invitationAction(merchant, expired.id, {
      version: expired.version,
      action: 'RESEND',
    });
    await e.onboarding.invitationAction(merchant, expired.id, {
      version: r.invitation.version,
      action: 'REVOKE',
    });
    await fail(() => e.onboarding.inspectInvitation({ token: r.token! }), 'INVITATION_UNAVAILABLE');
  }));

test('staff lifecycle requires personal authorization, shop content approval and platform review before exposure', () =>
  fixture(async (e) => {
    const a = await staff(e);
    let app = await complete(e, a);
    assert(!(await e.publicCatalog()).listings.some((l) => l.staffId === a.staffId));
    await fail(() => submit(e, a), 'CONSENT_REQUIRED');
    await fail(
      () =>
        e.onboarding.consent(merchant, {
          version: 0,
          action: 'GRANT',
          termsVersion: CONSENT_TERMS,
          startsAt: e.now(),
          endsAt: e.now() + 86400000,
          acknowledged: true,
        }),
      'FORBIDDEN',
    );
    await grant(e, a);
    app = await submit(e, a);
    await fail(() => review(e, app), 'MERCHANT_REVIEW_REQUIRED');
    const shopSnapshot = await e.onboarding.snapshot(merchant);
    assert(!JSON.stringify(shopSnapshot).includes('PRIVATE LEGAL NAME'));
    assert(!JSON.stringify(shopSnapshot).includes('private@example.test'));
    assert.equal(
      shopSnapshot.members.find((m) => m.applicationId === app.id)?.profile?.displayName.ja,
      'Public Studio',
    );
    const identity = (await e.onboarding.snapshot(a)).evidence.find((e) => e.kind === 'IDENTITY')!;
    await fail(() => e.onboarding.evidence(merchant, identity.id), 'NOT_FOUND');
    const portrait = (await e.onboarding.snapshot(a)).evidence.find((e) => e.kind === 'PORTRAIT')!;
    assert((await e.onboarding.evidence(merchant, portrait.id)).data);
    await e.onboarding.approveContent(merchant, app.id, {
      version: app.version,
      approved: true,
      feedback,
    });
    app = (await e.onboarding.snapshot(a)).application!;
    await fail(() => review(e, { ...app, version: app.version - 1 }), 'VERSION_CONFLICT');
    app = await review(e, app);
    assert((await e.publicCatalog()).listings.some((l) => l.id === app.id));
    assert.equal((await e.onboarding.publicPortrait(app.id)).mime, 'image/jpeg');
    assert(
      !(await e.publicCatalog()).listings
        .find((l) => l.id === app.id)!
        .description.ja.includes('PRIVATE'),
    );
    const c = (await e.onboarding.snapshot(a)).consent!;
    await e.onboarding.consent(a, {
      version: c.version,
      action: 'REVOKE',
      termsVersion: CONSENT_TERMS,
      startsAt: e.now(),
      endsAt: e.now(),
      acknowledged: false,
    });
    assert(!(await e.publicCatalog()).listings.some((l) => l.id === app.id));
    await fail(() => e.onboarding.publicPortrait(app.id), 'NOT_FOUND');
    await fail(
      () =>
        e.quote(
          { id: 'customer', role: 'CUSTOMER', verificationLevel: 1 },
          {
            listingId: app.id,
            offeringId: 'store-nagi-60',
            bookingMode: 'SCHEDULED',
            nominationType: 'NOMINATED',
            startAt: e.now() + 3 * 3600000,
            area: 'shinjuku',
            requiredLanguage: '',
          },
        ),
      'LISTING_UNAVAILABLE',
    );
    await grant(e, a);
    assert(
      !(await e.publicCatalog()).listings.some((l) => l.id === app.id),
      'reauthorization never republishes automatically',
    );
  }));

test('changes requested preserve submissions and require saved resubmission; profile edits revoke the old personal grant', () =>
  fixture(async (e) => {
    const a = await staff(e);
    let app = await complete(e, a);
    await grant(e, a);
    app = await submit(e, a);
    await e.onboarding.approveContent(merchant, app.id, {
      version: app.version,
      approved: false,
      feedback: '请补充准确的服务说明并修改公开介绍中的表述。',
    });
    app = (await e.onboarding.snapshot(a)).application!;
    assert.equal(app.status, 'CHANGES_REQUIRED');
    await fail(() => submit(e, a), 'INVALID_STATE');
    app = await e.onboarding.save(a, {
      version: app.version,
      draft: { ...app.draft, description: tr('A revised accurate public service introduction.') },
    });
    assert.equal((await e.onboarding.snapshot(a)).consent?.status, 'REVOKED');
    await fail(() => submit(e, a), 'CONSENT_REQUIRED');
    await grant(e, a);
    app = await submit(e, a);
    await e.onboarding.approveContent(merchant, app.id, {
      version: app.version,
      approved: true,
      feedback,
    });
    app = (await e.onboarding.snapshot(a)).application!;
    app = await review(e, app, 'CHANGES_REQUIRED');
    assert.equal(app.status, 'CHANGES_REQUIRED');
    const submissions = await e.repo.transaction((tx) =>
      tx.list<PartnerApplication>('applicationSubmissions'),
    );
    assert.equal(submissions.filter((s) => s.ownerId === a.id).length, 2);
    assert.notEqual(submissions[0].draft.description.ja, submissions[1].draft.description.ja);
  }));

test('qualification and portrait expiry stop new exposure, and legacy publication review cannot bypass qualification', () =>
  fixture(async (e, advance) => {
    const a = await staff(e);
    let app = await approveStaff(e, a);
    const oldVersion = app.version;
    advance(180 * 86400000 + 1);
    assert(!(await e.publicCatalog()).listings.some((l) => l.id === app.id));
    app = (await e.onboarding.snapshot(a)).application!;
    assert.equal(app.status, 'EXPIRED');
    assert.equal(app.version, oldVersion + 1);
    const l = await e.repo.transaction((tx) => tx.get<Listing>('listings', app.id));
    await fail(
      () =>
        e.admin.review(root, {
          targetType: 'LISTING',
          targetId: app.id,
          decision: 'APPROVE',
          version: l!.moderationVersion ?? 1,
          reason: feedback,
        }),
      'QUALIFICATION_REVIEW_REQUIRED',
    );
    const events = await e.repo.transaction((tx) => tx.list<{ action: string }>('audit'));
    const count = events.filter((v) => v.action === 'QUALIFICATION_EXPIRED').length;
    await e.publicCatalog();
    assert.equal(
      (await e.repo.transaction((tx) => tx.list<{ action: string }>('audit'))).filter(
        (v) => v.action === 'QUALIFICATION_EXPIRED',
      ).length,
      count,
    );
  }));

test('only one active membership is allowed; ending a membership removes access and allows a new shop invitation', () =>
  fixture(async (e) => {
    const a = await staff(e),
      sora: Actor = { ...merchant, storeId: 'store-sora' };
    let i = await e.onboarding.invite(sora, { email: 'staff@example.test', name: 'Staff Person' });
    await fail(
      () =>
        e.onboarding.respondInvitation(a, {
          token: i.token,
          action: 'ACCEPT',
          bindingAccepted: true,
        }),
      'MEMBERSHIP_EXISTS',
    );
    const member = (await e.onboarding.snapshot(a)).members[0];
    await fail(
      () =>
        e.onboarding.endMembership({ ...merchant, storeId: 'store-mori' }, member.listing.id, {
          version: 1,
          reason: feedback,
        }),
      'NOT_FOUND',
    );
    await e.onboarding.endMembership(a, member.listing.id, { version: 1, reason: feedback });
    assert.equal((await e.onboarding.resolveActor(a)).onboardingOnly, true);
    await e.onboarding.respondInvitation(a, {
      token: i.token,
      action: 'ACCEPT',
      bindingAccepted: true,
    });
    const next = await e.onboarding.resolveActor(a);
    assert.equal(next.storeId, 'store-sora');
    assert.equal(
      (await e.repo.transaction((tx) => tx.get<Store>('stores', 'store-sora')))!.acceptanceMode,
      'MANUAL',
    );
  }));

test('private evidence checks file signatures, owner binding and administrator permissions', () =>
  fixture(async (e) => {
    const a = await staff(e);
    await fail(
      () =>
        e.onboarding.upload(a, {
          name: 'fake.png',
          mime: 'image/png',
          kind: 'IDENTITY',
          data: Buffer.from('not-a-png-file').toString('base64'),
        }),
      'INVALID_EVIDENCE',
    );
    const id = await upload(e, a, 'IDENTITY'),
      other = await e.onboarding.register({
        role: 'STAFF',
        email: 'other@example.test',
        password,
        name: 'Other Staff',
      });
    await fail(() => e.onboarding.evidence(other, id.id), 'NOT_FOUND');
    await fail(
      () => e.onboarding.evidence({ ...root, id: 'system', adminRole: 'SUPPORT' }, id.id),
      'FORBIDDEN',
    );
    let app = await complete(e, a);
    await grant(e, a);
    app = await submit(e, a);
    assert((await e.onboarding.evidence(root, id.id)).data);
    const foreign = await upload(e, other, 'BUSINESS');
    await e.onboarding.approveContent(merchant, app.id, {
      version: app.version,
      approved: false,
      feedback,
    });
    app = (await e.onboarding.snapshot(a)).application!;
    await fail(
      () =>
        e.onboarding.save(a, {
          version: app.version,
          draft: { ...app.draft, evidenceIds: [foreign.id] },
        }),
      'INVALID_EVIDENCE',
    );
    const publicJson = JSON.stringify(await e.publicCatalog()),
      audit = JSON.stringify(await e.repo.transaction((tx) => tx.list('audit'))),
      outbox = JSON.stringify(await e.repo.transaction((tx) => tx.list('outbox')));
    for (const v of [publicJson, audit, outbox]) {
      assert(!v.includes(png));
      assert(!v.includes('passwordHash'));
      assert(!v.includes('PRIVATE LEGAL NAME'));
    }
  }));

test('regulated services cannot be approved through ordinary onboarding checks', () =>
  fixture(async (e) => {
    const owner = await e.onboarding.register({
      role: 'MERCHANT',
      email: 'licensed@example.test',
      password,
      name: 'Licensed Studio',
    });
    await complete(e, owner, 'LICENSED');
    const a = await submit(e, owner);
    await fail(() => review(e, a), 'REGULATED_REVIEW_REQUIRED');
    assert(!(await e.publicCatalog()).stores.some((s) => s.id === owner.storeId));
  }));

async function reservation(e: Engine, staffActor: Actor, listingId: string) {
  const customer: Actor = { id: 'onboarding-customer', role: 'CUSTOMER', verificationLevel: 1 };
  const q = await e.quote(customer, {
    listingId,
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: e.now() + 180 * 60000,
    area: 'shinjuku',
    requiredLanguage: '',
  });
  const h = await e.hold(customer, q.id),
    p = await e.authorizeDemo(customer, h.id, true);
  const booking = await e.createBooking(
    customer,
    {
      holdId: h.id,
      quoteId: q.id,
      paymentId: p.id,
      address: {
        name: 'QA guest',
        area: 'shinjuku',
        type: 'HOTEL',
        detail: 'QA address 1-2-3',
        hotelName: 'QA hotel',
        room: '101',
        hotelPermission: true,
      },
      termsAccepted: true,
      policyVersion: q.cancellationPolicy.version,
    },
    crypto.randomUUID(),
  );
  // A newly invited therapist is outside the seed owner's explicit automatic grant.
  return booking.status === 'REQUESTED'
    ? e.accept(
        { id: 'owner-nagi', role: 'MERCHANT', storeId: 'store-nagi', verificationLevel: 1 },
        booking.id,
        booking.version,
      )
    : booking;
}
test('portrait-only expiry withdraws discovery while preserving the legitimate existing service and payment flow', () =>
  fixture(async (e, advance) => {
    const a = await staff(e),
      app = await approveStaff(e, a);
    let b = await reservation(e, a, app.id);
    b = await e.ack(a, b.id, b.version);
    const c = (await e.onboarding.snapshot(a)).consent!;
    await e.onboarding.consent(a, {
      version: c.version,
      action: 'GRANT',
      termsVersion: CONSENT_TERMS,
      startsAt: e.now(),
      endsAt: e.now() + 60000,
      acknowledged: true,
    });
    advance(120000);
    assert(!(await e.publicCatalog()).listings.some((l) => l.id === app.id));
    assert.equal((await e.onboarding.snapshot(a)).application!.status, 'APPROVED');
    assert.equal((await e.onboarding.snapshot(a)).consent!.status, 'EXPIRED');
    b = await finishVisit(e, b, a, { id: b.customerId, role: 'CUSTOMER', verificationLevel: 1 });
    assert.equal(b.status, 'COMPLETED');
    assert.equal(b.capturedAmount, b.quote.total);
    const history = await e.repo.transaction((tx) =>
      tx.list<{ action: string }>('portraitConsentHistory'),
    );
    assert(history.some((h) => h.action === 'EXPIRED'));
  }));
test('expired credentials block acknowledgement of an existing task and keep merchant cancellation available', () =>
  fixture(async (e, advance) => {
    const a = await staff(e),
      app = await approveStaff(e, a);
    const b = await reservation(e, a, app.id);
    await e.repo.transaction((tx) =>
      tx.put('partnerApplications', { ...app, validUntil: e.now() + 60000 }),
    );
    advance(120000);
    await fail(() => e.ack(a, b.id, b.version), 'QUALIFICATION_UNAVAILABLE');
    const cancelled = await e.cancel(merchant, b.id, b.version);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.capturedAmount, 0);
  }));
for (const decision of ['REJECT', 'SUSPEND'])
  test(`review ${decision} prevents exposure and retains actionable feedback`, () =>
    fixture(async (e) => {
      const a = await staff(e);
      let app = await complete(e, a);
      await grant(e, a);
      app = await submit(e, a);
      if (decision === 'SUSPEND') {
        await e.onboarding.approveContent(merchant, app.id, {
          version: app.version,
          approved: true,
          feedback,
        });
        app = (await e.onboarding.snapshot(a)).application!;
        app = await review(e, app);
      }
      app = await review(e, app, decision);
      assert.equal(app.status, decision === 'REJECT' ? 'REJECTED' : 'SUSPENDED');
      assert.equal(app.feedback, feedback);
      assert(!(await e.publicCatalog()).listings.some((l) => l.id === app.id));
      const saved = await e.onboarding.save(a, { version: app.version, draft: app.draft });
      assert.equal(saved.status, 'DRAFT');
    }));
test('declining an invitation creates no membership and cannot later accept the same token', () =>
  fixture(async (e) => {
    const a = await e.onboarding.register({
        role: 'STAFF',
        email: 'decline@example.test',
        password,
        name: 'Declining Staff',
      }),
      i = await e.onboarding.invite(merchant, {
        email: 'decline@example.test',
        name: 'Declining Staff',
      });
    const result = await e.onboarding.respondInvitation(a, {
      token: i.token,
      action: 'DECLINE',
      bindingAccepted: false,
    });
    assert.equal(result.invitation.status, 'DECLINED');
    assert.equal((await e.onboarding.snapshot(a)).members.length, 0);
    await fail(
      () =>
        e.onboarding.respondInvitation(a, {
          token: i.token,
          action: 'ACCEPT',
          bindingAccepted: true,
        }),
      'INVITATION_UNAVAILABLE',
    );
  }));

test('public portrait processing removes personal image metadata and rejects malformed image bodies', () =>
  fixture(async (e) => {
    const a = await staff(e);
    const source = await sharp(Buffer.from(png, 'base64'))
      .withMetadata({ exif: { IFD0: { Artist: 'PRIVATE PHOTO OWNER' } } })
      .jpeg()
      .toBuffer();
    assert((await sharp(source).metadata()).exif);
    const file = await e.onboarding.upload(a, {
      name: 'personal-photo.jpg',
      mime: 'image/jpeg',
      kind: 'PORTRAIT',
      data: source.toString('base64'),
    });
    const stored = await e.onboarding.evidence(a, file.id),
      clean = await sharp(Buffer.from(stored.data, 'base64')).metadata();
    assert.equal(clean.exif, undefined);
    assert.equal(clean.icc, undefined);
    assert.equal(clean.xmp, undefined);
    assert.equal(stored.mime, 'image/jpeg');
    const fake = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(40)]);
    await fail(
      () =>
        e.onboarding.upload(a, {
          name: 'fake.png',
          mime: 'image/png',
          kind: 'PORTRAIT',
          data: fake.toString('base64'),
        }),
      'INVALID_EVIDENCE',
    );
  }));

test('platform approval rechecks service availability after shop review', () =>
  fixture(async (e) => {
    const a = await staff(e);
    let app = await complete(e, a);
    await grant(e, a);
    app = await submit(e, a);
    await e.onboarding.approveContent(merchant, app.id, {
      version: app.version,
      approved: true,
      feedback,
    });
    app = (await e.onboarding.snapshot(a)).application!;
    await e.repo.transaction(async (tx) => {
      const offering = await tx.get<import('@hogulink/contracts').Offering>(
        'offerings',
        app.draft.offeringIds[0],
      );
      await tx.put('offerings', { ...offering!, active: false });
    });
    await fail(() => review(e, app), 'INVALID_OFFERING');
    assert(!(await e.publicCatalog()).listings.some((l) => l.id === app.id));
  }));
