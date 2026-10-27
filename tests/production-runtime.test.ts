import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { digest, encryptSecret } from '../src/server/security';
import type { Env } from '../src/server/db';
import { settings } from '../src/server/db';

let runtime: Miniflare;
const origin = 'https://live-store.test';
const password = 'a-private-test-password-2026';
const setupToken = 'production-setup-test-only';
let bootstrapCookie = '';
let submissionFixture = false;
let rejectSubmission = false;
let holdSubmission = false;
let releaseSubmission: (() => void) | undefined;
let releaseTracking: (() => void) | undefined;
let trackingStarted: (() => void) | undefined;
const submissionCalls: string[] = [];
async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return runtime.dispatchFetch(origin + '/api' + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['src/server/worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: 'hono/jsx',
    external: ['node:crypto', 'node:buffer'],
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: {
        PASSWORD_HASHER: { className: 'PasswordHasher', useSQLite: true },
        OPERATIONS: { className: 'StoreOperations', useSQLite: true },
      },
      d1Databases: ['DB'],
      r2Buckets: ['MEDIA', 'BACKUPS'],
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (!submissionFixture) return new Response('Unexpected test request', { status: 503 });
        submissionCalls.push(request.method + ' ' + url.pathname);
        if (url.pathname.endsWith('/siteverify'))
          return Response.json({ success: true, action: 'order', hostname: 'live-store.test' });
        if (request.method === 'GET' && url.pathname === '/api/v1/orders') {
          trackingStarted?.();
          await new Promise<void>((resolve) => {
            releaseTracking = resolve;
          });
          return Response.json({
            success: true,
            orders: [],
            pagination: { has_more: false, next_cursor: null },
          });
        }
        const payload = (await request.json()) as any;
        if (url.pathname.endsWith('/orders/quote'))
          return Response.json({
            success: true,
            is_valid: true,
            quote_id: 'quote-immediate-runtime',
            expires_at: new Date(Date.now() + 600000).toISOString(),
            supplier_group_id: 'runtime-supplier',
            destination: {
              is_casablanca: false,
              shipping_tier: 'standard',
              platform_shipping_cost: 30,
              is_shipping_cost_final: true,
            },
            financials: {
              currency: 'MAD',
              total_wholesale: 80,
              platform_shipping_cost: 30,
              customer_shipping_fee: payload.customer_shipping_fee,
              platform_due_break_even: 110,
              proposed_cod_to_collect: payload.cod_to_collect,
              estimated_partner_profit: payload.cod_to_collect - 110,
              is_break_even_or_profitable: true,
            },
            safety_guarantee: {
              order_created: false,
              stock_reserved: false,
              shipping_label_issued: false,
            },
          });
        if (url.pathname === '/api/v1/orders' && request.method === 'POST') {
          if (holdSubmission)
            await new Promise<void>((resolve) => {
              releaseSubmission = resolve;
            });
          if (rejectSubmission) return Response.json({ success: false }, { status: 500 });
        }
        if (url.pathname === '/api/v1/orders' && request.method === 'POST')
          return Response.json({
            success: true,
            duplicate: false,
            order: {
              order_id: 'runtime-' + payload.external_order_id,
              external_order_id: payload.external_order_id,
              order_number: 'MDK-2026-00401',
              shipping_status: 'pending',
              financial_status: 'pending',
            },
          });
        return new Response('Unexpected API request', { status: 500 });
      },
      bindings: {
        ENVIRONMENT: 'production',
        APP_ORIGIN: origin,
        MEDIA_ORIGIN: '/media',
        AUTH_PEPPER: 'production-runtime-test-pepper',
        SETUP_TOKEN: setupToken,
        ENCRYPTION_KEY: btoa('z'.repeat(32)),
        TURNSTILE_SECRET: 'production-test-secret',
      },
    }),
  );
  const database = await runtime.getD1Database('DB');
  for (const migration of [
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
    await database.exec(await readFile('migrations/' + migration + '.sql', 'utf8'));
  await database
    .prepare('INSERT INTO settings VALUES(1,?)')
    .bind(JSON.stringify({ turnstileSiteKey: 'production-test-site-key' }))
    .run();
});
afterAll(async () => runtime?.dispose());
describe('real deployment runtime', () => {
  it('starts without demo products or an owner and keeps setup checks private', async () => {
    expect(await (await runtime.dispatchFetch(origin + '/api/products')).json()).toEqual([]);
    const auth = (await (await runtime.dispatchFetch(origin + '/api/auth/status')).json()) as any;
    expect(auth.setup).toBe(true);
    expect(auth.development).toBe(false);
    expect((await post('/setup/check', { token: 'wrong-token' })).status).toBe(403);
    expect((await post('/setup/check', { token: setupToken })).status).toBe(200);
  });
  it('creates a production owner using native scrypt and secure cookies', async () => {
    expect(
      (await post('/auth/setup', { token: setupToken, email: 'owner@live-store.test', password }))
        .status,
    ).toBe(403);
    expect((await post('/auth/bootstrap', { token: 'invalid-link' })).status).toBe(403);
    const bootstrap = await post('/auth/bootstrap', { token: setupToken });
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get('set-cookie')).toContain('HttpOnly');
    expect(bootstrap.headers.get('set-cookie')).toContain('Secure');
    bootstrapCookie = bootstrap.headers.get('set-cookie')!.split(';')[0];
    const authorized = await runtime.dispatchFetch(origin + '/api/auth/status', {
      headers: { Cookie: bootstrapCookie },
    });
    expect(((await authorized.json()) as any).canSetup).toBe(true);
    const response = await post(
      '/auth/setup',
      {
        email: 'owner@live-store.test',
        password,
      },
      { Cookie: bootstrapCookie },
    );
    expect(response.status).toBe(201);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    const body = (await response.json()) as any;
    expect((await post('/auth/bootstrap', { token: setupToken })).status).toBe(409);
    expect(
      (
        await post(
          '/auth/setup',
          { email: 'attacker@live-store.test', password },
          { Cookie: bootstrapCookie },
        )
      ).status,
    ).toBe(403);
    const row = await (
      await runtime.getD1Database('DB')
    )
      .prepare('SELECT password FROM admins')
      .first<{ password: string }>();
    expect(row!.password).toMatch(/^scrypt:32768:8:3:/);
    expect(row!.password).not.toContain(password);
    const next = await post(
      '/admin/password',
      { current: password, password: password + '-updated' },
      { Cookie: cookie.split(';')[0], 'X-CSRF-Token': body.csrf },
    );
    expect(next.status).toBe(200);
    expect(
      (
        await post(
          '/admin/jobs/run',
          {},
          { Cookie: cookie.split(';')[0], 'X-CSRF-Token': body.csrf },
        )
      ).status,
    ).toBe(401);
    const newBody = (await next.json()) as any;
    expect(
      (
        await post(
          '/admin/jobs/run',
          {},
          { Cookie: next.headers.get('set-cookie')!.split(';')[0], 'X-CSRF-Token': newBody.csrf },
        )
      ).status,
    ).toBe(200);
  });
  it('verifies KDF credentials and rejects attacker-selected cost parameters', async () => {
    const ns = await runtime.getDurableObjectNamespace('PASSWORD_HASHER');
    const stub = ns.get(ns.idFromName('owner'));
    const request = (body: unknown) =>
      stub.fetch('https://internal/', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
    const { hash } = (await (await request({ operation: 'hash', password })).json()) as any;
    expect(await (await request({ operation: 'verify', password, stored: hash })).json()).toEqual({
      matches: true,
    });
    expect(
      await (
        await request({ operation: 'verify', password: 'wrong-password', stored: hash })
      ).json(),
    ).toEqual({ matches: false });
    expect(
      await (
        await request({
          operation: 'verify',
          password,
          stored: hash.replace('32768', '2147483648'),
        })
      ).json(),
    ).toEqual({ matches: false });
    expect((await request({ operation: 'hash', password: 'short' })).status).toBe(400);
  });
  it('requires Turnstile on real logins and refuses purchase before supplier verification', async () => {
    expect((await post('/auth/login', { email: 'owner@live-store.test', password })).status).toBe(
      400,
    );
    const quote = await post('/checkout/quote', {
      city: 'Rabat',
      cart: [{ productId: 'unknown', offerId: '', quantity: 1, revision: 1 }],
    });
    expect(quote.status).toBe(503);
  });
  it('dispatches auto-send and manual confirmation immediately while tracking is busy in the background object', async () => {
    const db = await runtime.getD1Database('DB');
    const config = await settings(db);
    const authEnv = { DB: db, ENCRYPTION_KEY: btoa('z'.repeat(32)) } as Env;
    const ns = await runtime.getDurableObjectNamespace('OPERATIONS');
    const token = 'submission-session-test-only',
      csrf = 'submission-csrf-test-only';
    let trackingRequest: Promise<unknown> | undefined;
    submissionFixture = true;
    submissionCalls.length = 0;
    try {
      await db
        .prepare('INSERT INTO credentials VALUES(?,?)')
        .bind('mowarid', await encryptSecret(authEnv, 'mw_live_submission_fixture'))
        .run();
      await db
        .prepare('INSERT INTO sync_state VALUES(?,?)')
        .bind(
          'supplier_contract',
          JSON.stringify({
            source: 'api',
            keyFingerprint: await digest('mw_live_submission_fixture'),
          }),
        )
        .run();
      await db
        .prepare(
          "INSERT INTO products(id,slug,sku,name,price,minimum,fulfillment,stock,active,supplier,verified) VALUES('runtime-product','runtime-product','RUNTIME-SKU','Runtime product',14900,11000,8000,100,1,'runtime-supplier',1)",
        )
        .run();
      await db
        .prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(JSON.stringify({ ...config, contractVerified: true, autoConfirm: true }))
        .run();
      const owner = await db.prepare('SELECT id FROM admins LIMIT 1').first<{ id: string }>();
      await db
        .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
        .bind(await digest(token), owner!.id, csrf, Date.now() + 600000)
        .run();
      await db
        .prepare(
          "INSERT INTO orders(id,ref,idempotency,request_hash,customer,supplier,quote,attribution,matching,created_at,status,sync_status,mowarid_id,shipping_status) VALUES('runtime-tracking','REF-RUNTIME-TRACKING','runtime-tracking-key','hash','{}','runtime-supplier','{\"total\":10000,\"items\":[]}','{}','{}',?,'confirmed','sent','runtime-existing','pending')",
        )
        .bind(new Date().toISOString())
        .run();
      const started = new Promise<void>((resolve) => {
        trackingStarted = resolve;
      });
      trackingRequest = ns
        .get(ns.idFromName('store'))
        .fetch('https://operations.internal/tracking', { method: 'POST' });
      await started;
      await db
        .prepare('INSERT INTO sync_state VALUES(?,?)')
        .bind(
          'shipping_policy',
          JSON.stringify({
            catalog: { maximum: 3000, keyFingerprint: await digest('mw_live_submission_fixture') },
          }),
        )
        .run();
      const lines = [{ productId: 'runtime-product', offerId: '', quantity: 1, revision: 1 }];
      const quoteResponse = await post('/checkout/quote', { cart: lines, city: 'Rabat' });
      expect(quoteResponse.status).toBe(200);
      const quote = (await quoteResponse.json()) as any;
      const place = () =>
        post('/orders', {
          cart: lines,
          customer: {
            name: 'Test customer',
            phone: '0612345678',
            city: 'Rabat',
            address: 'Test address',
            notes: '',
          },
          fingerprint: quote.fingerprint,
          idempotency: crypto.randomUUID(),
          turnstileToken: 'runtime-order-token',
        });
      holdSubmission = true;
      const automatic = await Promise.race([
        place(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      expect(
        automatic,
        'a saved checkout must respond while the supplier is still stalled',
      ).not.toBeNull();
      expect(automatic!.status).toBe(201);
      const automaticRef = ((await automatic!.json()) as any).ref;
      await expect
        .poll(() => submissionCalls.filter((call) => call === 'POST /api/v1/orders').length)
        .toBe(1);
      const inFlight = await db
        .prepare('SELECT id,sync_status,mowarid_id FROM orders WHERE ref=?')
        .bind(automaticRef)
        .first<any>();
      expect(inFlight).toMatchObject({ sync_status: 'sending', mowarid_id: null });
      expect(
        await db
          .prepare("SELECT status FROM jobs WHERE order_id=? AND type='submit'")
          .bind(inFlight.id)
          .first(),
      ).toMatchObject({ status: 'running' });
      holdSubmission = false;
      releaseSubmission?.();
      await expect
        .poll(
          async () =>
            (
              await db
                .prepare('SELECT sync_status FROM orders WHERE ref=?')
                .bind(automaticRef)
                .first<any>()
            )?.sync_status,
        )
        .toBe('sent');
      expect(submissionCalls.filter((call) => call === 'POST /api/v1/orders')).toHaveLength(1);
      await db
        .prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(JSON.stringify({ ...config, contractVerified: true, autoConfirm: false }))
        .run();
      const manual = await place();
      expect(manual.status).toBe(201);
      const manualRef = ((await manual.json()) as any).ref;
      const saved = await db
        .prepare('SELECT * FROM orders WHERE ref=?')
        .bind(manualRef)
        .first<any>();
      expect(saved.status).toBe('pending_confirmation');
      expect(submissionCalls.filter((call) => call === 'POST /api/v1/orders')).toHaveLength(1);
      const confirmed = await post(
        '/admin/orders/' + saved.id + '/confirm',
        {},
        { Cookie: 'session=' + token, 'X-CSRF-Token': csrf },
      );
      expect(confirmed.status).toBe(200);
      expect(await confirmed.json()).toMatchObject({ sent: true });
      expect(
        (await db.prepare('SELECT sync_status FROM orders WHERE id=?').bind(saved.id).first<any>())
          ?.sync_status,
      ).toBe('sent');
      expect(submissionCalls.filter((call) => call === 'POST /api/v1/orders')).toHaveLength(2);
      expect(submissionCalls.filter((call) => call === 'GET /api/v1/orders')).toHaveLength(1);
      expect(submissionCalls.filter((call) => call === 'POST /api/v1/orders/quote')).toHaveLength(
        0,
      );
      expect(
        (await db.prepare('SELECT quote FROM orders WHERE id=?').bind(saved.id).first<any>()).quote,
      ).toBe(saved.quote);
      // A real POST failure preserves the local success response and durable retry.
      rejectSubmission = true;
      await db
        .prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(JSON.stringify({ ...config, contractVerified: true, autoConfirm: true }))
        .run();
      const failed = await place();
      expect(failed.status).toBe(201);
      const failedRef = ((await failed.json()) as any).ref;
      await expect
        .poll(
          async () =>
            (
              await db
                .prepare('SELECT last_error FROM orders WHERE ref=?')
                .bind(failedRef)
                .first<any>()
            )?.last_error,
        )
        .toBe('remote_server_error');
      const pending = await db
        .prepare('SELECT * FROM orders WHERE ref=?')
        .bind(failedRef)
        .first<any>();
      expect(pending.sync_status).toBe('queued');
      expect(pending.last_error).toBe('remote_server_error');
      expect(pending.mowarid_id).toBeNull();
      expect(JSON.parse(pending.quote).total).toBe(quote.total);
      expect(
        (
          await db
            .prepare("SELECT status FROM jobs WHERE order_id=? AND type='submit'")
            .bind(pending.id)
            .first<any>()
        ).status,
      ).toBe('pending');
    } finally {
      holdSubmission = false;
      releaseSubmission?.();
      releaseSubmission = undefined;
      releaseTracking?.();
      await trackingRequest;
      submissionFixture = false;
      rejectSubmission = false;
      trackingStarted = undefined;
      releaseTracking = undefined;
      await db.prepare('UPDATE settings SET json=? WHERE id=1').bind(JSON.stringify(config)).run();
      await db
        .prepare('DELETE FROM sessions WHERE hash=?')
        .bind(await digest(token))
        .run();
      await db.prepare("DELETE FROM sync_state WHERE name='shipping_policy'").run();
      await db.prepare("DELETE FROM credentials WHERE name='mowarid'").run();
      await db.prepare("DELETE FROM sync_state WHERE name='supplier_contract'").run();
      await db
        .prepare(
          "DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE supplier='runtime-supplier')",
        )
        .run();
      await db
        .prepare(
          "DELETE FROM jobs WHERE order_id IN (SELECT id FROM orders WHERE supplier='runtime-supplier')",
        )
        .run();
      await db.prepare("DELETE FROM orders WHERE supplier='runtime-supplier'").run();
      await db.prepare("DELETE FROM products WHERE id='runtime-product'").run();
    }
  });
  it('verifies real passkey signatures in the private production service and rejects wrong origins, challenges, UV flags and counters', async () => {
    const stub = (await runtime.getDurableObjectNamespace('PASSWORD_HASHER')).get(
      (await runtime.getDurableObjectNamespace('PASSWORD_HASHER')).idFromName('owner'),
    );
    const call = (body: unknown) =>
      stub.fetch('https://password.internal/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = keys.publicKey.export({ format: 'jwk' });
    const publicKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
    const id = Buffer.from('test-credential-id').toString('base64url'),
      challenge = Buffer.from('random-isolated-test-challenge-value').toString('base64url');
    const rpHash = createHash('sha256').update('live-store.test').digest();
    const makeAssertion = (clientOrigin = origin, flags = 5) => {
      const clientDataJSON = Buffer.from(
        JSON.stringify({ type: 'webauthn.get', challenge, origin: clientOrigin }),
      ).toString('base64url');
      const authData = Buffer.concat([rpHash, Buffer.from([flags, 0, 0, 0, 1])]);
      const payload = Buffer.concat([
        authData,
        createHash('sha256').update(Buffer.from(clientDataJSON, 'base64url')).digest(),
      ]);
      return {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON,
          authenticatorData: authData.toString('base64url'),
          signature: Buffer.from(sign('sha256', payload, keys.privateKey)).toString('base64url'),
          userHandle: null,
        },
      };
    };
    const body = {
      operation: 'passkey-authenticate',
      origin,
      challenge,
      credential: { id, counter: 0, publicKey: Buffer.from(publicKey).toString('base64') },
      response: makeAssertion(),
    };
    const verified = await call(body);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ counter: 1 });
    expect((await call({ ...body, origin: 'https://attacker.test' })).status).toBe(400);
    expect((await call({ ...body, response: makeAssertion('https://attacker.test') })).status).toBe(
      401,
    );
    expect((await call({ ...body, response: makeAssertion(origin, 1) })).status).toBe(401);
    expect((await call({ ...body, challenge: 'different-challenge' })).status).toBe(401);
    expect((await call({ ...body, credential: { ...body.credential, counter: 1 } })).status).toBe(
      401,
    );
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge, origin }),
    ).toString('base64url');
    const credentialId = Buffer.from(id, 'base64url');
    const length = Buffer.alloc(2);
    length.writeUInt16BE(credentialId.length);
    const authData = Buffer.concat([
      rpHash,
      Buffer.from([69, 0, 0, 0, 0]),
      Buffer.alloc(16),
      length,
      credentialId,
      publicKey,
    ]);
    const attestation = isoCBOR.encode(
      new Map<string, any>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    const registration = await call({
      operation: 'passkey-register',
      origin,
      challenge,
      response: {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON,
          attestationObject: Buffer.from(attestation).toString('base64url'),
          transports: ['internal'],
        },
      },
    });
    expect(registration.status).toBe(200);
    expect(await registration.json()).toMatchObject({
      id,
      counter: 0,
      publicKey: body.credential.publicKey,
    });
  });
  it('serves uploaded media on the same origin in production', async () => {
    const id = '12345678-1234-1234-1234-123456789abc.webp';
    await (
      await runtime.getR2Bucket('MEDIA')
    ).put(id, 'test-webp-bytes', { httpMetadata: { contentType: 'image/webp' } });
    const response = await runtime.dispatchFetch(origin + '/media/' + id);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(await response.text()).toBe('test-webp-bytes');
    await new Promise((done) => setTimeout(done, 30));
    const cached = await runtime.dispatchFetch(origin + '/media/' + id);
    expect(cached.status).toBe(200);
    expect(await cached.text()).toBe('test-webp-bytes');
    expect(cached.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await runtime.dispatchFetch(origin + '/media/private-backup.json')).status).toBe(404);
  });
  it('blocks a catalog proof from another integration key before quoting an order', async () => {
    const db = await runtime.getD1Database('DB'),
      key = 'mw_live_isolated_production_fixture';
    await db
      .prepare('INSERT INTO credentials VALUES(?,?)')
      .bind('mowarid', await encryptSecret({ ENCRYPTION_KEY: btoa('z'.repeat(32)) } as Env, key))
      .run();
    try {
      await db
        .prepare('INSERT INTO sync_state VALUES(?,?)')
        .bind(
          'supplier_contract',
          JSON.stringify({ source: 'api', keyFingerprint: 'f'.repeat(64) }),
        )
        .run();
      const body = {
        city: 'Rabat',
        cart: [{ productId: 'unknown', offerId: '', quantity: 1, revision: 1 }],
      };
      expect((await post('/checkout/quote', body)).status).toBe(503);
      await db
        .prepare('UPDATE sync_state SET json=? WHERE name=?')
        .bind(
          JSON.stringify({ source: 'api', keyFingerprint: await digest(key) }),
          'supplier_contract',
        )
        .run();
      await db
        .prepare(
          'INSERT INTO sync_state VALUES(?,?) ON CONFLICT(name) DO UPDATE SET json=excluded.json',
        )
        .bind(
          'shipping_policy',
          JSON.stringify({ catalog: { maximum: 3000, keyFingerprint: await digest(key) } }),
        )
        .run();
      // Matching proof passes the gate, then normal unavailable-product checks apply.
      expect((await post('/checkout/quote', body)).status).toBe(400);
    } finally {
      await db.prepare("DELETE FROM sync_state WHERE name='shipping_policy'").run();
      await db.prepare("DELETE FROM credentials WHERE name='mowarid'").run();
      await db.prepare("DELETE FROM sync_state WHERE name='supplier_contract'").run();
    }
  });
  it('accepts a signed server callback through the native operations binding without weakening Origin checks elsewhere', async () => {
    const db = await runtime.getD1Database('DB');
    const cryptoEnv = { ENCRYPTION_KEY: btoa('z'.repeat(32)) } as Env;
    const key = 'mw_live_native_webhook_fixture',
      secret = 'whsec_native_webhook_fixture_12345';
    for (const [name, value] of [
      ['mowarid', key],
      ['mowarid_webhook', secret],
    ])
      await db
        .prepare('INSERT INTO credentials VALUES(?,?)')
        .bind(name, await encryptSecret(cryptoEnv, value))
        .run();
    await db
      .prepare('INSERT INTO sync_state VALUES(?,?)')
      .bind(
        'webhook_subscription',
        JSON.stringify({
          keyFingerprint: await digest(key),
          url: origin + '/api/webhooks/mowarid',
          status: 'testing',
        }),
      )
      .run();
    try {
      const raw = JSON.stringify({
        event_id: 'evt-native-ping',
        event_type: 'ping',
        api_version: 'v1',
        data: {},
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature =
        't=' +
        timestamp +
        ',v1=' +
        createHmac('sha256', secret)
          .update(timestamp + '.' + raw)
          .digest('hex');
      const started = Date.now();
      const response = await runtime.dispatchFetch(origin + '/api/webhooks/mowarid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mowarid-Signature': signature },
        body: raw,
      });
      expect(response.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(
        await db
          .prepare("SELECT status,payload FROM webhook_inbox WHERE event_id='evt-native-ping'")
          .first(),
      ).toEqual({ status: 'ignored', payload: null });
      expect(
        (
          await runtime.dispatchFetch(origin + '/api/webhooks/mowarid', {
            method: 'POST',
            body: raw,
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await runtime.dispatchFetch(origin + '/api/orders', {
            method: 'POST',
            headers: { 'X-Mowarid-Signature': signature },
            body: raw,
          })
        ).status,
      ).toBe(403);
    } finally {
      await db.prepare("DELETE FROM credentials WHERE name IN ('mowarid','mowarid_webhook')").run();
      await db
        .prepare(
          "DELETE FROM sync_state WHERE name IN ('webhook_subscription','webhook_last_received')",
        )
        .run();
    }
  });
  it('imports through the native private operations binding and keeps stale provider data as a draft', async () => {
    const db = await runtime.getD1Database('DB');
    const config = await settings(db);
    const previous = (
      await db
        .prepare("SELECT * FROM sync_state WHERE name IN ('supplier_contract','shipping_policy')")
        .all()
    ).results;
    const credentialBefore = await db
      .prepare("SELECT encrypted FROM credentials WHERE name='mowarid'")
      .first<any>();
    const owner = await db.prepare('SELECT id FROM admins LIMIT 1').first<any>();
    const token = 'catalog-import-session-test-only',
      csrf = 'catalog-import-csrf-test-only';
    const key = 'mw_live_catalog_import_fixture',
      fingerprint = await digest(key),
      requestId = crypto.randomUUID();
    try {
      await db
        .prepare('INSERT OR REPLACE INTO sessions(hash,admin_id,csrf,expires_at) VALUES(?,?,?,?)')
        .bind(await digest(token), owner.id, csrf, Date.now() + 600000)
        .run();
      await db
        .prepare('INSERT OR REPLACE INTO credentials VALUES(?,?)')
        .bind('mowarid', await encryptSecret({ ENCRYPTION_KEY: btoa('z'.repeat(32)) } as Env, key))
        .run();
      await db
        .prepare('UPDATE settings SET json=? WHERE id=1')
        .bind(JSON.stringify({ ...config, contractVerified: true }))
        .run();
      for (const [name, value] of [
        ['supplier_contract', { keyFingerprint: fingerprint }],
        [
          'shipping_policy',
          { catalog: { keyFingerprint: fingerprint, maximum: 3000, casa: 2000, other: 3000 } },
        ],
      ] as const)
        await db
          .prepare('INSERT OR REPLACE INTO sync_state VALUES(?,?)')
          .bind(name, JSON.stringify(value))
          .run();
      for (const [sku, hash] of [
        ['IMPORT-NATIVE-VALID', fingerprint],
        ['IMPORT-NATIVE-STALE', 'different-provider-key'],
      ])
        await db
          .prepare('INSERT INTO catalog VALUES(?,?,?)')
          .bind(
            sku,
            JSON.stringify({
              sku,
              name: 'Collagen Native',
              description: '<h2>Example</h2><p>Product details</p>',
              main_image: 'https://mowarid.ma/test.jpg',
              fulfillment_price: 80,
              suggested_retail_price: 200,
              stock_quantity: 10,
              supplier_key: 'runtime-supplier',
              is_active: true,
              key_fingerprint: hash,
            }),
            new Date().toISOString(),
          )
          .run();
      const payload = {
        requestId,
        mode: 'published',
        skus: ['IMPORT-NATIVE-VALID', 'IMPORT-NATIVE-STALE'],
      };
      const headers = { Cookie: 'session=' + token, 'X-CSRF-Token': csrf };
      const response = await post('/admin/catalog/import', payload, headers);
      expect(response.status).toBe(200);
      const result = (await response.json()) as any;
      expect(result.items.find((p: any) => p.sku === 'IMPORT-NATIVE-VALID').status).toBe(
        'published',
      );
      expect(result.items.find((p: any) => p.sku === 'IMPORT-NATIVE-STALE')).toMatchObject({
        status: 'draft',
      });
      expect(await (await post('/admin/catalog/import', payload, headers)).json()).toEqual(result);
      expect(
        (
          await db
            .prepare("SELECT active FROM products WHERE sku='IMPORT-NATIVE-STALE'")
            .first<any>()
        ).active,
      ).toBe(0);
    } finally {
      await db.prepare("DELETE FROM products WHERE sku LIKE 'IMPORT-NATIVE-%'").run();
      await db.prepare("DELETE FROM catalog WHERE sku LIKE 'IMPORT-NATIVE-%'").run();
      await db
        .prepare('DELETE FROM sessions WHERE hash=?')
        .bind(await digest(token))
        .run();
      await db.prepare('UPDATE settings SET json=? WHERE id=1').bind(JSON.stringify(config)).run();
      await db
        .prepare("DELETE FROM sync_state WHERE name IN ('supplier_contract','shipping_policy')")
        .run();
      for (const row of previous as any[])
        await db.prepare('INSERT INTO sync_state VALUES(?,?)').bind(row.name, row.json).run();
      await db.prepare("DELETE FROM credentials WHERE name='mowarid'").run();
      if (credentialBefore)
        await db
          .prepare('INSERT INTO credentials VALUES(?,?)')
          .bind('mowarid', credentialBefore.encrypted)
          .run();
    }
  });
});
