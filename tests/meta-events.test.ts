import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { defaults } from '../src/shared/types';
import { settingsSchema } from '../src/server/schemas';
import { metaPixelIds } from '../src/shared/meta-pixels';
import { metaPurchase } from '../src/server/jobs';
import type { Env } from '../src/server/db';
import { state, order } from '../src/server/db';
import { saveCredential, decryptSecret } from '../src/server/security';
import {
  metaTicket,
  validMetaTicket,
  metaPageUrl,
  metaEventStatement,
  flushMetaEvents,
  sendMetaEvent,
  type MetaEvent,
} from '../src/server/meta-events';

let mf: Miniflare,
  env: Env,
  cookie = '',
  csrf = '';
const origin = 'https://merchant.example.test';
const token = 'fixture-capi-token-never-public';
let received: { url: string; body: any }[] = [];
const event = (): MetaEvent => ({
  event_name: 'PageView',
  event_id: crypto.randomUUID(),
  event_time: Math.floor(Date.now() / 1000),
  action_source: 'website',
  event_source_url: origin + '/',
  user_data: {
    client_user_agent: 'Test browser',
    client_ip_address: '192.0.2.1',
    fbp: 'fb.1.123.456',
  },
});
const request = (path: string, body?: unknown, admin = false, method = body ? 'POST' : 'GET') =>
  mf.dispatchFetch(origin + '/api' + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'User-Agent': 'Test browser',
      'CF-Connecting-IP': '192.0.2.1',
      ...(admin ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['src/server/index.tsx'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: 'hono/jsx',
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2025-09-01',
      d1Databases: ['DB'],
      r2Buckets: ['MEDIA', 'BACKUPS'],
      bindings: {
        APP_ORIGIN: 'https://original-workers.example.test',
        ENVIRONMENT: 'development',
        ENCRYPTION_KEY: btoa('a'.repeat(32)),
        AUTH_PEPPER: 'tracking-test-pepper',
        SETUP_TOKEN: 'test-setup',
      },
      outboundService: async (request) => {
        if (new URL(request.url).hostname !== 'graph.facebook.com')
          throw Error('Unexpected external request');
        expect(request.headers.get('Authorization')).toBe('Bearer ' + token);
        received.push({ url: request.url, body: await request.json() });
        return Response.json({ events_received: 1 });
      },
    }),
  );
  env = {
    DB: await mf.getD1Database('DB'),
    ENCRYPTION_KEY: btoa('a'.repeat(32)),
    AUTH_PEPPER: 'tracking-test-pepper',
  } as Env;
  for (const file of (await readdir('migrations')).filter((p) => p.endsWith('.sql')).sort())
    await env.DB.exec(await readFile('migrations/' + file, 'utf8'));
  const setup = await request('/auth/setup', {
    token: 'test-setup',
    email: 'owner@example.test',
    password: 'secure-test-password-2026',
  });
  expect(setup.status).toBe(201);
  cookie = setup.headers.get('set-cookie')!.split(';')[0];
  csrf = ((await setup.json()) as any).csrf;
  await env.DB.exec(
    (await readFile('fixtures/demo.sql', 'utf8'))
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n'),
  );
  await saveCredential(env, 'meta', token);
});
beforeEach(async () => {
  received = [];
  await env.DB.prepare(
    'INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
  )
    .bind(
      JSON.stringify({
        ...defaults,
        facebookPixel: '123456',
        trackingEnabled: true,
        contractVerified: true,
        autoConfirm: false,
      }),
    )
    .run();
  await env.DB.prepare('DELETE FROM meta_events').run();
  await env.DB.prepare('DELETE FROM limits').run();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await mf?.dispose();
});

it('binds short-lived tickets to each actual merchant domain, installation and pixel', async () => {
  const ticket = await metaTicket(env, origin, '123456');
  expect(await validMetaTicket(env, origin, '123456', ticket)).toBe(true);
  expect(
    await validMetaTicket(env, 'https://original-workers.example.test', '123456', ticket),
  ).toBe(false);
  expect(
    await validMetaTicket({ ...env, AUTH_PEPPER: 'another-store' }, origin, '123456', ticket),
  ).toBe(false);
  expect(await validMetaTicket(env, origin, '654321', ticket)).toBe(false);
  expect(
    await validMetaTicket(
      env,
      origin,
      '123456',
      await metaTicket(env, origin, '123456', Date.now() - 1000),
    ),
  ).toBe(false);
  expect(metaPageUrl(origin, '/offers/sample?phone=private#private')).toBe(
    origin + '/offers/sample',
  );
  for (const path of [
    'https://foreign.example/',
    '//foreign.example/',
    '/admin/pixels',
    '/api/orders',
    '/offers/../admin',
  ])
    expect(() => metaPageUrl(origin, path)).toThrow();
});
it('encrypts event payloads, deduplicates browser event IDs, clears PII after acceptance and sends credentials only to Graph', async () => {
  const e = event();
  await (await metaEventStatement(env, '123456', e)).run();
  await (await metaEventStatement(env, '123456', e)).run();
  const rows = await env.DB.prepare('SELECT * FROM meta_events').all<any>();
  expect(rows.results).toHaveLength(1);
  expect(rows.results[0].payload).not.toContain('192.0.2.1');
  expect(JSON.parse(await decryptSecret(env, rows.results[0].payload))).toEqual(e);
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://graph.facebook.com/v26.0/123456/events');
    expect(init.redirect).toBe('manual');
    expect((init.headers as any).Authorization).toBe('Bearer ' + token);
    expect(JSON.parse(init.body as string)).toEqual({ data: [e] });
    return Response.json({ events_received: 1 });
  });
  vi.stubGlobal('fetch', fetch);
  await Promise.all([flushMetaEvents(env), flushMetaEvents(env)]);
  await (await metaEventStatement(env, '123456', e)).run();
  await flushMetaEvents(env);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare('SELECT status,payload FROM meta_events').first()).toEqual({
    status: 'sent',
    payload: null,
  });
});
it('retries temporary Graph failures with the original event ID and prevents redirects or sending old events to a new pixel', async () => {
  const e = event();
  await (await metaEventStatement(env, '123456', e)).run();
  const fetch = vi.fn(async () => Response.json({ error: { code: 2 } }, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  await flushMetaEvents(env);
  expect(await env.DB.prepare('SELECT status,last_error FROM meta_events').first()).toEqual({
    status: 'pending',
    last_error: 'meta_rejected_2',
  });
  fetch.mockImplementation(
    async () =>
      new Response(null, { status: 302, headers: { Location: 'https://foreign.example' } }),
  );
  await env.DB.prepare('UPDATE meta_events SET run_at=0').run();
  await flushMetaEvents(env);
  expect((await env.DB.prepare('SELECT status FROM meta_events').first<any>())!.status).toBe(
    'failed',
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  await env.DB.prepare('DELETE FROM meta_events').run();
  await (await metaEventStatement(env, '999999', event())).run();
  await flushMetaEvents(env);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    (await env.DB.prepare('SELECT last_error FROM meta_events').first<any>())!.last_error,
  ).toBe('meta_pixel_changed');
});
it('accepts same-domain public events on a changed merchant domain and rejects forged Lead/Purchase or foreign URLs', async () => {
  const bootstrap = (await (await request('/meta/bootstrap')).json()) as any;
  expect(bootstrap.enabled).toBe(true);
  expect(JSON.stringify(bootstrap)).not.toContain(token);
  const body = {
    pixel: bootstrap.pixel,
    ticket: bootstrap.ticket,
    event: 'PageView',
    eventId: crypto.randomUUID(),
    path: '/offers/example?secret=private',
    fbp: 'fb.1.123.456',
  };
  for (const name of ['Lead', 'Purchase'])
    expect((await request('/meta/events', { ...body, event: name })).status).toBe(400);
  expect(
    (await request('/meta/events', { ...body, path: 'https://foreign.example/' })).status,
  ).toBe(400);
  expect(
    (
      await request('/meta/events', {
        ...body,
        ticket: await metaTicket(env, 'https://original-workers.example.test', body.pixel),
      })
    ).status,
  ).toBe(403);
  expect((await request('/meta/events', body)).status).toBe(202);
  await vi.waitFor(() => expect(received).toHaveLength(1));
  const sent = received[0].body.data[0];
  expect(sent.event_id).toBe(body.eventId);
  expect(sent.event_source_url).toBe(origin + '/offers/example');
  expect(sent.user_data.fbp).toBe(body.fbp);
  expect(received[0].body.test_event_code).toBeUndefined();
  expect((await request('/meta/events', body)).status).toBe(202);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(received).toHaveLength(1);
});
it('keeps the test code out of production and restricts diagnostic tests to authenticated admin + CSRF', async () => {
  const body = { testEventCode: 'TEST12345' };
  expect((await request('/admin/pixels/test', body)).status).toBe(401);
  const result = await request('/admin/pixels/test', body, true);
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ accepted: true, test: true });
  expect(received).toHaveLength(1);
  expect(received[0].body.test_event_code).toBe(body.testEventCode);
  expect(received[0].body.data[0].event_name).toBe('PageView');
  expect(received[0].body.data[0].event_source_url).toBe(origin + '/');
  expect((await state(env.DB, 'meta_health'))?.lastSuccess).toBeTruthy();
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).toEqual({ n: 0 });
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM meta_events').first()).toEqual({ n: 0 });
  expect(
    ((await (await request('/admin/pixels/status', undefined, true)).json()) as any).connection,
  ).toBe('connected');
});
it('creates one server-authoritative Lead only after saving an order and keeps Purchase gated on delivery', async () => {
  const cart = [{ productId: 'demo-bag', offerId: '', quantity: 1, revision: 1 }];
  const quote = (await (await request('/checkout/quote', { cart, city: 'Rabat' })).json()) as any;
  const body = {
    cart,
    customer: {
      name: 'Test Customer',
      phone: '0612345678',
      city: 'Rabat',
      address: 'Test address',
      notes: '',
    },
    fingerprint: quote.fingerprint,
    idempotency: crypto.randomUUID(),
    matching: { path: '/offers/daily-bag', fbp: 'fb.1.123.456' },
  };
  const count = (await env.DB.prepare('SELECT COUNT(*) n FROM orders').first<any>())!.n;
  expect((await request('/orders', { ...body, fingerprint: '0'.repeat(64) })).status).toBe(409);
  expect(received).toHaveLength(0);
  const saved = await request('/orders', body);
  expect(saved.status).toBe(201);
  const result = (await saved.json()) as any;
  await vi.waitFor(() => expect(received).toHaveLength(1));
  const lead = received[0].body.data[0];
  expect(lead.event_name).toBe('Lead');
  expect(lead.event_id).toBe('lead:' + result.ref);
  expect(lead.event_source_url).toBe(origin + '/offers/daily-bag');
  expect(lead.user_data.ph[0]).toMatch(/^[a-f0-9]{64}$/);
  expect(lead.custom_data.value).toBe(quote.total / 100);
  expect((await request('/orders', body)).status).toBe(200);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).toEqual({ n: count + 1 });
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM jobs WHERE type='purchase'").first()).toEqual(
    { n: 0 },
  );
  expect(received).toHaveLength(1);
});
it('does not send events when tracking is disabled and records permanent token failures safely', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ error: { code: 190, message: token } }, { status: 400 }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(sendMetaEvent(env, '123456', event())).rejects.toMatchObject({
    code: 'meta_rejected_190',
    retry: false,
  });
  expect(JSON.stringify(await state(env.DB, 'meta_health'))).not.toContain(token);
  await env.DB.prepare(
    "UPDATE settings SET json=json_set(json,'$.trackingEnabled',json('false'),'$.facebookPixel','')",
  ).run();
  await (await metaEventStatement(env, '123456', event())).run();
  await flushMetaEvents(env);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await (await request('/meta/bootstrap')).json()).toEqual({ enabled: false });
});

const secondary = {
  id: '18be9ee0-a36c-4b61-898d-92e94e741bd3',
  pixel: '654321',
  label: 'Second account',
  enabled: true,
};
const secondaryToken = 'second-authorized-capi-token-fixture';
async function configureSecondary() {
  const current = (await (await request('/admin/settings', undefined, true)).json()) as any;
  const updated = { ...current.settings, facebookAdditionalPixels: [secondary] };
  expect((await request('/admin/settings', updated, true, 'PUT')).status).toBe(200);
  expect(
    (
      await request(
        '/admin/credentials',
        { metaPixel: secondary.pixel, meta: secondaryToken },
        true,
        'PUT',
      )
    ).status,
  ).toBe(200);
  return updated;
}
it('validates distinct destinations, preserves them for legacy settings clients and never exposes CAPI tokens', async () => {
  const updated = await configureSecondary();
  expect(metaPixelIds(updated)).toEqual(['123456', '654321']);
  expect(
    settingsSchema.safeParse({
      ...updated,
      facebookAdditionalPixels: [{ ...secondary, pixel: '123456' }],
    }).success,
  ).toBe(false);
  expect(
    settingsSchema.safeParse({ ...updated, facebookAdditionalPixels: [secondary, secondary] })
      .success,
  ).toBe(false);
  expect(settingsSchema.safeParse({ ...updated, facebookPixel: '' }).success).toBe(false);
  const legacy = { ...updated } as any;
  delete legacy.facebookAdditionalPixels;
  expect((await request('/admin/settings', legacy, true, 'PUT')).status).toBe(200);
  const saved = (await (await request('/admin/settings', undefined, true)).json()) as any;
  expect(saved.settings.facebookAdditionalPixels).toEqual([secondary]);
  expect(JSON.stringify(saved)).not.toContain(secondaryToken);
  expect(saved.credentials).toContain('meta:654321');
  const row = await env.DB.prepare(
    "SELECT encrypted FROM credentials WHERE name='meta:654321'",
  ).first<any>();
  expect(row.encrypted).not.toContain(secondaryToken);
  expect(await decryptSecret(env, row.encrypted)).toBe(secondaryToken);
  expect(
    (
      await request(
        '/admin/credentials',
        { metaPixel: '999999', meta: secondaryToken },
        true,
        'PUT',
      )
    ).status,
  ).toBe(400);
  const publicPage = await (await mf.dispatchFetch(origin + '/')).text();
  expect(publicPage).toContain('654321');
  expect(publicPage).not.toContain(secondaryToken);
  expect(publicPage).not.toContain('Second account');
  expect(
    (await request('/admin/settings', { ...updated, facebookAdditionalPixels: [] }, true, 'PUT'))
      .status,
  ).toBe(200);
  expect(
    await env.DB.prepare("SELECT encrypted FROM credentials WHERE name='meta:654321'").first(),
  ).toBeNull();
});
it('isolates destination credentials, failures and receipts while sharing browser/server event IDs', async () => {
  await configureSecondary();
  const bootstrap = (await (await request('/meta/bootstrap')).json()) as any;
  expect(bootstrap.pixels.map((p: any) => p.pixel)).toEqual(['123456', '654321']);
  expect(JSON.stringify(bootstrap)).not.toContain(secondaryToken);
  const e = event();
  for (const pixel of ['123456', '654321']) await (await metaEventStatement(env, pixel, e)).run();
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const isPrimary = url.includes('/123456/events');
    expect((init.headers as any).Authorization).toBe(
      'Bearer ' + (isPrimary ? token : secondaryToken),
    );
    expect(JSON.parse(init.body as string).data[0].event_id).toBe(e.event_id);
    return isPrimary
      ? Response.json({ events_received: 1 })
      : Response.json({ error: { code: 190 } }, { status: 400 });
  });
  vi.stubGlobal('fetch', fetch);
  await flushMetaEvents(env, 10);
  const rows = await env.DB.prepare(
    'SELECT pixel_id,status,last_error FROM meta_events ORDER BY pixel_id',
  ).all<any>();
  expect(rows.results).toEqual([
    { pixel_id: '123456', status: 'sent', last_error: null },
    { pixel_id: '654321', status: 'failed', last_error: 'meta_rejected_190' },
  ]);
  expect((await state(env.DB, 'meta_health')).errorCode).toBeNull();
  expect((await state(env.DB, 'meta_health:654321')).errorCode).toBe(190);
  // No second primary send when another destination fails or is retried.
  await flushMetaEvents(env, 10);
  expect(fetch).toHaveBeenCalledTimes(2);
  const newTicket = await metaTicket(env, origin, '654321');
  expect(await validMetaTicket(env, origin, '123456', newTicket)).toBe(false);
  await env.DB.prepare(
    "UPDATE settings SET json=json_set(json,'$.facebookAdditionalPixels[0].enabled',json('false'))",
  ).run();
  expect(((await (await request('/meta/bootstrap')).json()) as any).pixels).toBeUndefined();
  await expect(sendMetaEvent(env, '654321', e)).rejects.toMatchObject({
    code: 'meta_not_configured',
  });
});
it('sends one Lead and one delivered Purchase per destination without letting a primary rejection block the other', async () => {
  await configureSecondary();
  // The worker outbound mock confirms per-destination authentication too.
  const sharedToken = token;
  await saveCredential(env, 'meta:654321', sharedToken);
  const cart = [{ productId: 'demo-bag', offerId: '', quantity: 1, revision: 1 }];
  const quote = (await (await request('/checkout/quote', { cart, city: 'Rabat' })).json()) as any;
  const body = {
    cart,
    customer: {
      name: 'Test Customer',
      phone: '0612345678',
      city: 'Rabat',
      address: 'Test address',
      notes: '',
    },
    fingerprint: quote.fingerprint,
    idempotency: crypto.randomUUID(),
    matching: { path: '/offers/daily-bag' },
  };
  const result = await request('/orders', body);
  expect(result.status).toBe(201);
  const ref = ((await result.json()) as any).ref;
  await vi.waitFor(() =>
    expect(received.filter((r) => r.body.data[0].event_name === 'Lead')).toHaveLength(2),
  );
  expect(new Set(received.map((r) => r.body.data[0].event_id))).toEqual(new Set(['lead:' + ref]));
  expect(new Set(received.map((r) => r.url.split('/').at(-2)))).toEqual(
    new Set(['123456', '654321']),
  );
  expect((await request('/orders', body)).status).toBe(200);
  const row = await env.DB.prepare('SELECT id FROM orders WHERE ref=?').bind(ref).first<any>();
  const original = (await order(env.DB, row.id))!;
  await expect(metaPurchase(env, original)).rejects.toMatchObject({
    code: 'purchase_requires_delivery',
  });
  const delivered = {
    ...original,
    shipping_status: 'delivered',
    delivered_at: new Date().toISOString(),
  };
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const data = JSON.parse(init.body as string).data[0];
    expect(data.event_name).toBe('Purchase');
    expect(data.event_id).toBe('purchase:' + original.id);
    return url.includes('/123456/')
      ? Response.json({ error: { code: 190 } }, { status: 400 })
      : Response.json({ events_received: 1 });
  });
  vi.stubGlobal('fetch', fetch);
  await expect(metaPurchase(env, delivered)).rejects.toMatchObject({ code: 'meta_rejected_400' });
  await expect(metaPurchase(env, delivered)).rejects.toMatchObject({ code: 'meta_rejected_400' });
  expect(fetch.mock.calls.filter(([url]) => url.includes('/654321/'))).toHaveLength(1);
  expect(
    await env.DB.prepare('SELECT pixel_id,status,payload FROM meta_events WHERE id=?')
      .bind('654321:Purchase:purchase:' + original.id)
      .first(),
  ).toEqual({ pixel_id: '654321', status: 'sent', payload: null });
});

it('keeps an exhausted destination from starving another and reserves authoritative order events', async () => {
  await configureSecondary();
  await env.DB.exec(
    "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<5000) INSERT INTO meta_events(id,pixel_id,payload,run_at,created_at) SELECT '654321:PageView:fixture-'||x,'654321','fixture',0,0 FROM n",
  );
  const e = event();
  expect((await (await metaEventStatement(env, '654321', e)).run()).meta.changes).toBe(0);
  expect((await (await metaEventStatement(env, '123456', e)).run()).meta.changes).toBe(1);
  expect(
    (await (await metaEventStatement(env, '654321', { ...e, event_name: 'Lead' })).run()).meta
      .changes,
  ).toBe(1);
});
