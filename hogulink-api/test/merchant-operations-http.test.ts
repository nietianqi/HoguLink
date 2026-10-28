import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiController } from '../src/controller.js';
import { Repository } from '../src/repository.js';
import { Engine } from '../src/engine.js';
import { seed } from '../src/seed.js';
test('MERCHANT-OPERATIONS-HTTP protects project review, intake changes and tenant boundaries', async () => {
  const repo = new Repository('', ':memory:');
  await repo.init();
  await seed(repo);
  const e = new Engine(repo);
  @Module({ controllers: [ApiController], providers: [{ provide: 'ENGINE', useValue: e }] })
  class TestModule {}
  const app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const request = async (
    path: string,
    cookie = '',
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ) => {
    const r = await fetch(`${base}/v1/${path}`, {
      method,
      headers: {
        Origin: 'http://127.0.0.1:3000',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined
          ? {}
          : { 'Content-Type': 'application/json', 'Idempotency-Key': 'http-service-project-01' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  };
  try {
    assert.equal((await request('merchant/service-proposals')).status, 401);
    const owner = (await request('auth/demo', '', { role: 'MERCHANT', storeId: 'store-nagi' }))
      .cookie;
    const other = (await request('auth/demo', '', { role: 'MERCHANT', storeId: 'store-mori' }))
      .cookie;
    const admin = (await request('auth/demo', '', { role: 'ADMIN' })).cookie;
    const staff = (await request('auth/demo', '', { role: 'STAFF', staffId: 'staff-aoi' })).cookie;
    assert.equal(
      (await request('merchant/intake', staff, { version: 0, paused: true }, 'PUT')).status,
      403,
    );
    assert.equal(
      (await request('merchant/intake', owner, { version: 0, paused: true }, 'PUT')).status,
      200,
    );
    assert.equal(
      (await request('merchant/intake', owner, { version: 0, paused: false }, 'PUT')).status,
      409,
    );
    assert.equal(
      (
        await request(
          'merchant/intake',
          owner,
          { version: 1, paused: false, approved: true },
          'PUT',
        )
      ).status,
      422,
    );
    const draft = {
      name: { ja: 'リラックス整体', en: 'Relaxation session', 'zh-cn': '舒缓项目' },
      durationMinutes: 75,
      fulfillmentMode: 'HOME_VISIT',
      price: 10000,
      transportFee: 1000,
      listingIds: ['listing-aoi'],
    };
    const submitted = await request('merchant/service-proposals', owner, draft);
    assert.equal(submitted.status, 201);
    assert.equal((await request('merchant/service-proposals', other)).data.length, 0);
    const path = `admin/service-proposals/${submitted.data.id}/review`;
    assert.equal(
      (await request(path, owner, { version: 1, approve: true, feedback: 'Cannot self approve' }))
        .status,
      403,
    );
    const queue = await request('admin/service-proposals', admin);
    assert.equal(queue.status, 200);
    assert.equal(queue.data.length, 1);
    assert.equal(
      (
        await request(path, admin, {
          version: 1,
          approve: true,
          feedback: 'Reviewed service and staff',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(path, admin, {
          version: 1,
          approve: true,
          feedback: 'Stale duplicate review',
        })
      ).status,
      409,
    );
  } finally {
    await app.close();
    await repo.close();
  }
});
