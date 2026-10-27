import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { digest } from '../src/server/security';

let runtime: Miniflare;
const origin = 'https://new-trainee-store.test';
const code = 'private-setup-phrase-for-one-new-store';
const key = btoa('k'.repeat(32));
let challenge = '',
  session = '',
  csrf = '';
const post = (path: string, body: unknown, cookie = challenge, ip = '198.18.90.1') =>
  runtime.dispatchFetch(origin + '/api' + path, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      Cookie: cookie,
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify(body),
  });
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
      bindings: {
        ENVIRONMENT: 'production',
        INSTALLATION_MODE: 'cloudflare-button',
        ENCRYPTION_KEY: key,
        AUTH_PEPPER: 'a-test-only-pepper-for-installation',
        SETUP_TOKEN: code,
        MEDIA_ORIGIN: '/media',
      },
      outboundService: async (request) => {
        if (!request.url.endsWith('/siteverify'))
          return new Response('Unexpected outbound', { status: 503 });
        const form = await request.formData();
        return Response.json({
          success:
            form.get('secret') === 'private-widget-secret' &&
            ['verified-token', 'login-token'].includes(String(form.get('response'))),
          action: form.get('response') === 'login-token' ? 'login' : 'setup',
          hostname: new URL(origin).hostname,
        });
      },
    }),
  );
  const db = await runtime.getD1Database('DB');
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.exec(await readFile('migrations/' + file, 'utf8'));
}, 60000);
afterAll(async () => runtime?.dispose());
it('requires the private installation code before a visitor can create the owner', async () => {
  const auth = (await (await runtime.dispatchFetch(origin + '/api/auth/status')).json()) as any;
  expect(auth).toMatchObject({ setup: true, manualBootstrap: true, canSetup: false });
  expect(JSON.stringify(auth)).not.toContain(code);
  expect((await post('/auth/bootstrap', { token: 'incorrect-code' })).status).toBe(403);
  expect(
    (await post('/auth/setup', { email: 'trainee@example.test', password: 'Store123' }, '')).status,
  ).toBe(403);
  const bootstrap = await post('/auth/bootstrap', { token: code });
  expect(bootstrap.status).toBe(200);
  challenge = bootstrap.headers.get('set-cookie')!.split(';')[0];
  expect((await post('/setup/check', { token: code })).status).toBe(200);
});
it('checks the trainee widget before storing credentials and protects installation recovery', async () => {
  const body = {
    email: 'trainee@example.test',
    password: 'Store123',
    turnstileSiteKey: '0xABCDEFGHIJKLMNO12345',
    turnstileSecret: 'private-widget-secret',
    turnstileToken: 'bad-token',
  };
  expect((await post('/auth/setup', body)).status).toBe(400);
  const db = await runtime.getD1Database('DB');
  expect(await db.prepare('SELECT COUNT(*) AS count FROM admins').first('count')).toBe(0);
  expect(await db.prepare('SELECT COUNT(*) AS count FROM credentials').first('count')).toBe(0);
  for (const password of ['12345678', 'abcdefgh', 'abc123']) {
    const invalid = await post(
      '/auth/setup',
      {
        ...body,
        password,
        turnstileToken: 'verified-token',
      },
      challenge,
      '198.18.90.' + (2 + ['12345678', 'abcdefgh', 'abc123'].indexOf(password)),
    );
    expect(invalid.status).toBe(400);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM admins').first('count')).toBe(0);
  }
  const response = await post('/auth/setup', { ...body, turnstileToken: 'verified-token' });
  expect(response.status).toBe(201);
  const saved = (await response.json()) as any;
  expect(saved.installationKey).toBe(key);
  expect(saved.recovery).toHaveLength(8);
  session = response.headers.get('set-cookie')!.split(';')[0];
  csrf = saved.csrf;
  expect(await db.prepare('SELECT password FROM admins').first('password')).toMatch(/^scrypt:/);
  const encrypted = await db
    .prepare("SELECT encrypted FROM credentials WHERE name='turnstile'")
    .first<string>('encrypted');
  expect(encrypted).not.toContain(body.turnstileSecret);
  const publicSettings = await runtime.dispatchFetch(origin + '/api/products');
  expect(await publicSettings.text()).not.toContain(body.turnstileSecret);
  const admin = await runtime.dispatchFetch(origin + '/api/admin/settings', {
    headers: { Origin: origin, Cookie: session, 'X-CSRF-Token': csrf },
  });
  expect(admin.status).toBe(200);
  const text = await admin.text();
  expect(text).not.toContain(key);
  expect(text).not.toContain(body.turnstileSecret);
  expect((await post('/auth/bootstrap', { token: code })).status).toBe(409);
  const retry = await post('/auth/setup', {
    ...body,
    turnstileSecret: 'attacker-secret',
    turnstileToken: 'verified-token',
  });
  expect(retry.status).not.toBe(201);
  expect(
    await db.prepare("SELECT encrypted FROM credentials WHERE name='turnstile'").first('encrypted'),
  ).toBe(encrypted);
});

it('uses the encrypted per-store Turnstile secret for subsequent sign-in', async () => {
  const body = { email: 'trainee@example.test', password: 'Store123' };
  expect((await post('/auth/login', { ...body, turnstileToken: 'bad-token' }, '')).status).toBe(
    400,
  );
  expect((await post('/auth/login', { ...body, turnstileToken: 'login-token' }, '')).status).toBe(
    200,
  );
});
it('migrates compatible offers without changing their prices, quantities or saved legacy configuration', async () => {
  const db = await runtime.getD1Database('DB');
  await db.exec(
    (await readFile('fixtures/demo.sql', 'utf8'))
      .split('\n')
      .filter((line) => line.startsWith('INSERT INTO products'))
      .join('\n'),
  );
  const offers = JSON.stringify([
    { id: 'two', label: '', quantity: 2, total: 26000, freeShipping: true, enabled: true },
  ]);
  await db
    .prepare('UPDATE products SET offers=?,presentation=?,revision=7 WHERE id=?')
    .bind(offers, JSON.stringify({ quantityPricing: { unitPrice: 12000 } }), 'demo-bag')
    .run();
  const before = await db
    .prepare('SELECT price,offers FROM products WHERE id=?')
    .bind('demo-bag')
    .first();
  await db.exec(await readFile('migrations/0016_fixed_bundles.sql', 'utf8'));
  const after = await db
    .prepare('SELECT price,offers,presentation,revision FROM products WHERE id=?')
    .bind('demo-bag')
    .first<any>();
  expect(after.price).toBe(before!.price);
  expect(after.offers).toBe(before!.offers);
  expect(JSON.parse(after.presentation)).toMatchObject({
    bundleMode: true,
    quantityPricing: { unitPrice: 12000 },
  });
  expect(after.revision).toBe(8);
  await db.exec(await readFile('migrations/0016_fixed_bundles.sql', 'utf8'));
  expect(
    await db.prepare('SELECT revision FROM products WHERE id=?').bind('demo-bag').first('revision'),
  ).toBe(8);
});
it('keeps independent devices signed in, logs out only one device, and revokes all sessions on a password change', async () => {
  const login = async (ip: string) => {
    const response = await post(
      '/auth/login',
      { email: 'trainee@example.test', password: 'Store123', turnstileToken: 'login-token' },
      '',
      ip,
    );
    expect(response.status).toBe(200);
    return {
      cookie: response.headers.get('set-cookie')!.split(';')[0],
      csrf: ((await response.json()) as any).csrf,
    };
  };
  const deviceA = await login('198.18.91.1');
  const deviceB = await login('198.18.91.2');
  expect(deviceA.cookie).not.toBe(deviceB.cookie);
  const account = (cookie: string) =>
    runtime.dispatchFetch(origin + '/api/admin/account', {
      headers: { Origin: origin, Cookie: cookie },
    });
  expect((await account(deviceA.cookie)).status).toBe(200);
  expect((await account(deviceB.cookie)).status).toBe(200);
  const logout = await post('/admin/logout', {}, deviceB.cookie, '198.18.91.2');
  // A write uses the CSRF token belonging to that device's own session.
  expect(logout.status).toBe(403);
  expect(
    (
      await runtime.dispatchFetch(origin + '/api/admin/logout', {
        method: 'POST',
        headers: { Origin: origin, Cookie: deviceB.cookie, 'X-CSRF-Token': deviceB.csrf },
      })
    ).status,
  ).toBe(200);
  expect((await account(deviceB.cookie)).status).toBe(401);
  expect((await account(deviceA.cookie)).status).toBe(200);
  const deviceC = await login('198.18.91.3');
  const changed = await runtime.dispatchFetch(origin + '/api/admin/password', {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: deviceA.cookie,
      'X-CSRF-Token': deviceA.csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ current: 'Store123', password: 'Changed456' }),
  });
  expect(changed.status).toBe(200);
  expect((await account(deviceA.cookie)).status).toBe(401);
  expect((await account(deviceC.cookie)).status).toBe(401);
  expect((await account(changed.headers.get('set-cookie')!.split(';')[0])).status).toBe(200);
});

it('persists login for 30 days, renews legacy sessions, and survives changing networks and concurrent requests', async () => {
  const response = await post(
    '/auth/login',
    {
      email: 'trainee@example.test',
      password: 'Changed456',
      turnstileToken: 'login-token',
    },
    '',
    '198.18.92.1',
  );
  expect(response.status).toBe(200);
  const header = response.headers.get('set-cookie')!;
  expect(header).toContain('HttpOnly');
  expect(header).toContain('Secure');
  expect(header).toContain('SameSite=Strict');
  expect(header).toContain('Expires=');
  expect(Number(header.match(/Max-Age=(\d+)/)![1])).toBeGreaterThan(29 * 86400);
  const cookie = header.split(';')[0];
  const loginCsrf = ((await response.json()) as any).csrf;
  const hash = await digest(decodeURIComponent(cookie.slice('session='.length)));
  const db = await runtime.getD1Database('DB');
  const get = (path: string, ip: string) =>
    runtime.dispatchFetch(origin + '/api' + path, {
      headers: { Cookie: cookie, Origin: origin, 'CF-Connecting-IP': ip },
    });
  // Existing unexpired eight-hour cookies upgrade automatically when used.
  await db
    .prepare('UPDATE sessions SET expires_at=? WHERE hash=?')
    .bind(Date.now() + 8 * 3600000, hash)
    .run();
  const requests = await Promise.all([
    get('/auth/status', '198.18.92.22'),
    get('/auth/status', '2001:db8::33'),
  ]);
  for (const request of requests) {
    expect(request.status).toBe(200);
    expect(await request.json()).toMatchObject({ authenticated: true, csrf: loginCsrf });
  }
  const renewed = await db
    .prepare('SELECT expires_at,csrf FROM sessions WHERE hash=?')
    .bind(hash)
    .first<{ expires_at: number; csrf: string }>();
  expect(renewed!.expires_at - Date.now()).toBeGreaterThan(29 * 86400000);
  expect(renewed!.csrf).toBe(loginCsrf);
  expect(
    await db.prepare('SELECT COUNT(*) count FROM sessions WHERE hash=?').bind(hash).first('count'),
  ).toBe(1);
  const cookieRenewal = requests.find((request) => request.headers.has('set-cookie'))!;
  expect(cookieRenewal).toBeDefined();
  expect(cookieRenewal.headers.get('set-cookie')!.split(';')[0]).toBe(cookie);
  expect(
    Number(cookieRenewal.headers.get('set-cookie')!.match(/Max-Age=(\d+)/)![1]),
  ).toBeGreaterThan(29 * 86400);
  const withinDay = await get('/admin/account', '198.18.92.44');
  expect(withinDay.status).toBe(200);
  expect(withinDay.headers.has('set-cookie')).toBe(false);
  expect(
    await db.prepare('SELECT expires_at FROM sessions WHERE hash=?').bind(hash).first('expires_at'),
  ).toBe(renewed!.expires_at);
  // After a day of use, renew once, keeping the same session and CSRF.
  await db
    .prepare('UPDATE sessions SET expires_at=? WHERE hash=?')
    .bind(Date.now() + 28 * 86400000, hash)
    .run();
  const later = await get('/admin/account', '198.18.92.55');
  expect(later.status).toBe(200);
  expect(later.headers.has('set-cookie')).toBe(true);
  // An already expired session must never be revived by activity.
  await db
    .prepare('UPDATE sessions SET expires_at=? WHERE hash=?')
    .bind(Date.now() - 1000, hash)
    .run();
  const expired = await get('/auth/status', '198.18.92.66');
  expect(await expired.json()).toMatchObject({ authenticated: false });
  expect(expired.headers.has('set-cookie')).toBe(false);
  expect((await get('/admin/account', '198.18.92.77')).status).toBe(401);
  await db.prepare('DELETE FROM sessions WHERE hash=?').bind(hash).run();
});
