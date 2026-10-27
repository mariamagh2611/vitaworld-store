import { PRODUCT_DESCRIPTION_LIMIT } from '../src/shared/types';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { StoreOperations } from '../src/server/operations';
import { runJobs, recordRemote, syncUpdatedOrders, metaPurchase } from '../src/server/jobs';
import { dryRunMowarid, quoteMowarid } from '../src/server/order-checks';
import { order, parsedOrder, settings } from '../src/server/db';
import {
  encryptSecret,
  decryptSecret,
  saveCredential,
  startSession,
  session as readAdminSession,
  digest,
} from '../src/server/security';
import type { Env } from '../src/server/db';
import { enqueue } from '../src/server/jobs';
import { state } from '../src/server/db';
import { readBackupPart, restorePartIntoEmptyDatabase } from '../src/server/backup';
import { mowarid, syncCatalog, syncCities, submissionResult } from '../src/server/mowarid';
let mf: Miniflare,
  env: Env,
  cookie = '',
  csrf = '';
const origin = 'http://store.test';
async function req(path: string, body?: unknown, admin = false, method = body ? 'POST' : 'GET') {
  return mf.dispatchFetch(origin + '/api' + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(admin ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const customer = {
  name: 'Test Customer',
  phone: '+212612345678',
  city: 'Rabat',
  address: 'Rue test 12',
  notes: '',
};
const cart = [
  { productId: 'demo-bag', offerId: '', quantity: 1, revision: 1 },
  { productId: 'demo-notebook', offerId: '', quantity: 2, revision: 1 },
];
async function confirmedOrder(city = customer.city) {
  const current = ((await (await req('/products')).json()) as any[]).find(
    (p) => p.id === 'demo-notebook',
  );
  const lines = [{ productId: current.id, revision: current.revision, offerId: '', quantity: 1 }];
  const quote = (await (await req('/checkout/quote', { cart: lines, city })).json()) as any;
  const saved = await req('/orders', {
    cart: lines,
    customer: { ...customer, city },
    fingerprint: quote.fingerprint,
    idempotency: crypto.randomUUID(),
  });
  expect(saved.status).toBe(201);
  const ref = ((await saved.json()) as any).ref;
  const o = (await env.DB.prepare('SELECT * FROM orders WHERE ref=?').bind(ref).first<any>())!;
  await req('/admin/orders/' + o.id + '/confirm', {}, true);
  return o;
}
function quoteResponse(payload: any) {
  const costs: Record<string, number> = { 'DEMO-A1': 80, 'DEMO-A2': 25, 'DEMO-B1': 40 };
  const wholesale = payload.items.reduce(
    (sum: number, item: any) => sum + costs[item.sku] * item.quantity,
    0,
  );
  const casa = ['casablanca', 'الدار البيضاء'].includes(payload.city.toLowerCase());
  const shipping = casa ? 20 : 30;
  return {
    success: true,
    is_valid: true,
    quote_id: 'quot_test',
    expires_at: new Date(Date.now() + 600000).toISOString(),
    supplier_group_id: payload.items[0].sku === 'DEMO-B1' ? 'demo-b' : 'demo-a',
    destination: {
      is_casablanca: casa,
      shipping_tier: casa ? 'casablanca' : 'standard',
      platform_shipping_cost: shipping,
      is_shipping_cost_final: true,
    },
    financials: {
      total_wholesale: wholesale,
      platform_shipping_cost: shipping,
      customer_shipping_fee: payload.customer_shipping_fee,
      platform_due_break_even: wholesale + shipping,
      proposed_cod_to_collect: payload.cod_to_collect,
      estimated_partner_profit: payload.cod_to_collect - wholesale - shipping,
      is_break_even_or_profitable: true,
      currency: 'MAD',
    },
    safety_guarantee: { order_created: false, stock_reserved: false, shipping_label_issued: false },
  };
}
function quotedResponse(init?: RequestInit) {
  return new Response(JSON.stringify(quoteResponse(JSON.parse(init!.body as string))));
}
let savedId = '',
  savedRef = '',
  attempt = crypto.randomUUID();
beforeAll(async () => {
  const b = await build({
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
      script: b.outputFiles[0].text,
      compatibilityDate: '2025-09-01',
      d1Databases: ['DB', 'RESTORE'],
      r2Buckets: ['MEDIA', 'BACKUPS'],
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === '/api/store-origin-proof')
          return url.origin === 'https://shop.example.test'
            ? mf.dispatchFetch(request)
            : new Response('Unrelated site', { status: 404 });
        return fetch(request.url, {
          method: request.method,
          headers: Object.fromEntries(request.headers),
          ...(request.method !== 'GET' && request.method !== 'HEAD'
            ? { body: await request.arrayBuffer() }
            : {}),
        });
      },
      bindings: {
        APP_ORIGIN: 'http://store.test',
        ENVIRONMENT: 'development',
        MEDIA_ORIGIN: 'http://store.test/media',
        ENCRYPTION_KEY: btoa('a'.repeat(32)),
        AUTH_PEPPER: 'test-pepper',
        SETUP_TOKEN: 'test-setup',
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  await db.exec(await readFile('migrations/0001_initial.sql', 'utf8'));
  await db.exec(await readFile('migrations/0002_submission_guard.sql', 'utf8'));
  await db.exec(await readFile('migrations/0003_mowarid_contract.sql', 'utf8'));
  await db.exec(await readFile('migrations/0004_quote_and_dry_run.sql', 'utf8'));
  await db.exec(await readFile('migrations/0005_delivery_total.sql', 'utf8'));
  await db.exec(await readFile('migrations/0006_owner_access.sql', 'utf8'));
  await db.exec(await readFile('migrations/0007_product_shipping.sql', 'utf8'));
  await db.exec(await readFile('migrations/0008_categories.sql', 'utf8'));
  await db.exec(await readFile('migrations/0009_product_page_mode.sql', 'utf8'));
  await db.exec(await readFile('migrations/0010_webhooks.sql', 'utf8'));
  await db.exec(await readFile('migrations/0011_storefront_visibility.sql', 'utf8'));
  await db.exec(await readFile('migrations/0012_product_search.sql', 'utf8'));
  await db.exec(await readFile('migrations/0013_product_presentation.sql', 'utf8'));
  await db.exec(await readFile('migrations/0014_campaign_links.sql', 'utf8'));
  await db.exec(await readFile('migrations/0015_funnel.sql', 'utf8'));
  await db.exec(await readFile('migrations/0016_fixed_bundles.sql', 'utf8'));
  await db.exec(await readFile('migrations/0017_translated_keywords.sql', 'utf8'));
  await db.exec(await readFile('migrations/0018_category_translations.sql', 'utf8'));
  await db.exec(await readFile('migrations/0019_meta_events.sql', 'utf8'));
  await db.exec(
    (await readFile('fixtures/demo.sql', 'utf8'))
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n'),
  );
  env = {
    DB: db,
    MEDIA: await mf.getR2Bucket('MEDIA'),
    BACKUPS: await mf.getR2Bucket('BACKUPS'),
    ENCRYPTION_KEY: btoa('a'.repeat(32)),
    AUTH_PEPPER: 'test-pepper',
    ENVIRONMENT: 'development',
  } as unknown as Env;
});
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM limits').run();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await mf?.dispose();
});
describe('real Worker runtime and D1 transactions', () => {
  it('protects admin endpoints, Origin, and setup', async () => {
    expect((await req('/admin/orders')).status).toBe(401);
    expect(
      (
        await mf.dispatchFetch(origin + '/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    const r = await req('/auth/setup', {
      token: 'test-setup',
      email: 'owner@example.com',
      password: 'a-secure-test-password-2026',
    });
    expect(r.status).toBe(201);
    cookie = r.headers.get('set-cookie')!.split(';')[0];
    const body = (await r.json()) as any;
    csrf = body.csrf;
    expect(body.recovery).toHaveLength(8);
    expect((await req('/admin/settings')).status).toBe(401);
    expect((await req('/admin/settings', undefined, true)).status).toBe(200);
  });
  it('searches the complete private catalog and treats SQL wildcards as literal input', async () => {
    const added = Array.from({ length: 501 }, (_, index) => ({
      sku: 'A-SEARCH-' + String(index).padStart(4, '0'),
      name: 'catalog page filler',
    }));
    added.push({ sku: 'ZZ-SEARCH-ONLY', name: 'needle-variant-lookup' });
    try {
      for (let start = 0; start < added.length; start += 100)
        await env.DB.batch(
          added
            .slice(start, start + 100)
            .map((item) =>
              env.DB.prepare('INSERT INTO catalog VALUES(?,?,?)').bind(
                item.sku,
                JSON.stringify(item),
                new Date().toISOString(),
              ),
            ),
        );
      const first = (await (await req('/admin/catalog', undefined, true)).json()) as any[];
      expect(first).toHaveLength(500);
      expect(
        ((await (await req('/admin/catalog/skus', undefined, true)).json()) as any).skus,
      ).toContain('ZZ-SEARCH-ONLY');
      expect(first.some((item) => item.sku === 'ZZ-SEARCH-ONLY')).toBe(false);
      const found = (await (
        await req('/admin/catalog?q=needle-variant-lookup', undefined, true)
      ).json()) as any[];
      expect(found.map((item) => item.sku)).toEqual(['ZZ-SEARCH-ONLY']);
      const wildcard = await (await req('/admin/catalog?q=%25', undefined, true)).json();
      expect(wildcard).toEqual([]);
      expect((await req('/admin/catalog?q=needle-variant-lookup')).status).toBe(401);
    } finally {
      await env.DB.prepare(
        "DELETE FROM catalog WHERE sku LIKE 'A-SEARCH-%' OR sku='ZZ-SEARCH-ONLY'",
      ).run();
    }
  });
  it('imports HTML catalog batches with safe publication, draft fallbacks and repeatable receipts', async () => {
    const original = await env.DB.prepare("SELECT * FROM products WHERE sku='DEMO-A1'").first();
    const items = [
      {
        sku: 'IMPORT-COLLAGEN',
        name: 'Collagène Mini',
        suggested_retail_price: 200,
        stock_quantity: 10,
      },
      {
        sku: 'IMPORT-CHEAP',
        name: 'Cheap example',
        suggested_retail_price: 10,
        stock_quantity: 10,
      },
      {
        sku: 'IMPORT-EMPTY',
        name: 'No stock example',
        suggested_retail_price: 200,
        stock_quantity: 0,
      },
      {
        sku: 'IMPORT-LARGE',
        name: 'Oversized example',
        suggested_retail_price: 200,
        stock_quantity: 10,
        description: '<p>' + 'a'.repeat(25000) + '</p>',
      },
    ];
    try {
      for (const item of items)
        await env.DB.prepare('INSERT INTO catalog VALUES(?,?,?)')
          .bind(
            item.sku,
            JSON.stringify({
              is_active: true,
              fulfillment_price: 80,
              supplier_key: 'demo-a',
              main_image: 'https://mowarid.ma/main.jpg',
              images: ['https://mowarid.ma/extra.jpg'],
              description:
                '<h2>وصف المنتج</h2><p>تفاصيل فريدة للاستيراد</p><script>alert(1)</script>',
              ...item,
            }),
            new Date().toISOString(),
          )
          .run();
      const id = crypto.randomUUID();
      const body = {
        requestId: id,
        mode: 'published',
        skus: [...items.map((p) => p.sku), 'DEMO-A1', 'IMPORT-MISSING'],
      };
      expect((await req('/admin/catalog/import', body)).status).toBe(401);
      const response = await req('/admin/catalog/import', body, true);
      expect(response.status).toBe(200);
      const receipt = (await response.json()) as any;
      const result = (sku: string) => receipt.items.find((item: any) => item.sku === sku);
      expect(result('IMPORT-COLLAGEN').status).toBe('published');
      expect(result('IMPORT-CHEAP')).toMatchObject({ status: 'draft' });
      expect(result('IMPORT-CHEAP').reason).toBeTruthy();
      expect(result('IMPORT-EMPTY')).toMatchObject({ status: 'draft' });
      expect(result('IMPORT-LARGE').status).toBe('failed');
      expect(result('IMPORT-MISSING').status).toBe('failed');
      expect(result('DEMO-A1').status).toBe('skipped');
      const saved = await env.DB.prepare(
        "SELECT * FROM products WHERE sku='IMPORT-COLLAGEN'",
      ).first<any>();
      expect(saved.active).toBe(1);
      expect(saved.category_id).toBeNull();
      expect(JSON.parse(saved.presentation).descriptionHtml).toContain('<h2>وصف المنتج</h2>');
      expect(JSON.parse(saved.presentation).descriptionHtml).not.toContain('script');
      expect(JSON.parse(saved.gallery)).toHaveLength(2);
      expect(saved.keywords).toContain('كولاجين');
      const lookup = await req('/products?q=' + encodeURIComponent('كولاجين'));
      expect(((await lookup.json()) as any[]).some((p) => p.sku === 'IMPORT-COLLAGEN')).toBe(true);
      expect(await (await req('/admin/catalog/import', body, true)).json()).toEqual(receipt);
      expect((await req('/admin/catalog/import', { ...body, mode: 'draft' }, true)).status).toBe(
        409,
      );
      const retry = (await (
        await req('/admin/catalog/import', { ...body, requestId: crypto.randomUUID() }, true)
      ).json()) as any;
      expect(retry.items.filter((p: any) => p.status === 'skipped')).toHaveLength(4);
      expect(await env.DB.prepare("SELECT * FROM products WHERE sku='DEMO-A1'").first()).toEqual(
        original,
      );
      const inventory = (await (await req('/admin/catalog/skus', undefined, true)).json()) as any;
      expect(inventory.skus).toContain('IMPORT-COLLAGEN');
    } finally {
      await env.DB.prepare("DELETE FROM products WHERE sku LIKE 'IMPORT-%'").run();
      await env.DB.prepare("DELETE FROM catalog WHERE sku LIKE 'IMPORT-%'").run();
    }
  });
  it('overlapping imports create one product and preserve a separately saved draft', async () => {
    const sku = 'IMPORT-RACE';
    await env.DB.prepare('INSERT INTO catalog VALUES(?,?,?)')
      .bind(
        sku,
        JSON.stringify({
          sku,
          name: 'Concurrent product',
          description: '<p>Example</p>',
          main_image: 'https://mowarid.ma/test.jpg',
          fulfillment_price: 80,
          suggested_retail_price: 200,
          supplier_key: 'demo-a',
          is_active: true,
          stock_quantity: 10,
        }),
        new Date().toISOString(),
      )
      .run();
    try {
      const responses = await Promise.all([
        req(
          '/admin/catalog/import',
          { requestId: crypto.randomUUID(), mode: 'draft', skus: [sku] },
          true,
        ),
        req(
          '/admin/catalog/import',
          { requestId: crypto.randomUUID(), mode: 'draft', skus: [sku] },
          true,
        ),
      ]);
      const results = (await Promise.all(responses.map((r) => r.json()))) as any[];
      expect(results.flatMap((r) => r.items).filter((p) => p.status === 'draft')).toHaveLength(1);
      expect(results.flatMap((r) => r.items).filter((p) => p.status === 'skipped')).toHaveLength(1);
      await env.DB.prepare('UPDATE products SET name=?,keywords=? WHERE sku=?')
        .bind('Merchant edit', 'custom-keyword', sku)
        .run();
      const before = await env.DB.prepare('SELECT * FROM products WHERE sku=?').bind(sku).first();
      const repeated = (await (
        await req(
          '/admin/catalog/import',
          { requestId: crypto.randomUUID(), mode: 'published', skus: [sku] },
          true,
        )
      ).json()) as any;
      expect(repeated.items[0].status).toBe('skipped');
      expect(await env.DB.prepare('SELECT * FROM products WHERE sku=?').bind(sku).first()).toEqual(
        before,
      );
    } finally {
      await env.DB.prepare('DELETE FROM products WHERE sku=?').bind(sku).run();
      await env.DB.prepare('DELETE FROM catalog WHERE sku=?').bind(sku).run();
    }
  });
  it('runs catalog imports through the private operations worker and persists a retry receipt', async () => {
    const sku = 'IMPORT-OPERATIONS',
      requestId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO catalog VALUES(?,?,?)')
      .bind(
        sku,
        JSON.stringify({
          sku,
          name: 'Private worker example',
          description: '<p>Example</p>',
          main_image: 'https://mowarid.ma/test.jpg',
          fulfillment_price: 80,
          suggested_retail_price: 200,
          supplier_key: 'demo-a',
          is_active: true,
          stock_quantity: 10,
        }),
        new Date().toISOString(),
      )
      .run();
    try {
      const worker = new StoreOperations({} as DurableObjectState, env);
      const request = () =>
        new Request('https://operations.internal/catalog-import', {
          method: 'POST',
          body: JSON.stringify({ requestId, mode: 'draft', skus: [sku], admin: 'owner' }),
        });
      const result = await worker.fetch(request());
      expect(result.status).toBe(200);
      const receipt = (await result.json()) as any;
      expect(receipt.items[0].status).toBe('draft');
      expect(await (await worker.fetch(request())).json()).toEqual(receipt);
    } finally {
      await env.DB.prepare('DELETE FROM products WHERE sku=?').bind(sku).run();
      await env.DB.prepare('DELETE FROM catalog WHERE sku=?').bind(sku).run();
    }
  });
  it('rejects CSRF and mixed suppliers', async () => {
    const forbidden = await mf.dispatchFetch(origin + '/api/admin/sync/catalog', {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(forbidden.status).toBe(403);
    expect(
      (
        await req('/checkout/quote', {
          cart: [cart[0], { productId: 'demo-candle', offerId: '', quantity: 1, revision: 1 }],
          city: 'Rabat',
        })
      ).status,
    ).toBe(400);
  });
  it('disables biometric sign-in, recovery and registration while retaining password recovery', async () => {
    for (const path of [
      '/auth/passkey/options',
      '/auth/passkey/verify',
      '/admin/passkeys/options',
      '/admin/passkeys/verify',
    ])
      expect((await req(path, {}, path.startsWith('/admin/'))).status).toBe(404);
    expect((await req('/admin/passkeys', undefined, true)).status).toBe(404);
    expect((await req('/admin/account', undefined, true)).status).toBe(200);
  });
  it('atomically saves multi-item orders and handles concurrent idempotency', async () => {
    const quote = (await (await req('/checkout/quote', { cart, city: 'Rabat' })).json()) as any;
    expect(quote.total).toBe(31700);
    expect(quote.merchantPricing).toBeUndefined();
    const body = {
      cart,
      customer,
      storeIdentity: { name: 'Forged checkout brand', url: 'https://attacker.invalid' },
      fingerprint: quote.fingerprint,
      idempotency: attempt,
      matching: { consent: false },
    };
    const results = await Promise.all([req('/orders', body), req('/orders', body)]);
    const refs = (await Promise.all(results.map((r) => r.json()))) as any[];
    expect(refs[0].ref).toBe(refs[1].ref);
    savedRef = refs[0].ref;
    expect(await (await req('/orders/attempt/' + attempt)).json()).toEqual({ ref: savedRef });
    const rows = await env.DB.prepare('SELECT * FROM orders').all<any>();
    expect(rows.results).toHaveLength(1);
    savedId = rows.results[0].id;
    expect(JSON.parse(rows.results[0].quote).storeIdentity).toEqual({
      name: (await settings(env.DB)).brand,
      url: origin,
    });
    expect(rows.results[0].status).toBe('pending_confirmation');
    expect(JSON.parse(rows.results[0].quote).merchantPricing).toMatchObject({
      subtotal: 13000,
      shipping: 3000,
      total: 16000,
      profit: 15700,
    });
    const adminOrders = (await (await req('/admin/orders', undefined, true)).json()) as any[];
    expect(adminOrders[0].pricing.merchant).toMatchObject({
      subtotal: 13000,
      shipping: 3000,
      total: 16000,
      profit: 15700,
      source: 'snapshot',
    });
    expect((await env.DB.prepare('SELECT * FROM order_items').all()).results).toHaveLength(2);
    expect((await env.DB.prepare('SELECT * FROM jobs').all()).results).toHaveLength(0);
    expect(
      (await req('/orders', { ...body, customer: { ...customer, name: 'Other Name' } })).status,
    ).toBe(409);
  });
  it('confirms concurrently into exactly one durable outbox job', async () => {
    await Promise.all([
      req('/admin/orders/' + savedId + '/confirm', {}, true),
      req('/admin/orders/' + savedId + '/confirm', {}, true),
    ]);
    const jobs = await env.DB.prepare("SELECT * FROM jobs WHERE type='submit'").all();
    expect(jobs.results).toHaveLength(1);
    expect((await order(env.DB, savedId))?.status).toBe('confirmed');
  });
  it('inspects item-level rejections inside HTTP 200', async () => {
    await saveCredential(env, 'mowarid', 'mw_live_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/orders/quote')) return quotedResponse(init);
        return new Response(
          JSON.stringify(
            url.includes('?external_order_id=')
              ? { success: true, orders: [] }
              : {
                  success: true,
                  results: [
                    {
                      external_order_id: savedId,
                      status: 'rejected',
                      error: 'mixed_suppliers_not_allowed',
                    },
                  ],
                },
          ),
          { status: 200 },
        );
      }),
    );
    await runJobs(env, 1);
    const o = await order(env.DB, savedId);
    expect(o?.sync_status).toBe('error');
    expect(o?.mowarid_id).toBeNull();
    expect(o?.last_error).toBe('mixed_suppliers_not_allowed');
  });
  it('reconciles unknown POST outcomes before retry and blocks cancellation', async () => {
    await env.DB.prepare("UPDATE jobs SET status='pending',attempts=0,run_at=0 WHERE order_id=?")
      .bind(savedId)
      .run();
    let created = false;
    let posts = 0;
    const mock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/orders/quote')) return quotedResponse(init);
      if (url.includes('?external_order_id='))
        return new Response(
          JSON.stringify({
            success: true,
            orders: created ? [{ external_order_id: savedId, order_id: 'mw-test-id' }] : [],
          }),
        );
      posts++;
      expect(JSON.parse(init!.body as string).external_order_id).toBe(savedId);
      created = true;
      throw new Error('Simulated lost POST response');
    });
    vi.stubGlobal('fetch', mock);
    await runJobs(env, 1);
    expect((await order(env.DB, savedId))?.post_attempted).toBe(1);
    expect((await req('/admin/orders/' + savedId + '/cancel', {}, true)).status).toBe(409);
    await env.DB.prepare('UPDATE jobs SET run_at=0 WHERE order_id=?').bind(savedId).run();
    // An already-created shipment must be reconciled even if the catalog changes
    // before the retry; current sale restrictions only apply to a NEW POST.
    await env.DB.prepare("UPDATE products SET active=0,minimum=20000 WHERE id='demo-bag'").run();
    try {
      await runJobs(env, 1);
    } finally {
      await env.DB.prepare("UPDATE products SET active=1,minimum=11000 WHERE id='demo-bag'").run();
    }
    expect(posts).toBe(1);
    expect(mock).toHaveBeenCalledTimes(2);
    expect((await order(env.DB, savedId))?.sync_status).toBe('sent');
    expect((await req('/admin/orders/' + savedId + '/cancel', {}, true)).status).toBe(409);
  });
  it('delivery and Purchase outbox commit once; no event before delivery', async () => {
    let o = (await order(env.DB, savedId))!;
    await expect(
      recordRemote(env, o, {
        external_order_id: 'another-merchant-order',
        status: { shipping_status: 'delivered' },
        financials: { total_cod_amount: 317 },
      }),
    ).rejects.toMatchObject({ code: 'remote_order_identity_mismatch' });
    expect((await order(env.DB, savedId))?.remote).toBe(o.remote);
    await recordRemote(env, o, {
      status: { shipping_status: 'in_transit' },
      financials: { total_cod_amount: 317 },
    });
    expect(
      (await env.DB.prepare("SELECT * FROM jobs WHERE type='purchase'").all()).results,
    ).toHaveLength(0);
    o = (await order(env.DB, savedId))!;
    await Promise.all([
      recordRemote(env, o, {
        status: { shipping_status: 'delivered' },
        financials: { total_cod_amount: 317 },
      }),
      recordRemote(env, o, {
        status: { shipping_status: 'delivered' },
        financials: { total_cod_amount: 317 },
      }),
    ]);
    expect(
      (await env.DB.prepare("SELECT * FROM jobs WHERE type='purchase'").all()).results,
    ).toHaveLength(1);
    expect((await order(env.DB, savedId))?.delivery_time_source).toBe('observed');
  });
  it('persists campaign links, deduplicates them and rejects foreign or private destinations', async () => {
    expect((await req('/admin/campaign-links')).status).toBe(401);
    const payload = {
      target: origin + '/shop/demo-bag?utm_source=old',
      source: 'facebook',
      campaign: 'saved-campaign',
    };
    const response = await req('/admin/campaign-links', payload, true);
    expect(response.status).toBe(201);
    const saved = (await response.json()) as any;
    expect(new URL(saved.url).searchParams.get('utm_source')).toBe('facebook');
    expect(new URL(saved.target).searchParams.has('utm_source')).toBe(false);
    const repeated = (await (await req('/admin/campaign-links', payload, true)).json()) as any;
    expect(repeated.id).toBe(saved.id);
    expect(
      ((await (await req('/admin/campaign-links', undefined, true)).json()) as any[]).filter(
        (r) => r.id === saved.id,
      ),
    ).toHaveLength(1);
    for (const target of [
      'https://foreign.test/',
      origin + '/admin',
      origin + '/api/orders',
      'javascript:alert(1)',
      'https://store.test.evil.test/',
    ])
      expect((await req('/admin/campaign-links', { ...payload, target }, true)).status).toBe(400);
    expect(
      (
        await mf.dispatchFetch(origin + '/api/admin/campaign-links/' + saved.id, {
          method: 'DELETE',
          headers: { Origin: origin, Cookie: cookie },
        })
      ).status,
    ).toBe(403);
    expect((await req('/admin/campaign-links/' + saved.id, undefined, true, 'DELETE')).status).toBe(
      200,
    );
    expect(
      ((await (await req('/admin/campaign-links', undefined, true)).json()) as any[]).some(
        (r) => r.id === saved.id,
      ),
    ).toBe(false);
  });
  it('creates custom-domain campaign links from the canonical admin, without changing the destination hostname', async () => {
    const target = 'https://shop.example.test/offers/demo-bag?lang=fr';
    const campaign = 'GlutaPack (Demo) - Lead - AD V1';
    const response = await req(
      '/admin/campaign-links',
      { target, source: 'facebook', campaign },
      true,
    );
    expect(response.status).toBe(201);
    const saved = (await response.json()) as any;
    const url = new URL(saved.url);
    expect(url.origin).toBe('https://shop.example.test');
    expect(url.pathname).toBe('/offers/demo-bag');
    expect(url.searchParams.get('lang')).toBe('fr');
    expect(url.searchParams.get('utm_source')).toBe('facebook');
    expect(url.searchParams.get('utm_campaign')).toBe(campaign);
    expect(saved.target).toBe(target);
    const repeated = await req(
      '/admin/campaign-links',
      { target, source: 'facebook', campaign },
      true,
    );
    expect(((await repeated.json()) as any).id).toBe(saved.id);
    // The same store can generate canonical links while administering the alias.
    const fromAlias = await mf.dispatchFetch('https://shop.example.test/api/admin/campaign-links', {
      method: 'POST',
      headers: {
        Origin: 'https://shop.example.test',
        Cookie: cookie,
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target: origin + '/shop/demo-bag', source: 'facebook', campaign }),
    });
    expect(fromAlias.status).toBe(201);
    const aliasSaved = (await fromAlias.json()) as any;
    expect(new URL(aliasSaved.url).origin).toBe(origin);
    const challenge = crypto.randomUUID();
    const proof = await mf.dispatchFetch(
      'https://shop.example.test/api/store-origin-proof?challenge=' + challenge,
    );
    expect(proof.status).toBe(200);
    expect(proof.headers.get('Cache-Control')).toBe('no-store');
    const canonicalProof = await req('/store-origin-proof?challenge=' + challenge);
    expect(await proof.text()).not.toBe(await canonicalProof.text());
    expect((await req('/store-origin-proof?challenge=invalid')).status).toBe(400);
    for (const id of [saved.id, aliasSaved.id])
      expect((await req('/admin/campaign-links/' + id, undefined, true, 'DELETE')).status).toBe(
        200,
      );
  });
  it('secret and backup encryption round trip and reject tampering', async () => {
    const payload = JSON.stringify({ ref: savedRef, catalog: 'كتالوج'.repeat(60000) });
    const blob = await encryptSecret(env, payload);
    expect(blob).not.toContain(savedRef);
    expect(await decryptSecret(env, blob)).toBe(payload);
    await expect(decryptSecret(env, blob.slice(0, -3) + 'xxx')).rejects.toThrow();
  });
  it('creates an encrypted private backup and restores orders, items and jobs into a fresh database', async () => {
    const categoryId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO categories(id,name,position,active) VALUES(?,?,0,1)')
      .bind(categoryId, 'قسم محفوظ')
      .run();
    await env.DB.prepare("UPDATE products SET category_id=? WHERE id='demo-bag'")
      .bind(categoryId)
      .run();
    await env.DB.prepare(
      "UPDATE catalog SET json=json_set(json,'$.description',?) WHERE sku=(SELECT sku FROM catalog LIMIT 1)",
    )
      .bind('large-catalog-backup-'.repeat(15000))
      .run();
    const campaignId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO campaign_links VALUES(?,?,?,?,?,?)')
      .bind(
        campaignId,
        origin + '/?utm_source=facebook',
        origin + '/',
        'facebook',
        '',
        new Date().toISOString(),
      )
      .run();
    await enqueue(env, 'backup');
    for (let i = 0; i < 18; i++) await runJobs(env, 1);
    const manifest = await state(env.DB, 'backup_last');
    expect(manifest.complete).toBe(true);
    const db = await mf.getD1Database('RESTORE');
    await db.exec(await readFile('migrations/0001_initial.sql', 'utf8'));
    await db.exec(await readFile('migrations/0002_submission_guard.sql', 'utf8'));
    await db.exec(await readFile('migrations/0003_mowarid_contract.sql', 'utf8'));
    await db.exec(await readFile('migrations/0004_quote_and_dry_run.sql', 'utf8'));
    await db.exec(await readFile('migrations/0005_delivery_total.sql', 'utf8'));
    await db.exec(await readFile('migrations/0006_owner_access.sql', 'utf8'));
    await db.exec(await readFile('migrations/0007_product_shipping.sql', 'utf8'));
    await db.exec(await readFile('migrations/0008_categories.sql', 'utf8'));
    await db.exec(await readFile('migrations/0009_product_page_mode.sql', 'utf8'));
    await db.exec(await readFile('migrations/0010_webhooks.sql', 'utf8'));
    await db.exec(await readFile('migrations/0011_storefront_visibility.sql', 'utf8'));
    await db.exec(await readFile('migrations/0012_product_search.sql', 'utf8'));
    await db.exec(await readFile('migrations/0013_product_presentation.sql', 'utf8'));
    await db.exec(await readFile('migrations/0014_campaign_links.sql', 'utf8'));
    await db.exec(await readFile('migrations/0015_funnel.sql', 'utf8'));
    await db.exec(await readFile('migrations/0016_fixed_bundles.sql', 'utf8'));
    await db.exec(await readFile('migrations/0017_translated_keywords.sql', 'utf8'));
    await db.exec(await readFile('migrations/0018_category_translations.sql', 'utf8'));
    await db.exec(await readFile('migrations/0019_meta_events.sql', 'utf8'));
    for (const key of manifest.parts) {
      const object = await env.BACKUPS.get(key);
      expect(await object!.text()).not.toContain(savedRef);
      await restorePartIntoEmptyDatabase(db, await readBackupPart(env, key));
    }
    expect(
      (await db.prepare('SELECT url FROM campaign_links WHERE id=?').bind(campaignId).first<any>())
        ?.url,
    ).toBe(origin + '/?utm_source=facebook');
    expect(
      (await db.prepare('SELECT ref FROM orders WHERE id=?').bind(savedId).first<any>())?.ref,
    ).toBe(savedRef);
    expect(
      (await db.prepare('SELECT delivered_total FROM orders WHERE id=?').bind(savedId).first<any>())
        ?.delivered_total,
    ).toBe(31700);
    expect(
      (await db.prepare('SELECT * FROM order_items WHERE order_id=?').bind(savedId).all()).results,
    ).toHaveLength(2);
    expect(
      (await db.prepare("SELECT * FROM jobs WHERE type='purchase'").all()).results,
    ).toHaveLength(1);
    expect(
      (await db.prepare('SELECT name FROM categories WHERE id=?').bind(categoryId).first<any>())
        ?.name,
    ).toBe('قسم محفوظ');
    expect(
      (await db.prepare("SELECT category_id FROM products WHERE id='demo-bag'").first<any>())
        ?.category_id,
    ).toBe(categoryId);
    await env.DB.prepare('DELETE FROM categories WHERE id=?').bind(categoryId).run();
  });
  it('records metered D1 usage without exposing secrets in public HTML', async () => {
    const r = await mf.dispatchFetch(origin + '/');
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).not.toContain('mw_live_test');
    expect(html).not.toContain('minimum_selling_price');
    const rows = await env.DB.prepare('SELECT * FROM metrics').all();
    expect(rows.results.length).toBeGreaterThan(0);
  });
  it('handles HTTP 401 and respects HTTP 429 Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    await expect(mowarid(env, '/products')).rejects.toMatchObject({
      code: 'invalid_api_key_or_scope',
      retry: false,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } })),
    );
    await expect(mowarid(env, '/products')).rejects.toMatchObject({
      code: 'rate_limit_exceeded',
      retry: true,
      after: 120,
    });
  });
  it('buffers large variant lists using their supplier_group_id without repeating remote pages', async () => {
    const variants = Array.from({ length: 20 }, (_, i) => ({
      sku: 'VAR-' + i,
      is_active: true,
      stock_quantity: 5,
      supplier_group_id: 'vendor-real',
    }));
    const mock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            products: [
              {
                product_id: 'variant-parent',
                sku: 'PARENT',
                name: 'Parent',
                supplier_group_id: 'vendor-real',
                fulfillment_price: 60,
                minimum_selling_price: 80,
                is_active: true,
                stock_quantity: 5,
                variants,
              },
            ],
            pagination: { has_more: false },
          }),
        ),
    );
    vi.stubGlobal('fetch', mock);
    expect((await syncCatalog(env)).has_more).toBe(true);
    expect((await syncCatalog(env)).has_more).toBe(true);
    expect((await syncCatalog(env)).has_more).toBe(false);
    expect(mock).toHaveBeenCalledTimes(1);
    const row = await env.DB.prepare("SELECT json FROM catalog WHERE sku='VAR-19'").first<{
      json: string;
    }>();
    expect(JSON.parse(row!.json)).toMatchObject({
      supplier_key: 'vendor-real',
      minimum_selling_price: 80,
      fulfillment_price: 60,
    });
  });
  it('syncs public cities without credentials and uses the documented city metadata', async () => {
    await env.DB.prepare("DELETE FROM credentials WHERE name='mowarid'").run();
    const mock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      return new Response(
        JSON.stringify({
          success: true,
          count: 3,
          cities: [
            { city: 'CASABLANCA', is_casablanca: true, is_serviceable: true, shipping_fee_mad: 20 },
            { city: 'BOUSKOURA', is_casablanca: true, is_serviceable: true, shipping_fee_mad: 20 },
            { city: 'MARRAKECH', is_casablanca: false, is_serviceable: true, shipping_fee_mad: 30 },
          ],
        }),
      );
    });
    vi.stubGlobal('fetch', mock);
    try {
      expect(await syncCities(env)).toBe(3);
      expect(await (await req('/cities')).json()).toEqual(['CASABLANCA', 'BOUSKOURA', 'MARRAKECH']);
      const known = (await (
        await req('/checkout/quote', { cart, city: 'BOUSKOURA' })
      ).json()) as any;
      expect(known.shipping).toBe(2000);
      expect((await req('/checkout/quote', { cart, city: 'قرية غير مدرجة' })).status).toBe(200);
    } finally {
      await saveCredential(env, 'mowarid', 'mw_live_test');
    }
  });
  it('accepts a non-divisible bundle in admin and stores its exact checkout total', async () => {
    const all = (await (await req('/admin/products', undefined, true)).json()) as any[];
    const original = all.find((p) => p.id === 'demo-bag');
    try {
      expect(
        (
          await req(
            '/admin/products/demo-bag',
            {
              ...original,
              offers: [
                { id: 'three', label: '3 for 299', quantity: 3, total: 29900, freeShipping: true },
              ],
            },
            true,
            'PUT',
          )
        ).status,
      ).toBe(200);
      const current = ((await (await req('/products')).json()) as any[]).find(
        (p) => p.id === 'demo-bag',
      );
      expect(current.fulfillment).toBeUndefined();
      const bundle = [
        { productId: current.id, revision: current.revision, offerId: 'three', quantity: 3 },
      ];
      const quote = (await (
        await req('/checkout/quote', { cart: bundle, city: 'فاس' })
      ).json()) as any;
      expect(quote.total).toBe(29900);
      expect(quote.items[0]).toMatchObject({ unitPrice: 9967, subtotal: 29900 });
      const saved = await req('/orders', {
        cart: bundle,
        customer,
        fingerprint: quote.fingerprint,
        idempotency: crypto.randomUUID(),
      });
      expect(saved.status).toBe(201);
      const row = await env.DB.prepare('SELECT quote FROM orders WHERE ref=?')
        .bind(((await saved.json()) as any).ref)
        .first<any>();
      expect(JSON.parse(row.quote).total).toBe(29900);
    } finally {
      await req('/admin/products/demo-bag', original, true, 'PUT');
    }
  });
  it('handles the new top-level duplicate envelope without another fulfillment request', async () => {
    const current = ((await (await req('/products')).json()) as any[]).find(
      (p) => p.id === 'demo-notebook',
    );
    const lines = [{ productId: current.id, revision: current.revision, offerId: '', quantity: 1 }];
    const quote = (await (
      await req('/checkout/quote', { cart: lines, city: 'Rabat' })
    ).json()) as any;
    const ref = (
      (await (
        await req('/orders', {
          cart: lines,
          customer,
          fingerprint: quote.fingerprint,
          idempotency: crypto.randomUUID(),
        })
      ).json()) as any
    ).ref;
    const o = await env.DB.prepare('SELECT * FROM orders WHERE ref=?').bind(ref).first<any>();
    await req('/admin/orders/' + o.id + '/confirm', {}, true);
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/orders/quote')) return quotedResponse(init);
        if (url.includes('?external_order_id='))
          return new Response(JSON.stringify({ success: true, orders: [] }));
        posts++;
        expect(JSON.parse(init!.body as string)).not.toHaveProperty('quote_id');
        expect(JSON.parse(init!.body as string).store).toEqual(JSON.parse(o.quote).storeIdentity);
        return new Response(
          JSON.stringify({
            success: true,
            duplicate: true,
            order: {
              order_id: 'mw-duplicate-id',
              external_order_id: o.id,
              order_number: 'MDK-TEST',
              shipping_status: 'pending',
            },
          }),
        );
      }),
    );
    await runJobs(env, 1);
    expect((await order(env.DB, o.id))?.mowarid_id).toBe('mw-duplicate-id');
    await runJobs(env, 1);
    expect(posts).toBe(1);
    expect(() =>
      submissionResult(
        { success: true, duplicate: true, order: { external_order_id: 'different' } },
        o.id,
      ),
    ).toThrow();
  });
  it('immediately reconciles an unexpected creation response without another POST or changing the receipt', async () => {
    const o = await confirmedOrder();
    let posts = 0,
      lookups = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/orders/quote')) return quotedResponse(init);
        if (url.includes('?external_order_id=')) {
          lookups++;
          return Response.json({
            success: true,
            orders: posts
              ? [
                  {
                    external_order_id: o.id,
                    order_id: 'mw-reconciled-creation',
                    status: { shipping_status: 'pending', financial_status: 'pending' },
                  },
                ]
              : [],
          });
        }
        posts++;
        return Response.json({ success: true, order: { order_id: 'mw-reconciled-creation' } });
      }),
    );
    await runJobs(env, 1, o.id);
    const after = (await order(env.DB, o.id))!;
    expect(after.sync_status).toBe('sent');
    expect(after.mowarid_id).toBe('mw-reconciled-creation');
    expect(after.quote).toBe(o.quote);
    expect(after.ref).toBe(o.ref);
    expect(posts).toBe(1);
    expect(lookups).toBe(1);
    await runJobs(env, 1, o.id);
    expect(posts).toBe(1);
  });
  it('sends a first attempt without order lookups and records an exact accepted response even if GET orders is down', async () => {
    const o = await confirmedOrder();
    let posts = 0,
      lookups = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('?external_order_id=')) {
          lookups++;
          return Response.json({ success: false }, { status: 500 });
        }
        if (url.endsWith('/orders/quote')) return quotedResponse(init);
        posts++;
        expect(JSON.parse(init!.body as string).external_order_id).toBe(o.id);
        return Response.json({
          success: true,
          duplicate: false,
          order: {
            order_id: 'mw-first-accepted',
            external_order_id: o.id,
            order_number: 'MDK-2026-00400',
            shipping_status: 'pending',
            financial_status: 'pending',
            call_status: 'pending',
          },
        });
      }),
    );
    await runJobs(env, 1, o.id);
    const saved = (await order(env.DB, o.id))!;
    expect(saved.sync_status).toBe('sent');
    expect(saved.mowarid_id).toBe('mw-first-accepted');
    expect(JSON.parse(saved.remote!).order_number).toBe('MDK-2026-00400');
    expect(saved.quote).toBe(o.quote);
    expect(saved.ref).toBe(o.ref);
    expect(saved.delivered_at).toBeNull();
    expect(posts).toBe(1);
    expect(lookups).toBe(0);
    expect(() =>
      submissionResult(
        {
          success: true,
          duplicate: false,
          order: { external_order_id: 'wrong', order_id: 'mw-wrong' },
        },
        o.id,
      ),
    ).toThrow();
    expect(() =>
      submissionResult(
        { success: true, duplicate: false, order: { external_order_id: o.id } },
        o.id,
      ),
    ).toThrow();
    await runJobs(env, 1, o.id);
    expect(posts).toBe(1);
  });
  it('blocks a second POST when an earlier POST outcome is unknown and lookup is unavailable', async () => {
    const o = await confirmedOrder();
    await env.DB.prepare('UPDATE orders SET post_attempted=1 WHERE id=?').bind(o.id).run();
    const network = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      return Response.json({ success: false }, { status: 500 });
    });
    vi.stubGlobal('fetch', network);
    await runJobs(env, 1, o.id);
    expect(network).toHaveBeenCalledTimes(1);
    expect((await order(env.DB, o.id))!.post_attempted).toBe(1);
    expect((await order(env.DB, o.id))!.mowarid_id).toBeNull();
    await env.DB.prepare("UPDATE jobs SET status='done' WHERE order_id=?").bind(o.id).run();
  });
  it('submits Casablanca orders with the live city tier and the unchanged customer price', async () => {
    const o = await confirmedOrder('Casablanca');
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('?external_order_id='))
          return Response.json({ success: true, orders: [] });
        if (url.endsWith('/orders/quote')) return quotedResponse(init);
        posts++;
        const payload = JSON.parse(init!.body as string);
        expect(payload.cod_to_collect).toBe(JSON.parse(o.quote).total / 100);
        expect(payload.customer_shipping_fee).toBe(20);
        return Response.json({
          success: true,
          results: [{ status: 'created', external_order_id: o.id, order_id: 'mw-casablanca-tier' }],
        });
      }),
    );
    await runJobs(env, 1, o.id);
    const after = (await order(env.DB, o.id))!;
    expect(after.sync_status).toBe('sent');
    expect(after.quote).toBe(o.quote);
    expect(posts).toBe(1);
  });
  it('blocks new fulfillment when updated wholesale costs make a saved order unprofitable', async () => {
    const o = await confirmedOrder();
    const mock = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/orders/quote')
              ? { success: true, is_valid: false, validation: { status: 'rejected' } }
              : { success: true, orders: [] },
          ),
        ),
    );
    vi.stubGlobal('fetch', mock);
    await env.DB.prepare("UPDATE products SET fulfillment=50000 WHERE id='demo-notebook'").run();
    try {
      await runJobs(env, 1);
      expect(mock).not.toHaveBeenCalled();
      expect((await order(env.DB, o.id))?.last_error).toBe('catalog_cost_changed_review_required');
      expect((await order(env.DB, o.id))?.post_attempted).toBe(0);
    } finally {
      await env.DB.prepare("UPDATE products SET fulfillment=2500 WHERE id='demo-notebook'").run();
    }
    expect((await req('/admin/orders/' + o.id + '/cancel', {}, true)).status).toBe(200);
  });
  it('allows correction after definite validation rejection and retries the same external identifier', async () => {
    const o = await confirmedOrder();
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/orders/quote')) return quotedResponse(init);
        if (url.includes('?external_order_id='))
          return new Response(JSON.stringify({ success: true, orders: [] }));
        posts++;
        return new Response(JSON.stringify({ error: 'validation_error' }), { status: 400 });
      }),
    );
    await runJobs(env, 1);
    expect((await order(env.DB, o.id))?.post_attempted).toBe(0);
    expect(
      (
        await req(
          '/admin/orders/' + o.id + '/customer',
          { ...customer, name: 'Corrected Customer' },
          true,
          'PATCH',
        )
      ).status,
    ).toBe(200);
    await req('/admin/jobs/' + encodeURIComponent('submit:' + o.id) + '/retry', {}, true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/orders/quote')) return quotedResponse(init);
        if (url.includes('?external_order_id='))
          return new Response(JSON.stringify({ success: true, orders: [] }));
        posts++;
        const body = JSON.parse(init!.body as string);
        expect(body.external_order_id).toBe(o.id);
        expect(body.customer_name).toBe('Corrected Customer');
        return new Response(
          JSON.stringify({
            success: true,
            results: [{ external_order_id: o.id, status: 'created', order_id: 'mw-corrected-id' }],
          }),
        );
      }),
    );
    await runJobs(env, 1);
    expect(posts).toBe(2);
    expect((await order(env.DB, o.id))?.mowarid_id).toBe('mw-corrected-id');
    expect((await req('/admin/orders/' + o.id + '/customer', customer, true, 'PATCH')).status).toBe(
      400,
    );
  });
  it('retries a confirmed order immediately with its original price and reference, targeting only its submission', async () => {
    const o = await confirmedOrder();
    const unrelated = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO jobs(id,type,run_at,created_at) VALUES(?,'unrelated',0,?)")
      .bind(unrelated, new Date().toISOString())
      .run();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('Transport unavailable');
        }),
      );
      await runJobs(env, 1, o.id);
      expect((await order(env.DB, o.id))?.sync_status).toBe('queued');
      expect(
        (await env.DB.prepare('SELECT status FROM jobs WHERE id=?').bind(unrelated).first<any>())
          ?.status,
      ).toBe('pending');
      await req('/admin/orders/' + o.id + '/confirm', {}, true);
      let posts = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          expect(init?.redirect).toBe('manual');
          if (url.includes('?external_order_id='))
            return Response.json({ success: true, orders: [] });
          if (url.endsWith('/orders/quote')) return quotedResponse(init);
          const body = JSON.parse(init!.body as string);
          expect(body.external_order_id).toBe(o.id);
          expect(body.cod_to_collect).toBe(JSON.parse(o.quote).total / 100);
          posts++;
          return Response.json({
            success: true,
            results: [
              { status: 'created', external_order_id: o.id, order_id: 'mw-targeted-retry' },
            ],
          });
        }),
      );
      await runJobs(env, 1, o.id);
      const sent = (await order(env.DB, o.id))!;
      expect(sent.mowarid_id).toBe('mw-targeted-retry');
      expect(sent.quote).toBe(o.quote);
      expect(sent.ref).toBe(o.ref);
      expect((await req('/admin/orders/' + o.id + '/confirm', {}, true)).status).toBe(200);
      await runJobs(env, 1, o.id);
      expect(posts).toBe(1);
    } finally {
      await env.DB.prepare('DELETE FROM jobs WHERE id=?').bind(unrelated).run();
    }
  });
  it('disables existing variants when an archived parent no longer includes them', async () => {
    await env.DB.prepare(
      "INSERT INTO products(id,slug,sku,parent_id,name,price,minimum,fulfillment,stock,active,supplier,verified) VALUES('archived-variant','archived-variant','VAR-19','variant-parent','Variant',8000,8000,6000,5,1,'vendor-real',1)",
    ).run();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              products: [
                {
                  product_id: 'variant-parent',
                  sku: 'PARENT',
                  supplier_group_id: 'vendor-real',
                  fulfillment_price: 60,
                  minimum_selling_price: 80,
                  is_active: false,
                  stock_quantity: 0,
                },
              ],
              pagination: { has_more: false },
            }),
          ),
      ),
    );
    await syncCatalog(env, '', '2026-10-01T00:00:00Z');
    expect(
      (await env.DB.prepare("SELECT active FROM products WHERE id='archived-variant'").first<any>())
        ?.active,
    ).toBe(0);
    const row = await env.DB.prepare("SELECT json FROM catalog WHERE sku='VAR-19'").first<any>();
    expect(JSON.parse(row.json).is_active).toBe(false);
  });
  it('stores a fresh quote and completes dry-run without changing order state or reserving local stock', async () => {
    const o = await confirmedOrder();
    const before = await order(env.DB, o.id);
    const jobs = await env.DB.prepare('SELECT COUNT(*) count FROM jobs WHERE order_id=?')
      .bind(o.id)
      .first<any>();
    const stock = await env.DB.prepare(
      "SELECT stock FROM products WHERE id='demo-notebook'",
    ).first<any>();
    const bodies: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string);
        if (url.endsWith('/orders/quote')) return quotedResponse(init);
        bodies.push(body);
        return new Response(JSON.stringify({ success: true, dry_run: true }));
      }),
    );
    const result = await dryRunMowarid(env, before!);
    expect(result.dry_run).toBe(true);
    expect(JSON.parse(o.quote).storeIdentity).toBeDefined();
    expect(bodies[0].notes).toBe(JSON.parse(o.customer).notes);
    expect(bodies[0].store).toEqual(JSON.parse(o.quote).storeIdentity);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      external_order_id: o.id,
      dry_run: true,
      quote_id: 'quot_test',
      cod_to_collect: 99,
      customer_shipping_fee: 30,
    });
    const after = (await order(env.DB, o.id))!;
    expect(after.status).toBe(before!.status);
    expect(after.sync_status).toBe(before!.sync_status);
    expect(after.post_attempted).toBe(0);
    expect(after.mowarid_id).toBeNull();
    expect(JSON.parse(after.remote_quote!).approved).toBe(true);
    expect(JSON.parse(after.dry_run_result!).success).toBe(true);
    expect(
      (
        await env.DB.prepare('SELECT COUNT(*) count FROM jobs WHERE order_id=?')
          .bind(o.id)
          .first<any>()
      ).count,
    ).toBe(jobs.count);
    expect(
      (await env.DB.prepare("SELECT stock FROM products WHERE id='demo-notebook'").first<any>())
        .stock,
    ).toBe(stock.stock);
    await req('/admin/orders/' + o.id + '/cancel', {}, true);
  });
  it('does not accept an ordinary created response as a successful dry-run', async () => {
    const o = await confirmedOrder();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) =>
        url.endsWith('/orders/quote')
          ? quotedResponse(init)
          : new Response(
              JSON.stringify({
                success: true,
                results: [{ status: 'created', order_id: 'unexpected' }],
              }),
            ),
      ),
    );
    await expect(dryRunMowarid(env, (await order(env.DB, o.id))!)).rejects.toMatchObject({
      code: 'invalid_dry_run_contract',
    });
    const after = (await order(env.DB, o.id))!;
    expect(after.mowarid_id).toBeNull();
    expect(after.dry_run_result).toBeNull();
    expect(after.post_attempted).toBe(1);
    expect((await req('/admin/orders/' + o.id + '/cancel', {}, true)).status).toBe(409);
    await env.DB.prepare('UPDATE orders SET post_attempted=0 WHERE id=?').bind(o.id).run();
    await req('/admin/orders/' + o.id + '/cancel', {}, true);
  });
  it('keeps an earlier unknown fulfillment outcome locked when a retry receives a definite rejection', async () => {
    const o = await confirmedOrder();
    await env.DB.prepare('UPDATE orders SET post_attempted=1 WHERE id=?').bind(o.id).run();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('?external_order_id='))
          return new Response(JSON.stringify({ success: true, orders: [] }));
        if (url.endsWith('/orders/quote')) return quotedResponse(init);
        return new Response('{}', { status: 401 });
      }),
    );
    await runJobs(env, 1);
    expect((await order(env.DB, o.id))?.post_attempted).toBe(1);
    expect((await req('/admin/orders/' + o.id + '/cancel', {}, true)).status).toBe(409);
    await env.DB.prepare('UPDATE orders SET post_attempted=0 WHERE id=?').bind(o.id).run();
    await req('/admin/orders/' + o.id + '/cancel', {}, true);
  });
  it('persists invalid quote details for review without treating them as approval', async () => {
    const o = await confirmedOrder();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              is_valid: false,
              validation: { status: 'rejected', reason: 'Below break-even' },
              financials: { platform_due_break_even: 120 },
            }),
          ),
      ),
    );
    await expect(quoteMowarid(env, (await order(env.DB, o.id))!)).rejects.toMatchObject({
      code: 'remote_quote_rejected',
    });
    const after = (await order(env.DB, o.id))!;
    expect(JSON.parse(after.remote_quote!).approved).toBe(false);
    expect(after.post_attempted).toBe(0);
    await req('/admin/orders/' + o.id + '/cancel', {}, true);
  });
  it('uses the actual delivered_at for Purchase and preserves it across repeated polls', async () => {
    const created = (await order(env.DB, savedId))!;
    await env.DB.prepare('DELETE FROM jobs WHERE id=?')
      .bind('purchase:' + savedId)
      .run();
    await env.DB.prepare('UPDATE orders SET delivered_at=NULL,delivery_time_source=NULL WHERE id=?')
      .bind(savedId)
      .run();
    const at = new Date(Date.now() - 60000).toISOString();
    const remote = {
      status: { shipping_status: 'delivered' },
      financials: { total_cod_amount: 317 },
      timestamps: { delivered_at: at },
    };
    await recordRemote(env, created, remote);
    await recordRemote(env, (await order(env.DB, savedId))!, {
      ...remote,
      timestamps: { delivered_at: new Date().toISOString() },
    });
    expect((await order(env.DB, savedId))?.delivered_at).toBe(at);
    expect((await order(env.DB, savedId))?.delivery_time_source).toBe('api');
    expect(
      (
        await env.DB.prepare("SELECT * FROM jobs WHERE type='purchase' AND order_id=?")
          .bind(savedId)
          .all()
      ).results,
    ).toHaveLength(1);
  });
  it('resumes incremental tracking pages and advances the checkpoint only after processing them', async () => {
    await env.DB.prepare('UPDATE orders SET remote=NULL WHERE id=?').bind(savedId).run();
    await env.DB.prepare('DELETE FROM sync_state WHERE name=?').bind('tracking_progress').run();
    await env.DB.prepare("INSERT OR REPLACE INTO sync_state VALUES('tracking_checkpoint',?)")
      .bind(JSON.stringify({ since: '2026-10-01T00:00:00Z' }))
      .run();
    const updated = new Date(Date.now() - 10000).toISOString();
    const rows = [
      {
        order_id: 'mw-test-id',
        external_order_id: savedId,
        status: { shipping_status: 'returned' },
        financials: { total_cod_amount: 317, partner_profit: 0 },
        timestamps: { updated_at: updated },
      },
      ...Array.from({ length: 3 }, (_, i) => ({ external_order_id: 'ANOTHER-STORE-' + i })),
    ];
    const mock = vi.fn(async (url: string) => {
      if (!url.includes('cursor=')) expect(url).toContain('updated_since=2026-10-01T00%3A00%3A00Z');
      else {
        expect(url).toContain('cursor=opaque%2B%2F%3D');
        expect(url).not.toContain('updated_since=');
      }
      expect(url).not.toContain('&page=');
      return new Response(
        JSON.stringify({
          success: true,
          orders: url.includes('cursor=') ? [] : rows,
          pagination: url.includes('cursor=')
            ? { has_more: false, next_cursor: null }
            : { has_more: true, next_cursor: 'opaque+/=' },
        }),
      );
    });
    vi.stubGlobal('fetch', mock);
    await syncUpdatedOrders(env, 1);
    expect((await order(env.DB, savedId))?.shipping_status).toBe('returned');
    expect((await state(env.DB, 'tracking_checkpoint')).since).toBe('2026-10-01T00:00:00Z');
    expect((await state(env.DB, 'tracking_progress')).pending).toHaveLength(3);
    await syncUpdatedOrders(env, 1);
    await syncUpdatedOrders(env, 1);
    await syncUpdatedOrders(env, 1);
    expect(mock).toHaveBeenCalledTimes(1);
    await syncUpdatedOrders(env, 1);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(await state(env.DB, 'tracking_progress')).toBeNull();
    expect((await state(env.DB, 'tracking_checkpoint')).since).not.toBe('2026-10-01T00:00:00Z');
    const report = (await (await req('/admin/analytics', undefined, true)).json()) as any;
    expect(report.metrics.returned).toBe(1);
    expect(report.metrics.revenue).toBe(0);
    const current = (await order(env.DB, savedId))!;
    await recordRemote(env, current, {
      order_id: 'mw-test-id',
      status: { shipping_status: 'in_transit' },
      financials: { total_cod_amount: 317 },
      timestamps: { updated_at: new Date(Date.parse(updated) - 1000).toISOString() },
    });
    expect((await order(env.DB, savedId))?.shipping_status).toBe('returned');
  });
  it('preserves the newest tracking version when two updates commit concurrently', async () => {
    await env.DB.prepare('UPDATE orders SET remote=NULL WHERE id=?').bind(savedId).run();
    const o = (await order(env.DB, savedId))!;
    const older = {
      status: { shipping_status: 'in_transit' },
      financials: { total_cod_amount: 317 },
      timestamps: { updated_at: new Date(Date.now() - 10000).toISOString() },
    };
    const newer = {
      ...older,
      status: { shipping_status: 'returned' },
      timestamps: { updated_at: new Date(Date.now() - 5000).toISOString() },
    };
    await Promise.all([recordRemote(env, o, older), recordRemote(env, o, newer)]);
    const latest = (await order(env.DB, savedId))!;
    expect(latest.shipping_status).toBe('returned');
    expect(JSON.parse(latest.remote!).timestamps.updated_at).toBe(newer.timestamps.updated_at);
  });
  it('shares the minute budget across public cities, private reads, quotes and dry-run', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const mock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/cities'))
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      return new Response(JSON.stringify({ success: true }));
    });
    vi.stubGlobal('fetch', mock);
    try {
      await mowarid(env, '/products');
      await mowarid(env, '/cities');
      const rows = await env.DB.prepare('SELECT * FROM limits').all<any>();
      expect(rows.results).toHaveLength(1);
      await env.DB.prepare('UPDATE limits SET count=39').run();
      await mowarid(env, '/orders/quote', {});
      await expect(mowarid(env, '/orders', { dry_run: true })).rejects.toMatchObject({
        code: 'rate_limit_exceeded',
        noOrderCreated: true,
      });
      expect(mock).toHaveBeenCalledTimes(3);
    } finally {
      clock.mockRestore();
    }
  });
  it('recognizes a soft-deleted order before retrying and never recreates its fulfillment', async () => {
    const o = await confirmedOrder();
    await env.DB.prepare('UPDATE orders SET post_attempted=1 WHERE id=?').bind(o.id).run();
    const mock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      return new Response(
        JSON.stringify({
          success: true,
          orders: [
            {
              order_id: 'mw-deleted',
              external_order_id: o.id,
              status: { shipping_status: 'deleted' },
              financials: { total_cod_amount: 99 },
              timestamps: { updated_at: new Date().toISOString() },
            },
          ],
        }),
      );
    });
    vi.stubGlobal('fetch', mock);
    await runJobs(env, 3);
    expect((await order(env.DB, o.id))?.shipping_status).toBe('deleted');
    expect((await order(env.DB, o.id))?.mowarid_id).toBe('mw-deleted');
    expect((await order(env.DB, o.id))?.delivered_total).toBeNull();
    expect(
      (
        await env.DB.prepare("SELECT * FROM jobs WHERE type='purchase' AND order_id=?")
          .bind(o.id)
          .all()
      ).results,
    ).toHaveLength(0);
    await env.DB.prepare(
      "UPDATE jobs SET status='pending',run_at=0 WHERE type='submit' AND order_id=?",
    )
      .bind(o.id)
      .run();
    await runJobs(env, 1);
    expect(mock).toHaveBeenCalledTimes(2);
    expect((await order(env.DB, o.id))?.shipping_status).toBe('deleted');
  });
  it('tracks a held order through a COD correction and delivery without changing the original receipt', async () => {
    const original = ((await (await req('/admin/products', undefined, true)).json()) as any[]).find(
      (p) => p.id === 'demo-notebook',
    );
    const originalSettings = await settings(env.DB);
    try {
      expect(
        (await req('/admin/products/' + original.id, { ...original, price: 3500 }, true, 'PUT'))
          .status,
      ).toBe(200);
      const created = await confirmedOrder('Casablanca');
      await env.DB.prepare("UPDATE orders SET mowarid_id='mw-held',sync_status='sent' WHERE id=?")
        .bind(created.id)
        .run();
      await env.DB.prepare("UPDATE jobs SET status='done' WHERE type='submit' AND order_id=?")
        .bind(created.id)
        .run();
      const held = {
        order_id: 'mw-held',
        status: { shipping_status: 'pending', hold_reason: 'negative_margin_on_shipping_update' },
        shipping: { delivery_warning: 'Review the changed destination' },
        financials: { total_cod_amount: 55, platform_shipping_cost: 45, partner_profit: -15 },
        customer: { city: 'Rabat', address: 'Corrected address' },
        timestamps: { updated_at: new Date(Date.now() - 10000).toISOString() },
      };
      await recordRemote(env, (await order(env.DB, created.id))!, held);
      const stopped = (await order(env.DB, created.id))!;
      expect(parsedOrder(stopped).hold_reason).toBe('negative_margin_on_shipping_update');
      expect(stopped.delivered_at).toBeNull();
      expect(stopped.delivered_total).toBeNull();
      await expect(metaPurchase(env, stopped)).rejects.toMatchObject({
        code: 'purchase_requires_delivery',
      });
      const resumed = {
        ...held,
        status: { shipping_status: 'in_transit', hold_reason: null },
        financials: { total_cod_amount: 65, platform_shipping_cost: 30, partner_profit: 10 },
        timestamps: { updated_at: new Date(Date.now() - 5000).toISOString() },
      };
      await recordRemote(env, stopped, resumed);
      expect(parsedOrder((await order(env.DB, created.id))!).hold_reason).toBeNull();
      expect((await order(env.DB, created.id))?.last_error).toBe('remote_cod_changed');
      const delivered = {
        ...resumed,
        status: { shipping_status: 'delivered', hold_reason: null },
        timestamps: {
          updated_at: new Date().toISOString(),
          delivered_at: new Date(Date.now() - 1000).toISOString(),
        },
      };
      await recordRemote(env, (await order(env.DB, created.id))!, delivered);
      await recordRemote(env, (await order(env.DB, created.id))!, delivered);
      const final = (await order(env.DB, created.id))!;
      expect(JSON.parse(final.quote).total).toBe(5500);
      expect(final.delivered_total).toBe(6500);
      await expect(
        recordRemote(env, final, { status: { shipping_status: 'delivered' } }),
      ).rejects.toMatchObject({ code: 'missing_delivery_cod_amount' });
      await expect(
        recordRemote(env, final, {
          status: { shipping_status: 'delivered' },
          financials: { total_cod_amount: 65.001 },
        }),
      ).rejects.toMatchObject({ code: 'invalid_remote_cod_amount' });
      expect(
        (
          await env.DB.prepare("SELECT * FROM jobs WHERE type='purchase' AND order_id=?")
            .bind(created.id)
            .all()
        ).results,
      ).toHaveLength(1);
      expect(
        (
          await env.DB.prepare("SELECT * FROM audit WHERE action='remote_cod_changed' AND target=?")
            .bind(created.id)
            .all()
        ).results,
      ).toHaveLength(1);
      const report = (await (await req('/admin/analytics', undefined, true)).json()) as any;
      expect(report.metrics.revenue).toBe(6500);
      await env.DB.prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(
          JSON.stringify({
            ...originalSettings,
            trackingEnabled: true,
            facebookPixel: '12345',
            metaVersion: 'v21.0',
          }),
        )
        .run();
      await saveCredential(env, 'meta', 'simulated-meta-token');
      const meta = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(_url).toBe('https://graph.facebook.com/v26.0/12345/events');
        expect(init?.redirect).toBe('manual');
        const event = JSON.parse(init!.body as string).data[0];
        expect(event.event_name).toBe('Purchase');
        expect(event.custom_data.value).toBe(65);
        expect(event.user_data.ph).toEqual([await digest('212612345679')]);
        expect(event.custom_data.currency).toBe('MAD');
        expect(event.event_id).toBe('purchase:' + created.id);
        return new Response(JSON.stringify({ events_received: 1 }));
      });
      vi.stubGlobal('fetch', meta);
      await metaPurchase(env, {
        ...final,
        remote: JSON.stringify({ ...JSON.parse(final.remote!), customer: { phone: '0612345679' } }),
        matching: JSON.stringify({ consent: true }),
      });
      expect(meta).toHaveBeenCalledTimes(1);
    } finally {
      await env.DB.prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(JSON.stringify(originalSettings))
        .run();
      await req('/admin/products/' + original.id, original, true, 'PUT');
    }
  });
  it('automatically verifies supplier identity on catalog synchronization without a manual approval step', async () => {
    const previous = await settings(env.DB);
    await env.DB.prepare(
      "UPDATE settings SET json=json_set(json,'$.contractVerified',json('false')) WHERE id=1",
    ).run();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              products: [
                {
                  product_id: 'simple-sync-parent',
                  sku: 'SIMPLE-SYNC',
                  name: 'Catalog fixture',
                  supplier_group_id: 'trusted-supplier',
                  fulfillment_price: 20,
                  stock_quantity: 10,
                  is_active: true,
                },
              ],
              pagination: { has_more: false },
            }),
          ),
      ),
    );
    try {
      await syncCatalog(env, 'simple-sync', '');
      expect((await settings(env.DB)).contractVerified).toBe(true);
      expect((await state(env.DB, 'supplier_contract'))?.source).toBe('api');
      expect(
        await env.DB.prepare("SELECT json FROM catalog WHERE sku='SIMPLE-SYNC'").first(),
      ).not.toBeNull();
    } finally {
      await env.DB.prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(JSON.stringify(previous))
        .run();
      await env.DB.prepare("DELETE FROM catalog WHERE sku='SIMPLE-SYNC'").run();
    }
  });
  it('preserves new supplier status labels, filters shipping and financial states, and never treats payout as delivery', async () => {
    const created = await confirmedOrder();
    await recordRemote(env, created, {
      order_id: 'status-fixture',
      status: {
        shipping_status: 'accepted',
        shipping_status_label: 'مقبول',
        financial_status: 'paid',
        financial_status_label: 'تم دفع الأرباح',
      },
    });
    const states = (await (await req('/admin/orders/statuses', undefined, true)).json()) as any;
    expect(states.shipping).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'accepted', label: 'مقبول' })]),
    );
    expect(states.financial).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'paid', label: 'مدفوعة' })]),
    );
    for (const filter of ['vendor-accepted', 'profit-paid', 'financial:paid']) {
      const rows = (await (
        await req('/admin/orders?status=' + encodeURIComponent(filter), undefined, true)
      ).json()) as any[];
      expect(rows.some((row) => row.id === created.id)).toBe(true);
    }
    expect(
      await env.DB.prepare("SELECT id FROM jobs WHERE type='purchase' AND order_id=?")
        .bind(created.id)
        .first(),
    ).toBeNull();
    const current = (await order(env.DB, created.id))!;
    await recordRemote(env, current, {
      status: { shipping_status: 'preparing', shipping_status_label: 'قيد التجهيز' },
    });
    expect((await order(env.DB, created.id))?.shipping_status).toBe('preparing');
    expect(
      ((await (await req('/admin/analytics', undefined, true)).json()) as any).campaigns.some(
        (g: any) => 'roas' in g || 'spend' in g,
      ),
    ).toBe(false);
  });
  it('retries delivered purchase events without browser consent flags, reusing event IDs and excluding undelivered orders', async () => {
    const previous = await settings(env.DB);
    const secret = await env.DB.prepare(
      "SELECT encrypted FROM credentials WHERE name='meta'",
    ).first<{ encrypted: string }>();
    const created = await confirmedOrder();
    try {
      await recordRemote(env, created, {
        status: { shipping_status: 'delivered' },
        financials: { total_cod_amount: JSON.parse(created.quote).total / 100 },
      });
      await env.DB.prepare('UPDATE orders SET matching=? WHERE id=?')
        .bind(JSON.stringify({ consent: true }), created.id)
        .run();
      await env.DB.prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(
          JSON.stringify({
            ...previous,
            trackingEnabled: true,
            facebookPixel: '12345',
            metaVersion: 'v21.0',
          }),
        )
        .run();
      await saveCredential(env, 'meta', 'isolated-meta-fixture');
      const fail = () =>
        env.DB.prepare(
          "UPDATE jobs SET status='failed',attempts=2,last_error='meta_not_configured' WHERE type='purchase' AND order_id=?",
        )
          .bind(created.id)
          .run();
      await fail();
      expect((await req('/admin/pixels/retry', {}, true)).status).toBe(200);
      const event = await env.DB.prepare(
        "SELECT id,status,attempts FROM jobs WHERE type='purchase' AND order_id=?",
      )
        .bind(created.id)
        .first<any>();
      expect(event).toEqual({ id: 'purchase:' + created.id, status: 'pending', attempts: 0 });
      await req('/admin/pixels/retry', {}, true);
      expect(
        (
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM jobs WHERE type='purchase' AND order_id=?",
          )
            .bind(created.id)
            .first<any>()
        )?.count,
      ).toBe(1);
      await fail();
      await env.DB.prepare('UPDATE orders SET matching=? WHERE id=?')
        .bind(JSON.stringify({ consent: false }), created.id)
        .run();
      await req('/admin/pixels/retry', {}, true);
      expect(
        (
          await env.DB.prepare("SELECT status FROM jobs WHERE type='purchase' AND order_id=?")
            .bind(created.id)
            .first<any>()
        )?.status,
      ).toBe('pending');
      await fail();
      await env.DB.prepare("UPDATE orders SET matching=?,shipping_status='in_transit' WHERE id=?")
        .bind(JSON.stringify({ consent: true }), created.id)
        .run();
      await req('/admin/pixels/retry', {}, true);
      expect(
        (
          await env.DB.prepare("SELECT status FROM jobs WHERE type='purchase' AND order_id=?")
            .bind(created.id)
            .first<any>()
        )?.status,
      ).toBe('failed');
    } finally {
      await env.DB.prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(JSON.stringify(previous))
        .run();
      if (secret)
        await env.DB.prepare("UPDATE credentials SET encrypted=? WHERE name='meta'")
          .bind(secret.encrypted)
          .run();
      else await env.DB.prepare("DELETE FROM credentials WHERE name='meta'").run();
    }
  });

  it('saves long descriptions and distinct product/landing modes while leaving economic data and cart rules intact', async () => {
    const original = ((await (await req('/admin/products', undefined, true)).json()) as any[]).find(
      (product) => product.id === 'demo-candle',
    );
    const description = 'تفاصيل واضحة عن المنتج. '.repeat(300);
    const blocks = [
      {
        id: 'mode-image',
        type: 'IMAGE',
        order: 0,
        enabled: true,
        settings: { image: '/demo/candle.svg', width: 480, height: 480 },
      },
    ];
    try {
      expect(
        (
          await req(
            '/admin/products/' + original.id,
            { ...original, description, pageMode: 'product', blocks },
            true,
            'PUT',
          )
        ).status,
      ).toBe(200);
      const regular = await (await mf.dispatchFetch(origin + '/products/' + original.slug)).text();
      expect(regular).toContain('class="store-header"');
      expect(regular).toContain(description);
      expect(regular).toContain('id="add-offer"');
      expect(regular).not.toContain('class="offer-card"');
      expect(regular).not.toContain('class="image-slice"');
      expect(
        (
          await req(
            '/admin/products/' + original.id,
            { ...original, description, pageMode: 'landing', blocks },
            true,
            'PUT',
          )
        ).status,
      ).toBe(200);
      const landing = await (await mf.dispatchFetch(origin + '/products/' + original.slug)).text();
      expect(landing).not.toContain('class="store-header"');
      expect(landing).not.toContain('id="add-offer"');
      expect(landing).not.toContain('id="cart-dialog"');
      expect(landing).not.toContain('id="saved-cart-reminder"');
      expect(landing).toContain('class="image-slice"');
      expect(landing).toContain('id="checkout-form"');
      expect(landing).toContain('<summary>السياسات</summary>');
      const saved = ((await (await req('/admin/products', undefined, true)).json()) as any[]).find(
        (product) => product.id === original.id,
      );
      expect(saved.description).toBe(description);
      expect(saved.pageMode).toBe('landing');
      expect(saved.supplier).toBe(original.supplier);
      expect(saved.fulfillment).toBe(original.fulfillment);
    } finally {
      await req('/admin/products/' + original.id, original, true, 'PUT');
    }
  });
  it('keeps delivered revenue and one Purchase across approved, shipped, delivered, cleared and paid states', async () => {
    const created = await confirmedOrder();
    const previous = await settings(env.DB);
    const deliveredAt = new Date(Date.now() - 60000).toISOString();
    const baseline = (await (await req('/admin/analytics', undefined, true)).json()) as any;
    let version = Date.now() - 10000;
    const update = async (shipping: string, financial: string) => {
      await recordRemote(env, (await order(env.DB, created.id))!, {
        status: { shipping_status: shipping, financial_status: financial },
        financials: { total_cod_amount: 100 },
        shipping: {
          carrier: 'A new carrier',
          tracking_number: 'TRACK-1',
          tracking_url: 'https://carrier.example.test/TRACK-1',
        },
        timestamps: {
          updated_at: new Date((version += 1000)).toISOString(),
          delivered_at: deliveredAt,
        },
      });
    };
    const purchases = () =>
      env.DB.prepare("SELECT id,status FROM jobs WHERE type='purchase' AND order_id=?")
        .bind(created.id)
        .all<any>();
    try {
      await update('pending', 'paid');
      expect((await order(env.DB, created.id))?.delivered_at).toBeNull();
      expect((await purchases()).results).toHaveLength(0);
      await expect(metaPurchase(env, (await order(env.DB, created.id))!)).rejects.toMatchObject({
        code: 'purchase_requires_delivery',
      });
      for (const shipping of ['approved', 'shipped']) {
        await update(shipping, 'pending');
        const rows = (await (
          await req('/admin/orders?status=shipping:' + shipping, undefined, true)
        ).json()) as any[];
        expect(rows.some((row) => row.id === created.id)).toBe(true);
        expect((await purchases()).results).toHaveLength(0);
      }
      await update('delivered', 'awaiting_settlement');
      await update('delivered', 'cleared');
      await update('paid', 'paid');
      await update('paid', 'paid');
      const final = (await order(env.DB, created.id))!;
      expect(final.delivered_at).toBe(deliveredAt);
      expect(final.delivered_total).toBe(10000);
      expect((await purchases()).results).toHaveLength(1);
      const report = (await (await req('/admin/analytics', undefined, true)).json()) as any;
      expect(report.metrics.delivered).toBe(baseline.metrics.delivered + 1);
      expect(report.metrics.revenue).toBe(baseline.metrics.revenue + 10000);
      const paidRows = (await (
        await req('/admin/orders?status=financial:paid', undefined, true)
      ).json()) as any[];
      expect(paidRows.some((row) => row.id === created.id)).toBe(true);
      await env.DB.prepare('UPDATE orders SET matching=? WHERE id=?')
        .bind(JSON.stringify({ consent: true }), created.id)
        .run();
      await env.DB.prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(
          JSON.stringify({
            ...previous,
            trackingEnabled: true,
            facebookPixel: '12345',
            metaVersion: 'v21.0',
          }),
        )
        .run();
      await saveCredential(env, 'meta', 'isolated-meta-status-test');
      const network = vi.fn(async (_url: string, init?: RequestInit) => {
        const event = JSON.parse(init!.body as string).data[0];
        expect(event.event_id).toBe('purchase:' + created.id);
        expect(event.event_time).toBe(Math.floor(Date.parse(deliveredAt) / 1000));
        expect(event.custom_data).toMatchObject({ value: 100, currency: 'MAD' });
        return new Response(JSON.stringify({ events_received: 1 }));
      });
      vi.stubGlobal('fetch', network);
      await metaPurchase(env, (await order(env.DB, created.id))!);
      expect(network).toHaveBeenCalledTimes(1);
      await env.DB.prepare("UPDATE jobs SET status='failed' WHERE type='purchase' AND order_id=?")
        .bind(created.id)
        .run();
      expect((await req('/admin/pixels/retry', {}, true)).status).toBe(200);
      expect((await purchases()).results).toEqual([
        { id: 'purchase:' + created.id, status: 'pending' },
      ]);
    } finally {
      await env.DB.prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(JSON.stringify(previous))
        .run();
      await env.DB.prepare("DELETE FROM credentials WHERE name='meta'").run();
      await env.DB.prepare('DELETE FROM jobs WHERE order_id=?').bind(created.id).run();
      await env.DB.prepare('DELETE FROM order_items WHERE order_id=?').bind(created.id).run();
      await env.DB.prepare('DELETE FROM orders WHERE id=?').bind(created.id).run();
    }
  });
  it('reconciles first-observed shipping paid as delivered without creating a second event on repeated sync', async () => {
    const created = await confirmedOrder();
    try {
      const remote = {
        status: { shipping_status: 'paid', financial_status: 'paid' },
        financials: { total_cod_amount: 100 },
        timestamps: { updated_at: new Date().toISOString(), delivered_at: null },
      };
      await recordRemote(env, created, remote);
      await recordRemote(env, (await order(env.DB, created.id))!, remote);
      expect((await order(env.DB, created.id))?.delivery_time_source).toBe('observed');
      expect((await order(env.DB, created.id))?.delivered_total).toBe(10000);
      expect(
        (
          await env.DB.prepare("SELECT id FROM jobs WHERE type='purchase' AND order_id=?")
            .bind(created.id)
            .all()
        ).results,
      ).toHaveLength(1);
      await expect(
        recordRemote(env, (await order(env.DB, created.id))!, {
          status: { shipping_status: 'paid' },
        }),
      ).rejects.toMatchObject({ code: 'missing_delivery_cod_amount' });
    } finally {
      await env.DB.prepare('DELETE FROM jobs WHERE order_id=?').bind(created.id).run();
      await env.DB.prepare('DELETE FROM order_items WHERE order_id=?').bind(created.id).run();
      await env.DB.prepare('DELETE FROM orders WHERE id=?').bind(created.id).run();
    }
  });
  it('reports exact invalid product fields and normalizes images from the existing catalog cache', async () => {
    const product = ((await (await req('/admin/products', undefined, true)).json()) as any[]).find(
      (p) => p.id === 'demo-bag',
    );
    const response = await req(
      '/admin/products/' + product.id,
      { ...product, name: '', description: 'x'.repeat(PRODUCT_DESCRIPTION_LIMIT + 1) },
      true,
      'PUT',
    );
    expect(response.status).toBe(400);
    const result = (await response.json()) as any;
    expect(result.details.map((issue: any) => issue.field)).toEqual(['name', 'description']);
    expect(result.message).toContain('اسم المنتج');
    expect(result.details[1].message).toContain(String(PRODUCT_DESCRIPTION_LIMIT));
    const catalog = (await (
      await req('/admin/catalog?q=DEMO-A1', undefined, true)
    ).json()) as any[];
    expect(catalog[0].images[0]).toBe('https://mowarid.ma/demo/bag.svg');
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO catalog VALUES(?,?,?)').bind(
          'CAT-IMG-PARENT',
          JSON.stringify({
            product_id: 'legacy-photo-parent',
            parent_id: null,
            name: 'Parent',
            images: ['/api/media/parent.jpg'],
          }),
          new Date().toISOString(),
        ),
        env.DB.prepare('INSERT INTO catalog VALUES(?,?,?)').bind(
          'CAT-IMG-VARIANT',
          JSON.stringify({
            sku: 'CAT-IMG-VARIANT',
            parent_id: 'legacy-photo-parent',
            name: 'Variant',
            images: [],
          }),
          new Date().toISOString(),
        ),
      ]);
      const result = (await (
        await req('/admin/catalog?q=CAT-IMG-VARIANT', undefined, true)
      ).json()) as any[];
      expect(result).toHaveLength(1);
      expect(result[0].images).toEqual(['https://mowarid.ma/api/media/parent.jpg']);
    } finally {
      await env.DB.prepare(
        "DELETE FROM catalog WHERE sku IN ('CAT-IMG-PARENT','CAT-IMG-VARIANT')",
      ).run();
    }
  });
  it('tracks call attempts and updated customer instructions without mutating checkout snapshots or inventing delivery', async () => {
    const o = await confirmedOrder();
    await env.DB.prepare(
      "UPDATE orders SET mowarid_id='call-fixture',sync_status='sent' WHERE id=?",
    )
      .bind(o.id)
      .run();
    const original = JSON.parse(o.customer),
      originalQuote = o.quote;
    const at = new Date(Date.now() - 2000).toISOString();
    const remote = {
      order_id: 'call-fixture',
      external_order_id: o.id,
      status: {
        order_status: 'pending',
        financial_status: 'pending',
        call_status: 'call_attempt_3',
        last_call_at: at,
        postponed_note: null,
      },
      customer: {
        name: 'Updated customer',
        phone: '+212612345679',
        city: 'Casablanca',
        address: 'Corrected address',
      },
      notes: 'Please deliver after 18:00',
      store: { name: 'Own store', url: 'https://store.example.test' },
      financials: { total_cod_amount: 99, currency: 'MAD' },
      timestamps: { updated_at: at },
    };
    try {
      await recordRemote(env, (await order(env.DB, o.id))!, remote);
      let saved = (await order(env.DB, o.id))!;
      expect(saved.shipping_status).toBe('pending');
      expect(saved.customer).toBe(o.customer);
      expect(saved.quote).toBe(originalQuote);
      expect(saved.delivered_at).toBeNull();
      const view = parsedOrder(saved);
      expect(view.customer).toMatchObject({
        phone: '0612345679',
        city: 'Casablanca',
        address: 'Corrected address',
        notes: 'Please deliver after 18:00',
      });
      expect(view.original_customer).toEqual(original);
      expect(
        (
          await env.DB.prepare("SELECT id FROM jobs WHERE order_id=? AND type='purchase'")
            .bind(o.id)
            .all()
        ).results,
      ).toHaveLength(0);
      const postponed = {
        ...remote,
        status: {
          ...remote.status,
          order_status: 'confirmed',
          call_status: 'postponed',
          postponed_note: 'Call next week',
        },
        notes: '',
        timestamps: { updated_at: new Date(Date.now() - 1000).toISOString() },
      };
      await recordRemote(env, saved, postponed);
      saved = (await order(env.DB, o.id))!;
      expect(parsedOrder(saved).customer.notes).toBe('');
      const filtered = (await (
        await req(
          '/admin/orders?shipping=confirmed&financial=pending&call=postponed',
          undefined,
          true,
        )
      ).json()) as any[];
      expect(filtered.some((row) => row.id === o.id)).toBe(true);
      expect(
        (await req('/admin/orders?call=' + encodeURIComponent("' OR 1=1 --"), undefined, true))
          .status,
      ).toBe(400);
      await recordRemote(env, saved, remote); // old call/address snapshot cannot replace newer data
      expect(parsedOrder((await order(env.DB, o.id))!).remote?.status.call_status).toBe(
        'postponed',
      );
      const delivered = {
        ...postponed,
        status: {
          ...postponed.status,
          order_status: 'delivered',
          financial_status: 'awaiting_settlement',
        },
        timestamps: { updated_at: new Date().toISOString(), delivered_at: at },
      };
      await recordRemote(env, (await order(env.DB, o.id))!, delivered);
      expect((await order(env.DB, o.id))!.shipping_status).toBe('delivered');
      await recordRemote(env, (await order(env.DB, o.id))!, {
        ...delivered,
        status: { ...delivered.status, financial_status: 'paid' },
      });
      expect(
        (
          await env.DB.prepare("SELECT id FROM jobs WHERE order_id=? AND type='purchase'")
            .bind(o.id)
            .all()
        ).results,
      ).toHaveLength(1);
    } finally {
      await env.DB.prepare('DELETE FROM jobs WHERE order_id=?').bind(o.id).run();
      await env.DB.prepare('DELETE FROM order_items WHERE order_id=?').bind(o.id).run();
      await env.DB.prepare('DELETE FROM orders WHERE id=?').bind(o.id).run();
    }
  });
  it('combines the shipping and profit filters, preserves legacy settlement records and validates new filter values', async () => {
    const ids = ['FILTER-A', 'FILTER-B', 'FILTER-C'];
    try {
      for (const [index, [shipping, financial]] of [
        ['delivered', 'awaiting_settlement'],
        ['paid', 'cleared'],
        ['shipped', 'paid'],
      ].entries()) {
        await env.DB.prepare(
          'INSERT INTO orders(id,ref,idempotency,request_hash,customer,supplier,quote,attribution,matching,status,sync_status,created_at,mowarid_id,shipping_status,financial_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
          .bind(
            ids[index],
            ids[index],
            ids[index],
            'hash',
            JSON.stringify(customer),
            'demo-a',
            JSON.stringify({ total: 10000, items: [] }),
            '{}',
            '{}',
            'confirmed',
            'sent',
            new Date().toISOString(),
            'vendor-' + ids[index],
            shipping,
            financial,
          )
          .run();
      }
      const rows = (await (
        await req('/admin/orders?shipping=delivered&financial=awaiting_settlement', undefined, true)
      ).json()) as any[];
      expect(
        rows
          .filter((o) => ids.includes(o.id))
          .map((o) => o.id)
          .sort(),
      ).toEqual(['FILTER-A', 'FILTER-B']);
      expect(rows.find((o) => o.id === 'FILTER-B').financial_status).toBe('awaiting_settlement');
      const other = (await (
        await req('/admin/orders?shipping=shipped&financial=paid', undefined, true)
      ).json()) as any[];
      expect(other.filter((o) => ids.includes(o.id)).map((o) => o.id)).toEqual(['FILTER-C']);
      const states = (await (await req('/admin/orders/statuses', undefined, true)).json()) as any;
      expect(states.financial.some((state: any) => state.code === 'cleared')).toBe(false);
      expect((await req('/admin/orders?financial=cleared', undefined, true)).status).toBe(400);
      expect(
        (await req('/admin/orders?shipping=' + encodeURIComponent("' OR 1=1 --"), undefined, true))
          .status,
      ).toBe(400);
      expect((await req('/admin/orders?shipping=delivered')).status).toBe(401);
    } finally {
      for (const id of ids) await env.DB.prepare('DELETE FROM orders WHERE id=?').bind(id).run();
    }
  });
  it('activates saved pixel IDs without a separate toggle and stops tracking when all IDs are cleared', async () => {
    const original = await settings(env.DB);
    try {
      expect(
        (
          await req(
            '/admin/settings',
            { ...original, facebookPixel: '123456789012345', trackingEnabled: false },
            true,
            'PUT',
          )
        ).status,
      ).toBe(200);
      expect((await settings(env.DB)).trackingEnabled).toBe(true);
      expect((await settings(env.DB)).metaVersion).toBe('v26.0');
      expect(
        (
          await req(
            '/admin/settings',
            {
              ...original,
              facebookPixel: '',
              tiktokPixel: '',
              googleId: '',
              snapPixel: '',
              trackingEnabled: true,
            },
            true,
            'PUT',
          )
        ).status,
      ).toBe(200);
      expect((await settings(env.DB)).trackingEnabled).toBe(false);
    } finally {
      await req('/admin/settings', original, true, 'PUT');
    }
  });
  it('keeps category operations private, validates product assignment and unlinks deletion without removing products or orders', async () => {
    const id = crypto.randomUUID(),
      category = { id, name: 'قسم محلي للاختبار', image: '', icon: '🏠', position: 0, active: 1 };
    expect((await req('/admin/categories')).status).toBe(401);
    expect((await req('/admin/categories/' + id, category, true, 'PUT')).status).toBe(200);
    const product = ((await (await req('/admin/products', undefined, true)).json()) as any[]).find(
      (p) => p.id === 'demo-bag',
    );
    try {
      expect(
        (
          await req(
            '/admin/products/' + product.id,
            { ...product, categoryId: crypto.randomUUID() },
            true,
            'PUT',
          )
        ).status,
      ).toBe(400);
      expect(
        (await req('/admin/products/' + product.id, { ...product, categoryId: id }, true, 'PUT'))
          .status,
      ).toBe(200);
      expect((await req('/admin/categories/order', { ids: [id, id] }, true, 'PATCH')).status).toBe(
        409,
      );
      expect((await req('/admin/categories/order', { ids: [id] }, true, 'PATCH')).status).toBe(200);
      const before = await env.DB.prepare('SELECT COUNT(*) count FROM orders').first<any>();
      expect((await req('/admin/categories/' + id, undefined, true, 'DELETE')).status).toBe(200);
      const after = (await (await req('/admin/products', undefined, true)).json()) as any[];
      expect(after.find((p) => p.id === product.id).categoryId).toBe(null);
      expect(await env.DB.prepare('SELECT COUNT(*) count FROM orders').first<any>()).toEqual(
        before,
      );
    } finally {
      await req('/admin/categories/' + id, undefined, true, 'DELETE');
      await req('/admin/products/' + product.id, product, true, 'PUT');
    }
  });
  it('canonicalizes Casablanca aliases, keeps the promised total and handles stale reconciliation clicks', async () => {
    const product = ((await (await req('/products')).json()) as any[]).find(
      (p) => p.id === 'demo-notebook',
    );
    const lines = [{ productId: product.id, offerId: '', quantity: 1, revision: product.revision }];
    for (const city of ['كازا', 'البيضاء', 'Casa', 'casa blanca'])
      expect(
        (await (await req('/checkout/quote', { cart: lines, city })).json()) as any,
      ).toMatchObject({ shipping: 2000 });
    const quote = (await (
      await req('/checkout/quote', { cart: lines, city: 'كازا' })
    ).json()) as any;
    const created = (await (
      await req('/orders', {
        cart: lines,
        customer: { ...customer, city: 'كازا' },
        fingerprint: quote.fingerprint,
        idempotency: crypto.randomUUID(),
      })
    ).json()) as any;
    const item = (await env.DB.prepare('SELECT * FROM orders WHERE ref=?')
      .bind(created.ref)
      .first<any>())!;
    expect(JSON.parse(item.customer).city).toBe('CASABLANCA');
    expect(JSON.parse(item.quote).total).toBe(quote.total);
    expect((await req('/admin/orders/' + item.id)).status).toBe(401);
    expect((await req('/admin/orders/' + item.id, undefined, true)).status).toBe(200);
    await env.DB.prepare(
      "UPDATE orders SET mowarid_id='known-casa-order',sync_status='sent',post_attempted=1 WHERE id=?",
    )
      .bind(item.id)
      .run();
    const snapshot = (await order(env.DB, item.id))!;
    const mock = vi.fn(async () => {
      throw new Error('An acknowledged outcome needs no new provider request');
    });
    vi.stubGlobal('fetch', mock);
    for (let i = 0; i < 2; i++) {
      const response = await req('/admin/orders/' + item.id + '/reconcile', {}, true);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ found: true, sent: true });
    }
    expect(mock).not.toHaveBeenCalled();
    expect((await order(env.DB, item.id))?.quote).toBe(snapshot.quote);
  });
  it('recovers an owner once, revokes sessions and passkeys, and replaces the recovery file', async () => {
    const owner = await env.DB.prepare('SELECT recovery,password FROM admins WHERE id=?')
      .bind('owner')
      .first<{ recovery: string; password: string }>();
    const recoverCode = 'isolated-account-recovery-proof';
    const { digest } = await import('../src/server/security');
    await env.DB.prepare('UPDATE admins SET recovery=? WHERE id=?')
      .bind(JSON.stringify([await digest(recoverCode)]), 'owner')
      .run();
    await env.DB.prepare('INSERT INTO passkeys VALUES(?,?,?,?,?,?,?,?)')
      .bind(
        'test-key',
        'owner',
        'not-a-real-public-key',
        0,
        '[]',
        'store.test',
        'revocation fixture',
        new Date().toISOString(),
      )
      .run();
    expect(
      (
        await req('/auth/recover', {
          email: 'owner@example.com',
          code: 'wrong',
          password: 'a-new-secure-test-password-2026',
        })
      ).status,
    ).toBe(401);
    const recovered = await req('/auth/recover', {
      email: 'owner@example.com',
      code: recoverCode,
      password: 'a-new-secure-test-password-2026',
    });
    expect(recovered.status).toBe(200);
    const data = (await recovered.json()) as any;
    expect(data.recovery).toHaveLength(8);
    expect(data.email).toBe('owner@example.com');
    expect((await req('/admin/settings', undefined, true)).status).toBe(401);
    expect(await env.DB.prepare('SELECT id FROM passkeys').first()).toBeNull();
    expect(
      (
        await req('/auth/recover', {
          email: 'owner@example.com',
          code: recoverCode,
          password: 'a-new-secure-test-password-2026',
        })
      ).status,
    ).toBe(401);
    cookie = recovered.headers.get('set-cookie')!.split(';')[0];
    csrf = data.csrf;
    expect((await req('/admin/settings', undefined, true)).status).toBe(200);
    const stored = await env.DB.prepare('SELECT recovery FROM admins WHERE id=?')
      .bind('owner')
      .first<{ recovery: string }>();
    expect(stored!.recovery).not.toContain(data.recovery[0]);
    expect(stored!.recovery).not.toBe(owner!.recovery);
    // A credential verified just before a concurrent reset cannot create a
    // new session after that reset has revoked access.
    const probe = new Hono<{ Bindings: Env }>();
    probe.onError((_e, c) => c.json({ denied: true }, 401));
    probe.get('/old-password', async (c) =>
      c.json({ csrf: await startSession(c, 'owner', { password: owner!.password }) }),
    );
    probe.get('/deleted-key', async (c) =>
      c.json({ csrf: await startSession(c, 'owner', { passkey: 'test-key' }) }),
    );
    expect((await probe.request('/old-password', {}, env)).status).toBe(401);
    expect((await probe.request('/deleted-key', {}, env)).status).toBe(401);
  });
  it('does not revive a session revoked or expired between reading it and renewing it', async () => {
    for (const change of ['revoke', 'expire']) {
      const token = crypto.randomUUID(),
        hash = await digest(token);
      await env.DB.prepare('INSERT INTO sessions(hash,admin_id,csrf,expires_at) VALUES(?,?,?,?)')
        .bind(hash, 'owner', 'renewal-race-csrf', Date.now() + 600000)
        .run();
      const raced = new Proxy(env.DB, {
        get(db, key) {
          if (key === 'prepare')
            return (sql: string) => {
              if (!sql.startsWith('UPDATE sessions SET expires_at')) return db.prepare(sql);
              return {
                bind: (...params: unknown[]) => ({
                  first: async () => {
                    if (change === 'revoke')
                      await db.prepare('DELETE FROM sessions WHERE hash=?').bind(hash).run();
                    else
                      await db
                        .prepare('UPDATE sessions SET expires_at=? WHERE hash=?')
                        .bind(Date.now() - 1000, hash)
                        .run();
                    return db
                      .prepare(sql)
                      .bind(...params)
                      .first();
                  },
                }),
              };
            };
          const value = Reflect.get(db, key);
          return typeof value === 'function' ? value.bind(db) : value;
        },
      });
      const probe = new Hono<{ Bindings: Env }>();
      probe.get('/probe', async (c) => c.json({ session: await readAdminSession(c) }));
      try {
        const response = await probe.request(
          '/probe',
          { headers: { Cookie: 'session=' + token } },
          { ...env, DB: raced },
        );
        expect(await response.json()).toEqual({ session: null });
        expect(response.headers.has('set-cookie')).toBe(false);
        expect(
          await env.DB.prepare('SELECT COUNT(*) count FROM sessions WHERE hash=? AND expires_at>?')
            .bind(hash, Date.now())
            .first('count'),
        ).toBe(0);
      } finally {
        await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(hash).run();
      }
    }
  });
  it('keeps a published unlisted product purchasable through both presentations and preserves its visibility in older editor updates', async () => {
    const original = ((await (await req('/admin/products', undefined, true)).json()) as any[]).find(
      (p) => p.id === 'demo-bag',
    );
    try {
      const save = await req(
        '/admin/products/' + original.id,
        { ...original, storefrontVisible: 0, pageMode: 'landing', gallery: ['/demo/notebook.svg'] },
        true,
        'PUT',
      );
      expect(save.status).toBe(200);
      const listed = (await (await req('/products')).json()) as any[];
      expect(listed.some((p) => p.id === original.id)).toBe(false);
      const home = await (await mf.dispatchFetch(origin + '/')).text();
      expect(home).not.toContain('data-product-card="' + original.id + '"');
      const sitemap = await (await mf.dispatchFetch(origin + '/sitemap.xml')).text();
      expect(sitemap).not.toContain(original.slug);
      const regular = await (await mf.dispatchFetch(origin + '/shop/' + original.slug)).text();
      expect(regular).toContain('class="store-header"');
      expect(regular).toContain('id="add-offer"');
      expect(regular).not.toContain('id="checkout-form"');
      expect(regular).toContain('data-gallery-image="/demo/notebook.svg"');
      expect(regular).toContain('content="noindex,follow"');
      const landing = await (await mf.dispatchFetch(origin + '/offers/' + original.slug)).text();
      expect(landing).not.toContain('class="store-header"');
      expect(landing).toContain('id="checkout-form"');
      const legacy = await (await mf.dispatchFetch(origin + '/products/' + original.slug)).text();
      expect(legacy).toContain('id="checkout-form"');
      const current = ((await (await req('/products?ids=' + original.id)).json()) as any[])[0];
      expect(current.storefrontVisible).toBe(0);
      expect(current).not.toHaveProperty('fulfillment');
      const quote = await req('/checkout/quote', {
        cart: [{ productId: current.id, offerId: '', quantity: 2, revision: current.revision }],
        city: 'Rabat',
        checkoutMode: 'cart',
      });
      expect(quote.status).toBe(200);
      expect(await quote.json()).toMatchObject({
        subtotal: current.offers.find((o: any) => o.quantity === 2).total,
        shipping: 0,
        total: current.offers.find((o: any) => o.quantity === 2).total,
      });
      const olderEditor = { ...original, price: original.price + 100 };
      delete olderEditor.storefrontVisible;
      delete olderEditor.gallery;
      expect((await req('/admin/products/' + original.id, olderEditor, true, 'PUT')).status).toBe(
        200,
      );
      const saved = ((await (await req('/admin/products', undefined, true)).json()) as any[]).find(
        (p) => p.id === original.id,
      );
      expect(saved.storefrontVisible).toBe(0);
      expect(saved.gallery).toEqual(['/demo/notebook.svg']);
    } finally {
      await req('/admin/products/' + original.id, original, true, 'PUT');
    }
  });
  it('searches normalized names, explicit keywords, full descriptions and renamed categories without revealing unlisted products or private fields', async () => {
    const id = crypto.randomUUID();
    const all = (await (await req('/admin/products', undefined, true)).json()) as any[];
    const bag = all.find((p) => p.id === 'demo-bag'),
      notebook = all.find((p) => p.id === 'demo-notebook');
    try {
      expect(
        (
          await req(
            '/admin/categories/' + id,
            { id, name: 'العناية والإكسسوارات', image: '', icon: '', active: 1, position: 0 },
            true,
            'PUT',
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await req(
            '/admin/products/' + bag.id,
            {
              ...bag,
              name: 'حَقِيبَة أنيقة Crème',
              keywords: 'شنطة, sac, سفر',
              description: 'تفاصيل عادية. '.repeat(100) + 'علامةنهايةالوصف',
              categoryId: id,
            },
            true,
            'PUT',
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await req(
            '/admin/products/' + notebook.id,
            { ...notebook, keywords: 'حقيبة شنطة' },
            true,
            'PUT',
          )
        ).status,
      ).toBe(200);
      const search = async (q: string) => {
        const r = await req('/products?q=' + encodeURIComponent(q));
        expect(r.status).toBe(200);
        return (await r.json()) as any[];
      };
      expect((await search('حقيبه انيقه'))[0].id).toBe(bag.id);
      expect((await search('creme'))[0].id).toBe(bag.id);
      expect((await search('DEMO-A1'))[0].id).toBe(bag.id);
      const scoped = await req('/products?q=' + encodeURIComponent('حقيبة') + '&supplier=demo-b');
      expect(scoped.status).toBe(200);
      expect(await scoped.json()).toEqual([]);
      expect((await search('شنطه')).some((p) => p.id === bag.id)).toBe(true);
      const ordered = await search('حقيبة');
      expect(ordered[0].id).toBe(bag.id);
      expect(ordered.some((p) => p.id === notebook.id)).toBe(true);
      expect((await search('علامةنهايةالوصف'))[0].id).toBe(bag.id);
      expect((await search('الاكسسوارات'))[0].id).toBe(bag.id);
      expect(
        (
          await req(
            '/admin/categories/' + id,
            { id, name: 'العناية بالمسافر', image: '', icon: '', active: 1, position: 0 },
            true,
            'PUT',
          )
        ).status,
      ).toBe(200);
      expect(await search('الاكسسوارات')).toHaveLength(0);
      expect((await search('المسافر'))[0].id).toBe(bag.id);
      const latest = ((await (await req('/admin/products', undefined, true)).json()) as any[]).find(
        (p) => p.id === bag.id,
      );
      expect(
        (await req('/admin/products/' + bag.id, { ...latest, storefrontVisible: 0 }, true, 'PUT'))
          .status,
      ).toBe(200);
      expect(await search('علامةنهايةالوصف')).toHaveLength(0);
      expect((await search('حقيبة'))[0].id).toBe(notebook.id);
      expect(await search('" OR * % _')).toHaveLength(0);
      const visible = await search('شنطه');
      expect(visible[0]).not.toHaveProperty('fulfillment');
      expect(visible[0]).not.toHaveProperty('minimum');
    } finally {
      await req('/admin/products/' + bag.id, bag, true, 'PUT');
      await req('/admin/products/' + notebook.id, notebook, true, 'PUT');
      await req('/admin/categories/' + id, undefined, true, 'DELETE');
    }
  });
  it('snapshots the cart-only free threshold through local save, city correction and later store setting changes', async () => {
    const original = await settings(env.DB);
    const book = ((await (await req('/admin/products', undefined, true)).json()) as any[]).find(
      (p) => p.id === 'demo-notebook',
    );
    const current = ((await (await req('/products')).json()) as any[]).find(
      (p) => p.id === 'demo-bag',
    );
    try {
      expect(
        (
          await req(
            '/admin/settings',
            { ...original, cartFreeShippingThreshold: 30000 },
            true,
            'PUT',
          )
        ).status,
      ).toBe(200);
      const lines = [
        { productId: current.id, offerId: '', quantity: 3, revision: current.revision },
      ];
      const quote = (await (
        await req('/checkout/quote', { cart: lines, city: 'Casablanca', checkoutMode: 'cart' })
      ).json()) as any;
      expect(quote).toMatchObject({
        subtotal: 44700,
        shipping: 0,
        cartFreeShippingThreshold: 30000,
        shippingReason: 'threshold',
      });
      const direct = (await (
        await req('/checkout/quote', { cart: lines, city: 'Rabat', checkoutMode: 'direct' })
      ).json()) as any;
      expect(direct).toMatchObject({ shipping: 3000, cartFreeShippingThreshold: 0 });
      const saved = await req('/orders', {
        cart: lines,
        customer: { ...customer, city: 'Casablanca' },
        fingerprint: quote.fingerprint,
        idempotency: crypto.randomUUID(),
        checkoutMode: 'cart',
      });
      expect(saved.status).toBe(201);
      const reference = ((await saved.json()) as any).ref;
      const row = await env.DB.prepare('SELECT id,quote FROM orders WHERE ref=?')
        .bind(reference)
        .first<any>();
      expect(
        (await req('/admin/settings', { ...original, cartFreeShippingThreshold: 0 }, true, 'PUT'))
          .status,
      ).toBe(200);
      expect(
        (
          await req(
            '/admin/orders/' + row.id + '/customer',
            { ...customer, city: 'Rabat' },
            true,
            'PATCH',
          )
        ).status,
      ).toBe(200);
      const revised = await env.DB.prepare('SELECT quote FROM orders WHERE id=?')
        .bind(row.id)
        .first<any>();
      expect(JSON.parse(revised.quote)).toMatchObject({
        shipping: 0,
        total: 44700,
        cartFreeShippingThreshold: 30000,
      });
      expect(
        (await req('/admin/products/' + book.id, { ...book, price: 3600 }, true, 'PUT')).status,
      ).toBe(200);
      expect(
        (await req('/admin/settings', { ...original, cartFreeShippingThreshold: 1 }, true, 'PUT'))
          .status,
      ).toBe(400);
      expect((await settings(env.DB)).cartFreeShippingThreshold).toBe(0);
    } finally {
      await req('/admin/settings', original, true, 'PUT');
      await req('/admin/products/' + book.id, book, true, 'PUT');
    }
  });
  it('deletes only the selected legacy offer without overwriting pixel, brand or other offers', async () => {
    const original = await settings(env.DB),
      id = crypto.randomUUID(),
      other = crypto.randomUUID();
    const changed = {
      ...original,
      brand: 'Concurrent brand',
      facebookPixel: '12345',
      checkoutOffers: [
        { id, productId: 'missing', title: 'دارنا', quantity: 1, total: 50000, enabled: true },
        {
          id: other,
          productId: 'also-missing',
          title: 'keep',
          quantity: 1,
          total: 20000,
          enabled: true,
        },
      ],
    };
    try {
      await env.DB.prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(JSON.stringify(changed))
        .run();
      expect((await req('/admin/checkout-offers/' + id, undefined, false, 'DELETE')).status).toBe(
        401,
      );
      expect((await req('/admin/checkout-offers/' + id, undefined, true, 'DELETE')).status).toBe(
        200,
      );
      const after = await settings(env.DB);
      expect(after.checkoutOffers).toEqual([changed.checkoutOffers[1]]);
      expect(after.brand).toBe(changed.brand);
      expect(after.facebookPixel).toBe(changed.facebookPixel);
      expect((await req('/admin/checkout-offers/' + id, undefined, true, 'DELETE')).status).toBe(
        200,
      );
      expect((await settings(env.DB)).checkoutOffers).toHaveLength(1);
    } finally {
      await env.DB.prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(JSON.stringify(original))
        .run();
    }
  });
  it('records cancellation without a false COD warning, pending-call filter or Purchase event', async () => {
    const o = await confirmedOrder();
    await env.DB.prepare(
      "UPDATE orders SET mowarid_id='cancel-fixture',sync_status='sent' WHERE id=?",
    )
      .bind(o.id)
      .run();
    const original = o.quote,
      q = JSON.parse(original);
    const remote = {
      order_id: 'cancel-fixture',
      external_order_id: o.id,
      status: {
        shipping_status: 'pending',
        order_status: 'pending',
        financial_status: 'pending',
        call_status: 'call_attempt_1',
      },
      financials: { total_cod_amount: q.total / 100, currency: 'MAD' },
      timestamps: { updated_at: new Date(Date.now() - 1000).toISOString() },
    };
    await recordRemote(env, (await order(env.DB, o.id))!, remote);
    expect(
      (
        (await (await req('/admin/orders?call=call_attempt_1', undefined, true)).json()) as any[]
      ).some((row) => row.id === o.id),
    ).toBe(true);
    await recordRemote(env, (await order(env.DB, o.id))!, {
      ...remote,
      status: {
        ...remote.status,
        shipping_status: 'cancelled',
        order_status: 'cancelled',
        call_status: 'pending',
        cancellation_reason: 'Customer denies placing the order',
        internal_note: 'private-supplier-note',
      },
      financials: {
        currency: 'MAD',
        total_cod_amount: 0,
        products_subtotal: 0,
        customer_shipping_fee: 0,
        wholesale_subtotal: 0,
        platform_shipping_cost: 0,
        partner_profit: 0,
      },
      timestamps: { updated_at: new Date().toISOString() },
    });
    const saved = (await order(env.DB, o.id))!;
    expect(saved.quote).toBe(original);
    expect(saved.last_error).toBeNull();
    const view = (await (await req('/admin/orders/' + o.id, undefined, true)).json()) as any;
    expect(view.remote.status.cancellation_reason).toBe('Customer denies placing the order');
    expect(view.remote.status).not.toHaveProperty('internal_note');
    expect(parsedOrder(saved)).toMatchObject({
      financial_status: 'cancelled',
      pricing: {
        closed: true,
        customer: { total: q.total, shipping: q.shipping },
        merchant: { total: 0, profit: 0 },
      },
    });
    expect(
      ((await (await req('/admin/orders?call=pending', undefined, true)).json()) as any[]).some(
        (row) => row.id === o.id,
      ),
    ).toBe(false);
    expect(
      (
        await env.DB.prepare("SELECT id FROM audit WHERE target=? AND action='remote_cod_changed'")
          .bind(o.id)
          .all()
      ).results,
    ).toHaveLength(0);
    expect(
      (
        await env.DB.prepare("SELECT id FROM jobs WHERE order_id=? AND type='purchase'")
          .bind(o.id)
          .all()
      ).results,
    ).toHaveLength(0);
  });
  it('separates sending statistics from remote lifecycle states and includes every accepted order in the sent filter', async () => {
    const fixture = await confirmedOrder();
    const cases = [
      ['pending_confirmation', null, null, null],
      ['confirmed', null, null, null],
      ['cancelled', null, null, null],
      ['confirmed', 'remote-pending', 'pending', 'pending'],
      ['confirmed', 'remote-approved', 'approved', 'pending'],
      ['confirmed', 'remote-delivered', 'delivered', 'awaiting_settlement'],
      ['confirmed', 'remote-paid', 'paid', 'paid'],
      ['confirmed', 'remote-returned', 'returned', 'cancelled'],
      ['confirmed', 'remote-cancelled', 'cancelled', 'cancelled'],
    ];
    const ids: string[] = [];
    try {
      for (const [status, remoteId, shipping, financial] of cases) {
        const id = crypto.randomUUID();
        ids.push(id);
        await env.DB.prepare(
          'INSERT INTO orders(id,ref,idempotency,request_hash,customer,supplier,quote,attribution,matching,status,sync_status,created_at,mowarid_id,shipping_status,financial_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
          .bind(
            id,
            id,
            id,
            id,
            fixture.customer,
            fixture.supplier,
            fixture.quote,
            '{}',
            '{}',
            status,
            remoteId ? 'sent' : 'pending',
            '2020-02-01T12:00:00Z',
            remoteId,
            shipping,
            financial,
          )
          .run();
      }
      const report = (await (
        await req('/admin/analytics?from=2020-02-01&to=2020-02-01', undefined, true)
      ).json()) as any;
      expect(report.metrics).toMatchObject({
        orders: 9,
        sent: 6,
        not_sent: 3,
        in_progress: 2,
        delivered: 2,
        profit_paid: 1,
        returned: 1,
        cancelled: 2,
      });
      const sent = (await (
        await req('/admin/orders?shipping=sent', undefined, true)
      ).json()) as any[];
      expect(sent.filter((row) => ids.includes(row.id))).toHaveLength(6);
      const unsent = (await (
        await req('/admin/orders?shipping=not_sent', undefined, true)
      ).json()) as any[];
      expect(unsent.filter((row) => ids.includes(row.id))).toHaveLength(3);
    } finally {
      for (const id of ids) await env.DB.prepare('DELETE FROM orders WHERE id=?').bind(id).run();
    }
  });
});

it('counts unique funnel stages per session and campaign, includes visits before any orders, and whitelists campaign fields', async () => {
  const session = crypto.randomUUID(),
    source = 'funnel-fixture',
    campaign = 'test-funnel';
  const body = {
    session,
    source,
    campaign,
    attribution: { utm_medium: 'paid', fbclid: 'click-fixture', arbitrary: 'drop' },
  };
  for (const stage of ['visit', 'visit', 'checkout', 'checkout'])
    expect((await req('/visits', { ...body, stage })).status).toBe(200);
  const rows = (
    await env.DB.prepare('SELECT stage,attribution FROM visits WHERE source=?')
      .bind(source)
      .all<any>()
  ).results;
  expect(rows).toHaveLength(2);
  expect(JSON.parse(rows[0].attribution)).toEqual({ utm_medium: 'paid', fbclid: 'click-fixture' });
  const analytics = (await (await req('/admin/analytics', undefined, true)).json()) as any;
  expect(analytics.campaigns.find((row: any) => row.source === source)).not.toHaveProperty(
    'conversion',
  );
  expect(analytics.campaigns.find((row: any) => row.source === source)).toMatchObject({
    visits: 1,
    checkouts: 1,
    orders: 0,
  });
});
it('retires complementary offers without exposing them, changing saved quotes or disabling quantity/free delivery offers', async () => {
  const rows = (await (await req('/admin/products', undefined, true)).json()) as any[];
  const base = rows.find((p) => p.id === 'demo-bag');
  const oldQuotes = (await env.DB.prepare('SELECT id,quote FROM orders ORDER BY id').all()).results;
  const rule = {
    id: crypto.randomUUID(),
    title: 'retired',
    items: [{ productId: 'demo-notebook', quantity: 1, total: 5000 }],
    total: 5000,
    enabled: true,
  };
  try {
    await env.DB.prepare('UPDATE products SET presentation=? WHERE id=?')
      .bind(JSON.stringify({ ...base.presentation, crossSells: [rule] }), base.id)
      .run();
    const pub = ((await (await req('/products')).json()) as any[]).find((p) => p.id === base.id);
    expect(pub).not.toHaveProperty('crossSells');
    expect(pub).not.toHaveProperty('checkoutOffers');
    expect(JSON.stringify(pub)).not.toMatch(/fulfillment|profit/);
    const retired = await req('/checkout/quote', {
      city: 'Rabat',
      cart: [
        {
          productId: base.id,
          offerId: 'checkout:' + base.id + ':' + rule.id,
          quantity: 1,
          revision: pub.revision,
        },
      ],
    });
    expect(retired.status).toBe(409);
    expect(((await retired.json()) as any).error).toBe('invalid_checkout_offer');
    expect(
      (
        await req(
          '/admin/products/' + base.id + '/cross-sells',
          { revision: base.revision, crossSells: [rule] },
          true,
          'PUT',
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await req(
          '/admin/products/' + base.id,
          {
            ...base,
            presentation: { ...base.presentation, freeShipping: true, crossSells: [rule] },
          },
          true,
          'PUT',
        )
      ).status,
    ).toBe(200);
    const updated = ((await (await req('/products')).json()) as any[]).find(
      (p) => p.id === base.id,
    );
    expect(updated.freeShipping).toBe(true);
    const priced = await req('/checkout/quote', {
      city: 'Rabat',
      checkoutMode: 'direct',
      cart: [{ productId: base.id, offerId: '', quantity: 1, revision: updated.revision }],
    });
    expect(priced.status).toBe(200);
    expect(((await priced.json()) as any).shipping).toBe(0);
    expect((await env.DB.prepare('SELECT id,quote FROM orders ORDER BY id').all()).results).toEqual(
      oldQuotes,
    );
  } finally {
    await req('/admin/products/' + base.id, base, true, 'PUT');
  }
});

it('reconciles removed SKUs only after a complete full catalogue scan and handles new, changed and archived products generically', async () => {
  const cached = (await env.DB.prepare('SELECT * FROM catalog').all<any>()).results;
  const originals = (
    await env.DB.prepare(
      'SELECT id,active,verified,stock,revision,minimum,fulfillment,supplier FROM products',
    ).all<any>()
  ).results;
  const snapshots = (await env.DB.prepare('SELECT id,quote FROM orders ORDER BY id').all()).results;
  const fingerprint = await digest('mw_live_test');
  const dbStates = (
    await env.DB.prepare(
      "SELECT * FROM sync_state WHERE name LIKE 'catalog_%' OR name='supplier_contract'",
    ).all<any>()
  ).results;
  const bag = originals.find((p) => p.id === 'demo-bag');
  const notebook = originals.find((p) => p.id === 'demo-notebook');
  const product = (sku: string, cost: number, active = true) => ({
    product_id: sku,
    sku,
    name: sku,
    supplier_group_id: 'demo-a',
    fulfillment_price: cost,
    minimum_selling_price: cost + 30,
    suggested_retail_price: cost + 120,
    is_active: active,
    stock_quantity: 10,
  });
  const response = (products: any[], next = '') =>
    new Response(
      JSON.stringify({
        success: true,
        products,
        pagination: { has_more: !!next, ...(next ? { next_cursor: next } : {}) },
      }),
    );
  try {
    await env.DB.prepare(
      "DELETE FROM sync_state WHERE name IN ('catalog_pending','catalog_full_scan')",
    ).run();
    for (const sku of ['DEMO-A1', 'DEMO-A2'])
      await env.DB.prepare(
        "UPDATE catalog SET json=json_set(json,'$.key_fingerprint',?) WHERE sku=?",
      )
        .bind(fingerprint, sku)
        .run();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response([product('DEMO-A2', notebook.fulfillment / 100)], 'full-second')),
    );
    expect((await syncCatalog(env)).has_more).toBe(true);
    expect(
      (await env.DB.prepare("SELECT active FROM products WHERE id='demo-bag'").first<any>())!
        .active,
    ).toBe(bag.active);
    // Failure partway through cannot infer that the omitted product was removed.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    );
    await expect(syncCatalog(env, 'full-second')).rejects.toBeDefined();
    expect(
      (await env.DB.prepare("SELECT active FROM products WHERE id='demo-bag'").first<any>())!
        .active,
    ).toBe(bag.active);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response([product('NEW-SCAN-SKU', 55)])),
    );
    expect((await syncCatalog(env, 'full-second')).has_more).toBe(false);
    expect(
      await env.DB.prepare(
        "SELECT active,verified,stock FROM products WHERE id='demo-bag'",
      ).first(),
    ).toMatchObject({ active: 0, verified: 0, stock: 0 });
    expect(
      JSON.parse(
        (await env.DB.prepare("SELECT json FROM catalog WHERE sku='NEW-SCAN-SKU'").first<any>())!
          .json,
      ),
    ).toMatchObject({ fulfillment_price: 55, suggested_retail_price: 175 });
    // Incremental omission must not retire still-present products.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response([product('NEW-SCAN-SKU', 56)])),
    );
    await syncCatalog(env, '', '2026-10-01T00:00:00Z');
    expect(
      (await env.DB.prepare("SELECT active FROM products WHERE id='demo-notebook'").first<any>())!
        .active,
    ).toBe(notebook.active);
    // A full traversal interrupted by an incremental run cannot retire unseen products.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response([product('NEW-SCAN-SKU', 56)], 'interrupted-last')),
    );
    await syncCatalog(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response([])),
    );
    await syncCatalog(env, '', '2026-10-01T01:00:00Z');
    expect(await state(env.DB, 'catalog_full_scan')).toBeNull();
    await syncCatalog(env, 'interrupted-last');
    expect(
      (await env.DB.prepare("SELECT active FROM products WHERE id='demo-notebook'").first<any>())!
        .active,
    ).toBe(notebook.active);
    // An explicit archive immediately removes availability; costs are updated for every SKU.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response([product('DEMO-A2', notebook.fulfillment / 100 + 1, false)])),
    );
    await syncCatalog(env, '', '2026-10-02T00:00:00Z');
    expect(
      await env.DB.prepare(
        "SELECT active,fulfillment FROM products WHERE id='demo-notebook'",
      ).first(),
    ).toMatchObject({ active: 0, fulfillment: notebook.fulfillment + 100 });
    expect((await env.DB.prepare('SELECT id,quote FROM orders ORDER BY id').all()).results).toEqual(
      snapshots,
    );
  } finally {
    await env.DB.prepare('DELETE FROM catalog').run();
    for (const row of cached)
      await env.DB.prepare('INSERT INTO catalog VALUES(?,?,?)')
        .bind(row.sku, row.json, row.updated_at)
        .run();
    for (const row of originals)
      await env.DB.prepare(
        'UPDATE products SET active=?,verified=?,stock=?,revision=?,minimum=?,fulfillment=?,supplier=? WHERE id=?',
      )
        .bind(
          row.active,
          row.verified,
          row.stock,
          row.revision,
          row.minimum,
          row.fulfillment,
          row.supplier,
          row.id,
        )
        .run();
    await env.DB.prepare(
      "DELETE FROM sync_state WHERE name LIKE 'catalog_%' OR name='supplier_contract'",
    ).run();
    for (const row of dbStates)
      await env.DB.prepare('INSERT INTO sync_state VALUES(?,?)').bind(row.name, row.json).run();
    vi.unstubAllGlobals();
  }
});
it('enforces fixed bundle limits and quantity choices without changing historical order prices', async () => {
  const original = ((await (await req('/admin/products', undefined, true)).json()) as any[]).find(
    (p) => p.id === 'demo-bag',
  );
  const snapshots = (await env.DB.prepare('SELECT id,quote FROM orders ORDER BY id').all()).results;
  const offer = (id: string, quantity: number) => ({
    id,
    quantity,
    label: '',
    total: original.price * quantity,
    freeShipping: false,
  });
  const presentation = { ...original.presentation, bundleMode: true, promotion: undefined };
  try {
    const tooMany = await req(
      '/admin/products/' + original.id,
      { ...original, presentation, offers: [offer('two', 2), offer('three', 3), offer('four', 4)] },
      true,
      'PUT',
    );
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()) as any).toMatchObject({ error: 'invalid_bundles' });
    expect(
      (
        await req(
          '/admin/products/' + original.id,
          { ...original, presentation, offers: [offer('one', 1)] },
          true,
          'PUT',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await req(
          '/admin/products/' + original.id,
          { ...original, presentation, offers: [offer('two', 2), offer('three', 3)] },
          true,
          'PUT',
        )
      ).status,
    ).toBe(200);
    const current = ((await (await req('/products')).json()) as any[]).find(
      (p) => p.id === original.id,
    );
    expect(current.bundleMode).toBe(true);
    expect(current.fulfillment).toBeUndefined();
    for (const quantity of [1, 2, 3, 4]) {
      const quoted = await req('/checkout/quote', {
        city: 'Rabat',
        cart: [{ productId: original.id, offerId: '', quantity, revision: current.revision }],
      });
      expect(quoted.status).toBe(quantity === 4 ? 409 : 200);
    }
    await env.DB.exec(await readFile('migrations/0016_fixed_bundles.sql', 'utf8'));
    expect((await env.DB.prepare('SELECT id,quote FROM orders ORDER BY id').all()).results).toEqual(
      snapshots,
    );
  } finally {
    await req('/admin/products/' + original.id, original, true, 'PUT');
  }
});
