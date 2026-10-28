import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  Actor,
  AdminMember,
  Audit,
  Booking,
  SafetyEvent,
  SupportTicket,
} from '@hogulink/contracts';
import { Repository } from '../src/repository.js';
import { Engine } from '../src/engine.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';
const admin: Actor = { id: 'admin-operations-owner', role: 'ADMIN', verificationLevel: 3 };
const customer: Actor = { id: 'customer-operations', role: 'CUSTOMER', verificationLevel: 1 };
const code = (value: string) => (e: unknown) => e instanceof DomainError && e.code === value;
async function member(
  e: Engine,
  role: AdminMember['adminRole'],
  id = role.toLowerCase(),
): Promise<Actor> {
  const teams: AdminMember['teams'] =
    role === 'TRUST_SAFETY' ? ['TRUST_SAFETY'] : ['CUSTOMER_SUPPORT'];
  await e.repo.transaction((tx) =>
    tx.put<AdminMember>('adminMembers', {
      id,
      name: `QA ${role}`,
      email: `${id}@example.test`,
      adminRole: role,
      teams,
      status: 'ACTIVE',
      version: 1,
      sessionVersion: 1,
      createdAt: e.now(),
      updatedAt: e.now(),
    }),
  );
  return {
    id,
    role: 'ADMIN',
    verificationLevel: 3,
    adminRole: role,
    adminTeams: teams,
    adminSessionVersion: 1,
  };
}
async function fixture(fn: (e: Engine, b: Booking) => Promise<void>) {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  await seed(repo);
  const e = new Engine(repo, () => Date.UTC(2026, 9, 18, 0));
  try {
    const q = await e.quote(customer, {
      listingId: 'listing-aoi',
      offeringId: 'store-nagi-60',
      bookingMode: 'SCHEDULED',
      nominationType: 'NOMINATED',
      startAt: e.now() + 3 * 3600000,
      area: 'shinjuku',
      requiredLanguage: '',
    });
    const h = await e.hold(customer, q.id),
      p = await e.authorizeDemo(customer, h.id, true);
    const b = await e.createBooking(
      customer,
      {
        quoteId: q.id,
        holdId: h.id,
        paymentId: p.id,
        termsAccepted: true,
        policyVersion: q.cancellationPolicy.version,
        address: {
          name: 'QA Search Guest',
          type: 'HOTEL',
          area: 'shinjuku',
          detail: 'Secret QA street',
          hotelName: 'QA Hotel',
          room: 'Secret room',
          hotelPermission: true,
        },
      },
      'admin-operations-booking',
    );
    await repo.transaction(async (tx) => {
      await tx.put('customerAccounts', {
        id: customer.id,
        name: 'QA Search Guest',
        email: 'qa-search@example.test',
        status: 'ACTIVE',
        verifiedAt: e.now(),
        createdAt: e.now(),
        salt: 'secret-salt',
        passwordHash: 'secret-password-hash',
      });
      await tx.put<SafetyEvent>('safety', {
        id: 'qa-safety',
        bookingId: b.id,
        storeId: b.storeId,
        staffId: b.assignedStaffId!,
        type: 'SOS',
        status: 'OPEN',
        createdAt: e.now(),
        version: 1,
      });
    });
    await fn(e, b);
  } finally {
    await repo.close();
  }
}
test('customer lookup requires a bounded query and supports name, complete email and booking references', () =>
  fixture(async (e, b) => {
    for (const q of ['QA Search', 'qa-search@example.test', b.id, b.id.slice(-8).toUpperCase()]) {
      const found = await e.admin.customers(admin, { q });
      assert.equal(found.total, 1);
      assert.equal(found.items[0].id, customer.id);
      assert.doesNotMatch(
        JSON.stringify(found),
        /secret-salt|secret-password-hash|Secret QA street|Secret room/,
      );
    }
    assert.equal((await e.admin.customers(admin, { q: '@example.test' })).total, 0);
    await assert.rejects(e.admin.customers(admin, { q: '' }));
    await assert.rejects(e.admin.customers(admin, { q: 'QA', page: 0 }));
    const audit = await e.repo.read((tx) => tx.list<Audit>('audit'));
    assert.equal(audit.filter((a) => a.action === 'CUSTOMER_DIRECTORY_SEARCHED').length, 5);
    assert.ok(
      audit
        .filter((a) => a.action === 'CUSTOMER_DIRECTORY_SEARCHED')
        .every((a) => !a.detail.includes('example.test')),
    );
  }));
test('customer lookup and profiles reject customers, merchants and finance-only employees', () =>
  fixture(async (e) => {
    const finance = await member(e, 'FINANCE');
    for (const actor of [
      customer,
      { id: 'shop', role: 'MERCHANT', verificationLevel: 1 } as Actor,
      finance,
    ]) {
      await assert.rejects(e.admin.customers(actor, { q: 'QA' }), code('FORBIDDEN'));
      await assert.rejects(e.admin.customer(actor, customer.id), code('FORBIDDEN'));
    }
  }));
test('customer profile redacts visit identity and hides private cases from support employees', () =>
  fixture(async (e, b) => {
    const support = await member(e, 'SUPPORT');
    const make = (
      id: string,
      category: SupportTicket['category'],
      visibility: SupportTicket['visibility'],
    ): SupportTicket => ({
      id,
      category,
      visibility,
      customerId: customer.id,
      bookingId: b.id,
      storeId: b.storeId,
      reporterId: customer.id,
      reporterRole: 'CUSTOMER',
      subject: id,
      description: 'Private QA narrative only in the case detail',
      priority: 'NORMAL',
      status: 'OPEN',
      version: 1,
      createdAt: e.now(),
      updatedAt: e.now(),
      dueAt: e.now() + 3600000,
    });
    await e.repo.transaction(async (tx) => {
      await tx.put('supportTickets', make('shared-case', 'SERVICE_QUALITY', 'SHOP_AND_CUSTOMER'));
      await tx.put('supportTickets', make('private-case', 'PRIVACY', 'PLATFORM_ONLY'));
    });
    const profile = await e.admin.customer(support, customer.id);
    assert.deepEqual(
      profile.cases.map((c) => c.id),
      ['shared-case'],
    );
    assert.equal(profile.restriction, undefined);
    assert.ok(
      profile.bookings.every(
        (b) =>
          !('address' in b) &&
          !('customerId' in b) &&
          !('customerId' in b.quote) &&
          !('paymentId' in b),
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(profile),
      /secret-password-hash|Private QA narrative|Secret QA street|Secret room|private-case/,
    );
    const work = await e.admin.caseWork(support);
    assert.deepEqual(
      work.map((w) => w.id),
      ['shared-case'],
    );
    assert.equal((await e.admin.customer(admin, customer.id)).cases.length, 2);
  }));
test('restriction can target a registered customer before their first booking and preserves optimistic versions', () =>
  fixture(async (e) => {
    await e.repo.transaction((tx) =>
      tx.put('customerAccounts', {
        id: 'new-customer',
        name: 'New QA',
        email: 'new@example.test',
        status: 'ACTIVE',
        createdAt: e.now(),
      }),
    );
    const r = await e.care.setRestriction(admin, {
      customerId: 'new-customer',
      active: true,
      reason: 'Documented QA booking restriction',
      expiresAt: e.now() + 3600000,
      version: 0,
    });
    assert.equal(r.version, 1);
    await assert.rejects(
      e.care.setRestriction(admin, {
        customerId: 'new-customer',
        active: false,
        reason: 'Documented QA release reason',
        expiresAt: e.now() + 3600000,
        version: 0,
      }),
      code('VERSION_CONFLICT'),
    );
  }));
test('safety handling is permission-scoped, versioned and omitted from merchant and therapist views', () =>
  fixture(async (e) => {
    const support = await member(e, 'SUPPORT');
    const input = {
      version: 1,
      action: 'ACKNOWLEDGE',
      note: 'Contacting the therapist for a safety check',
      followUpAt: e.now() + 15 * 60000,
    };
    await assert.rejects(e.care.handleSafety(support, 'qa-safety', input), code('FORBIDDEN'));
    const first = await e.care.handleSafety(admin, 'qa-safety', input);
    assert.equal(first.handling?.ownerId, admin.id);
    assert.equal(first.version, 2);
    await assert.rejects(e.care.handleSafety(admin, 'qa-safety', input), code('VERSION_CONFLICT'));
    const shop: Actor = {
      id: 'shop',
      role: 'MERCHANT',
      storeId: 'store-nagi',
      verificationLevel: 1,
    };
    assert.ok((await e.care.safetyEvents(shop)).every((event) => !event.handling));
    const staff: Actor = {
      id: 'staff',
      role: 'STAFF',
      storeId: 'store-nagi',
      staffId: 'staff-aoi',
      verificationLevel: 1,
    };
    assert.ok((await e.care.safetyEvents(staff)).every((event) => !event.handling));
    await assert.rejects(
      e.care.handleSafety(admin, 'qa-safety', {
        ...input,
        version: 2,
        action: 'CONTACT',
        followUpAt: e.now() - 1,
      }),
      code('INVALID_FOLLOW_UP'),
    );
  }));
test('safety handover permits only active safety employees and closes further handling after resolution', () =>
  fixture(async (e) => {
    const safety = await member(e, 'TRUST_SAFETY'),
      finance = await member(e, 'FINANCE');
    let event = await e.care.handleSafety(admin, 'qa-safety', {
      version: 1,
      action: 'ACKNOWLEDGE',
      note: 'QA owner begins the safety investigation',
      followUpAt: e.now() + 60000,
    });
    await assert.rejects(
      e.care.handleSafety(admin, event.id, {
        version: event.version,
        action: 'HANDOVER',
        ownerId: finance.id,
        note: 'QA invalid finance handover request',
        followUpAt: e.now() + 60000,
      }),
      code('INVALID_ASSIGNEE'),
    );
    event = await e.care.handleSafety(admin, event.id, {
      version: event.version,
      action: 'HANDOVER',
      ownerId: safety.id,
      note: 'QA verified shift handover to safety team',
      followUpAt: e.now() + 60000,
    });
    assert.equal(event.handling?.ownerId, safety.id);
    assert.equal(event.handling?.history.length, 2);
    const activity = await e.repo.read((tx) =>
      tx.list<{ eventId: string; note: string }>('safetyHandlingActivity'),
    );
    assert.equal(activity.filter((x) => x.eventId === event.id).length, 2);
    assert.ok(activity.some((x) => x.note.includes('shift handover')));
    const other = await member(e, 'TRUST_SAFETY', 'other-safety');
    await assert.rejects(
      e.care.handleSafety(other, event.id, {
        version: event.version,
        action: 'CONTACT',
        note: 'QA attempt by another safety employee',
        followUpAt: e.now() + 60000,
      }),
      code('FORBIDDEN'),
    );
    await e.care.resolveSafety(
      safety,
      event.id,
      event.version!,
      'QA verified safe outcome and closure',
    );
    await assert.rejects(
      e.care.handleSafety(safety, event.id, {
        version: event.version! + 1,
        action: 'CONTACT',
        note: 'QA cannot update a resolved safety event',
        followUpAt: e.now() + 60000,
      }),
      code('INVALID_STATE'),
    );
  }));
test('audit roles use persisted employee identities rather than identifier guesses', () =>
  fixture(async (e) => {
    const employee = await member(e, 'SUPPORT', 'member-not-containing-admin');
    await e.repo.transaction(async (tx) => {
      await tx.put<Audit>('audit', {
        id: 'qa-legacy-member',
        actorId: employee.id,
        action: 'MEMBER_ACTIVATED',
        at: e.now(),
        detail: '',
      });
      await tx.put<Audit>('audit', {
        id: 'qa-unknown',
        actorId: 'unknown-person',
        action: 'LEGACY_EVENT',
        at: e.now(),
        detail: '',
      });
    });
    const snapshot = await e.admin.snapshot(admin);
    assert.equal(snapshot.audit.find((a) => a.id === 'qa-legacy-member')?.actorRole, 'ADMIN');
    assert.equal(snapshot.audit.find((a) => a.id === 'qa-unknown')?.actorRole, undefined);
  }));
