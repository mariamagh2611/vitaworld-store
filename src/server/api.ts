import { validNewPassword, PASSWORD_HINT } from '../shared/password';
import { policyVisible } from '../shared/policies';
import { safeProducts, reviewPrices } from './price-safety';
import { maximumShipping, shippingCosts } from './shipping-policy';
import { businessDate, businessStart, nextDay } from '../shared/time';
import { Hono } from 'hono';
import { z } from 'zod';
import { deleteCookie } from 'hono/cookie';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import {
  bootstrapAllowed,
  issueChallenge,
  consumeChallenge,
  challengeValue,
  verifiedPasskey,
} from './passkeys';
import { mediaLimits, webpDimensions } from '../shared/media';
import type { Env, OrderRow } from './db';
import {
  settings,
  products,
  cartProducts,
  order,
  parsedOrder,
  audit,
  now,
  state,
  setState,
  cities,
  categories,
} from './db';
import { requestInterfaceLanguage } from './language';
import { enabledStoreLanguages, localizedProduct, languageOf } from '../shared/i18n';
import { defaults, publicProduct, type Product, type Quote } from '../shared/types';
import {
  DomainError,
  quoteCart,
  customerInput,
  isCasa,
  assertOrderMargin,
  assertPublishedPrices,
  platformShipping,
} from '../shared/domain';
import { cartSchema, orderSchema, productSchema, settingsSchema, categorySchema } from './schemas';
import { catalogMedia, catalogSearchKeywords } from '../shared/catalog';
import { merchantCatalog } from '../shared/merchant-order';
import {
  financialStatus,
  financialLabel,
  orderPhaseLabels,
  financialLabels,
  callLabels,
} from '../shared/order-status';
import { META_GRAPH_VERSION } from './meta';
import { metaPixelIds, metaCredentialName, metaHealthName } from '../shared/meta-pixels';
import { storeIdentity } from './store-identity';
import { campaignOriginAllowed, storeOriginProof } from './campaign-origin';
import {
  metaConfiguredPixels,
  metaTicket,
  validMetaTicket,
  metaPageUrl,
  metaEventStatement,
  flushMetaEvents,
  sendMetaEvent,
  retryMetaEvents,
} from './meta-events';
import {
  normalizeProductContent,
  safeProductHtml,
  plainProductDescription,
} from './product-content';
import { receiveWebhook, processWebhooks, queueWebhookConnection, webhookReady } from './webhooks';
import {
  credential,
  saveCredential,
  encryptSecret,
  digest,
  random,
  ownerPasswordHash,
  ownerPasswordMatches,
  requireOwnerAuth,
  dummyOwnerHash,
  checkOwnerAuth,
  constantEqual,
  sameOrigin,
  rate,
  turnstile,
  startSession,
  session,
  endSession,
} from './security';
import { enqueue, runJobs, recordRemote, refreshTracking, dispatchSubmission } from './jobs';
import { mowarid, supplierKey, field, cents, RemoteError } from './mowarid';
import { quoteMowarid, dryRunMowarid } from './order-checks';
import { previewHTML } from './views';
import { searchProducts } from './search';
import { importCatalogBatch, catalogImportSchema } from './catalog-import';
import { merchantPricingSnapshot, orderPricing } from '../shared/order-pricing';
import { canonicalCity } from '../shared/cities';
export const api = new Hono<{ Bindings: Env; Variables: { admin: string; csrf: string } }>();
async function adminOrderRows(env: Env, items: OrderRow[]) {
  const rows = items.map(parsedOrder);
  const legacy = rows.filter((row) => !row.quote.merchantPricing);
  const productIds = [
    ...new Set(legacy.flatMap((row) => row.quote.items.map((item) => item.productId))),
  ].filter(Boolean);
  const costProducts: Product[] = [];
  // D1 limits bound parameters. One batch of product IDs serves all legacy rows.
  for (let offset = 0; offset < productIds.length; offset += 75)
    costProducts.push(...(await cartProducts(env.DB, productIds.slice(offset, offset + 75))));
  const knownCities = legacy.length ? await cities(env.DB) : [];
  for (const row of legacy)
    row.pricing = orderPricing(
      row,
      merchantPricingSnapshot(
        row.quote,
        costProducts,
        platformShipping(row.customer.city, knownCities),
        now(),
      ),
    );
  return rows;
}
async function retryPurchaseEvents(env: Env) {
  const s = await settings(env.DB);
  if (!s.trackingEnabled || !s.facebookPixel || !(await credential(env, 'meta'))) return;
  // Reuse the original outbox row and event ID; never retry an undelivered order.
  await env.DB.prepare(
    "UPDATE jobs SET status='pending',attempts=0,run_at=?,lease_until=0,last_error=NULL WHERE type='purchase' AND status='failed' AND EXISTS(SELECT 1 FROM orders WHERE orders.id=jobs.order_id AND shipping_status IN ('delivered','paid') AND delivered_at IS NOT NULL)",
  )
    .bind(Date.now())
    .run();
}
async function makeQuote(
  env: Env,
  cart: Parameters<typeof quoteCart>[0],
  city: string,
  checkoutMode: 'cart' | 'direct' = 'cart',
): Promise<Quote> {
  const contract = await state(env.DB, 'supplier_contract');
  if (
    env.ENVIRONMENT !== 'development' &&
    (contract?.source !== 'api' ||
      (contract.keyFingerprint &&
        contract.keyFingerprint !== (await digest(await credential(env, 'mowarid')))))
  )
    throw new DomainError('supplier_contract_missing', 'لم يُتحقق من عقد مورد الإنتاجي بعد.', 503);
  const [ps, s, knownCities, maximum] = await Promise.all([
    cartProducts(
      env.DB,
      cart.map((l) => l.productId),
    ),
    settings(env.DB),
    cities(env.DB),
    maximumShipping(env),
  ]);
  const q = quoteCart(cart, ps, city, s, knownCities, checkoutMode, maximum);
  const p = checkoutMode === 'direct' ? ps.find((p) => p.id === cart[0]?.productId) : undefined;
  const value = {
    ...q,
    checkoutMode,
    cartFreeShippingThreshold: checkoutMode === 'cart' ? s.cartFreeShippingThreshold : 0,
    shippingRates: {
      casa: p?.shippingCasa ?? s.shippingCasa,
      other: p?.shippingOther ?? s.shippingOther,
    },
  };
  return { ...value, fingerprint: await digest(JSON.stringify(value)) };
}
const credentialsSchema = z.object({
  metaPixel: z
    .string()
    .regex(/^\d{5,30}$/)
    .optional(),
  mowarid: z
    .string()
    .regex(/^$|^mw_live_[a-zA-Z0-9_-]+$/)
    .max(500)
    .optional(),
  meta: z
    .string()
    .max(2000)
    .refine(
      (v) => !v || (v.length >= 32 && !/[\s•*]/.test(v) && /^[a-zA-Z0-9_-]+$/.test(v)),
      'الصق رمز CAPI الكامل وحده، دون مسافات أو قيمة مخفية.',
    )
    .optional(),
});
api.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.path !== '/api/webhooks/mowarid')
    sameOrigin(c);
  c.header('Cache-Control', 'no-store');
  // Biometric sign-in/recovery has been retired from this store. Existing key
  // records are left intact; none can be registered or used through the API.
  if (/^\/api\/(?:auth\/passkey|admin\/passkeys)(?:\/|$)/.test(c.req.path)) return c.notFound();
  await next();
});
api.post('/webhooks/mowarid', async (c) => {
  const signature = c.req.header('X-Mowarid-Signature') || '';
  if (!signature || signature.length > 256)
    return c.json({ error: 'webhook_signature_invalid' }, 401);
  try {
    await rate(c, 120, 60, 'webhook_ingress');
  } catch (error) {
    c.header('Retry-After', '60');
    throw error;
  }
  const body = await c.req.arrayBuffer();
  if (c.env.OPERATIONS) {
    const stub = c.env.OPERATIONS.get(c.env.OPERATIONS.idFromName('store'));
    const response = await stub.fetch('https://operations.internal/receive', {
      method: 'POST',
      headers: { 'X-Mowarid-Signature': signature },
      body,
    });
    if (response.ok)
      c.executionCtx.waitUntil(
        stub.fetch('https://operations.internal/webhooks', { method: 'POST' }).then(() => {}),
      );
    return new Response(response.body, {
      status: response.status,
      headers: new Headers(response.headers),
    });
  }
  const result = await receiveWebhook(c.env, new Uint8Array(body), signature);
  c.executionCtx.waitUntil(processWebhooks(c.env));
  return c.json(result);
});
// A public, nonce-bound attestation of the hostname actually serving this store.
// Signing a caller-supplied origin would allow an unrelated host to relay proofs.
api.get('/store-origin-proof', async (c) => {
  const challenge = z.string().uuid().parse(c.req.query('challenge'));
  return c.text(await storeOriginProof(c.env, new URL(c.req.url).origin, challenge));
});
api.get('/auth/status', async (c) => {
  const a = await c.env.DB.prepare('SELECT id FROM admins LIMIT 1').first();
  const ss = await session(c),
    s = await settings(c.env.DB);
  return c.json({
    adminLanguage: s.adminLanguage,
    setup: !a,
    manualBootstrap:
      !a && c.env.ENVIRONMENT !== 'development' && c.env.INSTALLATION_MODE === 'cloudflare-button',
    canSetup: !a && (await bootstrapAllowed(c)),
    authenticated: !!ss,
    csrf: ss?.csrf,
    turnstileSiteKey: s.turnstileSiteKey,
    privacyVisible: policyVisible(s, 'privacy'),
    development: c.env.ENVIRONMENT === 'development',
    brand: s.brand,
    logo: s.logo,
    storeOrigin: c.env.APP_ORIGIN || '',
  });
});
api.get('/meta/bootstrap', async (c) => {
  await rate(c, 120, 60, 'meta_bootstrap');
  const pixels = await metaConfiguredPixels(c.env);
  if (!pixels.length) return c.json({ enabled: false });
  const destinations = await Promise.all(
    pixels.map(async (pixel) => ({ pixel, ticket: await metaTicket(c.env, c.req.url, pixel) })),
  );
  return c.json({
    enabled: true,
    ...destinations[0],
    ...(destinations.length > 1 ? { pixels: destinations } : {}),
  });
});
api.post('/meta/events', async (c) => {
  await rate(c, 120, 60, 'meta_events');
  const body = z
    .object({
      event: z.enum(['PageView', 'ViewContent', 'InitiateCheckout']),
      eventId: z.string().uuid(),
      pixel: z.string().regex(/^\d{5,30}$/),
      ticket: z.string().max(100),
      path: z.string().max(2000),
      fbp: z.string().max(200).default(''),
      fbc: z.string().max(500).default(''),
    })
    .strict()
    .parse(await c.req.json());
  const pixels = await metaConfiguredPixels(c.env),
    pixel = body.pixel;
  if (!pixels.length) return c.json({ queued: false });
  if (!pixels.includes(pixel) || !(await validMetaTicket(c.env, c.req.url, pixel, body.ticket)))
    throw new DomainError('tracking_expired', 'أعد تحميل الصفحة لتحديث التتبع.', 403);
  const event_source_url = metaPageUrl(c.req.url, body.path);
  const result = await (
    await metaEventStatement(c.env, pixel, {
      event_name: body.event,
      event_id: body.eventId,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url,
      user_data: {
        client_user_agent: (c.req.header('User-Agent') || '').slice(0, 500),
        ...(c.req.header('CF-Connecting-IP')
          ? { client_ip_address: c.req.header('CF-Connecting-IP')! }
          : {}),
        ...(/^fb\.\d\.\d+\.[\w.-]+$/.test(body.fbp) ? { fbp: body.fbp } : {}),
        ...(/^fb\.\d\.\d+\.[\w.-]+$/.test(body.fbc) ? { fbc: body.fbc } : {}),
      },
    })
  ).run();
  c.executionCtx.waitUntil(flushMetaEvents(c.env).catch(() => {}));
  return c.json({ queued: !!result.meta.changes }, 202);
});
api.post('/auth/bootstrap', async (c) => {
  await rate(c, 10, 900, 'bootstrap');
  const b = z.object({ token: z.string().max(200) }).parse(await c.req.json());
  if (
    !c.env.SETUP_TOKEN ||
    (c.env.INSTALLATION_MODE === 'cloudflare-button' && c.env.SETUP_TOKEN.length < 24) ||
    !constantEqual(b.token, c.env.SETUP_TOKEN)
  )
    throw new DomainError('invalid_setup_link', 'رابط إكمال التثبيت غير صالح.', 403);
  if (await c.env.DB.prepare('SELECT id FROM admins LIMIT 1').first())
    throw new DomainError('already_setup', 'حساب المتجر جاهز. سجل الدخول ببريدك وكلمة مرورك.', 409);
  await issueChallenge(c, 'bootstrap', '');
  return c.json({ ok: true });
});
api.post('/setup/check', async (c) => {
  await rate(c, 5, 900, 'setup_check');
  const b = z.object({ token: z.string().max(200) }).parse(await c.req.json());
  if (!c.env.SETUP_TOKEN || !constantEqual(b.token, c.env.SETUP_TOKEN))
    throw new DomainError('invalid_setup_token', 'رمز التجهيز غير صحيح.', 403);
  if (
    !c.env.ENCRYPTION_KEY ||
    (c.env.INSTALLATION_MODE !== 'cloudflare-button' &&
      (!c.env.TURNSTILE_SECRET || !(await settings(c.env.DB)).turnstileSiteKey)) ||
    !c.env.OPERATIONS ||
    !(await checkOwnerAuth(c.env))
  )
    throw new DomainError('setup_incomplete', 'تجهيز المتجر غير مكتمل.', 503);
  return c.json({ ok: true });
});
api.post('/auth/setup', async (c) => {
  await rate(c, 5, 900, 'setup');
  const b = z
    .object({
      token: z.string().max(200).optional(),
      email: z.email(),
      password: z.string().min(8).max(128).refine(validNewPassword, PASSWORD_HINT),
      turnstileSiteKey: z.string().max(100).optional(),
      turnstileSecret: z.string().max(255).optional(),
      turnstileToken: z.string().max(4096).optional(),
    })
    .parse(await c.req.json());
  const local =
    c.env.ENVIRONMENT === 'development' &&
    !!c.env.SETUP_TOKEN &&
    constantEqual(b.token || '', c.env.SETUP_TOKEN);
  if (!local && !(await bootstrapAllowed(c)))
    throw new DomainError(
      'setup_link_required',
      'افتح صفحة إنشاء الحساب من رابط إكمال التثبيت الخاص بك.',
      403,
    );
  const button =
    c.env.ENVIRONMENT !== 'development' && c.env.INSTALLATION_MODE === 'cloudflare-button';
  if (button) {
    if (!/^0x[A-Za-z0-9_-]{15,98}$/.test(b.turnstileSiteKey || '') || !b.turnstileSecret)
      throw new DomainError(
        'setup_captcha_required',
        'أضف مفاتيح حماية Cloudflare Turnstile لإكمال التثبيت.',
        400,
      );
    await turnstile(c.env, b.turnstileToken || '', 'setup', {
      secret: b.turnstileSecret,
      origin: new URL(c.req.url).origin,
    });
  }
  requireOwnerAuth(c.env);
  const recovery = Array.from({ length: 8 }, () => random(18));
  const hashes = await Promise.all(recovery.map(digest));
  const password = await ownerPasswordHash(c.env, b.password);
  const create = c.env.DB.prepare('INSERT OR IGNORE INTO admins VALUES(?,?,?,?,?)').bind(
    'owner',
    b.email.toLowerCase(),
    password,
    JSON.stringify(hashes),
    now(),
  );
  const r = button
    ? (
        await c.env.DB.batch([
          c.env.DB.prepare(
            'INSERT INTO credentials SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM admins) ON CONFLICT(name) DO UPDATE SET encrypted=excluded.encrypted WHERE NOT EXISTS(SELECT 1 FROM admins)',
          ).bind('turnstile', await encryptSecret(c.env, b.turnstileSecret!)),
          c.env.DB.prepare(
            "INSERT INTO settings SELECT 1,? WHERE NOT EXISTS(SELECT 1 FROM admins) ON CONFLICT(id) DO UPDATE SET json=json_set(settings.json,'$.turnstileSiteKey',?) WHERE NOT EXISTS(SELECT 1 FROM admins)",
          ).bind(
            JSON.stringify({ ...defaults, turnstileSiteKey: b.turnstileSiteKey }),
            b.turnstileSiteKey,
          ),
          create,
        ])
      )[2]
    : await create.run();
  if (!r.meta.changes) throw new DomainError('already_setup', 'تم إنشاء حساب المالك مسبقًا.', 409);
  await c.env.DB.prepare("DELETE FROM auth_challenges WHERE kind='bootstrap'").run();
  const csrf = await startSession(c, 'owner', { password });
  deleteCookie(c, 'owner_setup', { path: '/api/' });
  return c.json(
    { csrf, recovery, ...(button ? { installationKey: c.env.ENCRYPTION_KEY } : {}) },
    201,
  );
});
api.post('/auth/login', async (c) => {
  await rate(c, 5, 900, 'login');
  const b = z
    .object({
      email: z.email(),
      password: z.string().max(128),
      turnstileToken: z.string().max(4096).default(''),
    })
    .parse(await c.req.json());
  requireOwnerAuth(c.env);
  await turnstile(c.env, b.turnstileToken, 'login', {
    origin: new URL(c.req.url).origin,
  });
  const a = await c.env.DB.prepare('SELECT * FROM admins WHERE email=?')
    .bind(b.email.toLowerCase())
    .first<{ id: string; password: string }>();
  // Same KDF on unknown emails avoids an obvious account-existence timing signal.
  const stored =
    a?.password ||
    (c.env.PASSWORD_HASHER
      ? dummyOwnerHash
      : 'pbkdf2-sha256:600000:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  if (!(await ownerPasswordMatches(c.env, b.password, stored)) || !a)
    throw new DomainError('invalid_login', 'بيانات الدخول غير صحيحة.', 401);
  let verifiedPassword = a.password;
  if (
    c.env.PASSWORD_HASHER
      ? !a.password.startsWith('scrypt:')
      : !a.password.startsWith('pbkdf2-sha256:')
  ) {
    verifiedPassword = await ownerPasswordHash(c.env, b.password);
    const migrated = await c.env.DB.prepare(
      'UPDATE admins SET password=? WHERE id=? AND password=?',
    )
      .bind(verifiedPassword, a.id, a.password)
      .run();
    if (!migrated.meta.changes)
      throw new DomainError('auth_changed', 'تغيرت بيانات الحساب. أعد تسجيل الدخول.', 401);
  }
  return c.json({ csrf: await startSession(c, a.id, { password: verifiedPassword }) });
});
api.post('/auth/recover', async (c) => {
  await rate(c, 5, 900, 'recover');
  const b = z
    .object({
      email: z.email(),
      code: z.string().max(100),
      password: z.string().min(8).max(128).refine(validNewPassword, PASSWORD_HINT),
      turnstileToken: z.string().max(4096).default(''),
    })
    .parse(await c.req.json());
  await turnstile(c.env, b.turnstileToken, 'recover', {
    origin: new URL(c.req.url).origin,
  });
  const a = await c.env.DB.prepare('SELECT id,recovery FROM admins WHERE email=?')
      .bind(b.email.toLowerCase())
      .first<{ id: string; recovery: string }>(),
    hash = await digest(b.code);
  const codes: string[] = a ? JSON.parse(a.recovery) : [];
  if (!a || !codes.includes(hash))
    throw new DomainError('invalid_recovery', 'بيانات الاسترداد غير صحيحة.', 401);
  const recovery = Array.from({ length: 8 }, () => random(18));
  const remaining = JSON.stringify(await Promise.all(recovery.map(digest)));
  const p = await ownerPasswordHash(c.env, b.password);
  const r = await c.env.DB.prepare(
    'UPDATE admins SET password=?,recovery=? WHERE id=? AND recovery=?',
  )
    .bind(p, remaining, a.id, a.recovery)
    .run();
  if (!r.meta.changes) throw new DomainError('recovery_used', 'رمز الاسترداد مستخدم.', 409);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE admin_id=?').bind(a.id),
    c.env.DB.prepare('DELETE FROM passkeys WHERE admin_id=?').bind(a.id),
    c.env.DB.prepare('DELETE FROM auth_challenges WHERE admin_id=?').bind(a.id),
  ]);
  await audit(c.env.DB, a.id, 'account_recovered');
  return c.json({
    csrf: await startSession(c, a.id, { password: p }),
    recovery,
    email: b.email.toLowerCase(),
  });
});
const passkeyResponseSchema = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(2048),
  rawId: z.string().max(2048),
  type: z.literal('public-key'),
  response: z
    .object({
      clientDataJSON: z.string().max(8192),
      attestationObject: z.string().max(32768).optional(),
      authenticatorData: z.string().max(8192).optional(),
      signature: z.string().max(8192).optional(),
      userHandle: z.string().max(2048).nullish(),
      transports: z.array(z.string().max(30)).max(10).optional(),
    })
    .passthrough(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.string().max(30).optional(),
});
api.post('/auth/passkey/options', async (c) => {
  await rate(c, 10, 900, 'passkey_options');
  const { kind } = z.object({ kind: z.enum(['login', 'recover']) }).parse(await c.req.json());
  const challenge = challengeValue();
  await issueChallenge(c, kind, challenge);
  return c.json({
    challenge,
    rpId: new URL(c.env.APP_ORIGIN || c.req.url).hostname,
    userVerification: 'required',
    timeout: 120000,
    allowCredentials: [],
  });
});
api.post('/auth/passkey/verify', async (c) => {
  await rate(c, 5, 900, 'passkey_verify');
  const b = z
    .object({
      kind: z.enum(['login', 'recover']),
      response: passkeyResponseSchema,
      password: z.string().min(8).max(128).refine(validNewPassword, PASSWORD_HINT).optional(),
    })
    .parse(await c.req.json());
  if (b.kind === 'recover' && !b.password)
    throw new DomainError('password_required', 'اختر كلمة مرور جديدة أولًا.');
  const attempt = await consumeChallenge(c, b.kind);
  const origin = new URL(c.env.APP_ORIGIN || c.req.url).origin;
  const key = await c.env.DB.prepare('SELECT * FROM passkeys WHERE id=? AND rp_id=?')
    .bind(b.response.id, new URL(origin).hostname)
    .first<{ id: string; admin_id: string; public_key: string; counter: number }>();
  if (!key)
    throw new DomainError(
      'invalid_passkey',
      'لم يُسجّل هذا المفتاح لهذا المتجر. استخدم كلمة المرور أو ملف الاسترداد.',
      401,
    );
  const result = await verifiedPasskey(c.env, {
    operation: 'passkey-authenticate',
    response: b.response as AuthenticationResponseJSON,
    challenge: attempt.challenge,
    origin,
    credential: { id: key.id, publicKey: key.public_key, counter: key.counter },
  });
  const updated = await c.env.DB.prepare('UPDATE passkeys SET counter=? WHERE id=? AND counter=?')
    .bind(result.counter, key.id, key.counter)
    .run();
  if (!updated.meta.changes)
    throw new DomainError('passkey_changed', 'أعد التحقق من مفتاح الدخول.', 409);
  let recovery: string[] | undefined;
  let recoveredPassword: string | undefined;
  if (b.kind === 'recover') {
    recovery = Array.from({ length: 8 }, () => random(18));
    recoveredPassword = await ownerPasswordHash(c.env, b.password!);
    const update = await c.env.DB.prepare(
      'UPDATE admins SET password=?,recovery=? WHERE id=? AND EXISTS(SELECT 1 FROM passkeys WHERE id=? AND counter=?)',
    )
      .bind(
        recoveredPassword,
        JSON.stringify(await Promise.all(recovery.map(digest))),
        key.admin_id,
        key.id,
        result.counter,
      )
      .run();
    if (!update.meta.changes)
      throw new DomainError('invalid_passkey', 'أُبطل مفتاح الدخول. استخدم ملف الاسترداد.', 401);
    await c.env.DB.prepare('DELETE FROM sessions WHERE admin_id=?').bind(key.admin_id).run();
    await audit(c.env.DB, key.admin_id, 'account_recovered_with_passkey');
  }
  const owner = recovery
    ? await c.env.DB.prepare('SELECT email FROM admins WHERE id=?')
        .bind(key.admin_id)
        .first<{ email: string }>()
    : null;
  return c.json({
    csrf: await startSession(c, key.admin_id, { passkey: key.id, password: recoveredPassword }),
    recovery,
    email: owner?.email,
  });
});
api.get('/products', async (c) => {
  const configured = await settings(c.env.DB);
  const language = requestInterfaceLanguage(c, configured);
  const asPublic = async (rows: Product[]) =>
    (await safeProducts(c.env, rows, configured)).map((p) =>
      publicProduct(localizedProduct(p, language)),
    );
  const ids = c.req.query('ids');
  const q = c.req.query('q')?.trim();
  if (q) {
    await rate(c, 120, 60, 'store_search');
    const supplier = c.req.query('supplier');
    const found = await searchProducts(
      c.env.DB,
      z.string().max(200).parse(q),
      supplier ? z.string().max(100).parse(supplier) : undefined,
    );
    return c.json((await asPublic(found)).filter((p) => found.some((v) => v.id === p.id)));
  }
  const p = ids
    ? (
        await cartProducts(
          c.env.DB,
          z.array(z.string().min(1).max(100)).max(30).parse(ids.split(',')),
        )
      ).filter((p) => p.active)
    : await products(c.env.DB, true);
  return c.json(await asPublic(p));
});
api.get('/cities', async (c) => {
  return c.json(
    (await cities(c.env.DB)).filter((c) => c.is_serviceable !== false).map((c) => c.city),
  );
});
api.get('/orders/attempt/:key', async (c) => {
  await rate(c, 30, 600, 'attempt_lookup');
  const key = z.string().uuid().parse(c.req.param('key'));
  const row = await c.env.DB.prepare('SELECT ref FROM orders WHERE idempotency=?')
    .bind(key)
    .first<{ ref: string }>();
  return c.json({ ref: row?.ref || null });
});
api.post('/checkout/quote', async (c) => {
  await rate(c, 60, 60, 'quote');
  const b = z
    .object({
      cart: cartSchema,
      city: z.string().max(100),
      checkoutMode: z.enum(['cart', 'direct']).default('cart'),
    })
    .parse(await c.req.json());
  return c.json(await makeQuote(c.env, b.cart, b.city, b.checkoutMode));
});
api.post('/orders', async (c) => {
  await rate(c, 10, 600, 'orders');
  const b = orderSchema.parse(await c.req.json()),
    customer = customerInput(b.customer);
  const requestHash = await digest(
    JSON.stringify({ cart: b.cart, customer, fingerprint: b.fingerprint }),
  );
  const existing = await c.env.DB.prepare('SELECT * FROM orders WHERE idempotency=?')
    .bind(b.idempotency)
    .first<OrderRow>();
  if (existing) {
    if (existing.request_hash !== requestHash)
      throw new DomainError('idempotency_conflict', 'معرف الطلب مستخدم لمحتويات أخرى.', 409);
    return c.json({ ref: existing.ref });
  }
  customer.city = canonicalCity(customer.city, await cities(c.env.DB));
  await turnstile(c.env, b.turnstileToken, 'order', {
    origin: new URL(c.req.url).origin,
  });
  const q = await makeQuote(c.env, b.cart, customer.city, b.checkoutMode);
  if (q.fingerprint !== b.fingerprint)
    throw new DomainError('quote_changed', 'تغير الإجمالي. راجع السلة ثم أعد المحاولة.', 409);
  const s = await settings(c.env.DB);
  if (!s.contractVerified)
    throw new DomainError(
      'supplier_contract_missing',
      'المنتجات غير جاهزة لاستقبال الطلبات بعد.',
      503,
    );
  q.storeIdentity = storeIdentity(c.env, s.brand, c.req.url);
  q.merchantPricing = merchantPricingSnapshot(
    q,
    await cartProducts(
      c.env.DB,
      q.items.map((item) => item.productId),
    ),
    platformShipping(customer.city, await cities(c.env.DB)),
    now(),
  );
  const id = 'STORE-' + crypto.randomUUID(),
    ref = 'REF-' + crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(),
    at = now();
  const allowed = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'utm_id',
    'fbclid',
    'ttclid',
    'gclid',
    'ScCid',
    'timestamp',
    'landing',
    'referrer',
  ];
  const safeAttr = Object.fromEntries(
    Object.entries(b.attribution).map(([touch, value]) => [
      touch,
      Object.fromEntries(Object.entries(value).filter(([k]) => allowed.includes(k))),
    ]),
  );
  const matching = {
    trackingEnabled: s.trackingEnabled,
    fbp: s.trackingEnabled ? b.matching.fbp || '' : '',
    fbc: s.trackingEnabled ? b.matching.fbc || '' : '',
    ip: s.trackingEnabled ? c.req.header('CF-Connecting-IP') || '' : undefined,
    agent: s.trackingEnabled ? c.req.header('User-Agent')?.slice(0, 500) : undefined,
  };
  const statements = [
    c.env.DB.prepare(
      'INSERT INTO orders(id,ref,idempotency,request_hash,customer,supplier,quote,attribution,matching,status,sync_status,created_at,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(
      id,
      ref,
      b.idempotency,
      requestHash,
      JSON.stringify(customer),
      q.supplier,
      JSON.stringify(q),
      JSON.stringify(safeAttr),
      JSON.stringify(matching),
      s.autoConfirm ? 'confirmed' : 'pending_confirmation',
      s.autoConfirm ? 'queued' : 'not_sent',
      at,
      s.autoConfirm ? at : null,
    ),
    ...q.items.map((i) =>
      c.env.DB.prepare('INSERT INTO order_items VALUES(?,?,?,?,?,?,?)').bind(
        crypto.randomUUID(),
        id,
        i.productId,
        i.sku,
        i.quantity,
        i.unitPrice,
        JSON.stringify(i),
      ),
    ),
    ...(s.autoConfirm
      ? [
          c.env.DB.prepare(
            'INSERT INTO jobs(id,type,order_id,run_at,created_at) VALUES(?,?,?,?,?)',
          ).bind('submit:' + id, 'submit', id, Date.now(), at),
        ]
      : []),
  ];
  const metaPixels = await metaConfiguredPixels(c.env);
  if (metaPixels.length) {
    let source: string;
    try {
      source = metaPageUrl(c.req.url, b.matching.path || '/checkout');
    } catch {
      source = new URL(c.req.url).origin + '/checkout';
    }
    for (const metaPixel of metaPixels)
      statements.push(
        await metaEventStatement(c.env, metaPixel, {
          event_name: 'Lead',
          event_id: 'lead:' + ref,
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: source,
          user_data: {
            ph: [await digest('212' + customer.phone.slice(1))],
            ...(matching.fbp ? { fbp: matching.fbp } : {}),
            ...(matching.fbc ? { fbc: matching.fbc } : {}),
            ...(matching.ip ? { client_ip_address: matching.ip } : {}),
            ...(matching.agent ? { client_user_agent: matching.agent } : {}),
          },
          custom_data: { currency: 'MAD', value: q.total / 100 },
        }),
      );
  }
  try {
    await c.env.DB.batch(statements);
  } catch (e) {
    const raced = await c.env.DB.prepare('SELECT ref,request_hash FROM orders WHERE idempotency=?')
      .bind(b.idempotency)
      .first<{ ref: string; request_hash: string }>();
    if (raced?.request_hash === requestHash) return c.json({ ref: raced.ref });
    throw e;
  }
  if (metaPixels.length) c.executionCtx.waitUntil(flushMetaEvents(c.env).catch(() => {}));
  // Checkout succeeds once the order and its submission outbox commit. The
  // supplier's network latency must not keep the customer waiting for success.
  if (s.autoConfirm) c.executionCtx.waitUntil(dispatchSubmission(c.env, id));
  return c.json({ ref }, 201);
});
api.post('/visits', async (c) => {
  await rate(c, 60, 60, 'visits');
  const b = z
    .object({
      session: z.string().uuid(),
      source: z.string().max(100),
      campaign: z.string().max(200),
      stage: z.enum(['visit', 'checkout']).default('visit'),
      attribution: z.record(z.string().max(50), z.string().max(500)).default({}),
    })
    .parse(await c.req.json());
  const allowed = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'utm_id',
    'fbclid',
    'gclid',
    'ttclid',
    'ScCid',
    'landing',
    'referrer',
    'timestamp',
  ];
  const attr = Object.fromEntries(
    Object.entries(b.attribution).filter(([k]) => allowed.includes(k)),
  );
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO visits(key,date,source,campaign,stage,attribution) VALUES(?,?,?,?,?,?)',
  )
    .bind(
      await digest([b.session, businessDate(), b.source, b.campaign, b.stage].join(':')),
      businessDate(),
      b.source || 'direct',
      b.campaign || '',
      b.stage,
      JSON.stringify(attr),
    )
    .run();
  return c.json({ ok: true });
});
api.use('/admin/*', async (c, next) => {
  const ss = await session(c);
  if (!ss) throw new DomainError('unauthorized', 'سجل الدخول أولًا.', 401);
  if (c.req.method !== 'GET' && c.req.header('X-CSRF-Token') !== ss.csrf)
    throw new DomainError('csrf_failed', 'انتهت صلاحية الجلسة. أعد تسجيل الدخول.', 403);
  c.set('admin', ss.admin_id);
  c.set('csrf', ss.csrf);
  await next();
});
api.post('/admin/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});
api.get('/admin/account', async (c) =>
  c.json(
    await c.env.DB.prepare('SELECT email FROM admins WHERE id=?').bind(c.get('admin')).first(),
  ),
);
api.get('/admin/passkeys', async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        'SELECT id,name,rp_id,created_at FROM passkeys WHERE admin_id=? ORDER BY created_at DESC',
      )
        .bind(c.get('admin'))
        .all()
    ).results,
  ),
);
api.post('/admin/passkeys/options', async (c) => {
  await rate(c, 5, 900, 'passkey_register');
  const b = z.object({ current: z.string().max(128) }).parse(await c.req.json());
  const a = await c.env.DB.prepare('SELECT email,password FROM admins WHERE id=?')
    .bind(c.get('admin'))
    .first<{ email: string; password: string }>();
  if (!a || !(await ownerPasswordMatches(c.env, b.current, a.password)))
    throw new DomainError('invalid_password', 'كلمة المرور الحالية غير صحيحة.', 401);
  const keys = (
    await c.env.DB.prepare('SELECT id,transports FROM passkeys WHERE admin_id=?')
      .bind(c.get('admin'))
      .all<{ id: string; transports: string }>()
  ).results;
  if (keys.length >= 5)
    throw new DomainError('passkey_limit', 'يمكن حفظ خمسة مفاتيح دخول. احذف مفتاحًا قديمًا أولًا.');
  const challenge = challengeValue();
  await issueChallenge(c, 'register', challenge, c.get('admin'), c.get('csrf'));
  return c.json({
    challenge,
    rp: {
      id: new URL(c.env.APP_ORIGIN || c.req.url).hostname,
      name: (await settings(c.env.DB)).brand || 'إدارة المتجر',
    },
    user: { id: btoa(c.get('admin')).replaceAll('=', ''), name: a.email, displayName: a.email },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    timeout: 120000,
    attestation: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: keys.map((k) => ({
      id: k.id,
      type: 'public-key',
      transports: JSON.parse(k.transports),
    })),
  });
});
api.post('/admin/passkeys/verify', async (c) => {
  const b = z
    .object({ response: passkeyResponseSchema, name: z.string().min(1).max(80) })
    .parse(await c.req.json());
  const attempt = await consumeChallenge(c, 'register', c.get('csrf'));
  if (attempt.admin_id !== c.get('admin'))
    throw new DomainError('invalid_passkey', 'التحقق غير صالح.', 401);
  const origin = new URL(c.env.APP_ORIGIN || c.req.url).origin;
  const key = await verifiedPasskey(c.env, {
    operation: 'passkey-register',
    response: b.response as RegistrationResponseJSON,
    challenge: attempt.challenge,
    origin,
  });
  if (!key.id || !key.publicKey)
    throw new DomainError('invalid_passkey', 'تعذر تسجيل مفتاح الدخول.', 401);
  const r = await c.env.DB.prepare(
    'INSERT INTO passkeys SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM passkeys WHERE admin_id=?)<5 ON CONFLICT(id) DO NOTHING',
  )
    .bind(
      key.id,
      c.get('admin'),
      key.publicKey,
      key.counter,
      JSON.stringify(key.transports),
      new URL(origin).hostname,
      b.name,
      now(),
      c.get('admin'),
    )
    .run();
  if (!r.meta.changes)
    throw new DomainError('passkey_limit', 'المفتاح موجود بالفعل أو بلغت الحد المسموح.', 409);
  await audit(c.env.DB, c.get('admin'), 'passkey_registered');
  return c.json({ ok: true }, 201);
});
api.delete('/admin/passkeys/:id', async (c) => {
  const b = z.object({ current: z.string().max(128) }).parse(await c.req.json());
  const a = await c.env.DB.prepare('SELECT password FROM admins WHERE id=?')
    .bind(c.get('admin'))
    .first<{ password: string }>();
  if (!a || !(await ownerPasswordMatches(c.env, b.current, a.password)))
    throw new DomainError('invalid_password', 'كلمة المرور الحالية غير صحيحة.', 401);
  await c.env.DB.prepare('DELETE FROM passkeys WHERE id=? AND admin_id=?')
    .bind(c.req.param('id'), c.get('admin'))
    .run();
  await audit(c.env.DB, c.get('admin'), 'passkey_revoked');
  return c.json({ ok: true });
});
api.post('/admin/password', async (c) => {
  const b = z
    .object({
      current: z.string().max(128),
      password: z.string().min(8).max(128).refine(validNewPassword, PASSWORD_HINT),
    })
    .parse(await c.req.json());
  const a = await c.env.DB.prepare('SELECT password,email FROM admins WHERE id=?')
    .bind(c.get('admin'))
    .first<{ password: string; email: string }>();
  if (!a || !(await ownerPasswordMatches(c.env, b.current, a.password)))
    throw new DomainError('invalid_password', 'كلمة المرور الحالية غير صحيحة.');
  const codes = Array.from({ length: 8 }, () => random(18));
  const password = await ownerPasswordHash(c.env, b.password);
  const changed = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE admins SET password=?,recovery=? WHERE id=? AND password=?').bind(
      password,
      JSON.stringify(await Promise.all(codes.map(digest))),
      c.get('admin'),
      a.password,
    ),
    c.env.DB.prepare('DELETE FROM sessions WHERE admin_id=?').bind(c.get('admin')),
  ]);
  if (!changed[0].meta.changes)
    throw new DomainError('auth_changed', 'تغيرت كلمة المرور. أعد تسجيل الدخول.', 401);
  return c.json({
    csrf: await startSession(c, c.get('admin'), { password }),
    recovery: codes,
    email: a.email,
  });
});
api.get('/admin/settings', async (c) => {
  const r = await c.env.DB.prepare('SELECT name FROM credentials').all<{ name: string }>();
  const delivery = await shippingCosts(c.env).catch(() => null);
  return c.json({
    settings: await settings(c.env.DB),
    credentials: r.results.map((r) => r.name),
    sync: await state(c.env.DB, 'catalog_last'),
    backup: await state(c.env.DB, 'backup_last'),
    maximumShipping: delivery?.maximum ?? null,
    shippingCosts: delivery,
  });
});
api.get('/admin/notices', async (c) => {
  const [usage, size, backup, purchase] = await Promise.all([
    c.env.DB.prepare('SELECT reads,writes FROM metrics WHERE date=?')
      .bind(new Date().toISOString().slice(0, 10))
      .first<{ reads: number; writes: number }>(),
    c.env.DB.prepare('SELECT SUM(size) total FROM media').first<{ total: number | null }>(),
    c.env.DB.prepare(
      "SELECT status FROM jobs WHERE type='backup' ORDER BY created_at DESC,rowid DESC LIMIT 1",
    ).first<{ status: string }>(),
    c.env.DB.prepare(
      "SELECT jobs.id,jobs.last_error FROM jobs JOIN orders ON orders.id=jobs.order_id WHERE jobs.type='purchase' AND jobs.status='failed' AND orders.shipping_status IN ('delivered','paid') LIMIT 1",
    ).first<{ id: string; last_error: string }>(),
  ]);
  const notices: { id: string; message: string; action?: string }[] = [];
  if (
    (usage?.reads || 0) >= 4_000_000 ||
    (usage?.writes || 0) >= 80_000 ||
    (size?.total || 0) >= 7_000_000_000
  )
    notices.push({
      id: 'capacity',
      message:
        'اقترب المتجر من حدود خطة Cloudflare المجانية. راجع استخدام حسابك لتجنب توقف الخدمة.',
      action: 'cloudflare',
    });
  if (backup?.status === 'failed')
    notices.push({
      id: 'backup',
      message: 'تعذر حفظ نسخة الأمان الأخيرة لبيانات المتجر. أعد المحاولة.',
      action: 'backup',
    });
  const pixelSettings = purchase ? await settings(c.env.DB) : null;
  if (purchase && pixelSettings?.trackingEnabled && pixelSettings.facebookPixel)
    notices.push({
      id: 'purchase',
      message:
        purchase.last_error === 'meta_rejected_401'
          ? 'رفضت Meta رمز CAPI. احفظ رمزًا صالحًا للبكسل في صفحة البكسلات؛ ستُعاد محاولة الأحداث المؤهلة.'
          : 'لم يكتمل إرسال بعض أحداث الشراء إلى Meta. راجع إعداد حدث الشراء في صفحة البكسلات، ثم أعد المحاولة.',
      action: 'pixels',
    });
  const paused = await state(c.env.DB, 'pricing_paused');
  if (paused?.products?.length)
    notices.push({
      id: 'pricing',
      message:
        'توقف بيع بعض المنتجات أو العروض لأن السعر لا يغطي تكاليف مورد. راجع أسعارها وإعدادات التوصيل.',
      action: 'products',
    });
  return c.json(notices);
});
api.get('/admin/pixels/status', async (c) => {
  const configured = await settings(c.env.DB),
    token = await credential(c.env, 'meta'),
    health = await state(c.env.DB, 'meta_health');
  const currentHealth =
    token &&
    configured.facebookPixel &&
    health?.fingerprint === (await digest(configured.facebookPixel + ':' + token))
      ? health
      : null;
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) delivered,SUM(o.delivered_at IS NOT NULL) eligible,SUM(j.status='done') sent,SUM(j.status='failed') failed,MAX(CASE WHEN j.status='done' THEN j.created_at END) lastSuccess FROM orders o LEFT JOIN jobs j ON j.order_id=o.id AND j.type='purchase' WHERE o.shipping_status IN ('delivered','paid')",
  ).first<{
    delivered: number;
    eligible: number;
    sent: number;
    failed: number;
    lastSuccess: string | null;
  }>();
  return c.json({
    additional: await Promise.all(
      configured.facebookAdditionalPixels.map(async (destination) => {
        const pixel = destination.pixel,
          name = metaCredentialName(configured, pixel);
        const token = await credential(c.env, name),
          health = await state(c.env.DB, metaHealthName(configured, pixel));
        const current =
          token && health?.fingerprint === (await digest(pixel + ':' + token)) ? health : null;
        return {
          ...destination,
          saved: !!token,
          connection: !destination.enabled
            ? 'disabled'
            : !token
              ? 'not_configured'
              : current?.errorCode
                ? 'rejected'
                : current?.lastSuccess
                  ? 'connected'
                  : 'awaiting_event',
          errorCode: current?.errorCode || null,
          lastSuccess: current?.lastSuccess || null,
          events: await c.env.DB.prepare(
            "SELECT COUNT(CASE WHEN status='sent' THEN 1 END) sent,COUNT(CASE WHEN status IN ('pending','running') THEN 1 END) pending,COUNT(CASE WHEN status='failed' THEN 1 END) failed FROM meta_events WHERE pixel_id=?",
          )
            .bind(pixel)
            .first(),
        };
      }),
    ),
    web: await c.env.DB.prepare(
      "SELECT COUNT(CASE WHEN status='sent' THEN 1 END) sent,COUNT(CASE WHEN status IN ('pending','running') THEN 1 END) pending,COUNT(CASE WHEN status='failed' THEN 1 END) failed FROM meta_events WHERE pixel_id=?",
    )
      .bind(configured.facebookPixel)
      .first(),
    delivered: row?.delivered || 0,
    eligible: row?.eligible || 0,
    sent: row?.sent || 0,
    failed: row?.failed || 0,
    awaiting: Math.max(0, (row?.eligible || 0) - (row?.sent || 0) - (row?.failed || 0)),
    connection:
      !configured.facebookPixel || !token
        ? 'not_configured'
        : currentHealth?.errorCode
          ? 'rejected'
          : currentHealth?.lastSuccess
            ? 'connected'
            : 'awaiting_event',
    lastSuccess: currentHealth?.lastSuccess || null,
    errorCode: currentHealth?.errorCode || null,
  });
});
api.post('/admin/pixels/test', async (c) => {
  await rate(c, 10, 60, 'meta_test');
  const { testEventCode, pixel: selected } = z
    .object({
      testEventCode: z.string().regex(/^TEST\d{3,20}$/),
      pixel: z
        .string()
        .regex(/^\d{5,30}$/)
        .optional(),
    })
    .parse(await c.req.json());
  const configured = await metaConfiguredPixels(c.env);
  const pixel = selected || (await settings(c.env.DB)).facebookPixel;
  if (!configured.includes(pixel))
    throw new DomainError('meta_not_configured', 'احفظ معرّف البكسل ورمز CAPI أولًا.');
  try {
    return c.json(
      await sendMetaEvent(
        c.env,
        pixel,
        {
          event_name: 'PageView',
          event_id: 'test:' + crypto.randomUUID(),
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: new URL(c.req.url).origin + '/',
          user_data: {
            client_user_agent: (c.req.header('User-Agent') || '').slice(0, 500),
            ...(c.req.header('CF-Connecting-IP')
              ? { client_ip_address: c.req.header('CF-Connecting-IP')! }
              : {}),
          },
        },
        testEventCode,
      ),
    );
  } catch (error) {
    if (error instanceof RemoteError)
      throw new DomainError(
        error.code,
        'لم تقبل Meta حدث الاختبار. راجع صلاحية رمز CAPI ومعرّف البكسل ورمز الاختبار.',
        502,
      );
    throw error;
  }
});
api.post('/admin/pixels/retry', async (c) => {
  const { pixel } = z
    .object({
      pixel: z
        .string()
        .regex(/^\d{5,30}$/)
        .optional(),
    })
    .parse(await c.req.json());
  if (!pixel || pixel === (await settings(c.env.DB)).facebookPixel)
    await retryPurchaseEvents(c.env);
  await retryMetaEvents(c.env, pixel);
  c.executionCtx.waitUntil(flushMetaEvents(c.env).catch(() => {}));
  return c.json({ ok: true });
});
api.patch('/admin/language', async (c) => {
  const body = z
    .object({ scope: z.enum(['admin', 'store']), language: z.enum(['ar', 'fr', 'en']) })
    .strict()
    .parse(await c.req.json());
  const current = await settings(c.env.DB);
  if (body.scope === 'store') {
    const enabled = enabledStoreLanguages(current);
    const selected =
      enabled.length === 1 ? [body.language] : [...new Set([...enabled, body.language])];
    await c.env.DB.prepare(
      "INSERT INTO settings(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=json_set(settings.json,'$.storeLanguage',?,'$.storeLanguages',json(?))",
    )
      .bind(
        JSON.stringify({ ...current, storeLanguage: body.language, storeLanguages: selected }),
        body.language,
        JSON.stringify(selected),
      )
      .run();
    await audit(c.env.DB, c.get('admin'), 'language_changed', 'store:' + body.language);
    return c.json({ ok: true, storeLanguage: body.language, storeLanguages: selected });
  }
  const key = 'adminLanguage';
  await c.env.DB.prepare(
    'INSERT INTO settings(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=json_set(settings.json,?,?)',
  )
    .bind(JSON.stringify({ ...current, [key]: body.language }), '$.' + key, body.language)
    .run();
  await audit(c.env.DB, c.get('admin'), 'language_changed', body.scope + ':' + body.language);
  return c.json({ ok: true });
});
api.patch('/admin/store-languages', async (c) => {
  const body = z
    .object({
      storeLanguage: z.enum(['ar', 'fr', 'en']),
      storeLanguages: z
        .array(z.enum(['ar', 'fr', 'en']))
        .min(1)
        .max(3),
    })
    .strict()
    .refine(
      (value) => value.storeLanguages.includes(value.storeLanguage),
      'اختر لغة افتراضية من اللغات المفعّلة.',
    )
    .parse(await c.req.json());
  const selected = [...new Set(body.storeLanguages)],
    current = await settings(c.env.DB);
  await c.env.DB.prepare(
    "INSERT INTO settings(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=json_set(settings.json,'$.storeLanguage',?,'$.storeLanguages',json(?))",
  )
    .bind(
      JSON.stringify({ ...current, ...body, storeLanguages: selected }),
      body.storeLanguage,
      JSON.stringify(selected),
    )
    .run();
  await audit(c.env.DB, c.get('admin'), 'store_languages_changed', selected.join(','));
  return c.json({ storeLanguage: body.storeLanguage, storeLanguages: selected });
});
api.delete('/admin/checkout-offers/:id', async (c) => {
  const id = z.string().max(100).parse(c.req.param('id'));
  await c.env.DB.prepare(
    "UPDATE settings SET json=json_set(json,'$.checkoutOffers',json(COALESCE((SELECT json_group_array(json(value)) FROM json_each(settings.json,'$.checkoutOffers') WHERE json_extract(value,'$.id')<>?),'[]'))) WHERE id=1",
  )
    .bind(id)
    .run();
  await audit(c.env.DB, c.get('admin'), 'legacy_checkout_offer_deleted', id);
  return c.json({ ok: true });
});
api.put('/admin/settings', async (c) => {
  const old = await settings(c.env.DB),
    body = await c.req.json(),
    s = settingsSchema.parse(body);
  s.metaVersion = META_GRAPH_VERSION;
  s.landingTheme =
    old.landingTheme ||
    (Object.keys(old.theme).some(
      (key) => s.theme[key as keyof typeof s.theme] !== old.theme[key as keyof typeof s.theme],
    )
      ? old.theme
      : s.landingTheme);
  if (!Object.hasOwn(body, 'productInfo')) s.productInfo = old.productInfo;
  if (!Object.hasOwn(body, 'branding')) s.branding = old.branding;
  if (!Object.hasOwn(body, 'typography')) s.typography = old.typography;
  if (!Object.hasOwn(body, 'googleAdsId')) s.googleAdsId = old.googleAdsId;
  if (!Object.hasOwn(body, 'googleAdsLeadLabel')) s.googleAdsLeadLabel = old.googleAdsLeadLabel;
  if (!Object.hasOwn(body, 'facebookAdditionalPixels')) {
    s.facebookAdditionalPixels = old.facebookAdditionalPixels;
    settingsSchema.parse(s);
  }
  if (!body.home || !Object.hasOwn(body.home, 'showNavigation'))
    s.home.showNavigation = old.home.showNavigation;
  if (!body.home || !Object.hasOwn(body.home, 'showSearch'))
    s.home.showSearch = old.home.showSearch;
  if (!body.home || !Object.hasOwn(body.home, 'showPriceSort'))
    s.home.showPriceSort = old.home.showPriceSort;
  if (!body.home || !Object.hasOwn(body.home, 'heroCardImages'))
    s.home.heroCardImages = old.home.heroCardImages;
  if (!body.home || !Object.hasOwn(body.home, 'licenseCard'))
    s.home.licenseCard = old.home.licenseCard;
  for (const key of ['contactEmail', 'contactPhone', 'socials', 'checkoutOffers'] as const)
    if (!Object.hasOwn(body, key)) (s as any)[key] = old[key];
  for (const key of ['adminLanguage', 'storeLanguage', 'contentTranslations'] as const)
    if (!Object.hasOwn(body, key)) (s as any)[key] = old[key];
  if (!Object.hasOwn(body, 'storeLanguages')) {
    const enabled = enabledStoreLanguages(old);
    s.storeLanguages =
      enabled.length === 1 && s.storeLanguage !== old.storeLanguage
        ? [s.storeLanguage]
        : [...new Set([...enabled, s.storeLanguage])];
  }
  if (!Object.hasOwn(body, 'cartFreeShippingThreshold'))
    s.cartFreeShippingThreshold = old.cartFreeShippingThreshold;
  if (
    s.cartFreeShippingThreshold !== old.cartFreeShippingThreshold ||
    s.shippingCasa !== old.shippingCasa ||
    s.shippingOther !== old.shippingOther
  ) {
    const all = await products(c.env.DB),
      maximum = await maximumShipping(c.env);
    for (const p of all.filter((p) => p.active && p.verified)) {
      try {
        assertPublishedPrices(p.price, p.offers, p.fulfillment, s, p, maximum);
        if (
          p.presentation?.promotion &&
          (!p.presentation.promotion.endsAt ||
            Date.parse(p.presentation.promotion.endsAt) > Date.now())
        )
          assertPublishedPrices(
            p.presentation.promotion.price,
            p.offers,
            p.fulfillment,
            s,
            p,
            maximum,
          );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        throw new DomainError(error.code, p.name + ': ' + error.message, 400, [
          { field: 'cartFreeShippingThreshold', label: 'إعدادات التوصيل', message: error.message },
        ]);
      }
    }
  }
  s.checkoutOffers = [];
  s.contractVerified = old.contractVerified && s.supplierField === old.supplierField;
  s.trackingEnabled = !!(
    metaPixelIds(s).length ||
    s.tiktokPixel ||
    s.googleId ||
    s.googleAdsId ||
    s.snapPixel
  );
  const stmts = [
    c.env.DB.prepare(
      'INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
    ).bind(JSON.stringify(s)),
  ];
  for (const removed of old.facebookAdditionalPixels.filter(
    (p) => !s.facebookAdditionalPixels.some((next) => next.pixel === p.pixel),
  )) {
    stmts.push(
      c.env.DB.prepare('DELETE FROM credentials WHERE name=?').bind('meta:' + removed.pixel),
    );
    stmts.push(
      c.env.DB.prepare('DELETE FROM sync_state WHERE name=?').bind('meta_health:' + removed.pixel),
    );
  }
  if (s.supplierField !== old.supplierField)
    stmts.push(c.env.DB.prepare('UPDATE products SET verified=0,revision=revision+1'));
  await c.env.DB.batch(stmts);
  if (
    s.trackingEnabled !== old.trackingEnabled ||
    s.facebookPixel !== old.facebookPixel ||
    s.metaVersion !== old.metaVersion
  )
    await retryPurchaseEvents(c.env);
  await reviewPrices(c.env);
  await audit(c.env.DB, c.get('admin'), 'settings_updated');
  return c.json({ ok: true });
});
api.put('/admin/credentials', async (c) => {
  const b = credentialsSchema.parse(await c.req.json());
  const configured = await settings(c.env.DB);
  const selectedMeta = b.metaPixel ? metaCredentialName(configured, b.metaPixel) : 'meta';
  if (b.metaPixel && !selectedMeta)
    throw new DomainError('meta_not_configured', 'احفظ معرّف البكسل أولًا.');
  for (const [k, v] of Object.entries(b))
    if (v && k !== 'metaPixel') {
      await saveCredential(c.env, k === 'meta' ? selectedMeta : k, v);
      if (k === 'mowarid') {
        const s = await settings(c.env.DB);
        s.contractVerified = false;
        await c.env.DB.batch([
          c.env.DB.prepare(
            'INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
          ).bind(JSON.stringify(s)),
          c.env.DB.prepare('UPDATE products SET verified=0,revision=revision+1'),
        ]);
        await setState(c.env.DB, 'supplier_contract', { source: 'unverified' });
        await setState(c.env.DB, 'catalog_cursor', { cursor: '', since: '' });
        await setState(c.env.DB, 'catalog_pending', null);
        await c.env.DB.prepare(
          "DELETE FROM sync_state WHERE name IN ('tracking_progress','tracking_checkpoint','tracking_last')",
        ).run();
      }
    }
  await audit(c.env.DB, c.get('admin'), 'credentials_updated');
  if (b.mowarid) {
    await queueWebhookConnection(c.env, true);
    if (c.env.OPERATIONS) {
      const stub = c.env.OPERATIONS.get(c.env.OPERATIONS.idFromName('store'));
      c.executionCtx.waitUntil(
        stub.fetch('https://operations.internal/jobs', { method: 'POST' }).then(() => {}),
      );
    }
  }
  if (b.meta) {
    if (selectedMeta === 'meta') await retryPurchaseEvents(c.env);
    await retryMetaEvents(c.env, b.metaPixel || configured.facebookPixel);
    c.executionCtx.waitUntil(flushMetaEvents(c.env).catch(() => {}));
  }
  return c.json({ ok: true });
});
api.post('/admin/connection', async (c) => {
  const data = await mowarid(c.env, '/orders?action=ping');
  if (data.success !== true) throw new DomainError('health_failed', 'فشل فحص الاتصال.');
  return c.json({ ok: true, scopes: data.scopes || [] });
});
api.get('/admin/integration/status', async (c) => {
  const s = await settings(c.env.DB);
  const latest = await c.env.DB.prepare(
    "SELECT status,last_error FROM jobs WHERE type='catalog' ORDER BY created_at DESC LIMIT 1",
  ).first<{ status: string; last_error: string | null }>();
  const active = await c.env.DB.prepare(
    "SELECT id FROM jobs WHERE type IN ('catalog','cities') AND status IN ('pending','running') LIMIT 1",
  ).first();
  const count = await c.env.DB.prepare('SELECT COUNT(*) count FROM catalog').first<{
    count: number;
  }>();
  const last = await state(c.env.DB, 'catalog_last');
  const webhook = await state(c.env.DB, 'webhook_subscription');
  return c.json({
    ready: s.contractVerified,
    syncing: !!active,
    products: count?.count || 0,
    lastUpdated: last?.at || null,
    error:
      latest?.status === 'failed' ? 'تعذر تحديث منتجات مورد. افحص الاتصال ثم أعد المزامنة.' : null,
    liveUpdates: await webhookReady(c.env),
    liveUpdatesStatus: webhook?.status || 'waiting',
    liveUpdatesError:
      webhook?.status === 'error'
        ? 'لم يكتمل الاتصال بالتحديث المباشر. تستمر متابعة الطلبات بالمزامنة الاحتياطية.'
        : null,
  });
});
api.post('/admin/integration/webhooks', async (c) => {
  if (!(await queueWebhookConnection(c.env, true)))
    throw new DomainError('webhook_setup_unavailable', 'احفظ مفتاح مورد على متجرك المنشور أولًا.');
  await audit(c.env.DB, c.get('admin'), 'webhook_connection_requested');
  if (c.env.OPERATIONS) {
    const stub = c.env.OPERATIONS.get(c.env.OPERATIONS.idFromName('store'));
    c.executionCtx.waitUntil(
      stub.fetch('https://operations.internal/jobs', { method: 'POST' }).then(() => {}),
    );
  }
  return c.json({ ok: true });
});
api.post('/admin/integration/sync', async (c) => {
  if (!(await credential(c.env, 'mowarid')))
    throw new DomainError('key_required', 'احفظ مفتاح مورد أولًا.');
  await c.env.DB.batch(
    ['catalog', 'cities'].map((type) =>
      c.env.DB.prepare(
        "INSERT INTO jobs(id,type,order_id,run_at,created_at) SELECT ?,?,NULL,?,? WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE type=? AND order_id IS NULL AND status IN ('pending','running'))",
      ).bind(crypto.randomUUID(), type, Date.now(), now(), type),
    ),
  );
  await audit(c.env.DB, c.get('admin'), 'catalog_sync_requested');
  if (c.env.OPERATIONS) {
    const stub = c.env.OPERATIONS.get(c.env.OPERATIONS.idFromName('store'));
    c.executionCtx.waitUntil(
      stub.fetch('https://operations.internal/jobs', { method: 'POST' }).then(() => {}),
    );
  }
  return c.json({ ok: true });
});
api.post('/admin/contract', async (c) => {
  const s = await settings(c.env.DB);
  if (!s.supplierField)
    throw new DomainError('supplier_field_required', 'حدد المسار الفعلي لحقل المورد أولًا.');
  const data = await mowarid(c.env, '/products?limit=1');
  const p = data.products?.[0];
  if (
    data.success !== true ||
    !p ||
    !supplierKey(p, s.supplierField) ||
    (Array.isArray(p.variants) && p.variants.some((v: unknown) => !supplierKey(v, s.supplierField)))
  )
    throw new DomainError(
      'supplier_contract_missing',
      'استجابة الكتالوج لا تحتوي هوية مورد صالحة في الحقل المحدد.',
    );
  s.contractVerified = true;
  await setState(c.env.DB, 'supplier_contract', {
    source: 'api',
    field: s.supplierField,
    verifiedAt: now(),
  });
  await c.env.DB.prepare(
    'INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
  )
    .bind(JSON.stringify(s))
    .run();
  await setState(c.env.DB, 'catalog_cursor', { cursor: '', since: '' });
  await setState(c.env.DB, 'catalog_pending', null);
  await enqueue(c.env, 'catalog');
  await audit(c.env.DB, c.get('admin'), 'supplier_contract_verified');
  return c.json({ ok: true, supplier: supplierKey(p, s.supplierField), sku: p.sku });
});
api.post('/admin/sync/:type', async (c) => {
  const type = c.req.param('type');
  if (!['catalog', 'cities', 'backup'].includes(type))
    throw new DomainError('invalid_job', 'عملية غير صالحة.');
  await enqueue(c.env, type);
  return c.json({ ok: true }, 202);
});
api.post('/admin/jobs/run', async (c) => {
  if (c.env.OPERATIONS) {
    const stub = c.env.OPERATIONS.get(c.env.OPERATIONS.idFromName('store'));
    const response = await stub.fetch('https://operations.internal/jobs', { method: 'POST' });
    if (!response.ok)
      throw new DomainError('jobs_unavailable', 'تعذر تشغيل المهام. راجع حالتها.', 503);
  } else await runJobs(c.env, 1);
  return c.json({ ok: true });
});
api.get('/admin/jobs', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100').all();
  return c.json(r.results);
});
api.post('/admin/jobs/:id/retry', async (c) => {
  const r = await c.env.DB.prepare(
    "UPDATE jobs SET status='pending',attempts=0,run_at=?,last_error=NULL WHERE id=? AND status='failed'",
  )
    .bind(Date.now(), c.req.param('id'))
    .run();
  if (!r.meta.changes) throw new DomainError('job_not_failed', 'المهمة ليست متوقفة.');
  await audit(c.env.DB, c.get('admin'), 'job_retry', c.req.param('id'));
  return c.json({ ok: true });
});
api.get('/admin/catalog/skus', async (c) => {
  const rows = await c.env.DB.prepare('SELECT sku FROM catalog ORDER BY sku').all<{
    sku: string;
  }>();
  return c.json({ skus: rows.results.map((row) => row.sku) });
});
api.post('/admin/catalog/import', async (c) => {
  const body = catalogImportSchema.parse(await c.req.json());
  if (c.env.OPERATIONS) {
    const stub = c.env.OPERATIONS.get(c.env.OPERATIONS.idFromName('catalog-import'));
    const response = await stub.fetch('https://operations.internal/catalog-import', {
      method: 'POST',
      body: JSON.stringify({ ...body, admin: c.get('admin') }),
    });
    if (!response.ok)
      throw new DomainError(
        'catalog_import_retry',
        'تعذر إكمال دفعة الاستيراد. اضغط متابعة الاستيراد للمحاولة مجددًا.',
        503,
      );
    return c.json(await response.json());
  }
  return c.json(
    await importCatalogBatch(c.env, c.get('admin'), body.requestId, body.mode, body.skus),
  );
});
api.get('/admin/catalog', async (c) => {
  const query = z
    .string()
    .trim()
    .max(100)
    .parse(c.req.query('q') || '');
  const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
  const paginated = c.req.query('page') !== undefined;
  const page = paginated ? z.coerce.number().int().min(1).max(10000).parse(c.req.query('page')) : 1;
  const perPage = paginated
    ? z.coerce
        .number()
        .int()
        .min(1)
        .max(60)
        .parse(c.req.query('limit') || '24')
    : 500;
  const r = await c.env.DB.prepare(
    "SELECT json FROM catalog WHERE ?='' OR sku LIKE ? ESCAPE '\\' OR json_extract(json,'$.name') LIKE ? ESCAPE '\\' ORDER BY sku LIMIT ? OFFSET ?",
  )
    .bind(query, pattern, pattern, perPage, (page - 1) * perPage)
    .all<{
      json: string;
    }>();
  const rows = r.results.map((row) => JSON.parse(row.json));
  const missingParents = [
    ...new Set(
      rows
        .filter((product) => product.parent_id && !catalogMedia(product).images.length)
        .map((product) => product.parent_id),
    ),
  ];
  // Older cached variants may have an empty images array even though the
  // parent has photos. Resolve these in one bounded read, including searches
  // that return only the variant and omit its parent.
  const parentRows = missingParents.length
    ? (
        await c.env.DB.prepare(
          "SELECT json FROM catalog WHERE json_extract(json,'$.parent_id') IS NULL AND json_extract(json,'$.product_id') IN (SELECT value FROM json_each(?)) LIMIT 500",
        )
          .bind(JSON.stringify(missingParents))
          .all<{ json: string }>()
      ).results
    : [];
  const parentImages = new Map(
    parentRows.map((row) => {
      const parent = JSON.parse(row.json);
      return [parent.product_id, parent] as const;
    }),
  );
  const mapped = rows.map((product) => ({
    ...merchantCatalog(product),
    ...catalogMedia(product, parentImages.get(product.parent_id)),
    search_keywords: catalogSearchKeywords(product, parentImages.get(product.parent_id)),
  }));
  if (!paginated) return c.json(mapped);
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM catalog WHERE ?='' OR sku LIKE ? ESCAPE '\\' OR json_extract(json,'$.name') LIKE ? ESCAPE '\\'",
  )
    .bind(query, pattern, pattern)
    .first<{ total: number }>();
  return c.json({
    products: mapped,
    total: count?.total || 0,
    page,
    hasMore: page * perPage < (count?.total || 0),
  });
});
api.get('/admin/categories', async (c) => c.json(await categories(c.env.DB)));
api.patch('/admin/categories/order', async (c) => {
  const ids = z
    .array(z.string().uuid())
    .max(100)
    .parse((await c.req.json()).ids);
  const existing = await categories(c.env.DB);
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== existing.length ||
    existing.some((row) => !ids.includes(row.id))
  )
    throw new DomainError(
      'categories_changed',
      'تغيّرت الأقسام في نافذة أخرى. حدّث الصفحة وأعد ترتيبها.',
      409,
    );
  if (ids.length)
    await c.env.DB.batch(
      ids.map((id, i) =>
        c.env.DB.prepare('UPDATE categories SET position=? WHERE id=?').bind(i, id),
      ),
    );
  await audit(c.env.DB, c.get('admin'), 'categories_reordered');
  return c.json({ ok: true });
});
api.put('/admin/categories/:id', async (c) => {
  const body = await c.req.json();
  const category = categorySchema.parse(body);
  if (category.id !== c.req.param('id')) throw new DomainError('invalid_id', 'معرف غير صالح.');
  const existing = await categories(c.env.DB);
  if (!existing.some((row) => row.id === category.id) && existing.length >= 100)
    throw new DomainError('category_limit', 'يمكن إنشاء مئة قسم في المتجر.');
  if (
    existing.some(
      (row) => row.id !== category.id && row.name.toLowerCase() === category.name.toLowerCase(),
    )
  )
    throw new DomainError('category_exists', 'يوجد قسم بهذا الاسم؛ اختر اسمًا مختلفًا.');
  await c.env.DB.prepare(
    'INSERT INTO categories(id,name,image,icon,position,active,translations) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,image=excluded.image,icon=excluded.icon,position=excluded.position,active=excluded.active,translations=excluded.translations',
  )
    .bind(
      category.id,
      category.name,
      category.image,
      category.icon,
      category.position,
      category.active,
      JSON.stringify(
        Object.hasOwn(body, 'translations')
          ? category.translations || {}
          : existing.find((row) => row.id === category.id)?.translations || {},
      ),
    )
    .run();
  await audit(c.env.DB, c.get('admin'), 'category_saved', category.id);
  return c.json({ ok: true });
});
api.delete('/admin/categories/:id', async (c) => {
  const id = z.string().uuid().parse(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM categories WHERE id=?').bind(id).run();
  await audit(c.env.DB, c.get('admin'), 'category_deleted', id);
  return c.json({ ok: true });
});
api.get('/admin/products', async (c) => c.json(await products(c.env.DB)));
api.post('/admin/preview', async (c) => {
  const body = await c.req.json();
  const previewLanguage = z.enum(['ar', 'fr', 'en']).optional().parse(body.previewLanguage);
  const p = normalizeProductContent(
    productSchema
      .extend({ sku: z.string().max(100), slug: z.string().max(100), name: z.string().max(150) })
      .parse(body),
  );
  if (!Object.hasOwn(body, 'pageMode'))
    p.pageMode = p.blocks.some((block) => block.type === 'IMAGE' || block.type === 'CTA')
      ? 'landing'
      : 'product';
  return c.json({
    html: await previewHTML(
      {
        ...p,
        parentId: null,
        supplier: null,
        verified: 0,
        minimum: 0,
        fulfillment: null,
        stock: 0,
        revision: 1,
      },
      await settings(c.env.DB),
      previewLanguage,
      await safeProducts(
        c.env,
        await cartProducts(c.env.DB, p.presentation?.landingProductIds || []),
      ),
    ),
  });
});
api.post('/admin/content/preview', async (c) => {
  await rate(c, 60, 60, 'content_preview');
  const { html } = z
    .object({ html: z.string().max(20000) })
    .strict()
    .parse(await c.req.json());
  const clean = safeProductHtml(html);
  return c.json({ html: clean, text: plainProductDescription(clean) });
});
api.put('/admin/products/:id', async (c) => {
  const body = await c.req.json();
  let p = productSchema.parse(body);
  if (p.presentation) delete p.presentation.crossSells;
  if (
    !Object.hasOwn(body, 'storefrontVisible') ||
    !Object.hasOwn(body, 'gallery') ||
    !Object.hasOwn(body, 'keywords') ||
    !Object.hasOwn(body, 'presentation')
  ) {
    const existing = await c.env.DB.prepare(
      'SELECT storefront_visible,gallery,keywords,presentation FROM products WHERE id=?',
    )
      .bind(p.id)
      .first<{
        storefront_visible: number;
        gallery: string;
        keywords: string;
        presentation: string;
      }>();
    if (existing) {
      if (!Object.hasOwn(body, 'storefrontVisible'))
        p.storefrontVisible = existing.storefront_visible;
      if (!Object.hasOwn(body, 'gallery')) p.gallery = JSON.parse(existing.gallery);
      if (!Object.hasOwn(body, 'keywords')) p.keywords = existing.keywords;
      if (!Object.hasOwn(body, 'presentation')) p.presentation = JSON.parse(existing.presentation);
    }
  }
  if (!Object.hasOwn(body, 'pageMode')) {
    const existing = await c.env.DB.prepare('SELECT page_mode FROM products WHERE id=?')
      .bind(p.id)
      .first<{ page_mode: 'product' | 'landing' }>();
    p.pageMode =
      existing?.page_mode ||
      (p.blocks.some((block) => block.type === 'IMAGE' || block.type === 'CTA')
        ? 'landing'
        : 'product');
  }
  if (p.id !== c.req.param('id')) throw new DomainError('invalid_id', 'معرف غير صالح.');
  p = productSchema.parse(normalizeProductContent(p));
  if (
    p.categoryId &&
    !(await c.env.DB.prepare('SELECT id FROM categories WHERE id=?').bind(p.categoryId).first())
  )
    return c.json(
      {
        error: 'category_missing',
        message: 'قسم المنتج لم يعد موجودًا. اختر قسمًا آخر.',
        details: [
          { field: 'categoryId', label: 'قسم المنتج', message: 'اختر قسمًا موجودًا أو دون قسم.' },
        ],
      },
      400,
    );
  const duplicate = await c.env.DB.prepare(
    'SELECT sku,slug FROM products WHERE id<>? AND (sku=? OR slug=?) LIMIT 1',
  )
    .bind(p.id, p.sku, p.slug)
    .first<{ sku: string; slug: string }>();
  if (duplicate) {
    const field = duplicate.sku === p.sku ? 'sku' : 'slug',
      label = field === 'sku' ? 'كود المنتج لدى مورد' : 'رابط المنتج';
    return c.json(
      {
        error: 'product_exists',
        message: label + ' مستخدم في منتج آخر. عدّل المنتج الموجود أو اختر قيمة مختلفة.',
        details: [{ field, label, message: 'هذه القيمة مستخدمة في منتج آخر.' }],
      },
      400,
    );
  }
  if (
    new Set(p.offers.map((o) => o.id)).size !== p.offers.length ||
    new Set(p.blocks.map((b) => b.id)).size !== p.blocks.length ||
    p.blocks.filter((b) => b.type === 'ORDER_FORM' && b.enabled).length > 1
  )
    throw new DomainError('duplicate_blocks', 'المعرفات والاستمارة يجب أن تكون فريدة.');
  const raw = await c.env.DB.prepare('SELECT json FROM catalog WHERE sku=?')
      .bind(p.sku)
      .first<{ json: string }>(),
    catalog = raw ? JSON.parse(raw.json) : null,
    s = await settings(c.env.DB);
  const supplier = catalog?.supplier_key || null,
    fulfillment =
      catalog?.fulfillment_price === undefined || catalog?.fulfillment_price === null
        ? null
        : cents(catalog.fulfillment_price),
    verified = Number(!!supplier && s.contractVerified && fulfillment !== null),
    minimum = catalog ? cents(catalog.minimum_selling_price ?? 0) : 0,
    stock = catalog?.stock_quantity || 0;
  if (
    p.active &&
    (!verified ||
      catalog?.is_active !== true ||
      (c.env.ENVIRONMENT !== 'development' &&
        catalog?.key_fingerprint !== (await digest(await credential(c.env, 'mowarid')))))
  )
    throw new DomainError(
      'unverified_product',
      'لا يمكن نشر منتج دون مطابقة كتالوج وهوية مورد موثقة.',
    );
  if (p.presentation?.promotion) {
    const prior = await c.env.DB.prepare('SELECT presentation FROM products WHERE id=?')
      .bind(p.id)
      .first<{ presentation: string }>();
    const old = prior ? JSON.parse(prior.presentation).promotion : null;
    p.presentation.promotion.startsAt = old?.startsAt || now();
  }
  if (p.presentation?.promotion && p.presentation.promotion.price >= p.price)
    throw new DomainError('invalid_promotion', 'سعر العرض يجب أن يكون أقل من السعر الأصلي.');
  if (p.presentation?.bundleMode) {
    if (p.offers.length > 2 || p.offers.some((o) => o.quantity < 2))
      throw new DomainError(
        'invalid_bundles',
        'يمكنك إضافة باقتين بجانب المنتج الواحد، بكمية لا تقل عن 2.',
        400,
        [
          {
            field: 'offers',
            label: 'الباقات',
            message: 'يمكنك إضافة باقتين بجانب المنتج الواحد، بكمية لا تقل عن 2.',
          },
        ],
      );
    delete p.presentation.quantityPricing;
  }
  const enabledQuantities = p.offers.filter((o) => o.enabled !== false).map((o) => o.quantity);
  if (new Set(enabledQuantities).size !== enabledQuantities.length)
    throw new DomainError('duplicate_quantity', 'حدد عرضًا واحدًا لكل كمية.', 400, [
      { field: 'offers', label: 'عروض الكمية', message: 'حدد عرضًا واحدًا لكل كمية.' },
    ]);
  if (p.presentation?.quantityPricing)
    p.presentation.quantityPricing.fromQuantity = Math.max(1, ...enabledQuantities) + 1;
  // Old API clients receive a safe, explicit normal-price fallback on changed tiers.
  if (
    p.active &&
    enabledQuantities.length &&
    Math.max(...enabledQuantities) < 100 &&
    !p.presentation?.quantityPricing &&
    !p.presentation?.bundleMode
  ) {
    const prior = await cartProducts(c.env.DB, [p.id]);
    if (!prior[0] || JSON.stringify(prior[0].offers) !== JSON.stringify(p.offers))
      p.presentation = {
        ...p.presentation,
        quantityPricing: {
          unitPrice: p.price,
          fromQuantity: Math.max(...enabledQuantities) + 1,
          freeShipping: false,
          enabled: true,
        },
      };
  }
  if (p.active) {
    const maximum = await maximumShipping(c.env);
    assertPublishedPrices(p.price, p.offers, fulfillment, s, p, maximum);
    if (
      p.presentation?.promotion &&
      (!p.presentation.promotion.endsAt || Date.parse(p.presentation.promotion.endsAt) > Date.now())
    )
      assertPublishedPrices(p.presentation.promotion.price, p.offers, fulfillment, s, p, maximum);
  }
  await c.env.DB.prepare(
    'INSERT INTO products(id,slug,sku,parent_id,name,description,image,price,minimum,fulfillment,stock,active,featured,supplier,verified,offers,blocks,color,form_color,shipping_casa,shipping_other,category_id,page_mode,storefront_visible,gallery,keywords,presentation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,sku=excluded.sku,parent_id=excluded.parent_id,name=excluded.name,description=excluded.description,image=excluded.image,price=excluded.price,minimum=excluded.minimum,fulfillment=excluded.fulfillment,stock=excluded.stock,active=excluded.active,featured=excluded.featured,supplier=excluded.supplier,verified=excluded.verified,offers=excluded.offers,blocks=excluded.blocks,color=excluded.color,form_color=excluded.form_color,shipping_casa=excluded.shipping_casa,shipping_other=excluded.shipping_other,category_id=excluded.category_id,page_mode=excluded.page_mode,storefront_visible=excluded.storefront_visible,gallery=excluded.gallery,keywords=excluded.keywords,presentation=excluded.presentation,revision=products.revision+1',
  )
    .bind(
      p.id,
      p.slug,
      p.sku,
      catalog?.parent_id || null,
      p.name,
      p.description,
      p.image,
      p.price,
      minimum,
      fulfillment,
      stock,
      p.active,
      p.featured,
      supplier,
      verified,
      JSON.stringify(p.offers),
      JSON.stringify(p.blocks),
      p.color,
      p.formColor,
      p.shippingCasa,
      p.shippingOther,
      p.categoryId,
      p.pageMode,
      p.storefrontVisible,
      JSON.stringify(p.gallery),
      p.keywords,
      JSON.stringify(p.presentation),
    )
    .run();
  await reviewPrices(c.env);
  await audit(c.env.DB, c.get('admin'), 'product_saved', p.id);
  return c.json({ ok: true });
});
api.post('/admin/orders/sync', async (c) => {
  if (c.env.OPERATIONS) {
    const stub = c.env.OPERATIONS.get(c.env.OPERATIONS.idFromName('store'));
    c.executionCtx.waitUntil(
      stub.fetch('https://operations.internal/tracking', { method: 'POST' }).then(() => {}),
    );
  } else c.executionCtx.waitUntil(refreshTracking(c.env, true));
  return c.json({ ok: true, queued: true });
});
api.get('/admin/orders/statuses', async (c) => {
  const shipping = (
    await c.env.DB.prepare(
      "SELECT shipping_status code,json_extract(remote,'$.status.shipping_status_label') label,COUNT(*) count FROM orders WHERE shipping_status IS NOT NULL GROUP BY shipping_status,label",
    ).all()
  ).results;
  const financial = (
    await c.env.DB.prepare(
      "SELECT financial_status code,json_extract(remote,'$.status.financial_status_label') label,COUNT(*) count FROM orders WHERE financial_status IS NOT NULL GROUP BY financial_status,label",
    ).all()
  ).results;
  const merged = new Map<string, { code: string; label: string; count: number }>();
  for (const row of financial as { code: string; count: number; label: string }[]) {
    const code = financialStatus(row.code);
    if (!financialLabels[code]) continue;
    merged.set(code, {
      code,
      label: financialLabel(code),
      count: (merged.get(code)?.count || 0) + row.count,
    });
  }
  return c.json({ shipping, financial: [...merged.values()] });
});
api.get('/admin/orders', async (c) => {
  const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(c.req.query('page') || '1'),
    status = c.req.query('status') || '';
  const phase = z
    .string()
    .refine(
      (value) =>
        !value || value === 'pending_confirmation' || Object.hasOwn(orderPhaseLabels, value),
    )
    .parse(c.req.query('shipping') || '');
  const financial = z
    .enum(['', 'pending', 'awaiting_settlement', 'paid', 'cancelled'])
    .parse(c.req.query('financial') || '');
  const call = z
    .string()
    .refine((value) => !value || Object.hasOwn(callLabels, value))
    .parse(c.req.query('call') || '');
  const filter = z.string().max(120).parse(status);
  let where = '',
    values: string[] = [];
  if (filter === 'vendor-accepted') {
    where =
      " WHERE shipping_status IN ('approved','accepted') OR json_extract(remote,'$.status.shipping_status_label') IN ('مقبول','تم قبول الطلب')";
  } else if (filter === 'profit-paid') {
    where =
      " WHERE financial_status='paid' OR json_extract(remote,'$.status.financial_status_label') IN ('تم دفع الأرباح','تم دفع الارباح','الأرباح مدفوعة')";
  } else if (filter.startsWith('shipping:')) {
    const code = filter.slice(9);
    const aliases =
      code === 'approved' || code === 'accepted'
        ? ['approved', 'accepted']
        : code === 'shipped' || code === 'in_transit'
          ? ['shipped', 'in_transit']
          : [code];
    where = ' WHERE shipping_status IN (' + aliases.map(() => '?').join(',') + ')';
    values = aliases;
  } else if (filter.startsWith('financial:')) {
    where = ' WHERE financial_status=?';
    values = [filter.slice(10)];
  } else if (filter) {
    where = ' WHERE status=?';
    values = [filter];
  }
  const conditions = where ? [where.slice(7)] : [];
  if (phase) {
    const phases: Record<string, string> = {
      not_sent: 'mowarid_id IS NULL',
      pending_confirmation: "status='pending_confirmation' AND mowarid_id IS NULL",
      confirmed:
        "(status='confirmed' AND mowarid_id IS NULL) OR shipping_status IN ('confirmed','approved','accepted') OR json_extract(remote,'$.status.order_status')='confirmed'",
      sent: 'mowarid_id IS NOT NULL',
      pending: "mowarid_id IS NOT NULL AND shipping_status='pending'",
      shipped: "shipping_status IN ('shipped','in_transit')",
      delivered: "shipping_status IN ('delivered','paid')",
      returned: "shipping_status='returned'",
      cancelled: "status='cancelled' OR shipping_status IN ('cancelled','deleted')",
      deleted: "shipping_status='deleted'",
    };
    conditions.push(phases[phase]);
  }
  if (financial) {
    conditions.push(
      "CASE WHEN financial_status='cleared' THEN 'awaiting_settlement' WHEN financial_status IS NOT NULL THEN financial_status WHEN status='cancelled' OR shipping_status IN ('cancelled','returned','deleted') THEN 'cancelled' ELSE 'pending' END = ?",
    );
    values.push(financial);
  }
  if (call) {
    conditions.push("json_extract(remote,'$.status.call_status') = ?");
    conditions.push(
      "status!='cancelled' AND (shipping_status IS NULL OR shipping_status NOT IN ('cancelled','returned','deleted','delivered','paid'))",
    );
    values.push(call);
  }
  where = conditions.length
    ? ' WHERE ' + conditions.map((value) => '(' + value + ')').join(' AND ')
    : '';
  const stmt = c.env.DB.prepare(
    'SELECT * FROM orders' + where + ' ORDER BY created_at DESC LIMIT 30 OFFSET ?',
  );
  const r = await stmt.bind(...values, (page - 1) * 30).all<OrderRow>();
  return c.json(await adminOrderRows(c.env, r.results));
});
api.get('/admin/orders/:id', async (c) => {
  const item = await order(c.env.DB, c.req.param('id'));
  if (!item) throw new DomainError('not_found', 'الطلب غير موجود.', 404);
  return c.json((await adminOrderRows(c.env, [item]))[0]);
});
api.patch('/admin/orders/:id/customer', async (c) => {
  const o = await order(c.env.DB, c.req.param('id'));
  if (
    !o ||
    o.mowarid_id ||
    o.post_attempted ||
    !(
      o.status === 'pending_confirmation' ||
      (o.status === 'confirmed' && o.sync_status === 'error')
    )
  )
    throw new DomainError('order_locked', 'الطلب غير قابل للتعديل.');
  const customer = customerInput(await c.req.json());
  customer.city = canonicalCity(customer.city, await cities(c.env.DB));
  const q = JSON.parse(o.quote) as Quote,
    s = await settings(c.env.DB);
  q.shippingReason = q.items.some((i) => i.freeShipping)
    ? 'offer'
    : q.checkoutMode !== 'direct' &&
        (q.cartFreeShippingThreshold || 0) > 0 &&
        q.subtotal >= q.cartFreeShippingThreshold!
      ? 'threshold'
      : 'standard';
  q.shipping =
    q.shippingReason !== 'standard'
      ? 0
      : isCasa(customer.city, await cities(c.env.DB))
        ? (q.shippingRates?.casa ?? s.shippingCasa)
        : (q.shippingRates?.other ?? s.shippingOther);
  q.total = q.subtotal + q.shipping;
  assertOrderMargin(
    q.items,
    await cartProducts(
      c.env.DB,
      q.items.map((i) => i.productId),
    ),
    q.total,
    await maximumShipping(c.env),
  );
  if (q.merchantPricing) {
    const shipping = platformShipping(customer.city, await cities(c.env.DB));
    const total =
      q.merchantPricing.subtotal === null ? null : q.merchantPricing.subtotal + shipping;
    q.merchantPricing = {
      ...q.merchantPricing,
      shipping,
      total,
      profit: total === null ? null : q.total - total,
    };
  }
  q.fingerprint = await digest(JSON.stringify({ ...q, fingerprint: undefined }));
  const r = await c.env.DB.prepare(
    "UPDATE orders SET customer=?,quote=?,remote_quote=NULL,dry_run_result=NULL WHERE id=? AND mowarid_id IS NULL AND post_attempted=0 AND (status='pending_confirmation' OR (status='confirmed' AND sync_status='error')) AND NOT EXISTS(SELECT 1 FROM jobs WHERE order_id=? AND type='submit' AND status='running')",
  )
    .bind(JSON.stringify(customer), JSON.stringify(q), o.id, o.id)
    .run();
  if (!r.meta.changes) throw new DomainError('order_locked', 'تغيرت حالة الطلب.', 409);
  await audit(c.env.DB, c.get('admin'), 'customer_corrected', o.id);
  return c.json({ ok: true });
});
api.post('/admin/orders/:id/quote', async (c) => {
  const o = await order(c.env.DB, c.req.param('id'));
  if (!o || o.mowarid_id || !['pending_confirmation', 'confirmed'].includes(o.status))
    throw new DomainError('order_locked', 'الطلب غير متاح للفحص.');
  const proof = await quoteMowarid(c.env, o);
  await audit(c.env.DB, c.get('admin'), 'order_quote_checked', o.id);
  return c.json(proof);
});
api.post('/admin/orders/:id/dry-run', async (c) => {
  const o = await order(c.env.DB, c.req.param('id'));
  if (!o) throw new DomainError('not_found', 'الطلب غير موجود.', 404);
  const proof = await dryRunMowarid(c.env, o);
  await audit(c.env.DB, c.get('admin'), 'order_dry_run_checked', o.id);
  return c.json(proof);
});
api.post('/admin/orders/:id/reconcile', async (c) => {
  const o = await order(c.env.DB, c.req.param('id'));
  if (!o) throw new DomainError('not_found', 'الطلب غير موجود.', 404);
  // The background sender may finish between rendering the button and clicking
  // it. Repeated reads of an acknowledged result are successful and never POST.
  if (o.mowarid_id) return c.json({ found: true, sent: true });
  if (!o.post_attempted) return c.json({ found: false, pending: o.sync_status === 'queued' });
  const data = await mowarid(c.env, '/orders?external_order_id=' + encodeURIComponent(o.id));
  if (data.success !== true || !Array.isArray(data.orders))
    throw new DomainError('lookup_failed', 'تعذر التحقق من نتيجة الطلب.');
  const remote = data.orders.find((r: Record<string, any>) => r.external_order_id === o.id);
  if (typeof remote?.order_id === 'string' && remote.order_id) {
    await c.env.DB.prepare(
      "UPDATE orders SET mowarid_id=?,sync_status='sent',last_error=NULL,next_poll=? WHERE id=? AND mowarid_id IS NULL",
    )
      .bind(remote.order_id, Date.now(), o.id)
      .run();
    await c.env.DB.prepare(
      "UPDATE jobs SET status='done',lease_until=0,last_error=NULL WHERE order_id=? AND type='submit' AND status IN ('pending','failed')",
    )
      .bind(o.id)
      .run();
    try {
      await recordRemote(c.env, (await order(c.env.DB, o.id))!, remote);
    } catch (e) {
      await c.env.DB.prepare('UPDATE orders SET last_error=? WHERE id=?')
        .bind(e instanceof RemoteError ? e.code : 'tracking_error', o.id)
        .run();
      throw e;
    }
  }
  await audit(c.env.DB, c.get('admin'), 'order_reconciled', o.id);
  return c.json({ found: !!remote?.order_id });
});
api.post('/admin/orders/:id/confirm', async (c) => {
  const id = c.req.param('id');
  const o = await order(c.env.DB, id);
  if (!o) throw new DomainError('not_found', 'الطلب غير موجود.', 404);
  if (!['pending_confirmation', 'confirmed'].includes(o.status))
    throw new DomainError('order_locked', 'لا يمكن تأكيد هذا الطلب.');
  if (o.mowarid_id) return c.json({ ok: true, sent: true });
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE orders SET status='confirmed',sync_status='queued',last_error=NULL,confirmed_at=COALESCE(confirmed_at,?) WHERE id=? AND mowarid_id IS NULL AND status IN ('pending_confirmation','confirmed') AND NOT EXISTS(SELECT 1 FROM jobs WHERE order_id=? AND type='submit' AND status='running')",
    ).bind(now(), id, id),
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO jobs(id,type,order_id,run_at,created_at) SELECT ?,'submit',id,?,? FROM orders WHERE id=? AND status='confirmed'",
    ).bind('submit:' + id, Date.now(), now(), id),
    c.env.DB.prepare(
      "UPDATE jobs SET status='pending',run_at=?,attempts=CASE WHEN status='failed' THEN 0 ELSE attempts END,last_error=NULL WHERE order_id=? AND type='submit' AND status IN ('pending','failed') AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='confirmed' AND mowarid_id IS NULL)",
    ).bind(Date.now(), id, id),
  ]);
  await audit(c.env.DB, c.get('admin'), 'order_confirmed', id);
  if (await dispatchSubmission(c.env, id)) return c.json({ ok: true, sent: true });
  return c.json({ ok: true, queued: true }, 202);
});
api.post('/admin/orders/:id/cancel', async (c) => {
  const id = c.req.param('id');
  const r = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE orders SET status='cancelled',sync_status='cancelled' WHERE id=? AND mowarid_id IS NULL AND post_attempted=0 AND status IN ('pending_confirmation','confirmed') AND NOT EXISTS(SELECT 1 FROM jobs WHERE order_id=? AND type='submit' AND status='running')",
    ).bind(id, id),
    c.env.DB.prepare(
      "UPDATE jobs SET status='cancelled' WHERE order_id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='cancelled')",
    ).bind(id, id),
  ]);
  if (!r[0].meta.changes)
    throw new DomainError('order_locked', 'بدأ إرسال الطلب أو لا يمكن إلغاؤه محليًا.', 409);
  await audit(c.env.DB, c.get('admin'), 'order_cancelled', id);
  return c.json({ ok: true });
});
api.post('/admin/orders/:id/refresh', async (c) => {
  const o = await order(c.env.DB, c.req.param('id'));
  if (!o?.mowarid_id) throw new DomainError('not_sent', 'الطلب لم يُرسل بعد.');
  const data = await mowarid(c.env, '/orders?external_order_id=' + encodeURIComponent(o.id));
  const remote = data.orders?.find((r: Record<string, unknown>) => r.external_order_id === o.id);
  if (!remote) throw new DomainError('remote_missing', 'لم يظهر الطلب في استجابة مورد.');
  await recordRemote(c.env, o, remote);
  return c.json({ ok: true });
});
api.get('/admin/campaign-links', async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        'SELECT * FROM campaign_links ORDER BY created_at DESC,id DESC LIMIT 200',
      ).all()
    ).results,
  ),
);
api.post('/admin/campaign-links', async (c) => {
  const b = z
    .object({
      target: z.string().min(1).max(2000),
      source: z.enum(['facebook', 'instagram', 'tiktok', 'google', 'snapchat']),
      campaign: z.string().trim().max(150).default(''),
      medium: z.string().trim().max(150).default(''),
      content: z.string().trim().max(150).default(''),
      term: z.string().trim().max(150).default(''),
    })
    .parse(await c.req.json());
  const origin = new URL(c.env.APP_ORIGIN || c.req.url).origin;
  let url: URL;
  try {
    url = new URL(b.target, origin);
    if (
      url.username ||
      url.password ||
      !['https:', 'http:'].includes(url.protocol) ||
      !/^\/(?:$|(?:shop|offers|products)\/[^/]+$)/.test(url.pathname)
    )
      throw new Error();
  } catch {
    throw new DomainError('invalid_campaign_link', 'اختر رابطًا من متجرك.');
  }
  if (!(await campaignOriginAllowed(c.env, c.req.url, url)))
    throw new DomainError('invalid_campaign_link', 'اختر رابطًا من متجرك.');
  url.searchParams.delete('utm_source');
  url.searchParams.delete('utm_campaign');
  const target = url.href;
  url.searchParams.set('utm_source', b.source);
  if (b.campaign) url.searchParams.set('utm_campaign', b.campaign);
  for (const key of ['medium', 'content', 'term'] as const)
    if (b[key]) url.searchParams.set('utm_' + key, b[key]);
  if (url.href.length > 2400)
    throw new DomainError('invalid_campaign_link', 'اختر رابطًا من متجرك.');
  await c.env.DB.prepare(
    'INSERT INTO campaign_links(id,url,target,source,campaign,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM campaign_links)<200 ON CONFLICT(url) DO NOTHING',
  )
    .bind(crypto.randomUUID(), url.href, target, b.source, b.campaign, now())
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM campaign_links WHERE url=?')
    .bind(url.href)
    .first();
  if (!row)
    throw new DomainError('campaign_links_limit', 'احذف بعض الروابط المحفوظة لإنشاء رابط جديد.');
  return c.json(row, 201);
});
api.delete('/admin/campaign-links/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM campaign_links WHERE id=?')
    .bind(z.string().uuid().parse(c.req.param('id')))
    .run();
  return c.json({ ok: true });
});
api.get('/admin/analytics', async (c) => {
  const from = c.req.query('from') || businessDate(new Date(Date.now() - 30 * 86400000)),
    to = c.req.query('to') || businessDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw new DomainError('invalid_date', 'تاريخ غير صالح.');
  let start: string, end: string;
  try {
    start = businessStart(from);
    end = businessStart(nextDay(to));
  } catch {
    throw new DomainError('invalid_date', 'تاريخ غير صالح.');
  }
  const data = await c.env.DB.prepare(
    `SELECT COALESCE(NULLIF(json_extract(attribution,'$.last.utm_source'),''),'direct') source,COALESCE(json_extract(attribution,'$.last.utm_campaign'),'') campaign,COUNT(*) orders,SUM(status='pending_confirmation') pending,SUM(status='confirmed') confirmed,SUM(mowarid_id IS NOT NULL) sent,SUM(mowarid_id IS NULL) not_sent,SUM(mowarid_id IS NOT NULL AND (shipping_status IS NULL OR shipping_status NOT IN ('delivered','paid','returned','cancelled','deleted'))) in_progress,SUM(financial_status='paid' AND shipping_status IN ('delivered','paid')) profit_paid,COALESCE(SUM(status='cancelled' OR shipping_status IN ('cancelled','deleted')),0) cancelled,COALESCE(SUM(shipping_status IN ('delivered','paid')),0) delivered,COALESCE(SUM(shipping_status='returned'),0) returned,SUM(CASE WHEN shipping_status IN ('delivered','paid') THEN COALESCE(delivered_total,CAST(json_extract(quote,'$.total') AS INTEGER)) ELSE 0 END) revenue FROM orders WHERE created_at>=? AND created_at<? GROUP BY source,campaign`,
  )
    .bind(start, end)
    .all<{
      source: string;
      campaign: string;
      orders: number;
      pending: number;
      confirmed: number;
      sent: number;
      not_sent: number;
      in_progress: number;
      profit_paid: number;
      cancelled: number;
      delivered: number;
      returned: number;
      revenue: number;
    }>();
  const metrics = {
    orders: 0,
    pending: 0,
    confirmed: 0,
    sent: 0,
    not_sent: 0,
    in_progress: 0,
    profit_paid: 0,
    cancelled: 0,
    delivered: 0,
    returned: 0,
    revenue: 0,
  };
  for (const row of data.results)
    for (const key of Object.keys(metrics) as (keyof typeof metrics)[])
      metrics[key] += Number(row[key]) || 0;
  const traffic = await c.env.DB.prepare(
    "SELECT source,campaign,SUM(stage='visit') visits,SUM(stage='checkout') checkouts FROM visits WHERE date>=? AND date<=? GROUP BY source,campaign",
  )
    .bind(from, to)
    .all<{ source: string; campaign: string; visits: number; checkouts: number }>();
  const campaigns = new Map<string, any>();
  for (const row of data.results)
    campaigns.set(JSON.stringify([row.source, row.campaign]), { ...row, visits: 0, checkouts: 0 });
  for (const row of traffic.results) {
    const key = JSON.stringify([row.source, row.campaign]);
    campaigns.set(key, {
      orders: 0,
      delivered: 0,
      returned: 0,
      revenue: 0,
      ...campaigns.get(key),
      ...row,
    });
  }
  return c.json({
    metrics,
    campaigns: [...campaigns.values()],
    note: 'الزيارات والوصول لصفحة الشراء تُحسب مرة لكل جلسة متصفح في اليوم والمصدر والحملة؛ الإيراد من الطلبات المسلّمة.',
  });
});
api.get('/admin/media', async (c) =>
  c.json(
    (await c.env.DB.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 200').all())
      .results,
  ),
);
api.post('/admin/media', async (c) => {
  const form = await c.req.formData(),
    file = form.get('file');
  if (!(file instanceof File) || file.size > mediaLimits.bytes)
    throw new DomainError('invalid_upload', 'أقصى حجم للصورة 2MB.');
  const buffer = await file.arrayBuffer();
  let dimensions;
  try {
    dimensions = webpDimensions(buffer);
  } catch {
    throw new DomainError('invalid_image', 'يجب رفع صورة WebP ثابتة وصالحة.');
  }
  const width = Number(form.get('width')),
    height = Number(form.get('height'));
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    width > mediaLimits.width ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > mediaLimits.height ||
    width * height > mediaLimits.pixels ||
    width !== dimensions.width ||
    height !== dimensions.height
  )
    throw new DomainError('invalid_dimensions', 'أبعاد الصورة غير صالحة.');
  const size = await c.env.DB.prepare('SELECT SUM(size) size FROM media').first<{ size: number }>();
  if ((size?.size || 0) + file.size > 8_000_000_000)
    throw new DomainError('media_budget', 'بلغت الصور حد التخزين الاحتياطي المسموح.');
  const id = crypto.randomUUID() + '.webp',
    url = c.env.MEDIA_ORIGIN.replace(/\/$/, '') + '/' + id;
  await c.env.MEDIA.put(id, buffer, {
    httpMetadata: { contentType: 'image/webp', cacheControl: 'public,max-age=31536000,immutable' },
  });
  await c.env.DB.prepare('INSERT INTO media VALUES(?,?,?,?,?,?)')
    .bind(id, url, file.size, width, height, now())
    .run();
  return c.json({ id, url, width, height });
});
api.delete('/admin/media/:id', async (c) => {
  const id = c.req.param('id'),
    r = await c.env.DB.prepare('SELECT url FROM media WHERE id=?')
      .bind(id)
      .first<{ url: string }>();
  if (!r) throw new DomainError('not_found', 'الصورة غير موجودة.', 404);
  const used = await c.env.DB.prepare(
    'SELECT id FROM products WHERE image=? OR instr(blocks,?)>0 LIMIT 1',
  )
    .bind(r.url, r.url)
    .first();
  const s = await settings(c.env.DB);
  if (used || s.logo === r.url || s.favicon === r.url)
    throw new DomainError('media_in_use', 'الصورة مستخدمة في محتوى المتجر.');
  await c.env.MEDIA.delete(id);
  await c.env.DB.prepare('DELETE FROM media WHERE id=?').bind(id).run();
  return c.json({ ok: true });
});
