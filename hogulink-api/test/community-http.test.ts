import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiController } from '../src/controller.js';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/repository.js';
import { seed } from '../src/seed.js';
import { bootstrapAdmin } from '../src/employees.js';

test('community routes through a real server: sessions, origins, roles, review and limits', async () => {
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
    };
  }
  try {
    const customer = (await request('auth/demo', { role: 'CUSTOMER' })).cookie,
      shop = (await request('auth/demo', { role: 'MERCHANT', storeId: 'store-nagi' })).cookie,
      staff = (await request('auth/demo', { role: 'STAFF', staffId: 'staff-aoi' })).cookie,
      admin = (await request('auth/demo', { role: 'ADMIN' })).cookie;
    const question = {
      title: 'Can I book a hotel visit?',
      body: 'I am staying in Shinjuku next week. What should I prepare?',
      language: 'en',
      topic: 'HOTEL',
    };
    assert.equal((await request('community/mine')).status, 401);
    const foreign = await request(
      'community/questions',
      question,
      customer,
      'POST',
      'https://evil.example',
    );
    assert.equal(foreign.body.error.code, 'ORIGIN_REJECTED');
    assert.equal((await request('community/questions', question, staff)).status, 403);

    const asked = await request('community/questions', question, customer);
    assert.equal(asked.status, 200);
    assert.equal(asked.body.status, 'PENDING');
    const contact = await request(
      'community/questions',
      { ...question, body: 'Call me on 090-1234-5678 to arrange it.' },
      customer,
    );
    assert.equal(contact.status, 422);
    assert.equal(contact.body.error.code, 'COMMUNITY_CONTACT');

    assert.equal((await request('admin/community', undefined, customer)).status, 403);
    const queue = await request('admin/community', undefined, admin);
    const item = queue.body.find((x: { id: string }) => x.id === asked.body.id);
    const reviewed = await request(
      `admin/community/posts/${asked.body.id}/review`,
      { version: item.version, decision: 'APPROVE' },
      admin,
    );
    assert.equal(reviewed.body.status, 'PUBLISHED');

    const feed = await request('public/discovery?tab=questions');
    assert(feed.body.items.some((p: { id: string }) => p.id === asked.body.id));
    assert(!JSON.stringify(feed.body).includes('demo-customer'));
    const answer = await request(
      `community/posts/${asked.body.id}/replies`,
      { body: 'Choose hotel and add the room number.', language: 'en' },
      shop,
    );
    assert.equal(answer.body.status, 'PENDING');
    assert.equal(
      (await request(`community/posts/${asked.body.id}/viewer`, undefined, customer)).body.author,
      true,
    );
    assert.equal(
      (await request('merchant/community', undefined, shop)).body.questions[0].id,
      asked.body.id,
    );
    assert.equal(
      (await request('merchant/community/settings', { staffPosting: true }, shop, 'PUT')).body
        .staffPosting,
      true,
    );
    assert.equal((await request('staff/community', undefined, staff)).body.canPost, true);

    // Restrictions stay manageable independently of the pending review queue.
    assert.equal((await request('admin/community/mutes')).status, 401);
    for (const cookie of [customer, shop, staff])
      assert.equal((await request('admin/community/mutes', undefined, cookie)).status, 403);
    await request(
      'admin/community/mutes',
      { ownerId: 'demo-customer', days: 7, reason: 'Repeated contact details.' },
      admin,
    );
    const restrictions = await request('admin/community/mutes', undefined, admin);
    assert.equal(restrictions.body.length, 1);
    assert.equal(restrictions.body[0].author.role, 'CUSTOMER');
    assert.equal(
      (
        await request(
          'admin/community/mutes',
          {
            ownerId: 'demo-customer',
            days: 0,
            expectedUntil: restrictions.body[0].until + 1,
            reason: 'Stale restriction list.',
          },
          admin,
        )
      ).status,
      409,
    );
    const lifted = await request(
      'admin/community/mutes',
      {
        ownerId: 'demo-customer',
        days: 0,
        expectedUntil: restrictions.body[0].until,
        reason: 'Reviewed and released.',
      },
      admin,
    );
    assert.equal(lifted.body.mutedUntil, null);
    assert.deepEqual((await request('admin/community/mutes', undefined, admin)).body, []);

    // Three questions a day per customer; the refused contact attempt counted as one.
    assert.equal((await request('community/questions', question, customer)).status, 200);
    const limited = await request('community/questions', question, customer);
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
  } finally {
    await app.close();
    await repo.close();
  }
});
