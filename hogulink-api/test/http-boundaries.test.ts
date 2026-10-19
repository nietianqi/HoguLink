import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Actor, Listing } from '@hogulink/contracts';
import { ApiController } from '../src/controller.js';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/repository.js';
import { seed } from '../src/seed.js';
import { bootstrapAdmin } from '../src/employees.js';

test('FULL-HTTP authentication, permissions, validation and membership revocation through a real server', async (t) => {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  await seed(repo);
  await bootstrapAdmin(repo);
  const e = new Engine(repo);
  @Module({ controllers: [ApiController], providers: [{ provide: 'ENGINE', useValue: e }] })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  async function request(
    path: string,
    body?: unknown,
    cookie = '',
    method = body === undefined ? 'GET' : 'POST',
    headerOrigin: string | null = 'http://127.0.0.1:3000',
  ) {
    const r = await fetch(`${origin}/v1/${path}`, {
      method,
      headers: {
        ...(headerOrigin ? { Origin: headerOrigin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '',
      requestId: r.headers.get('x-request-id'),
      cache: r.headers.get('cache-control'),
    };
  }
  try {
    const customer = (await request('auth/demo', { role: 'CUSTOMER' })).cookie,
      owner = (await request('auth/demo', { role: 'MERCHANT', storeId: 'store-nagi' })).cookie,
      staffCookie = (await request('auth/demo', { role: 'STAFF', staffId: 'staff-aoi' })).cookie,
      root = (await request('auth/demo', { role: 'ADMIN' })).cookie;
    const c: Actor = { id: 'demo-customer', role: 'CUSTOMER', verificationLevel: 1 },
      worker: Actor = {
        id: 'demo-staff-aoi',
        role: 'STAFF',
        staffId: 'staff-aoi',
        storeId: 'store-nagi',
        verificationLevel: 1,
      };
    const q = await e.quote(c, {
        listingId: 'listing-aoi',
        offeringId: 'store-nagi-60',
        bookingMode: 'SCHEDULED',
        nominationType: 'NOMINATED',
        startAt: e.now() + 3 * 3600000,
        area: 'shinjuku',
        requiredLanguage: '',
      }),
      h = await e.hold(c, q.id),
      p = await e.authorizeDemo(c, h.id, true);
    let b = await e.createBooking(
      c,
      {
        quoteId: q.id,
        holdId: h.id,
        paymentId: p.id,
        termsAccepted: true,
        policyVersion: q.cancellationPolicy.version,
        address: {
          name: 'HTTP QA Guest',
          type: 'HOTEL',
          area: 'shinjuku',
          detail: 'Private HTTP address',
          hotelName: 'Sample Hotel',
          room: 'HTTP-303',
          hotelPermission: true,
        },
      },
      randomUUID(),
    );
    b = await e.ack(worker, b.id, b.version);
    const quote = {
      listingId: 'listing-aoi',
      offeringId: 'store-nagi-60',
      bookingMode: 'SCHEDULED',
      nominationType: 'NOMINATED',
      startAt: e.now() + 7 * 3600000,
      area: 'shinjuku',
      requiredLanguage: '',
    };
    await t.test(
      'public health returns demo truth, request identity and no-store headers',
      async () => {
        const r = await request('health');
        assert.equal(r.status, 200);
        assert.equal(r.body.productionReady, false);
        assert.ok(r.requestId);
        assert.equal(r.cache, 'no-store');
      },
    );
    for (const cookie of ['', 'hogu_session=invalid', `hogu_session=${'f'.repeat(64)}`])
      await t.test(`invalid session ${cookie.length} cannot read protected orders`, async () => {
        const r = await request('bookings', undefined, cookie);
        assert.equal(r.status, 401);
        assert.equal(r.body.error.code, 'UNAUTHENTICATED');
      });
    for (const header of [null, 'https://untrusted.example'])
      await t.test(`mutations reject untrusted origin ${header ?? 'missing'}`, async () => {
        const r = await request('auth/demo', { role: 'ADMIN' }, '', 'POST', header);
        assert.equal(r.status, 403);
        assert.equal(r.body.error.code, 'ORIGIN_REJECTED');
      });
    for (const role of ['CUSTOMER', 'MERCHANT', 'STAFF'] as const) {
      const cookie = { CUSTOMER: customer, MERCHANT: owner, STAFF: staffCookie }[role];
      await t.test(`${role} cannot list employees or decide reviews`, async () => {
        assert.equal((await request('admin/members', undefined, cookie)).status, 403);
        assert.equal((await request('admin/reviews', {}, cookie)).status, 403);
      });
    }
    const invalidQuotes = [
      { ...quote, merchantId: 'forged-store' },
      { ...quote, startAt: 'tomorrow' },
      { ...quote, bookingMode: 'UNKNOWN' },
      { ...quote, nominationType: 'UNKNOWN' },
      { ...quote, requiredLanguage: 1 },
    ];
    for (let i = 0; i < invalidQuotes.length; i++)
      await t.test(
        `quote schema rejects malformed payload ${i + 1} without a server error`,
        async () => {
          const r = await request('quotes', invalidQuotes[i], customer);
          assert.equal(r.status, 422);
          assert.equal(r.body.error.code, 'VALIDATION_ERROR');
          assert.ok(r.requestId);
        },
      );
    await t.test('staff cannot change shop prices even with otherwise valid input', async () => {
      const r = await request(
        'merchant/services/store-nagi-60',
        { version: 1, price: 9000, transportFee: 1000, active: true },
        staffCookie,
        'PUT',
      );
      assert.equal(r.status, 403);
    });
    await t.test('wrong HTTP methods and unknown routes fail with a controlled 404', async () => {
      assert.equal((await request('quotes', quote, customer, 'PUT')).status, 404);
      assert.equal((await request('unknown-route', undefined, customer)).status, 404);
    });
    await t.test(
      'out-of-order completion is rejected without capture or ledger entries',
      async () => {
        const r = await request(
          `staff/tasks/${b.id}/events`,
          { version: b.version, event: 'COMPLETE' },
          staffCookie,
        );
        assert.equal(r.status, 409);
        const fresh = await e.booking(c, b.id);
        assert.equal(fresh.capturedAmount, 0);
        assert.equal((await e.repo.transaction((tx) => tx.list('feeEntries'))).length, 0);
      },
    );
    const employees: Record<string, { cookie: string; actor: Actor }> = {};
    for (const [role, teams] of [
      ['SUPPORT', ['CUSTOMER_SUPPORT']],
      ['OPERATIONS', ['CUSTOMER_SUPPORT']],
      ['TRUST_SAFETY', ['TRUST_SAFETY']],
      ['FINANCE', []],
      ['AUDITOR', []],
    ] as const) {
      const invitation = await e.employees.create(
        { id: 'demo-admin', role: 'ADMIN', verificationLevel: 3 },
        {
          name: `HTTP ${role}`,
          email: `${role.toLowerCase()}@regression.test`,
          adminRole: role,
          teams,
        },
      );
      await e.employees.activate({
        token: invitation.token,
        password: 'Regression-password-2026!',
      });
      const login = await request('auth/employee/login', {
        email: invitation.member.email,
        password: 'Regression-password-2026!',
      });
      assert.equal(login.status, 200);
      employees[role] = { cookie: login.cookie, actor: login.body };
    }
    for (const role of Object.keys(employees))
      await t.test(
        `${role} cannot gain employee management or legacy dashboard access`,
        async () => {
          assert.equal(
            (await request('admin/members', undefined, employees[role].cookie)).status,
            403,
          );
          assert.equal((await request('dashboard', undefined, employees[role].cookie)).status, 403);
        },
      );
    for (const role of ['FINANCE', 'AUDITOR'])
      await t.test(`${role} has no case mutation or review decision access`, async () => {
        for (const path of ['support-tickets', 'admin/customer-restrictions'])
          assert.equal((await request(path, undefined, employees[role].cookie)).status, 403);
        assert.equal((await request('admin/reviews', {}, employees[role].cookie)).status, 403);
      });
    await t.test(
      'an expired employee session is rejected before returning any workspace data',
      async () => {
        const actor = employees.SUPPORT.actor;
        await e.repo.transaction(async (tx) => {
          const m = (await tx.get<import('@hogulink/contracts').AdminMember>(
            'adminMembers',
            actor.id,
          ))!;
          await tx.put('adminMembers', { ...m, sessionVersion: m.sessionVersion + 1 });
        });
        const r = await request('admin/workspace', undefined, employees.SUPPORT.cookie);
        assert.equal(r.status, 401);
        assert.equal(r.body.actor, undefined);
      },
    );
    await t.test(
      'revoking staff membership expires its existing HTTP session and writes one safe audit event',
      async () => {
        await e.repo.transaction(async (tx) => {
          const listing = (await tx.get<Listing>('listings', 'listing-aoi'))!;
          await tx.put('listings', { ...listing, membershipActive: false });
        });
        for (const path of [
          `bookings/${b.id}`,
          'bookings',
          `staff/tasks/${b.id}/messages`,
          'staff/workspace',
        ]) {
          const r = await request(path, undefined, staffCookie);
          assert.equal(r.status, 401);
          assert.equal(JSON.stringify(r.body).includes('HTTP-303'), false);
        }
        const events = (
          await e.repo.transaction((tx) => tx.list<{ action: string; detail: string }>('audit'))
        ).filter((a) => a.action === 'STAFF_SESSION_REVOKED');
        assert.equal(events.length, 1);
        assert.equal(events[0].detail, 'staff-aoi');
      },
    );
    await t.test(
      'logout invalidates a cookie for both session and business endpoints',
      async () => {
        assert.equal((await request('auth/logout', {}, customer)).status, 200);
        assert.equal((await request('auth/session', undefined, customer)).status, 401);
        assert.equal((await request('bookings', undefined, customer)).status, 401);
      },
    );
    await t.test(
      'owner session remains usable after failures and role-isolated requests',
      async () => {
        assert.equal((await request('admin/workspace', undefined, root)).status, 200);
      },
    );
  } finally {
    await app.close();
    await repo.close();
  }
});
