import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  versionInput,
  type Actor,
  type Listing,
  type Store,
  type AdminMember,
} from '@hogulink/contracts';
import { Engine } from './engine.js';
import { listingStats, mobileBootstrap, mobileTherapists, storeStats } from './mobile.js';
import { DomainError, ensure } from './errors.js';
import { authorizeAdminRoute, bootstrapMember, currentAdmin } from './admin-access.js';
import { activeStaffMembership } from './staff-access.js';
import { stores as demoStores, listings as demoListings } from './seed.js';

type Session = { id: string; actor: Actor; expiresAt: number };
const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
/**
 * A local web origin also accepts its localhost/127.0.0.1 twin: both reach the same machine,
 * and mixing them otherwise rejects every sign-in and booking. Public origins stay exact.
 */
export function webOrigins(configured = process.env.WEB_ORIGIN) {
  if (!configured) return new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
  const origins = new Set([configured]);
  try {
    const url = new URL(configured);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
      origins.add(url.origin);
    }
  } catch {}
  return origins;
}
const allowedOrigins = webOrigins();
const demoEnabled = () =>
  process.env.DEMO_ACCESS_ENABLED !== '0' && (process.env.APP_MODE ?? 'demo') === 'demo';
const secureCookie = () =>
  process.env.NODE_ENV === 'production' ||
  (process.env.PUBLIC_WEB_URL || process.env.WEB_ORIGIN || '').startsWith('https:');
@Controller('v1')
export class ApiController {
  constructor(@Inject('ENGINE') private engine: Engine) {}
  /** The signed-in customer on a public page, if any; public reads never require one. */
  private async viewingCustomer(req: Request) {
    const viewer = await this.actor(req).catch(() => undefined);
    return viewer?.role === 'CUSTOMER' ? viewer.id : undefined;
  }
  private async actor(req: Request): Promise<Actor> {
    const token = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('hogu_session='))
      ?.slice(13);
    ensure(
      token && /^[a-f0-9]{64}$/.test(token),
      'UNAUTHENTICATED',
      'Please sign in to continue.',
      401,
    );
    const session = await this.engine.repo.transaction((tx) =>
      tx.get<Session>('sessions', hashToken(token)),
    );
    ensure(
      session && session.expiresAt > Date.now(),
      'UNAUTHENTICATED',
      'Your session expired. Please sign in.',
      401,
    );
    if (session.actor.customerAccountId) return this.engine.customers.resolve(session.actor);
    ensure(
      demoEnabled() || !session.actor.id.startsWith('demo-'),
      'UNAUTHENTICATED',
      'Demo access is disabled.',
      401,
    );
    if (session.actor.partnerAccountId) return this.engine.onboarding.resolveActor(session.actor);
    if (session.actor.role === 'STAFF') {
      const active = await this.engine.repo.transaction(async (tx) => {
        if (await activeStaffMembership(tx, session.actor)) return true;
        await tx.put('sessions', { ...session, expiresAt: 0 });
        await tx.put('audit', {
          id: `audit_${randomUUID()}`,
          actorId: session.actor.id,
          action: 'STAFF_SESSION_REVOKED',
          detail: session.actor.staffId ?? '',
          at: this.engine.now(),
        });
        return false;
      });
      ensure(active, 'UNAUTHENTICATED', 'Your shop membership changed. Please sign in again.', 401);
    }
    if (session.actor.role !== 'ADMIN') return session.actor;
    return this.engine.repo.transaction(async (tx) => {
      const actor = session.actor;
      if (actor.id === 'demo-admin') {
        const member =
          (await tx.get<import('@hogulink/contracts').AdminMember>('adminMembers', actor.id)) ??
          bootstrapMember(Date.now());
        return {
          ...actor,
          adminRole: member.adminRole,
          adminTeams: member.teams,
          adminSessionVersion: member.sessionVersion,
          displayName: member.name,
        };
      }
      return currentAdmin(tx, actor);
    });
  }
  private async session(res: Response, actor: Actor, req?: Request) {
    const token = randomBytes(32).toString('hex');
    await this.engine.repo.transaction(async (tx) => {
      const old = req?.headers.cookie
        ?.split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith('hogu_session='))
        ?.slice(13);
      if (old && /^[a-f0-9]{64}$/.test(old)) await tx.remove('sessions', hashToken(old));
      await tx.put<Session>('sessions', {
        id: hashToken(token),
        actor,
        expiresAt: Date.now() + 12 * 3600000,
      });
    });
    res.setHeader(
      'Set-Cookie',
      `hogu_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookie() ? '; Secure' : ''}`,
    );
    return res.json(actor);
  }
  @All('*path')
  async handle(@Req() req: Request, @Res() res: Response) {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
        ensure(
          allowedOrigins.has(req.headers.origin ?? ''),
          'ORIGIN_REJECTED',
          'This request origin is not allowed.',
          403,
        );
      const path = req.path.replace(/^\/v1\//, '').replace(/\/$/, '');
      const method = req.method;
      const body = req.body ?? {};
      if (path.startsWith('auth/demo'))
        ensure(demoEnabled(), 'NOT_FOUND', 'API route not found.', 404);
      if (path.startsWith('auth/') && method === 'POST')
        await this.engine.limits.check('auth-ip', req.ip || 'local', 60);
      if (path.startsWith('auth/customer/') && method === 'POST') {
        const action = path.slice('auth/customer/'.length);
        if (action === 'register') return res.json(await this.engine.customers.register(body));
        if (action === 'login')
          return this.session(res, await this.engine.customers.login(body), req);
        if (action === 'resend-verification')
          return res.json(await this.engine.customers.request(body, 'verify'));
        if (action === 'forgot-password')
          return res.json(await this.engine.customers.request(body, 'reset'));
        if (action === 'verify-email')
          return res.json(await this.engine.customers.confirm(body, 'verify'));
        if (action === 'reset-password')
          return res.json(await this.engine.customers.confirm(body, 'reset'));
      }
      if (path === 'health' && method === 'GET') {
        await this.engine.repo.read((tx) => tx.get('schemaCheck', 'health'));
        return res.json({
          status: 'ok',
          mode: process.env.APP_MODE || 'demo',
          paymentProvider: 'demo',
          productionReady: false,
          demoAccessEnabled: demoEnabled(),
          customerAccounts: true,
          notificationConfigured: (process.env.EMAIL_PROVIDER || 'disabled') !== 'disabled',
        });
      }
      if (path === 'health/ready' && method === 'GET') {
        const { worker, backup, blocked, failed, late } = await this.engine.repo.read(
          async (tx) => ({
            worker: await tx.get<{ at: number }>('systemHealth', 'background'),
            backup: await tx.get<{ at: number; status: string }>('systemHealth', 'backup'),
            blocked: await tx.count('outbox', { status: 'BLOCKED' }),
            failed: await tx.count('outbox', { status: 'FAILED' }),
            late: await tx.count('outbox', {
              status: ['PENDING', 'PROCESSING', 'RETRY'],
              createdAt: { lte: Date.now() - 300000 },
            }),
          }),
        );
        const backgroundHealthy = !!worker && Date.now() - worker.at < 120000;
        const backupHealthy =
          process.env.BACKUP_REQUIRED !== '1' ||
          (backup?.status === 'ok' && Date.now() - backup.at < 26 * 3600000);
        const deliveryHealthy =
          process.env.NOTIFICATIONS_REQUIRED !== '1' ||
          (blocked === 0 && failed === 0 && late === 0);
        const ready = backgroundHealthy && backupHealthy && deliveryHealthy;
        return res.status(ready ? 200 : 503).json({
          status: ready ? 'ok' : 'degraded',
          backgroundHealthy,
          backupHealthy,
          deliveryHealthy,
          productionReady: false,
        });
      }
      if (path === 'auth/demo-shops' && method === 'GET')
        return res.json(demoStores.map((s) => ({ id: s.id, name: s.name })));
      if (path === 'auth/demo-staff' && method === 'GET')
        return res.json(
          demoListings.map((s) => ({
            staffId: s.staffId,
            name: s.name,
            storeName: demoStores.find((st) => st.id === s.storeId)!.name,
          })),
        );
      if (path === 'auth/demo' && method === 'POST') {
        const data = z
          .object({
            role: z.enum(['CUSTOMER', 'MERCHANT', 'STAFF', 'ADMIN']),
            storeId: z.string().optional(),
            staffId: z.string().optional(),
            adminPersona: z.enum(['FINANCE']).optional(),
          })
          .strict()
          .parse(body);
        const actor: Actor = { id: 'demo-customer', role: data.role, verificationLevel: 1 };
        ensure(
          !data.adminPersona || data.role === 'ADMIN',
          'INVALID_INPUT',
          'A finance persona is only available for demo administrators.',
        );
        if (data.role === 'MERCHANT') {
          const store = await this.engine.repo.transaction((tx) =>
            tx.get<Store>('stores', data.storeId || 'store-nagi'),
          );
          ensure(store, 'NOT_FOUND', 'Demo shop not found.', 404);
          ensure(
            !(await this.engine.repo.transaction((tx) => tx.get('partnerApplications', store.id))),
            'FORBIDDEN',
            'Use the shop owner account to sign in.',
            403,
          );
          actor.storeId = store.id;
          actor.id = `demo-owner-${store.id}`;
        } else if (data.role === 'STAFF') {
          const listing = await this.engine.repo.transaction(async (tx) =>
            (await tx.list<Listing>('listings')).find(
              (x) => x.staffId === (data.staffId || 'staff-aoi'),
            ),
          );
          ensure(listing, 'NOT_FOUND', 'Demo staff not found.', 404);
          ensure(
            !(await this.engine.repo.transaction((tx) =>
              tx.get('partnerApplications', listing.id),
            )),
            'FORBIDDEN',
            'Use your personal staff account to sign in.',
            403,
          );
          actor.staffId = listing.staffId;
          actor.storeId = listing.storeId;
          actor.id = `demo-${listing.staffId}`;
        } else if (data.role === 'ADMIN') {
          actor.id = 'demo-admin';
          actor.verificationLevel = 3;
          if (data.adminPersona === 'FINANCE') {
            const member = await this.engine.repo.transaction(async (tx) => {
              let m = await tx.get<AdminMember>('adminMembers', 'demo-finance');
              if (!m) {
                m = {
                  id: 'demo-finance',
                  name: 'Demo Finance',
                  email: 'finance@hogulink.example',
                  adminRole: 'FINANCE',
                  teams: [],
                  status: 'ACTIVE',
                  version: 1,
                  sessionVersion: 1,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  bootstrap: true,
                };
                await tx.put('adminMembers', m);
              }
              ensure(
                m.bootstrap && m.adminRole === 'FINANCE' && m.status === 'ACTIVE',
                'FORBIDDEN',
                'Demo finance access is unavailable.',
                403,
              );
              return m;
            });
            Object.assign(actor, {
              id: member.id,
              adminRole: member.adminRole,
              adminTeams: member.teams,
              adminSessionVersion: member.sessionVersion,
              displayName: member.name,
            });
          }
        }
        return this.session(res, actor, req);
      }
      if (path === 'auth/session' && method === 'GET') return res.json(await this.actor(req));
      if (
        ['auth/partner/register', 'auth/partner/login', 'auth/partner/invitation'].includes(path) &&
        method === 'POST'
      ) {
        if (path.endsWith('/invitation'))
          return res.json(await this.engine.onboarding.inspectInvitation(body));
        return this.session(
          res,
          path.endsWith('/register')
            ? await this.engine.onboarding.register(body)
            : await this.engine.onboarding.login(body),
          req,
        );
      }
      if (
        [
          'auth/employee/login',
          'auth/employee/activate',
          'auth/employee/invitation',
          'auth/employee/mfa-enrollment',
        ].includes(path) &&
        method === 'POST'
      ) {
        if (path.endsWith('/login'))
          return this.session(res, await this.engine.employees.login(body), req);
        return res.json(
          path.endsWith('/activate')
            ? await this.engine.employees.activate(body)
            : path.endsWith('/mfa-enrollment')
              ? await this.engine.employees.enrollment(body)
              : await this.engine.employees.inspect(body),
        );
      }
      if (path === 'auth/logout' && method === 'POST') {
        const token = req.headers.cookie
          ?.split(';')
          .map((x) => x.trim())
          .find((x) => x.startsWith('hogu_session='))
          ?.slice(13);
        if (token)
          await this.engine.repo.transaction(async (tx) => {
            const session = await tx.get<Session>('sessions', hashToken(token));
            if (session) await tx.put('sessions', { ...session, expiresAt: 0 });
          });
        res.setHeader(
          'Set-Cookie',
          `hogu_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie() ? '; Secure' : ''}`,
        );
        return res.json({ ok: true });
      }
      if (path === 'public/experiences' && method === 'GET')
        return res.json(
          await this.engine.experience.publicReviews({
            storeId: typeof req.query.storeId === 'string' ? req.query.storeId : undefined,
            listingId: typeof req.query.listingId === 'string' ? req.query.listingId : undefined,
            cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
          }),
        );
      if (path === 'public/h5/bootstrap' && method === 'GET')
        return res.json(await mobileBootstrap(this.engine));
      if (path === 'public/discovery' && method === 'GET')
        return res.json(await this.engine.discovery.feed(req.query));
      const discoveryPost = path.match(/^public\/discovery\/([a-zA-Z0-9_-]{1,160})$/);
      if (discoveryPost && method === 'GET')
        return res.json(await this.engine.discovery.detail(discoveryPost[1], req.query));
      if (path === 'public/h5/therapists' && method === 'GET')
        return res.json(await mobileTherapists(this.engine, req.query));
      if (path === 'public/listing-stats' && method === 'GET') {
        const ids = z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,80}(,[a-zA-Z0-9_-]{1,80}){0,49}$/)
          .parse(req.query.ids)
          .split(',');
        const live = new Set((await this.engine.publicCatalog()).listings.map((x) => x.id));
        return res.json(
          await listingStats(
            this.engine,
            ids.filter((id) => live.has(id)),
          ),
        );
      }
      if (path === 'public/store-stats' && method === 'GET') {
        const ids = z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,80}(,[a-zA-Z0-9_-]{1,80}){0,49}$/)
          .parse(req.query.ids)
          .split(',');
        const live = new Set((await this.engine.publicCatalog()).stores.map((x) => x.id));
        return res.json(
          await storeStats(
            this.engine,
            ids.filter((id) => live.has(id)),
          ),
        );
      }
      if (path === 'public/staff-listings' && method === 'GET')
        return res.json(
          await this.engine.publicCatalog({
            area: typeof req.query.area === 'string' ? req.query.area : undefined,
            language: typeof req.query.language === 'string' ? req.query.language : undefined,
            mode: typeof req.query.mode === 'string' ? req.query.mode : undefined,
            fulfillmentMode:
              typeof req.query.fulfillmentMode === 'string' ? req.query.fulfillmentMode : undefined,
          }),
        );
      let match = path.match(/^public\/staff-listings\/([^/]+)\/availability$/);
      if (match && method === 'GET')
        return res.json(
          await this.engine.availability(
            decodeURIComponent(match[1]),
            typeof req.query.offeringId === 'string' ? req.query.offeringId : undefined,
            false,
            typeof req.query.language === 'string' ? req.query.language : '',
            req.query.mode === 'INSTANT' ? 'INSTANT' : 'SCHEDULED',
            typeof req.query.area === 'string' ? req.query.area : '',
            req.query.fulfillmentMode === 'IN_STORE' ? 'IN_STORE' : 'HOME_VISIT',
            Number(req.query.days) || undefined,
            await this.viewingCustomer(req),
          ),
        );
      match = path.match(/^public\/stores\/([^/]+)\/free-availability$/);
      if (match && method === 'GET') {
        const c = await this.engine.publicCatalog({
          fulfillmentMode: req.query.fulfillmentMode === 'IN_STORE' ? 'IN_STORE' : 'HOME_VISIT',
        });
        const store = c.stores.find((x) => x.slug === match![1]);
        const listing = store && c.listings.find((x) => x.storeId === store.id);
        ensure(listing, 'NOT_FOUND', 'Shop not found.', 404);
        return res.json(
          await this.engine.availability(
            listing.id,
            typeof req.query.offeringId === 'string' ? req.query.offeringId : undefined,
            true,
            typeof req.query.language === 'string' ? req.query.language : '',
            req.query.mode === 'INSTANT' ? 'INSTANT' : 'SCHEDULED',
            typeof req.query.area === 'string' ? req.query.area : '',
            req.query.fulfillmentMode === 'IN_STORE' ? 'IN_STORE' : 'HOME_VISIT',
            Number(req.query.days) || undefined,
            await this.viewingCustomer(req),
          ),
        );
      }
      match = path.match(/^public\/staff-listings\/([^/]+)$/);
      if (match && method === 'GET') {
        const catalog = await this.engine.publicCatalog({ fulfillmentMode: 'ALL' });
        const listing = catalog.listings.find((x) => x.slug === match![1] || x.id === match![1]);
        ensure(listing, 'NOT_FOUND', 'Listing not found.', 404);
        return res.json({
          listing,
          store: catalog.stores.find((x) => x.id === listing.storeId),
          offerings: catalog.offerings.filter((x) => listing.offeringIds.includes(x.id)),
        });
      }
      match = path.match(/^public\/stores\/([^/]+)$/);
      if (match && method === 'GET') {
        const catalog = await this.engine.publicCatalog({ fulfillmentMode: 'ALL' });
        const store = catalog.stores.find((x) => x.slug === match![1]);
        ensure(store, 'NOT_FOUND', 'Shop not found.', 404);
        return res.json({
          ...store,
          listings: catalog.listings.filter((x) => x.storeId === store.id),
          offerings: catalog.offerings.filter((x) => x.storeId === store.id),
        });
      }
      match = path.match(/^public\/shop-assets\/(brand_[0-9a-f-]{36})$/);
      if (match && method === 'GET') {
        const viewer = await this.actor(req).catch(() => undefined);
        const file = await this.engine.storefronts.file(match[1], viewer);
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, no-store');
        return res.send(file.bytes);
      }
      match = path.match(/^public\/venue-photos\/(evidence_[0-9a-f-]{36})$/);
      if (match && method === 'GET') {
        // Signed-in shops and reviewers may also preview photos that are not yet approved.
        const viewer = await this.actor(req).catch(() => undefined);
        const photo = await this.engine.venues.photo(match[1], viewer);
        res.setHeader('Content-Type', photo.mime);
        res.setHeader(
          'Cache-Control',
          photo.published ? 'public, max-age=300' : 'private, no-store',
        );
        return res.send(photo.bytes);
      }
      match = path.match(/^public\/listing-media\/(media_[0-9a-f-]{36})(\/poster)?$/);
      if (match && method === 'GET') {
        // Like venue photos: public once approved, otherwise only the people managing it.
        const viewer = await this.actor(req).catch(() => undefined);
        const file = await this.engine.media.file(match[1], match[2] ? 'poster' : 'file', viewer);
        res.setHeader('Content-Type', file.mime);
        res.setHeader(
          'Cache-Control',
          file.published ? 'public, max-age=300' : 'private, no-store',
        );
        res.setHeader('Accept-Ranges', 'bytes');
        // Mobile browsers fetch video in byte ranges and refuse to play without them.
        const total = file.bytes.length,
          range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2])),
            end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
          if (start >= total || start > end) {
            res.setHeader('Content-Range', `bytes */${total}`);
            return res.status(416).end();
          }
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          return res.status(206).send(file.bytes.subarray(start, end + 1));
        }
        return res.send(file.bytes);
      }
      match = path.match(/^public\/portraits\/([^/]+)$/);
      if (match && method === 'GET') {
        const portrait = await this.engine.onboarding.publicPortrait(match[1]);
        res.setHeader('Content-Type', portrait.mime);
        return res.send(portrait.bytes);
      }
      const actor = await this.actor(req);
      if (path === 'customer/discovery/saved' && method === 'GET')
        return res.json(await this.engine.discovery.saved(actor));
      const discoveryAction = path.match(/^customer\/discovery\/([a-zA-Z0-9_-]{1,160})(\/view)?$/);
      if (discoveryAction) {
        if (['PUT', 'POST'].includes(method))
          await this.engine.limits.check('discovery-write', actor.id, 60);
        if (discoveryAction[2] && method === 'POST')
          return res.json(await this.engine.discovery.view(actor, discoveryAction[1]));
        if (!discoveryAction[2] && method === 'GET')
          return res.json(await this.engine.discovery.state(actor, discoveryAction[1]));
        if (!discoveryAction[2] && method === 'PUT')
          return res.json(await this.engine.discovery.react(actor, discoveryAction[1], body));
      }
      if (path === 'admin/content-reviews' && method === 'GET')
        return res.json(await this.engine.contentReview.list(actor));
      const contentReview = path.match(/^admin\/content-reviews\/([^/]+)$/);
      if (contentReview && method === 'GET')
        return res.json(await this.engine.contentReview.detail(actor, contentReview[1]));
      if (contentReview && method === 'POST')
        return res.json(await this.engine.contentReview.review(actor, contentReview[1], body));
      if (path === 'admin/notifications' && method === 'GET')
        return res.json(await this.engine.notifications.snapshot(actor));
      const notificationRetry = path.match(/^admin\/notifications\/([^/]+)\/retry$/);
      if (notificationRetry && method === 'POST')
        return res.json(await this.engine.notifications.retry(actor, notificationRetry[1]));
      ensure(
        !actor.onboardingOnly || path.startsWith('onboarding/'),
        'MEMBERSHIP_REQUIRED',
        'Accept an active shop invitation to enter the work area.',
        403,
      );
      authorizeAdminRoute(actor, path, method);
      if (path === 'customer/overview' && method === 'GET')
        return res.json(await this.engine.experience.overview(actor));
      if (path === 'customer/addresses' && method === 'GET')
        return res.json(await this.engine.addresses.list(actor));
      if (path === 'customer/addresses' && method === 'POST')
        return res
          .status(201)
          .json(
            await this.engine.addresses.save(
              actor,
              undefined,
              body,
              String(req.headers['idempotency-key'] || ''),
            ),
          );
      match = path.match(/^customer\/addresses\/([^/]+)(\/default)?$/);
      if (match && match[2] && method === 'POST')
        return res.json(await this.engine.addresses.change(actor, match[1], body, 'DEFAULT'));
      if (match && !match[2] && method === 'PUT')
        return res.json(await this.engine.addresses.save(actor, match[1], body));
      if (match && !match[2] && method === 'DELETE')
        return res.json(await this.engine.addresses.change(actor, match[1], body, 'REMOVE'));
      if (path === 'customer/inbox' && method === 'GET')
        return res.json(await this.engine.engagement.inbox(actor, req.query));
      match = path.match(/^customer\/bookings\/([^/]+)\/(care|refund-requests)$/);
      if (match && match[2] === 'care' && method === 'GET')
        return res.json(await this.engine.refunds.overview(actor, match[1]));
      if (match && match[2] === 'refund-requests' && method === 'POST')
        return res
          .status(201)
          .json(
            await this.engine.refunds.request(
              actor,
              match[1],
              body,
              String(req.headers['idempotency-key'] || ''),
            ),
          );
      match = path.match(/^support-tickets\/([^/]+)\/refund-request$/);
      if (match && method === 'GET')
        return res.json(await this.engine.refunds.forTicket(actor, match[1]));
      match = path.match(/^refund-requests\/([^/]+)\/decision$/);
      if (match && method === 'POST')
        return res.json(
          await this.engine.refunds.decide(
            actor,
            match[1],
            body,
            String(req.headers['idempotency-key'] || ''),
          ),
        );
      if (path === 'customer/inbox/read' && method === 'POST')
        return res.json(await this.engine.engagement.read(actor, body));
      if (path === 'customer/store-favorites' && method === 'GET')
        return res.json(await this.engine.engagement.favorites(actor));
      match = path.match(/^customer\/store-favorites\/([^/]+)$/);
      if (match && method === 'GET')
        return res.json(await this.engine.engagement.favoriteState(actor, match[1]));
      if (match && method === 'PUT')
        return res.json(await this.engine.engagement.favorite(actor, match[1], body));
      if (path === 'customer/favorites' && method === 'GET')
        return res.json(await this.engine.experience.favorites(actor));
      match = path.match(/^customer\/favorites\/([^/]+)$/);
      if (match && method === 'GET')
        return res.json(await this.engine.experience.favoriteState(actor, match[1]));
      if (match && method === 'PUT')
        return res.json(await this.engine.experience.favorite(actor, match[1], body));
      match = path.match(/^customer\/bookings\/([^/]+)\/(experience|review|rebook)$/);
      if (match && method === 'GET' && match[2] === 'experience')
        return res.json(await this.engine.experience.customerExperience(actor, match[1]));
      if (match && method === 'GET' && match[2] === 'rebook')
        return res.json(await this.engine.experience.rebook(actor, match[1]));
      if (match && method === 'PUT' && match[2] === 'review')
        return res.json(await this.engine.experience.saveReview(actor, match[1], body));
      match = path.match(/^customer\/reviews\/([^/]+)\/withdraw$/);
      if (match && method === 'POST')
        return res.json(await this.engine.experience.withdraw(actor, match[1], body));
      if (path === 'merchant/experience' && method === 'GET')
        return res.json(await this.engine.experience.merchant(actor));
      if (path === 'staff/experience' && method === 'GET')
        return res.json(await this.engine.experience.staff(actor));
      match = path.match(/^merchant\/reviews\/([^/]+)\/(reply|appeal)$/);
      if (match && method === 'POST')
        return res.json(
          match[2] === 'reply'
            ? await this.engine.experience.reply(actor, match[1], body)
            : await this.engine.experience.appeal(actor, match[1], body),
        );
      if (path === 'admin/experience' && method === 'GET')
        return res.json(await this.engine.experience.moderation(actor));
      match = path.match(/^admin\/experience\/(REVIEW|REPLY|APPEAL)\/([^/]+)$/);
      if (match && method === 'POST')
        return res.json(await this.engine.experience.moderate(actor, match[1], match[2], body));
      if (path === 'fulfillment/safety' && method === 'GET')
        return res.json(await this.engine.fulfillment.desk(actor));
      match = path.match(/^fulfillment\/bookings\/([^/]+)\/(delay|check-in|contact)$/);
      if (match && method === 'POST')
        return res.json(
          match[2] === 'delay'
            ? await this.engine.fulfillment.delay(actor, match[1], body)
            : match[2] === 'check-in'
              ? await this.engine.fulfillment.respond(actor, match[1], body)
              : await this.engine.fulfillment.contact(actor, match[1], body),
        );
      if (path === 'onboarding/workspace' && method === 'GET')
        return res.json(await this.engine.onboarding.snapshot(actor));
      if (path === 'onboarding/application' && method === 'PUT')
        return res.json(await this.engine.onboarding.save(actor, body));
      if (path === 'onboarding/application/submit' && method === 'POST')
        return res.json(await this.engine.onboarding.submit(actor, body));
      if (path === 'onboarding/evidence' && method === 'POST')
        return res.json(await this.engine.onboarding.upload(actor, body));
      match = path.match(/^onboarding\/evidence\/([^/]+)$/);
      if (match && method === 'GET')
        return res.json(await this.engine.onboarding.evidence(actor, match[1]));
      if (path === 'onboarding/invitations' && method === 'POST')
        return res.json(await this.engine.onboarding.invite(actor, body));
      match = path.match(/^onboarding\/invitations\/([^/]+)$/);
      if (match && method === 'POST')
        return res.json(await this.engine.onboarding.invitationAction(actor, match[1], body));
      if (path === 'onboarding/invitation-response' && method === 'POST')
        return res.json(await this.engine.onboarding.respondInvitation(actor, body));
      if (path === 'onboarding/portrait-consent' && method === 'POST')
        return res.json(await this.engine.onboarding.consent(actor, body));
      match = path.match(/^onboarding\/members\/([^/]+)\/(content|end)$/);
      if (match && method === 'POST')
        return res.json(
          match[2] === 'content'
            ? await this.engine.onboarding.approveContent(actor, match[1], body)
            : await this.engine.onboarding.endMembership(actor, match[1], body),
        );
      if (path === 'onboarding/reviews' && method === 'GET')
        return res.json(await this.engine.onboarding.reviewQueue(actor));
      match = path.match(/^onboarding\/reviews\/([^/]+)$/);
      if (match && method === 'POST')
        return res.json(await this.engine.onboarding.review(actor, match[1], body));
      if (path === 'admin/members' && method === 'GET')
        return res.json(await this.engine.employees.list(actor));
      if (path === 'admin/members' && method === 'POST')
        return res.status(201).json(await this.engine.employees.create(actor, body));
      match = path.match(/^admin\/members\/([^/]+)(\/invitation)?$/);
      if (match && method === 'PUT' && !match[2])
        return res.json(await this.engine.employees.update(actor, match[1], body));
      if (match && method === 'POST' && match[2])
        return res.json(await this.engine.employees.reissue(actor, match[1], body));
      match = path.match(/^merchant\/bookings\/([^/]+)\/assignment-candidates$/);
      if (match && method === 'GET')
        return res.json(await this.engine.assignmentCandidates(actor, match[1]));
      if (path === 'merchant/workspace' && method === 'GET')
        return res.json(await this.engine.merchant.snapshot(actor));
      if (path === 'merchant/storefront' && method === 'GET')
        return res.json(await this.engine.storefronts.workspace(actor));
      if (path === 'merchant/storefront' && method === 'PUT')
        return res.json(await this.engine.storefronts.save(actor, body));
      if (path === 'merchant/storefront/submit' && method === 'POST')
        return res.json(await this.engine.storefronts.submit(actor, body));
      if (path === 'merchant/storefront/withdraw' && method === 'POST')
        return res.json(await this.engine.storefronts.withdraw(actor, body));
      if (path === 'merchant/storefront/images' && method === 'POST') {
        await this.engine.limits.check('storefront-upload', actor.id, 20);
        return res.status(201).json(await this.engine.storefronts.upload(actor, body));
      }
      match = path.match(/^merchant\/storefront\/images\/(brand_[0-9a-f-]{36})$/);
      if (match && method === 'DELETE')
        return res.json(await this.engine.storefronts.remove(actor, match[1]));
      if (path === 'admin/storefronts' && method === 'GET')
        return res.json(await this.engine.storefronts.queue(actor));
      match = path.match(/^admin\/storefronts\/([^/]+)\/review$/);
      if (match && method === 'POST')
        return res.json(await this.engine.storefronts.review(actor, match[1], body));
      if (path === 'merchant/venue' && method === 'PUT')
        return res.json(await this.engine.venues.save(actor, body));
      if (path === 'merchant/venue/geocode' && method === 'GET') {
        await this.engine.limits.check('venue-geocode', actor.id, 20);
        return res.json(await this.engine.venues.geocode(actor, req.query));
      }
      if (path === 'merchant/venue/photos' && method === 'POST')
        return res.status(201).json(await this.engine.venues.uploadPhoto(actor, body));
      // Therapist photos and introduction video, shared by the therapist and shop workspaces.
      const mediaListing =
        typeof req.query.listingId === 'string' ? req.query.listingId : undefined;
      if (path === 'media' && method === 'GET')
        return res.json(await this.engine.media.list(actor, mediaListing));
      if (path === 'media/photos' && method === 'POST') {
        await this.engine.limits.check('media-upload', actor.id, 20);
        return res.status(201).json(await this.engine.media.uploadPhoto(actor, body));
      }
      if (path === 'media/videos' && method === 'POST') {
        await this.engine.limits.check('media-upload', actor.id, 20);
        return res.status(201).json(await this.engine.media.startVideo(actor, body));
      }
      match = path.match(/^media\/videos\/([^/]+)\/(chunks|finish)$/);
      if (match && method === 'POST')
        return match[2] === 'chunks'
          ? res.json(await this.engine.media.videoChunk(actor, match[1], body))
          : res.status(201).json(await this.engine.media.finishVideo(actor, match[1], body));
      if (path === 'media/order' && method === 'PUT')
        return res.json(await this.engine.media.reorder(actor, body, mediaListing));
      match = path.match(/^media\/([^/]+)\/(authorize|confirm|withdraw|remove|cover)$/);
      if (match && method === 'POST') {
        const [, id, action] = match;
        if (action === 'authorize')
          return res.json(await this.engine.media.authorize(actor, id, body));
        if (action === 'confirm') return res.json(await this.engine.media.confirm(actor, id, body));
        if (action === 'withdraw')
          return res.json(await this.engine.media.withdraw(actor, id, body));
        if (action === 'remove') return res.json(await this.engine.media.remove(actor, id, body));
        return res.json(await this.engine.media.setCover(actor, id, body));
      }
      if (path === 'admin/listing-media' && method === 'GET')
        return res.json(await this.engine.media.reviewQueue(actor));
      match = path.match(/^admin\/listing-media\/([^/]+)\/review$/);
      if (match && method === 'POST')
        return res.json(await this.engine.media.review(actor, match[1], body));
      match = path.match(/^customer\/listing-media\/([^/]+)\/report$/);
      if (match && method === 'POST') {
        await this.engine.limits.check('media-report', actor.id, 10);
        return res.json(await this.engine.media.report(actor, match[1], body));
      }
      if (path === 'merchant/venue/calendar' && method === 'GET')
        return res.json(await this.engine.venues.calendar(actor, { date: req.query.date }));
      if (path === 'merchant/home-visits' && method === 'PUT')
        return res.json(await this.engine.venues.homeVisits(actor, body));
      if (path === 'admin/venues' && method === 'GET')
        return res.json(await this.engine.venues.list(actor));
      match = path.match(/^admin\/venues\/([^/]+)\/suspension$/);
      if (match && method === 'POST')
        return res.json(await this.engine.venues.suspend(actor, match[1], body));
      match = path.match(/^admin\/venues\/([^/]+)\/review$/);
      if (match && method === 'POST')
        return res.json(await this.engine.venues.review(actor, match[1], body));
      if (path === 'staff/safety-conditions' && method === 'PUT')
        return res.json(await this.engine.staff.requestSafetyConditions(actor, body));
      match = path.match(/^merchant\/team\/([^/]+)\/safety-conditions$/);
      if (match && method === 'POST')
        return res.json(await this.engine.staff.reviewSafetyConditions(actor, match[1], body));
      if (path === 'staff/shifts' && method === 'PUT')
        return res.json(await this.engine.staff.saveShifts(actor, body));
      match = path.match(/^merchant\/team\/([^/]+)\/shifts$/);
      if (match && method === 'PUT')
        return res.json(await this.engine.staff.saveShiftsAsShop(actor, match[1], body));
      match = path.match(/^merchant\/team\/([^/]+)\/service-modes$/);
      if (match && method === 'PUT')
        return res.json(await this.engine.venues.staffModes(actor, match[1], body));
      match = path.match(/^merchant\/services\/([^/]+)\/in-store$/);
      if (match && method === 'POST')
        return res.status(201).json(await this.engine.venues.createOffering(actor, match[1], body));
      match = path.match(/^merchant\/bookings\/([^/]+)\/check-in$/);
      if (match && method === 'POST')
        return res.json(await this.engine.checkIn(actor, match[1], body));
      match = path.match(/^merchant\/bookings\/([^/]+)\/late-arrival$/);
      if (match && method === 'POST')
        return res.json(await this.engine.closeLateArrival(actor, match[1], body));
      if (path === 'merchant/time-blocks' && method === 'POST')
        return res
          .status(201)
          .json(
            await this.engine.merchant.block(
              actor,
              body,
              String(req.headers['idempotency-key'] || ''),
            ),
          );
      match = path.match(/^merchant\/time-blocks\/([^/]+)$/);
      if (match && method === 'DELETE')
        return res.json(await this.engine.merchant.releaseBlock(actor, match[1], body));
      match = path.match(/^merchant\/services\/([^/]+)\/promotion$/);
      if (match && method === 'PUT')
        return res.json(await this.engine.merchant.promotion(actor, match[1], body));
      if (match && method === 'DELETE')
        return res.json(await this.engine.merchant.clearPromotion(actor, match[1], body));
      match = path.match(/^merchant\/services\/([^/]+)$/);
      if (match && method === 'PUT')
        return res.json(await this.engine.merchant.service(actor, match[1], body));
      if (path === 'merchant/settings' && method === 'PUT')
        return res.json(await this.engine.merchant.settings(actor, body));
      if (path === 'merchant/booking-rules' && method === 'PUT')
        return res.json(await this.engine.merchant.bookingRules(actor, body));
      if (path === 'customer/support-tickets' && method === 'POST')
        return res
          .status(201)
          .json(
            await this.engine.care.create(
              actor,
              body,
              String(req.headers['idempotency-key'] || ''),
            ),
          );
      if (path === 'support-tickets' && method === 'GET')
        return res.json(await this.engine.care.list(actor));
      match = path.match(/^admin\/support-tickets\/([^/]+)\/handling$/);
      if (match && method === 'GET')
        return res.json(await this.engine.handling.detail(actor, match[1]));
      if (match && method === 'PUT')
        return res.json(await this.engine.handling.update(actor, match[1], body));
      match = path.match(/^support-tickets\/([^/]+)$/);
      if (match && method === 'GET')
        return res.json(await this.engine.care.detail(actor, match[1]));
      match = path.match(/^support-tickets\/([^/]+)\/attachments$/);
      if (match && method === 'POST')
        return res.status(201).json(await this.engine.care.attach(actor, match[1], body));
      match = path.match(/^support-tickets\/([^/]+)\/attachments\/(evidence_[0-9a-f-]{36})$/);
      if (match && method === 'GET') {
        const file = await this.engine.care.attachment(actor, match[1], match[2]);
        res.setHeader('Content-Type', file.mime);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.send(file.bytes);
      }
      match = path.match(/^support-tickets\/([^/]+)\/(messages|actions)$/);
      if (match && method === 'POST') {
        if (match[2] === 'actions')
          return res.json(await this.engine.care.action(actor, match[1], body));
        const data = z
          .object({
            version: z.number().int().positive(),
            text: z.string().trim().min(3).max(3000),
          })
          .strict()
          .parse(body);
        return res.json(await this.engine.care.reply(actor, match[1], data.version, data.text));
      }
      if (path === 'staff/customer-feedback' && method === 'POST') {
        const data = z
          .object({ bookingId: z.string(), text: z.string().trim().min(10).max(3000) })
          .strict()
          .parse(body);
        return res
          .status(201)
          .json(await this.engine.care.feedback(actor, data.bookingId, data.text));
      }
      if (path === 'merchant/customer-blocks' && method === 'GET')
        return res.json(await this.engine.care.blocks(actor));
      match = path.match(/^merchant\/customer-blocks\/([^/]+)$/);
      if (match && method === 'PUT')
        return res.json(await this.engine.care.setBlock(actor, decodeURIComponent(match[1]), body));
      if (path === 'customer/restrictions' && method === 'GET') {
        ensure(actor.role === 'CUSTOMER', 'FORBIDDEN', 'Customer account required.', 403);
        return res.json(await this.engine.care.restrictions(actor));
      }
      if (path === 'admin/customer-restrictions') {
        ensure(actor.role === 'ADMIN', 'FORBIDDEN', 'Platform account required.', 403);
        if (method === 'GET') return res.json(await this.engine.care.restrictions(actor));
        if (method === 'POST') return res.json(await this.engine.care.setRestriction(actor, body));
      }
      if (path === 'customer/restriction-appeals' && method === 'POST') {
        const data = z
          .object({
            version: z.number().int().positive(),
            text: z.string().trim().min(10).max(3000),
          })
          .strict()
          .parse(body);
        return res.status(201).json(await this.engine.care.appeal(actor, data.version, data.text));
      }
      if (path === 'safety-events' && method === 'GET')
        return res.json(await this.engine.care.safetyEvents(actor));
      match = path.match(/^staff\/tasks\/([^/]+)\/check-in$/);
      if (match && method === 'POST')
        return res.json(await this.engine.checkIn(actor, match[1], body));
      match = path.match(/^staff\/safety-events\/([^/]+)\/location$/);
      if (match && method === 'POST')
        return res.json(await this.engine.care.shareLocation(actor, match[1], body));
      match = path.match(/^admin\/safety-events\/([^/]+)\/emergency-location$/);
      if (match && method === 'POST')
        return res.json(await this.engine.care.emergencyLocation(actor, match[1], body));
      match = path.match(/^admin\/safety-events\/([^/]+)\/resolve$/);
      if (match && method === 'POST') {
        const data = z
          .object({
            version: z.number().int().positive(),
            text: z.string().trim().min(10).max(3000),
          })
          .strict()
          .parse(body);
        return res.json(
          await this.engine.care.resolveSafety(actor, match[1], data.version, data.text),
        );
      }
      if (path === 'quotes' && method === 'POST')
        return res.status(201).json(await this.engine.quote(actor, body));
      if (path === 'booking-holds' && method === 'POST')
        return res
          .status(201)
          .json(
            await this.engine.hold(
              actor,
              z.object({ quoteId: z.string() }).strict().parse(body).quoteId,
            ),
          );
      match = path.match(/^booking-holds\/([^/]+)\/submission$/);
      if (match && method === 'GET')
        return res.json(await this.engine.checkoutSubmission(actor, match[1]));
      match = path.match(/^booking-holds\/([^/]+)$/);
      if (match && method === 'GET') return res.json(await this.engine.checkout(actor, match[1]));
      if (match && method === 'DELETE')
        return res.json(await this.engine.releaseCheckoutHold(actor, match[1]));
      if (path === 'payments/demo-authorizations' && method === 'POST') {
        const data = z
          .object({ holdId: z.string(), challengePassed: z.boolean() })
          .strict()
          .parse(body);
        return res.json(await this.engine.authorizeDemo(actor, data.holdId, data.challengePassed));
      }
      if (path === 'bookings' && method === 'POST')
        return res
          .status(201)
          .json(
            await this.engine.createBooking(
              actor,
              body,
              String(req.headers['idempotency-key'] || ''),
            ),
          );
      if (path === 'bookings' && method === 'GET')
        return res.json(await this.engine.bookings(actor));
      if (path === 'staff/handoffs' && method === 'GET')
        return res.json(await this.engine.coordination.inbox(actor));
      match = path.match(/^bookings\/([^/]+)\/(coordination|handoffs)$/);
      if (match && match[2] === 'coordination' && method === 'GET')
        return res.json(await this.engine.coordination.detail(actor, match[1]));
      if (match && match[2] === 'handoffs' && method === 'POST')
        return res
          .status(201)
          .json(
            await this.engine.coordination.create(
              actor,
              match[1],
              body,
              String(req.headers['idempotency-key'] ?? ''),
            ),
          );
      match = path.match(/^work-handoffs\/([^/]+)\/actions$/);
      if (match && method === 'POST')
        return res.json(
          await this.engine.coordination.action(
            actor,
            match[1],
            body,
            String(req.headers['idempotency-key'] ?? ''),
          ),
        );
      match = path.match(/^bookings\/([^/]+)$/);
      if (match && method === 'GET') return res.json(await this.engine.booking(actor, match[1]));
      if (path === 'dashboard' && method === 'GET')
        return res.json(await this.engine.dashboard(actor));
      if (path === 'admin/todo' && method === 'GET')
        return res.json(await this.engine.adminTodo(actor));
      if (path === 'admin/shop-quality' && method === 'GET')
        return res.json(await this.engine.quality.shops(actor, req.query));
      if (path === 'admin/suspension-impact' && method === 'GET')
        return res.json(await this.engine.quality.suspensionImpact(actor));
      if (path === 'admin/order-monitor' && method === 'GET')
        return res.json(await this.engine.governance.monitor(actor));
      if (path === 'merchant/billing' && method === 'GET') {
        ensure(actor.role === 'MERCHANT', 'FORBIDDEN', 'Shop account required.', 403);
        return res.json(await this.engine.finance.workspace(actor, req.query));
      }
      if ((path === 'merchant/reports' || path === 'admin/reports') && method === 'GET') {
        ensure(
          actor.role === (path.startsWith('admin/') ? 'ADMIN' : 'MERCHANT'),
          'FORBIDDEN',
          'Incorrect reporting workspace.',
          403,
        );
        return res.json(await this.engine.reporting.workspace(actor, req.query));
      }
      if (
        (path === 'merchant/reports/export' || path === 'admin/reports/export') &&
        method === 'POST'
      ) {
        ensure(
          actor.role === (path.startsWith('admin/') ? 'ADMIN' : 'MERCHANT'),
          'FORBIDDEN',
          'Incorrect reporting workspace.',
          403,
        );
        return res.json(
          await this.engine.reporting.export(actor, body, req.get('Idempotency-Key') ?? ''),
        );
      }
      match = path.match(/^(merchant|admin)\/reports\/exports\/([^/]+)$/);
      if (match && method === 'GET') {
        ensure(
          actor.role === (match[1] === 'admin' ? 'ADMIN' : 'MERCHANT'),
          'FORBIDDEN',
          'Incorrect reporting workspace.',
          403,
        );
        return res.json(await this.engine.reporting.download(actor, match[2]));
      }
      if ((path === 'merchant/invoicing' || path === 'admin/invoicing') && method === 'GET') {
        ensure(
          actor.role === (path.startsWith('admin/') ? 'ADMIN' : 'MERCHANT'),
          'FORBIDDEN',
          'Incorrect invoicing workspace.',
          403,
        );
        return res.json(await this.engine.invoicing.workspace(actor, req.query));
      }
      match = path.match(/^(merchant|admin)\/invoicing\/([^/]+)\/(profile|requests)$/);
      if (match && method === 'POST') {
        ensure(
          actor.role === (match[1] === 'admin' ? 'ADMIN' : 'MERCHANT'),
          'FORBIDDEN',
          'Incorrect invoicing workspace.',
          403,
        );
        return res.json(
          await (match[3] === 'profile'
            ? this.engine.invoicing.saveProfile(
                actor,
                match[2],
                body,
                req.get('Idempotency-Key') ?? '',
              )
            : this.engine.invoicing.create(
                actor,
                match[2],
                body,
                req.get('Idempotency-Key') ?? '',
              )),
        );
      }
      match = path.match(/^billing\/invoice-requests\/([^/]+)\/actions$/);
      if (match && method === 'POST')
        return res.json(
          await this.engine.invoicing.action(
            actor,
            match[1],
            body,
            req.get('Idempotency-Key') ?? '',
          ),
        );
      if (path === 'admin/finance' && method === 'GET') {
        ensure(actor.role === 'ADMIN', 'FORBIDDEN', 'Platform finance required.', 403);
        return res.json(await this.engine.finance.workspace(actor, req.query));
      }
      match = path.match(/^admin\/finance\/([^/]+)\/entries\/([^/]+)\/report$/);
      if (match && method === 'POST')
        return res.json(
          await this.engine.finance.report(
            actor,
            match[1],
            match[2],
            body,
            String(req.headers['idempotency-key'] ?? ''),
          ),
        );
      match = path.match(/^(admin\/finance|merchant\/billing)\/([^/]+)\/(statements|settlements)$/);
      if (match && method === 'POST') {
        ensure(
          actor.role === (match[1] === 'admin/finance' ? 'ADMIN' : 'MERCHANT'),
          'FORBIDDEN',
          'Incorrect finance workspace.',
          403,
        );
        return res
          .status(201)
          .json(
            await (match[3] === 'statements'
              ? this.engine.finance.statement(
                  actor,
                  match[2],
                  body,
                  String(req.headers['idempotency-key'] ?? ''),
                )
              : this.engine.finance.prepare(
                  actor,
                  match[2],
                  body,
                  String(req.headers['idempotency-key'] ?? ''),
                )),
          );
      }
      match = path.match(/^finance\/settlements\/([^/]+)\/actions$/);
      if (match && method === 'POST')
        return res.json(
          await this.engine.finance.batchAction(
            actor,
            match[1],
            body,
            String(req.headers['idempotency-key'] ?? ''),
          ),
        );
      match = path.match(/^admin\/order-alerts\/([^/]+)\/follow-up$/);
      if (match && method === 'POST')
        return res.json(await this.engine.governance.watch(actor, match[1], body));
      match = path.match(/^support-tickets\/([^/]+)\/decision$/);
      if (match && method === 'GET')
        return res.json(await this.engine.governance.detail(actor, match[1]));
      if (match && method === 'POST')
        return res
          .status(201)
          .json(
            await this.engine.governance.publish(
              actor,
              match[1],
              body,
              (req.headers['idempotency-key'] as string) ?? '',
            ),
          );
      match = path.match(/^support-tickets\/([^/]+)\/decision\/acknowledgment$/);
      if (match && method === 'POST')
        return res.json(
          await this.engine.governance.acknowledge(
            actor,
            match[1],
            body,
            (req.headers['idempotency-key'] as string) ?? '',
          ),
        );
      if (path === 'admin/workspace' && method === 'GET')
        return res.json(await this.engine.admin.snapshot(actor));
      if (path === 'admin/reviews' && method === 'POST')
        return res.json(await this.engine.admin.review(actor, body));
      if (
        (path === 'merchant/subscription' || path === 'admin/subscriptions') &&
        method === 'GET'
      ) {
        ensure(
          actor.role === (path.startsWith('admin/') ? 'ADMIN' : 'MERCHANT'),
          'FORBIDDEN',
          'Incorrect billing workspace.',
          403,
        );
        return res.json(await this.engine.subscriptions.workspace(actor, req.query));
      }
      match = path.match(/^merchant\/subscription\/([^/]+)\/actions$/);
      if (match && method === 'POST')
        return res.json(
          await this.engine.subscriptions.change(
            actor,
            match[1],
            body,
            req.get('Idempotency-Key') ?? '',
          ),
        );
      match = path.match(/^billing\/plan-invoices\/([^/]+)\/actions$/);
      if (match && method === 'POST')
        return res.json(
          await this.engine.subscriptions.invoiceAction(
            actor,
            match[1],
            body,
            req.get('Idempotency-Key') ?? '',
          ),
        );
      if (path === 'staff/workspace' && method === 'GET')
        return res.json(await this.engine.staff.snapshot(actor));
      if (path === 'staff/time-off-requests' && method === 'POST')
        return res
          .status(201)
          .json(
            await this.engine.staff.request(
              actor,
              body,
              String(req.headers['idempotency-key'] ?? ''),
            ),
          );
      match = path.match(/^(staff|merchant)\/time-off-requests\/([^/]+)$/);
      if (match && method === 'PUT') {
        ensure(
          actor.role === (match[1] === 'staff' ? 'STAFF' : 'MERCHANT'),
          'FORBIDDEN',
          'Incorrect workspace.',
          403,
        );
        return res.json(await this.engine.staff.review(actor, match[2], body));
      }
      if (path === 'staff/duty-status' && method === 'PUT') {
        const data = z
          .object({ onDuty: z.boolean(), expectedAt: z.number().int().optional() })
          .strict()
          .parse(body);
        return res.json(await this.engine.duty(actor, data.onDuty, data.expectedAt));
      }
      if (path === 'staff/safety-alerts' && method === 'POST') {
        const d = z
          .object({
            bookingId: z.string(),
            version: z.number().int().positive(),
            type: z.enum(['SOS', 'SAFETY_TERMINATION']),
          })
          .strict()
          .parse(body);
        return res.json(await this.engine.safety(actor, d.bookingId, d.type, d.version));
      }
      if (path === 'admin/enforcement-actions' && method === 'POST') {
        const d = z
          .object({ listingId: z.string(), suspend: z.boolean(), reason: z.string().max(300) })
          .strict()
          .parse(body);
        return res.json(await this.engine.enforce(actor, d.listingId, d.suspend, d.reason));
      }
      match = path.match(/^bookings\/([^/]+)\/completion$/);
      if (match && method === 'GET')
        return res.json(await this.engine.completionView(actor, match[1]));
      if (match && method === 'POST')
        return res.json(
          await this.engine.completionAction(
            actor,
            match[1],
            body,
            req.get('Idempotency-Key') ?? '',
          ),
        );
      match = path.match(/^customer\/bookings\/([^/]+)\/payment-guarantee$/);
      if (match && method === 'POST')
        return res.json(await this.engine.renewPaymentGuarantee(actor, match[1], body));
      match = path.match(/^bookings\/([^/]+)\/cancellation-preview$/);
      if (match && method === 'GET')
        return res.json(await this.engine.cancellationPreview(actor, match[1]));
      match = path.match(/^customer\/bookings\/([^/]+)\/(cancel|replacement-consent|messages)$/);
      if (match) {
        const [, bookingId, action] = match;
        ensure(actor.role === 'CUSTOMER', 'FORBIDDEN', 'Customer account required.', 403);
        if (action === 'messages') {
          if (method === 'GET') return res.json(await this.engine.messages(actor, bookingId));
          if (method === 'POST')
            return res.json(
              await this.engine.messages(
                actor,
                bookingId,
                z.object({ text: z.string() }).strict().parse(body).text,
              ),
            );
        }
        if (method === 'POST') {
          const { version } = versionInput.parse(body);
          if (action === 'cancel')
            return res.json(
              await this.engine.cancel(
                actor,
                bookingId,
                version,
                false,
                z.object({ expectedFee: z.number().int().nonnegative().optional() }).parse(body)
                  .expectedFee,
              ),
            );
          if (action === 'replacement-consent')
            return res.json(
              await this.engine.consent(
                actor,
                bookingId,
                version,
                z.object({ approved: z.boolean() }).parse(body).approved,
              ),
            );
        }
      }
      match = path.match(
        /^merchant\/bookings\/([^/]+)\/(accept|reject|cancel|assignments|replacement-proposals|refunds|messages)$/,
      );
      if (match) {
        ensure(actor.role === 'MERCHANT', 'FORBIDDEN', 'Shop account required.', 403);
        const [, bookingId, action] = match;
        if (action === 'messages') {
          if (method === 'GET') return res.json(await this.engine.messages(actor, bookingId));
          if (method === 'POST')
            return res.json(
              await this.engine.messages(
                actor,
                bookingId,
                z.object({ text: z.string() }).strict().parse(body).text,
              ),
            );
        }
        if (method === 'POST') {
          const { version } = versionInput.parse(body);
          if (action === 'accept')
            return res.json(await this.engine.accept(actor, bookingId, version));
          if (action === 'reject' || action === 'cancel')
            return res.json(
              await this.engine.cancel(actor, bookingId, version, action === 'reject'),
            );
          if (action === 'assignments' || action === 'replacement-proposals')
            return res.json(
              await this.engine.assign(
                actor,
                bookingId,
                version,
                z.object({ listingId: z.string() }).parse(body).listingId,
                action === 'replacement-proposals',
              ),
            );
          if (action === 'refunds')
            return res.json(
              await this.engine.refund(
                actor,
                bookingId,
                version,
                z.object({ amount: z.number().int() }).parse(body).amount,
              ),
            );
        }
      }
      match = path.match(/^bookings\/([^/]+)\/no-show$/);
      const proposalWithdrawal = path.match(
        /^merchant\/bookings\/([^/]+)\/replacement-withdrawal$/,
      );
      if (proposalWithdrawal && method === 'POST')
        return res.json(await this.engine.withdrawProposal(actor, proposalWithdrawal[1], body));
      if (match && method === 'POST')
        return res.json(
          await this.engine.noShowAction(actor, match[1], body, req.get('Idempotency-Key') ?? ''),
        );
      match = path.match(/^staff\/tasks\/([^/]+)\/(ack|decline|withdraw|events|messages)$/);
      if (match) {
        ensure(actor.role === 'STAFF', 'FORBIDDEN', 'Staff account required.', 403);
        const [, bookingId, action] = match;
        if (action === 'messages') {
          if (method === 'GET') return res.json(await this.engine.messages(actor, bookingId));
          if (method === 'POST')
            return res.json(
              await this.engine.messages(
                actor,
                bookingId,
                z.object({ text: z.string() }).strict().parse(body).text,
              ),
            );
        }
        if (method === 'POST') {
          const { version } = versionInput.parse(body);
          if (action === 'ack')
            return res.json(
              await this.engine.ack(
                actor,
                bookingId,
                version,
                z.object({ arrivalMinutes: z.number().int().optional() }).parse(body)
                  .arrivalMinutes,
              ),
            );
          if (action === 'decline' || action === 'withdraw')
            return res.json(
              await this.engine.decline(
                actor,
                bookingId,
                version,
                z.object({ reason: z.string().max(300) }).parse(body).reason,
              ),
            );
          if (action === 'events')
            return res.json(
              await this.engine.event(
                actor,
                bookingId,
                version,
                z
                  .object({ event: z.enum(['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) })
                  .parse(body).event,
              ),
            );
        }
      }
      throw new DomainError('NOT_FOUND', 'API route not found.', 404);
    } catch (error) {
      if (error instanceof z.ZodError)
        return res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            fields: [...new Set(error.issues.map((issue) => issue.path.join('.')).filter(Boolean))],
            message: error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '),
          },
          requestId,
        });
      if (error instanceof DomainError)
        return res
          .status(error.status)
          .json({ error: { code: error.code, message: error.message }, requestId });
      const code = (error as { code?: string }).code;
      if (code === '23P01' || String(error).includes('SLOT_CONFLICT'))
        return res.status(409).json({
          error: {
            code: 'SLOT_CONFLICT',
            message: 'This time was just reserved. Select another time.',
          },
          requestId,
        });
      console.error(
        'Request failed',
        requestId,
        error instanceof Error ? error.name : 'UnknownError',
      );
      return res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Unable to process this request. Please retry.',
        },
        requestId,
      });
    }
  }
}
