import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Actor, Booking } from '@hogulink/contracts';
import { ApiController } from '../src/controller.js';
import { Repository } from '../src/repository.js';
import { Engine } from '../src/engine.js';
import { seed } from '../src/seed.js';

test('HTTP exception workflows use authenticated parties, server clocks and atomic financial decisions', async (t) => {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  await seed(repo);
  let now = Date.UTC(2026, 9, 18, 0);
  const e = new Engine(repo, () => now);
  @Module({ controllers: [ApiController], providers: [{ provide: 'ENGINE', useValue: e }] })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  async function request(path: string, cookie = '', body?: object, key = '') {
    const response = await fetch(`${origin}/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Origin: 'http://127.0.0.1:3000',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  }
  try {
    const customer = (await request('auth/demo', '', { role: 'CUSTOMER' })).cookie,
      staffCookie = (await request('auth/demo', '', { role: 'STAFF', staffId: 'staff-aoi' }))
        .cookie,
      ownerCookie = (await request('auth/demo', '', { role: 'MERCHANT', storeId: 'store-nagi' }))
        .cookie;
    const c: Actor = { id: 'demo-customer', role: 'CUSTOMER', verificationLevel: 1 },
      s: Actor = {
        id: 'demo-staff-staff-aoi',
        role: 'STAFF',
        staffId: 'staff-aoi',
        storeId: 'store-nagi',
        verificationLevel: 1,
      };
    const quoteInput = () => ({
      listingId: 'listing-aoi',
      offeringId: 'store-nagi-60',
      bookingMode: 'SCHEDULED',
      nominationType: 'NOMINATED',
      startAt: now + 3 * 3600000,
      area: 'shinjuku',
      requiredLanguage: '',
    });
    const q = await e.quote(c, quoteInput()),
      h = await e.hold(c, q.id),
      p = await e.authorizeDemo(c, h.id, true);
    let b = await e.createBooking(
      c,
      {
        quoteId: q.id,
        holdId: h.id,
        paymentId: p.id,
        policyVersion: q.cancellationPolicy.version,
        termsAccepted: true,
        address: {
          name: 'HTTP Guest',
          area: 'shinjuku',
          type: 'HOTEL',
          detail: 'HTTP isolated test address',
          hotelName: 'QA Hotel',
          room: '101',
          hotelPermission: true,
        },
      },
      randomUUID(),
    );
    b = await e.ack(s, b.id, b.version);
    const path = `bookings/${b.id}/no-show`,
      note = 'Please review the recorded arrival and contact evidence.';
    const action = (a: string, cookie: string, key = randomUUID()) =>
      request(path, cookie, { version: b.version, action: a, text: note }, key);
    await t.test(
      'new route rejects unknown input, missing sessions and wrong parties',
      async () => {
        assert.equal((await action('CONTACT', '')).status, 401);
        assert.equal((await action('CONTACT', customer)).status, 403);
        assert.equal(
          (
            await request(
              path,
              staffCookie,
              { version: b.version, action: 'CONTACT', text: note, clientTime: now + 999999 },
              randomUUID(),
            )
          ).status,
          422,
        );
        assert.equal((await action('CONTACT', staffCookie)).status, 409);
      },
    );
    now = b.quote.startAt;
    b = await e.event(s, b.id, b.version, 'EN_ROUTE');
    b = await e.event(s, b.id, b.version, 'ARRIVED');
    await t.test(
      'contact messages are idempotent and cannot be fabricated at the same time',
      async () => {
        const key = randomUUID(),
          first = await action('CONTACT', staffCookie, key);
        assert.equal(first.status, 200);
        b = first.body;
        const replay = await action('CONTACT', staffCookie, key);
        assert.equal(replay.status, 200);
        assert.equal(replay.body.noShow.contacts.length, 1);
        assert.equal((await action('CONTACT', staffCookie)).status, 409);
        now += 120000;
        const second = await action('CONTACT', staffCookie);
        assert.equal(second.status, 200);
        b = second.body;
        assert.equal(
          (await request(`customer/bookings/${b.id}/messages`, customer)).body.length,
          2,
        );
      },
    );
    await t.test(
      'server waiting gate prevents an early report and reporting never captures money',
      async () => {
        assert.equal((await action('REPORT', staffCookie)).status, 409);
        now = b.noShow!.waitUntil;
        const result = await action('REPORT', staffCookie);
        assert.equal(result.status, 200);
        b = result.body;
        assert.equal(b.capturedAmount, 0);
        assert.equal((await action('CONFIRM', staffCookie)).status, 403);
      },
    );
    await t.test(
      'shop confirmation and replay capture exactly the snapshotted fee once',
      async () => {
        const key = randomUUID(),
          confirmed = await action('CONFIRM', ownerCookie, key);
        assert.equal(confirmed.status, 200);
        b = confirmed.body;
        const replay = await action('CONFIRM', ownerCookie, key);
        assert.equal(replay.status, 200);
        assert.equal(replay.body.capturedAmount, 2310);
        assert.equal(replay.body.platformFee, 0);
        assert.equal(replay.body.cancelReason, 'CUSTOMER_NO_SHOW');
        const view = await request(`bookings/${b.id}`, customer);
        assert.equal(view.body.noShow.status, 'CONFIRMED');
      },
    );
    await t.test(
      'HTTP failed authorization releases checkout and requires reserving again',
      async () => {
        const quote = await request('quotes', customer, quoteInput()),
          hold = await request('booking-holds', customer, { quoteId: quote.body.id });
        assert.equal(hold.status, 201);
        assert.equal(
          (
            await request('payments/demo-authorizations', customer, {
              holdId: hold.body.id,
              challengePassed: false,
            })
          ).status,
          402,
        );
        assert.equal((await request(`booking-holds/${hold.body.id}`, customer)).status, 409);
        const next = await request('booking-holds', customer, { quoteId: quote.body.id });
        assert.equal(next.status, 201);
        assert.notEqual(next.body.id, hold.body.id);
      },
    );
  } finally {
    await app.close();
    await repo.close();
  }
});
