import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { tick, refreshTracking } from '../src/server/jobs';
import { state, setState, type Env } from '../src/server/db';
import { saveCredential, digest } from '../src/server/security';
import { syncCities } from '../src/server/mowarid';
let runtime: Miniflare, env: Env;
beforeAll(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test");}}',
      compatibilityDate: '2026-10-05',
      d1Databases: ['DB'],
      r2Buckets: ['MEDIA', 'BACKUPS'],
    }),
  );
  const db = await runtime.getD1Database('DB');
  for (const name of [
    '0001_initial',
    '0002_submission_guard',
    '0003_mowarid_contract',
    '0004_quote_and_dry_run',
    '0005_delivery_total',
    '0006_owner_access',
    '0007_product_shipping',
    '0008_categories',
    '0009_product_page_mode',
    '0010_webhooks',
    '0011_storefront_visibility',
    '0012_product_search',
    '0013_product_presentation',
    '0014_campaign_links',
    '0015_funnel',
  ])
    await db.exec(await readFile('migrations/' + name + '.sql', 'utf8'));
  env = {
    DB: db,
    MEDIA: await runtime.getR2Bucket('MEDIA'),
    BACKUPS: await runtime.getR2Bucket('BACKUPS'),
    ENVIRONMENT: 'development',
    ENCRYPTION_KEY: btoa('s'.repeat(32)),
  } as unknown as Env;
});
beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const table of [
    'jobs',
    'orders',
    'products',
    'sync_state',
    'limits',
    'catalog',
    'cities',
    'credentials',
    'settings',
  ])
    await env.DB.prepare('DELETE FROM ' + table).run();
  await env.DB.prepare("INSERT INTO settings VALUES(1,'{}')").run();
  await saveCredential(env, 'mowarid', 'local-scheduling-test-key');
  await setState(env.DB, 'schedule', { backup: Date.now(), cleanup: Date.now() });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await runtime?.dispose();
});
async function remoteOrder(shipping: string, financial: string | null = null) {
  await env.DB.prepare(
    'INSERT INTO orders(id,ref,idempotency,request_hash,customer,supplier,quote,attribution,matching,created_at,mowarid_id,shipping_status,financial_status,next_poll) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      'schedule-order',
      'schedule-reference',
      'schedule-idempotency',
      'schedule-hash',
      '{}',
      'supplier',
      '{}',
      '{}',
      '{}',
      new Date().toISOString(),
      'mowarid-order',
      shipping,
      financial,
      Date.now() + 86400000,
    )
    .run();
}
it('an empty trainee store makes no external polling requests', async () => {
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  await tick(env);
  expect(network).not.toHaveBeenCalled();
  expect(
    (await env.DB.prepare("SELECT type FROM jobs WHERE type IN ('catalog','cities')").all())
      .results,
  ).toHaveLength(0);
});
it('completed paid orders cause no background tracking calls', async () => {
  await remoteOrder('paid', 'paid');
  await env.DB.prepare('UPDATE orders SET next_poll=0').run();
  await env.DB.prepare('INSERT INTO cities VALUES(1,?,?)')
    .bind('[]', new Date().toISOString())
    .run();
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  await tick(env);
  expect(network).not.toHaveBeenCalled();
});
it('tracking is throttled for active shipments and still polls delivered orders awaiting payout', async () => {
  await remoteOrder('in_transit');
  await env.DB.prepare('INSERT INTO cities VALUES(1,?,?)')
    .bind('[]', new Date().toISOString())
    .run();
  const network = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          orders: [],
          pagination: { has_more: false, next_cursor: null },
        }),
      ),
  );
  vi.stubGlobal('fetch', network);
  await tick(env);
  await tick(env);
  expect(network).toHaveBeenCalledTimes(1);
  const active = await state(env.DB, 'tracking_last');
  expect(active.nextAt - Date.now()).toBeGreaterThanOrEqual(299000);
  await env.DB.prepare(
    "UPDATE orders SET shipping_status='delivered',financial_status='awaiting_settlement'",
  ).run();
  await setState(env.DB, 'tracking_last', { nextAt: 0 });
  await tick(env);
  expect(network).toHaveBeenCalledTimes(2);
  expect((await state(env.DB, 'tracking_last')).nextAt - Date.now()).toBeGreaterThan(299000);
});
it('a Retry-After deadline is respected by scheduled tracking', async () => {
  await remoteOrder('pending');
  await env.DB.prepare('INSERT INTO cities VALUES(1,?,?)')
    .bind('[]', new Date().toISOString())
    .run();
  const network = vi.fn(
    async () => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }),
  );
  vi.stubGlobal('fetch', network);
  await tick(env);
  await tick(env);
  expect(network).toHaveBeenCalledTimes(1);
  expect((await state(env.DB, 'tracking_last')).retryAt - Date.now()).toBeGreaterThan(119000);
});
it('admin opening bypasses the background cadence but repeated tabs and Retry-After do not poll again', async () => {
  await remoteOrder('paid', 'paid');
  const network = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          orders: [],
          pagination: { has_more: false, next_cursor: null },
        }),
      ),
  );
  vi.stubGlobal('fetch', network);
  await setState(env.DB, 'tracking_last', {
    at: new Date(Date.now() - 120000).toISOString(),
    nextAt: Date.now() + 1800000,
  });
  expect(await refreshTracking(env, true)).toEqual({ ok: true });
  expect((await state(env.DB, 'tracking_last')).nextAt - Date.now()).toBeGreaterThan(1790000);
  expect(await refreshTracking(env, true)).toEqual({ skipped: true });
  await setState(env.DB, 'tracking_last', {
    at: new Date(Date.now() - 120000).toISOString(),
    retryAt: Date.now() + 120000,
  });
  expect(await refreshTracking(env, true)).toEqual({ skipped: true });
  expect(network).toHaveBeenCalledTimes(1);
});
it('conditional cities sync retains metadata on 304 and replaces it when the ETag changes', async () => {
  const first = [{ city: 'CASABLANCA', is_casablanca: true, shipping_fee_mad: 20 }];
  const network = vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    expect(headers.has('Authorization')).toBe(false);
    if (network.mock.calls.length === 1) {
      expect(headers.has('If-None-Match')).toBe(false);
      return new Response(JSON.stringify({ success: true, cities: first }), {
        headers: { ETag: 'W/"cities-1"' },
      });
    }
    expect(headers.get('If-None-Match')).toBe('W/"cities-1"');
    if (network.mock.calls.length === 2) return new Response(null, { status: 304 });
    return new Response(JSON.stringify({ success: true, cities: [...first, { city: 'RABAT' }] }), {
      headers: { ETag: '"cities-2"' },
    });
  });
  vi.stubGlobal('fetch', network);
  expect(await syncCities(env)).toBe(1);
  expect(await syncCities(env)).toBe(1);
  const row = await env.DB.prepare('SELECT json FROM cities').first<{ json: string }>();
  expect(JSON.parse(row!.json)).toEqual(first);
  expect(await syncCities(env)).toBe(2);
  expect((await state(env.DB, 'cities_cache')).etag).toBe('"cities-2"');
});
it('a stored ETag without cached cities never accepts an empty 304 as a successful sync', async () => {
  await setState(env.DB, 'cities_cache', { etag: '"old"' });
  const network = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).has('If-None-Match')).toBe(false);
    return new Response(null, { status: 304 });
  });
  vi.stubGlobal('fetch', network);
  await expect(syncCities(env)).rejects.toMatchObject({ code: 'remote_http_304' });
  expect(await env.DB.prepare('SELECT json FROM cities').first()).toBeNull();
});
it('catalog schedules are spread across stores and retain the incremental synchronization cadence', async () => {
  await env.DB.prepare(
    "INSERT INTO products(id,slug,sku,name,price) VALUES('draft','draft','SCHEDULE-SKU','draft',10000)",
  ).run();
  await env.DB.prepare('INSERT INTO cities VALUES(1,?,?)')
    .bind('[]', new Date().toISOString())
    .run();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  await tick(env);
  const schedule = await state(env.DB, 'schedule');
  expect(schedule.catalogNext - Date.now()).toBeGreaterThan(989000);
  expect(schedule.catalogNext - Date.now()).toBeLessThanOrEqual(990000);
  expect(network).not.toHaveBeenCalled();
});
it('keeps bounded individual reconciliation with healthy webhooks without repeatedly fetching the same unchanged order', async () => {
  env.APP_ORIGIN = 'https://store.example.test';
  try {
    await remoteOrder('shipped');
    await env.DB.prepare('UPDATE orders SET next_poll=0,quote=?')
      .bind(JSON.stringify({ total: 10000, items: [] }))
      .run();
    await env.DB.prepare('INSERT INTO cities VALUES(1,?,?)')
      .bind('[]', new Date().toISOString())
      .run();
    await saveCredential(env, 'mowarid_webhook', 'whsec_local_schedule_fixture');
    await setState(env.DB, 'webhook_subscription', {
      status: 'active',
      url: env.APP_ORIGIN + '/api/webhooks/mowarid',
      keyFingerprint: await digest('local-scheduling-test-key'),
      verifiedAt: new Date().toISOString(),
    });
    const network = vi.fn(async (url: string) =>
      Response.json({
        success: true,
        orders: url.includes('external_order_id=')
          ? [
              {
                order_id: 'mowarid-order',
                external_order_id: 'schedule-order',
                status: { shipping_status: 'shipped' },
                financials: { total_cod_amount: 100 },
                timestamps: { updated_at: new Date().toISOString() },
              },
            ]
          : [],
        pagination: { has_more: false, next_cursor: null },
      }),
    );
    vi.stubGlobal('fetch', network);
    const started = Date.now();
    await tick(env);
    await tick(env);
    const completed = Date.now();
    expect(network).toHaveBeenCalledTimes(2);
    expect((await state(env.DB, 'schedule')).directPollNext).toBeGreaterThanOrEqual(
      started + 3600000,
    );
    const row = await env.DB.prepare('SELECT next_poll FROM orders').first<{ next_poll: number }>();
    expect(row!.next_poll).toBeGreaterThanOrEqual(started + 86400000);
    expect(row!.next_poll).toBeLessThanOrEqual(completed + 86400000);
    expect((await state(env.DB, 'tracking_last')).nextAt).toBeGreaterThanOrEqual(started + 300000);
  } finally {
    delete env.APP_ORIGIN;
  }
});

it('upgrades an old daily push deadline without bypassing rate-limit backoff', async () => {
  await remoteOrder('approved', 'pending');
  await setState(env.DB, 'tracking_last', {
    at: new Date(Date.now() - 600000).toISOString(),
    nextAt: Date.now() + 86400000,
  });
  const network = vi.fn(async () =>
    Response.json({
      success: true,
      orders: [],
      pagination: { has_more: false, next_cursor: null },
    }),
  );
  vi.stubGlobal('fetch', network);
  expect(await refreshTracking(env)).toEqual({ ok: true });
  expect(network).toHaveBeenCalledTimes(1);
  await setState(env.DB, 'tracking_last', {
    at: new Date(Date.now() - 600000).toISOString(),
    nextAt: Date.now() + 86400000,
    retryAt: Date.now() + 120000,
  });
  expect(await refreshTracking(env)).toEqual({ skipped: true });
  expect(network).toHaveBeenCalledTimes(1);
});
