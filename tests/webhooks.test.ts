import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { verifyMowaridWebhook } from '../src/server/webhook-signature';
import {
  receiveWebhook,
  processWebhooks,
  connectWebhooks,
  webhookReady,
  queueWebhookConnection,
} from '../src/server/webhooks';
import { saveCredential, credential, digest } from '../src/server/security';
import { state, setState, order, type Env } from '../src/server/db';
import { refreshTracking, syncUpdatedOrders } from '../src/server/jobs';

let runtime: Miniflare, env: Env;
const key = 'mw_live_local_webhook_fixture',
  secret = 'whsec_local_webhook_fixture_123456789';
const sign = (raw: string, timestamp = Math.floor(Date.now() / 1000)) =>
  't=' +
  timestamp +
  ',v1=' +
  createHmac('sha256', secret)
    .update(timestamp + '.' + raw)
    .digest('hex');
beforeAll(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: '2026-10-01',
      d1Databases: ['DB'],
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
    ENCRYPTION_KEY: btoa('w'.repeat(32)),
    ENVIRONMENT: 'production',
    APP_ORIGIN: 'https://store.example.test',
  } as Env;
});
beforeEach(async () => {
  vi.unstubAllGlobals();
  for (const table of [
    'webhook_inbox',
    'jobs',
    'order_items',
    'orders',
    'sync_state',
    'credentials',
    'limits',
  ])
    await env.DB.prepare('DELETE FROM ' + table).run();
  await saveCredential(env, 'mowarid', key);
  await saveCredential(env, 'mowarid_webhook', secret);
  await setState(env.DB, 'webhook_subscription', {
    id: 'subscription-local',
    url: env.APP_ORIGIN + '/api/webhooks/mowarid',
    keyFingerprint: await digest(key),
    status: 'active',
    verifiedAt: new Date().toISOString(),
  });
  await env.DB.prepare(
    'INSERT INTO orders(id,ref,idempotency,request_hash,customer,supplier,quote,attribution,matching,created_at,status,sync_status,mowarid_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      'local-order',
      'local-ref',
      'local-idempotency',
      'hash',
      '{}',
      'local-supplier',
      JSON.stringify({ total: 10000, items: [] }),
      '{}',
      '{}',
      new Date().toISOString(),
      'confirmed',
      'sent',
      'remote-order',
    )
    .run();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await runtime?.dispose();
});
function event(
  id: string,
  shipping = 'delivered',
  updated = new Date().toISOString(),
  nested = true,
) {
  const remote = {
    order_id: 'remote-order',
    external_order_id: 'local-order',
    status: {
      shipping_status: shipping,
      financial_status: shipping === 'paid' ? 'paid' : 'awaiting_settlement',
    },
    financials: { total_cod_amount: 100 },
    shipping: { carrier: 'Dynamic carrier', tracking_url: 'https://carrier.example.test/1' },
    timestamps: { updated_at: updated, delivered_at: new Date(Date.now() - 60000).toISOString() },
  };
  return JSON.stringify({
    event_id: id,
    event_type: 'order.delivered',
    api_version: 'v1',
    data: nested ? { order: remote } : remote,
  });
}
async function receive(raw: string, header = sign(raw)) {
  return receiveWebhook(env, new TextEncoder().encode(raw), header);
}

it('matches the exact vendor UTF-8 signature vector and rejects malformed, expired and tampered signatures', async () => {
  const raw =
    '{"event_id":"evt_test_123456789","event_type":"order.delivered","created_at":"2026-10-07T08:00:00.000Z","api_version":"v1","data":{"order_id":"8a729e1f-4b02-411a-8e2b-f38b4d817921","order_number":"#MDK-2026-00240","external_order_id":"STORE-ORD-9021","status":{"shipping_status":"delivered","shipping_status_label":"تم التوصيل","financial_status":"awaiting_settlement","financial_status_label":"بانتظار تسوية شركة الشحن"}}}';
  const header = 't=1728290000,v1=df1357c522118800b28e0d65247a84f9ebccdd5a17422c2ccb26e55b17e32261';
  expect(
    await verifyMowaridWebhook(raw, header, 'whsec_test_secret_abc1234567890def', 1728290000),
  ).toBe(true);
  expect(
    await verifyMowaridWebhook(raw + ' ', header, 'whsec_test_secret_abc1234567890def', 1728290000),
  ).toBe(false);
  expect(
    await verifyMowaridWebhook(raw, header, 'whsec_test_secret_abc1234567890def', 1728290301),
  ).toBe(false);
  for (const invalid of ['', 't=x,v1=abc', 't=1728290000,v1=abc', header + ',t=1728290000'])
    expect(await verifyMowaridWebhook(raw, invalid, secret, 1728290000)).toBe(false);
});
it('persists encrypted order events before processing and commits one Purchase without any detail-fetch requests', async () => {
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  const raw = event('evt-delivery');
  expect(await receive(raw)).toEqual({ ok: true, duplicate: false });
  const row = await env.DB.prepare('SELECT payload,status FROM webhook_inbox').first<any>();
  expect(row.status).toBe('pending');
  expect(row.payload).not.toContain('remote-order');
  expect((await order(env.DB, 'local-order'))?.delivered_at).toBeNull();
  await Promise.all([receive(raw), receive(raw)]);
  await processWebhooks(env);
  await processWebhooks(env);
  expect((await order(env.DB, 'local-order'))?.shipping_status).toBe('delivered');
  expect(
    (await env.DB.prepare("SELECT id FROM jobs WHERE type='purchase'").all()).results,
  ).toHaveLength(1);
  expect(await env.DB.prepare('SELECT status,payload FROM webhook_inbox').first()).toEqual({
    status: 'done',
    payload: null,
  });
  expect(network).not.toHaveBeenCalled();
});
it('accepts both documented nesting shapes and never rolls back a newer paid state on an older delivery event', async () => {
  await receive(event('evt-paid', 'paid', new Date(Date.now() - 1000).toISOString(), false));
  await processWebhooks(env);
  await receive(event('evt-older', 'delivered', new Date(Date.now() - 5000).toISOString()));
  await processWebhooks(env);
  expect((await order(env.DB, 'local-order'))?.shipping_status).toBe('paid');
  expect(
    (await env.DB.prepare("SELECT id FROM jobs WHERE type='purchase'").all()).results,
  ).toHaveLength(1);
});
it('rejects a validly signed conflicting reuse of event_id', async () => {
  await receive(event('evt-same'));
  await expect(receive(event('evt-same', 'paid'))).rejects.toMatchObject({
    code: 'webhook_event_conflict',
  });
  expect((await env.DB.prepare('SELECT event_id FROM webhook_inbox').all()).results).toHaveLength(
    1,
  );
});
it('applies signed appointment and tracking updates without fetching details or changing the original quote', async () => {
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  const original = (await order(env.DB, 'local-order'))!.quote;
  const payload = JSON.parse(event('evt-appointment', 'pending', '2026-10-09T14:30:00Z'));
  payload.event_type = 'order.status_updated';
  payload.data.order.status = {
    shipping_status: 'pending',
    financial_status: 'pending',
    call_status: 'postponed',
    postponed_until: '2026-10-15T09:00:00.000Z',
    postponed_note: 'Call after payday',
    last_call_at: '2026-10-09T11:15:24Z',
  };
  const raw = JSON.stringify(payload);
  await receive(raw);
  await processWebhooks(env);
  expect(
    (await order(env.DB, 'local-order'))!.remote &&
      JSON.parse((await order(env.DB, 'local-order'))!.remote!),
  ).toMatchObject({
    status: {
      postponed_until: '2026-10-15T09:00:00.000Z',
      postponed_note: 'Call after payday',
      last_call_at: '2026-10-09T11:15:24Z',
    },
  });
  expect(await receive(raw)).toMatchObject({ duplicate: true });
  payload.event_id = 'evt-tracking';
  payload.data.order.status = {
    shipping_status: 'approved',
    financial_status: 'pending',
    call_status: 'pending',
  };
  payload.data.order.shipping.tracking_number = 'MA020627135828';
  payload.data.order.timestamps.updated_at = '2026-10-09T14:31:00Z';
  await receive(JSON.stringify(payload));
  await processWebhooks(env);
  // A delayed old event must not remove the new tracking number.
  const older = JSON.parse(raw);
  older.event_id = 'evt-delayed-appointment';
  await receive(JSON.stringify(older));
  await processWebhooks(env);
  const saved = (await order(env.DB, 'local-order'))!;
  expect(saved.shipping_status).toBe('approved');
  expect(JSON.parse(saved.remote!).shipping.tracking_number).toBe('MA020627135828');
  expect(saved.quote).toBe(original);
  expect(saved.delivered_at).toBeNull();
  expect(
    (await env.DB.prepare("SELECT id FROM jobs WHERE type='purchase'").all()).results,
  ).toHaveLength(0);
  expect(network).not.toHaveBeenCalled();
});
it('does not import other stores orders and retains no customer payload for ignored events', async () => {
  const raw = JSON.parse(event('evt-other'));
  raw.data.order.external_order_id = 'another-store-order';
  await receive(JSON.stringify(raw));
  await processWebhooks(env);
  expect(await env.DB.prepare('SELECT status,payload FROM webhook_inbox').first()).toEqual({
    status: 'ignored',
    payload: null,
  });
  expect((await env.DB.prepare('SELECT id FROM orders').all()).results).toHaveLength(1);
  expect((await env.DB.prepare('SELECT id FROM jobs').all()).results).toHaveLength(0);
});
it('ignores a signed ping without creating an order or Purchase', async () => {
  await receive(
    JSON.stringify({ event_id: 'evt-ping', event_type: 'ping', api_version: 'v1', data: {} }),
  );
  expect((await env.DB.prepare('SELECT id FROM jobs').all()).results).toHaveLength(0);
  expect((await state(env.DB, 'webhook_last_received')).eventType).toBe('ping');
});
it('holds an early event until the accepted remote ID is persisted', async () => {
  await env.DB.prepare('UPDATE orders SET mowarid_id=NULL,post_attempted=1').run();
  await receive(event('evt-early'));
  await processWebhooks(env);
  expect((await env.DB.prepare('SELECT status FROM webhook_inbox').first<any>()).status).toBe(
    'pending',
  );
  expect((await order(env.DB, 'local-order'))?.delivered_at).toBeNull();
  await env.DB.prepare("UPDATE orders SET mowarid_id='remote-order'").run();
  await env.DB.prepare('UPDATE webhook_inbox SET run_at=0').run();
  await processWebhooks(env);
  expect((await order(env.DB, 'local-order'))?.shipping_status).toBe('delivered');
});
it('fails closed on mismatched order IDs and leaves frequent fallback tracking enabled', async () => {
  const raw = JSON.parse(event('evt-mismatch'));
  raw.data.order.order_id = 'wrong-id';
  await receive(JSON.stringify(raw));
  await processWebhooks(env);
  expect(await webhookReady(env)).toBe(false);
  expect((await order(env.DB, 'local-order'))?.delivered_at).toBeNull();
});
it('rejects signatures from a former integration key while preserving durable old events', async () => {
  const raw = event('evt-before-key-change');
  await receive(raw);
  await saveCredential(env, 'mowarid', 'mw_live_another_account');
  await expect(receive(event('evt-after-key-change'))).rejects.toMatchObject({
    code: 'webhook_account_changed',
  });
  await processWebhooks(env);
  expect((await order(env.DB, 'local-order'))?.delivered_at).toBeNull();
  expect(await webhookReady(env)).toBe(false);
});
it('registers once, stores the one-time secret encrypted, and activates only after a signed delivery test', async () => {
  await env.DB.prepare("DELETE FROM credentials WHERE name='mowarid_webhook'").run();
  await setState(env.DB, 'webhook_subscription', null);
  let registered = false,
    creates = 0;
  const sub = {
    id: 'subscription-created',
    url: env.APP_ORIGIN + '/api/webhooks/mowarid',
    events: ['order.delivered', 'order.status_updated', 'order.financial_updated'],
    is_active: true,
  };
  const network = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method;
    if (new URL(url).pathname.endsWith('/subscriptions') && method === 'GET')
      return Response.json({ success: true, subscriptions: registered ? [sub] : [] });
    if (new URL(url).pathname.endsWith('/subscriptions') && method === 'POST') {
      registered = true;
      creates++;
      return Response.json({ success: true, subscription: { ...sub, secret } });
    }
    if (new URL(url).pathname.endsWith('/ping')) {
      await receive(
        JSON.stringify({ event_id: crypto.randomUUID(), event_type: 'ping', data: {} }),
      );
      return Response.json({ success: true });
    }
    throw new Error('Unexpected API call');
  });
  vi.stubGlobal('fetch', network);
  await connectWebhooks(env);
  await connectWebhooks(env);
  expect(creates).toBe(1);
  expect(await webhookReady(env)).toBe(true);
  expect(await credential(env, 'mowarid_webhook')).toBe(secret);
  expect(
    (
      await env.DB.prepare(
        "SELECT encrypted FROM credentials WHERE name='mowarid_webhook'",
      ).first<any>()
    ).encrypted,
  ).not.toContain(secret);
});
it.each([404, 405, 500, 401, 429])(
  'retries the legacy ping route only when the documented route is absent (HTTP %s)',
  async (status) => {
    const sub = {
      id: 'subscription-local',
      url: env.APP_ORIGIN + '/api/webhooks/mowarid',
      events: ['order.delivered', 'order.status_updated', 'order.financial_updated'],
      is_active: true,
    };
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        paths.push(path);
        if (path.endsWith('/subscriptions'))
          return Response.json({ success: true, subscriptions: [sub] });
        if (path.endsWith('/ping')) return new Response('Endpoint unavailable', { status });
        if (path.endsWith('/test')) {
          await receive(
            JSON.stringify({
              event_id: 'legacy-ping',
              event_type: 'ping',
              api_version: 'v1',
              data: {},
            }),
          );
          return Response.json({ success: true });
        }
        throw new Error('Unexpected API call');
      }),
    );
    if ([404, 405].includes(status)) {
      await connectWebhooks(env);
      expect(await webhookReady(env)).toBe(true);
      expect(paths.filter((path) => path.endsWith('/test'))).toHaveLength(1);
    } else {
      await expect(connectWebhooks(env)).rejects.toBeDefined();
      expect(await webhookReady(env)).toBe(false);
      expect(paths.some((path) => path.endsWith('/test'))).toBe(false);
    }
    expect(paths.some((path) => path.endsWith('/rotate-secret'))).toBe(false);
  },
);
it('recovers a lost creation response by rotating the same subscription instead of creating another', async () => {
  await setState(env.DB, 'webhook_subscription', null);
  await env.DB.prepare("DELETE FROM credentials WHERE name='mowarid_webhook'").run();
  const sub = {
    id: 'recovered-sub',
    url: env.APP_ORIGIN + '/api/webhooks/mowarid',
    events: ['order.delivered', 'order.status_updated', 'order.financial_updated'],
    is_active: true,
  };
  let exists = false,
    creates = 0,
    rotates = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname.endsWith('/subscriptions') && init?.method === 'GET')
        return Response.json({ success: true, subscriptions: exists ? [sub] : [] });
      if (new URL(url).pathname.endsWith('/subscriptions') && init?.method === 'POST') {
        exists = true;
        creates++;
        throw new Error('Lost response');
      }
      if (new URL(url).pathname.endsWith('/rotate-secret')) {
        rotates++;
        return Response.json({ success: true, secret });
      }
      if (new URL(url).pathname.endsWith('/ping')) {
        await receive(JSON.stringify({ event_id: 'recovery-ping', event_type: 'ping' }));
        return Response.json({ success: true });
      }
      throw new Error('Unexpected API call');
    }),
  );
  await expect(connectWebhooks(env)).rejects.toMatchObject({ code: 'network_unknown' });
  await connectWebhooks(env);
  expect(creates).toBe(1);
  expect(rotates).toBe(1);
  expect(await webhookReady(env)).toBe(true);
});
it('leaves fallback enabled when registration returns 500 or a claimed test succeeds without any signed receipt', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 500 })),
  );
  await expect(connectWebhooks(env)).rejects.toMatchObject({ code: 'remote_server_error' });
  expect(await webhookReady(env)).toBe(false);
  const sub = {
    id: 'subscription-local',
    url: env.APP_ORIGIN + '/api/webhooks/mowarid',
    events: ['order.delivered', 'order.status_updated', 'order.financial_updated'],
    is_active: true,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        new URL(url).pathname.endsWith('/ping')
          ? { success: true }
          : { success: true, subscriptions: [sub] },
      ),
    ),
  );
  await expect(connectWebhooks(env)).rejects.toMatchObject({
    code: 'webhook_delivery_test_failed',
  });
  expect(await webhookReady(env)).toBe(false);
});
it('deduplicates setup jobs and retains reconciliation when transport pings do not prove business events', async () => {
  await queueWebhookConnection(env);
  await queueWebhookConnection(env);
  expect(
    (await env.DB.prepare("SELECT id FROM jobs WHERE type='webhook_connect'").all()).results,
  ).toHaveLength(1);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        success: true,
        orders: [],
        pagination: { has_more: false, next_cursor: null },
      }),
    ),
  );
  await refreshTracking(env);
  expect((await state(env.DB, 'tracking_last')).nextAt - Date.now()).toBeLessThan(1800001);
  await setState(env.DB, 'webhook_subscription', {
    ...(await state(env.DB, 'webhook_subscription')),
    status: 'error',
  });
  await setState(env.DB, 'tracking_last', { nextAt: 0 });
  await refreshTracking(env);
  expect((await state(env.DB, 'tracking_last')).nextAt - Date.now()).toBeLessThan(1800001);
});
it('restarts legacy Offset progress safely and resumes cursor pages after a rate-limited continuation', async () => {
  const since = '2026-08-01T00:00:00Z';
  await setState(env.DB, 'tracking_checkpoint', { since });
  await setState(env.DB, 'tracking_progress', {
    since,
    started: since,
    page: 40,
    pending: [{ external_order_id: 'old-pending' }],
    lastPage: false,
  });
  let continuation = 0;
  const network = vi.fn(async (url: string) => {
    const parsed = new URL(url);
    expect(parsed.searchParams.has('page')).toBe(false);
    if (!parsed.searchParams.has('cursor')) {
      expect(parsed.searchParams.get('updated_since')).toBe(since);
      return Response.json({
        success: true,
        orders: [
          JSON.parse(event('cursor-row', 'shipped')).data.order,
          { external_order_id: 'other-store' },
        ],
        pagination: { has_more: true, next_cursor: 'opaque+/=' },
      });
    }
    expect(parsed.searchParams.get('cursor')).toBe('opaque+/=');
    expect(parsed.searchParams.has('updated_since')).toBe(false);
    if (++continuation === 1)
      return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } });
    return Response.json({
      success: true,
      orders: [],
      pagination: { has_more: false, next_cursor: null },
    });
  });
  vi.stubGlobal('fetch', network);
  await syncUpdatedOrders(env, 1);
  expect((await order(env.DB, 'local-order'))?.shipping_status).toBe('shipped');
  expect((await state(env.DB, 'tracking_progress')).pending).toHaveLength(1);
  expect((await state(env.DB, 'tracking_progress')).cursor).toBe('opaque+/=');
  await syncUpdatedOrders(env, 1);
  expect(network).toHaveBeenCalledTimes(1);
  await expect(syncUpdatedOrders(env)).rejects.toMatchObject({
    code: 'rate_limit_exceeded',
    after: 120,
  });
  expect((await state(env.DB, 'tracking_checkpoint')).since).toBe(since);
  expect((await state(env.DB, 'tracking_progress')).cursor).toBe('opaque+/=');
  await syncUpdatedOrders(env);
  expect(await state(env.DB, 'tracking_progress')).toBeNull();
  expect((await state(env.DB, 'tracking_checkpoint')).since).not.toBe(since);
});
it('reconciles old unfinished restored orders instead of limiting the first sweep to the last seven days', async () => {
  const createdAt = new Date(Date.now() - 60 * 86400000).toISOString();
  await env.DB.prepare('UPDATE orders SET created_at=?').bind(createdAt).run();
  const network = vi.fn(async (url: string) => {
    const since = new URL(url).searchParams.get('updated_since')!;
    expect(Date.parse(since)).toBeLessThanOrEqual(Date.parse(createdAt));
    return Response.json({
      success: true,
      orders: [],
      pagination: { has_more: false, next_cursor: null },
    });
  });
  vi.stubGlobal('fetch', network);
  await syncUpdatedOrders(env);
  expect(network).toHaveBeenCalledTimes(1);
});
it('rejects a missing or stalled continuation without committing a misleading checkpoint', async () => {
  await setState(env.DB, 'tracking_checkpoint', { since: '2026-08-01T00:00:00Z' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        success: true,
        orders: [],
        pagination: { has_more: true, next_cursor: null },
      }),
    ),
  );
  await expect(syncUpdatedOrders(env)).rejects.toMatchObject({
    code: 'invalid_incremental_tracking_contract',
  });
  expect(await state(env.DB, 'tracking_progress')).toBeNull();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        success: true,
        orders: [],
        pagination: { has_more: true, next_cursor: 'same-cursor' },
      }),
    ),
  );
  await syncUpdatedOrders(env);
  await expect(syncUpdatedOrders(env)).rejects.toMatchObject({
    code: 'invalid_incremental_tracking_contract',
  });
  expect((await state(env.DB, 'tracking_checkpoint')).since).toBe('2026-08-01T00:00:00Z');
});
it('an explicit retry expedites a failed-server setup without bypassing a rate-limit deadline', async () => {
  await queueWebhookConnection(env);
  const future = Date.now() + 3600000;
  await env.DB.prepare(
    "UPDATE jobs SET last_error='remote_server_error',run_at=? WHERE type='webhook_connect'",
  )
    .bind(future)
    .run();
  await queueWebhookConnection(env, true);
  expect(
    (await env.DB.prepare("SELECT run_at FROM jobs WHERE type='webhook_connect'").first<any>())
      .run_at,
  ).toBe(0);
  await env.DB.prepare(
    "UPDATE jobs SET last_error='rate_limit_exceeded',run_at=? WHERE type='webhook_connect'",
  )
    .bind(future)
    .run();
  await queueWebhookConnection(env, true);
  expect(
    (await env.DB.prepare("SELECT run_at FROM jobs WHERE type='webhook_connect'").first<any>())
      .run_at,
  ).toBe(future);
  expect(
    (await env.DB.prepare("SELECT id FROM jobs WHERE type='webhook_connect'").all()).results,
  ).toHaveLength(1);
});
it('rejects a stale cached empty subscription list and reuses the existing subscription without cache-busting queries', async () => {
  let lists = 0;
  const listUrls: string[] = [];
  const sub = {
    id: 'subscription-local',
    url: env.APP_ORIGIN + '/api/webhooks/mowarid',
    events: ['order.delivered', 'order.status_updated', 'order.financial_updated'],
    is_active: true,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/subscriptions')) {
        listUrls.push(parsed.href);
        expect(parsed.search).toBe('');
        expect(new Headers(init?.headers).get('Cache-Control')).toBe('no-cache');
        expect(new Headers(init?.headers).get('Pragma')).toBe('no-cache');
        expect(init?.cache).toBe('no-store');
        expect((init as RequestInit & { cf?: unknown }).cf).toEqual({
          cacheTtlByStatus: { '100-599': -1 },
        });
        if (++lists === 1)
          return Response.json(
            { success: true, subscriptions: [] },
            { headers: { 'CF-Cache-Status': 'HIT' } },
          );
        return Response.json(
          { success: true, subscriptions: [sub] },
          { headers: { 'CF-Cache-Status': 'BYPASS' } },
        );
      }
      if (parsed.pathname.endsWith('/ping')) {
        await receive(JSON.stringify({ event_id: 'fresh-read-ping', event_type: 'ping' }));
        return Response.json({ success: true });
      }
      throw new Error('Must not create or rotate a known subscription');
    }),
  );
  await expect(connectWebhooks(env)).rejects.toMatchObject({ code: 'cached_private_api_response' });
  expect(await webhookReady(env)).toBe(false);
  await connectWebhooks(env);
  expect(await webhookReady(env)).toBe(true);
  expect(listUrls).toEqual([
    'https://mowarid.ma/api/v1/webhooks/subscriptions',
    'https://mowarid.ma/api/v1/webhooks/subscriptions',
  ]);
});
