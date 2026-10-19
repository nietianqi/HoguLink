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

test('ONBOARDING-HTTP identity boundaries, token use, document privacy and protected work access', async (t) => {
  const repo = new Repository('', ':memory:');
  await repo.init();
  await seed(repo);
  const e = new Engine(repo);
  @Module({ controllers: [ApiController], providers: [{ provide: 'ENGINE', useValue: e }] })
  class TestModule {}
  const app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false });
  app.useBodyParser('json', { limit: '512kb' });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  async function request(
    path: string,
    body?: unknown,
    cookie = '',
    method = body === undefined ? 'GET' : 'POST',
    origin = 'http://127.0.0.1:3000',
  ) {
    const res = await fetch(`${base}/v1/${path}`, {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '',
      headers: res.headers,
    };
  }
  const credentials = {
    email: 'http-partner@example.test',
    password: 'Onboarding-http-2026!',
    name: 'HTTP partner',
  };
  try {
    await t.test(
      'anonymous users cannot browse credential queues or private evidence',
      async () => {
        for (const p of [
          'onboarding/workspace',
          'onboarding/reviews',
          'onboarding/evidence/missing',
        ])
          assert.equal((await request(p)).status, 401);
      },
    );
    await t.test('untrusted origins and role escalation are rejected', async () => {
      assert.equal(
        (
          await request(
            'auth/partner/register',
            { role: 'MERCHANT', ...credentials },
            '',
            'POST',
            'https://example.invalid',
          )
        ).status,
        403,
      );
      assert.equal(
        (await request('auth/partner/register', { role: 'ADMIN', ...credentials })).status,
        422,
      );
    });
    const owner = await request('auth/partner/register', { role: 'MERCHANT', ...credentials });
    assert.equal(owner.status, 200);
    await t.test(
      'new merchant sessions are private and cannot be impersonated by the demo shop switcher',
      async () => {
        assert(owner.headers.get('set-cookie')?.includes('HttpOnly'));
        assert(owner.headers.get('set-cookie')?.includes('SameSite=Strict'));
        assert.equal(owner.headers.get('cache-control'), 'no-store');
        assert.equal(
          (await request('auth/demo', { role: 'MERCHANT', storeId: owner.data.storeId })).status,
          403,
        );
        assert.equal(
          (await request('onboarding/workspace', undefined, owner.cookie)).data.application.status,
          'DRAFT',
        );
        assert.equal((await request('onboarding/reviews', undefined, owner.cookie)).status, 403);
      },
    );
    const worker = await request('auth/partner/register', {
      role: 'STAFF',
      ...credentials,
      email: 'http-staff@example.test',
    });
    await t.test(
      'unbound staff can complete onboarding but cannot enter work endpoints',
      async () => {
        assert.equal(
          (await request('auth/session', undefined, worker.cookie)).data.onboardingOnly,
          true,
        );
        assert.equal((await request('staff/workspace', undefined, worker.cookie)).status, 403);
        assert.equal((await request('bookings', undefined, worker.cookie)).status, 403);
        assert.equal((await request('onboarding/workspace', undefined, worker.cookie)).status, 200);
      },
    );
    const invitation = await request(
      'onboarding/invitations',
      { name: 'Invited Staff', email: 'http-staff@example.test' },
      owner.cookie,
    );
    await t.test(
      'inspection is non-consuming; recipient acceptance uses the current session and refreshes membership',
      async () => {
        assert.equal(
          (await request('auth/partner/invitation', { token: invitation.data.token })).status,
          200,
        );
        assert.equal(
          (await request('auth/partner/invitation', { token: invitation.data.token })).status,
          200,
        );
        assert.equal(
          (
            await request(
              'onboarding/invitation-response',
              { token: invitation.data.token, action: 'ACCEPT', bindingAccepted: true },
              owner.cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              'onboarding/invitation-response',
              { token: invitation.data.token, action: 'ACCEPT', bindingAccepted: true },
              worker.cookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (await request('auth/session', undefined, worker.cookie)).data.storeId,
          owner.data.storeId,
        );
        assert.equal(
          (
            await request(
              'onboarding/invitation-response',
              { token: invitation.data.token, action: 'ACCEPT', bindingAccepted: true },
              worker.cookie,
            )
          ).status,
          410,
        );
      },
    );
    const workspace = (await request('onboarding/workspace', undefined, worker.cookie)).data;
    await t.test('managed staff cannot bypass account credentials through demo login', async () => {
      assert.equal(
        (await request('auth/demo', { role: 'STAFF', staffId: workspace.application.staffId }))
          .status,
        403,
      );
    });
    let evidenceId = '';
    await t.test(
      'private uploads accept the bounded file size through HTTP and reject signature spoofing',
      async () => {
        const bytes = Buffer.alloc(340000, 0);
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
        const good = await request(
          'onboarding/evidence',
          {
            name: 'private-document.png',
            mime: 'image/png',
            kind: 'IDENTITY',
            data: bytes.toString('base64'),
          },
          worker.cookie,
        );
        assert.equal(good.status, 200);
        evidenceId = good.data.id;
        assert.equal(good.data.data, undefined);
        assert.equal(
          (
            await request(
              'onboarding/evidence',
              {
                name: 'malicious.html',
                mime: 'image/png',
                kind: 'IDENTITY',
                data: Buffer.from('<html>invalid</html>').toString('base64'),
              },
              worker.cookie,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      'the shop cannot download staff identity documents and public URLs do not reveal evidence',
      async () => {
        assert.equal(
          (await request(`onboarding/evidence/${evidenceId}`, undefined, owner.cookie)).status,
          404,
        );
        assert.equal(
          (await request(`onboarding/evidence/${evidenceId}`, undefined, worker.cookie)).status,
          200,
        );
        assert.equal((await request(`public/portraits/${workspace.application.id}`)).status, 404);
        assert.equal((await request(`onboarding/evidence/${evidenceId}`)).status, 401);
      },
    );
    await t.test(
      'ending membership leaves a loginable onboarding account while revoking access to work',
      async () => {
        const member = (await request('onboarding/workspace', undefined, owner.cookie)).data
          .members[0];
        assert.equal(
          (
            await request(
              `onboarding/members/${member.listing.id}/end`,
              {
                version: member.listing.moderationVersion,
                reason: '结束合作关系，请店铺妥善处理所有未完成订单。',
              },
              owner.cookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (await request('auth/session', undefined, worker.cookie)).data.onboardingOnly,
          true,
        );
        assert.equal((await request('staff/workspace', undefined, worker.cookie)).status, 403);
        assert.equal((await request('onboarding/workspace', undefined, worker.cookie)).status, 200);
      },
    );
    await t.test('logout expires the current credential session', async () => {
      assert.equal((await request('auth/logout', {}, worker.cookie)).status, 200);
      assert.equal((await request('auth/session', undefined, worker.cookie)).status, 401);
    });
  } finally {
    await app.close();
    await repo.close();
  }
});
