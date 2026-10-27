/** @jsxImportSource hono/jsx */
import { safeProducts } from './price-safety';
import translations from '../shared/translations.json';
import { languageOf, translator, storefrontSettings } from '../shared/i18n';
import {
  visitorSettings,
  requestStoreLanguage,
  productSettings,
  requestInterfaceLanguage,
} from './language';
import { fieldIssues } from '../shared/validation';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import type { Product, Settings } from '../shared/types';
import { landingProducts } from '../shared/landing-products';
import type { Env } from './db';
import { settings, products, productBySlug, categories, cartProducts } from './db';
import { DomainError } from '../shared/domain';
import { RemoteError } from './mowarid';
import { Layout, Home, ProductPage, OrderForm } from './views';
import { raw } from 'hono/html';
import { policyVisible } from '../shared/policies';
import { policyHtml } from './policy-content';
import { api } from './api';
import { instrument } from './usage';
import { searchProducts } from './search';
const app = new Hono<{ Bindings: Env }>();
app.use('*', async (c, next) => {
  const usage = instrument(c.env.DB);
  // Preserve runtime bindings when instrumenting D1.
  const scoped = Object.create(c.env) as Env;
  Object.defineProperty(scoped, 'DB', { value: usage.db, enumerable: true });
  c.env = scoped;
  await next();
  c.executionCtx.waitUntil(usage.flush().catch(() => {}));
});
app.use(
  '*',
  secureHeaders({
    referrerPolicy: 'strict-origin-when-cross-origin',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
  }),
);
app.use('/api/*', (c, next) =>
  bodyLimit({
    maxSize: c.req.path === '/api/admin/media' ? 3 * 1024 * 1024 : 256 * 1024,
    onError: (c) =>
      c.json(
        {
          error: 'payload_too_large',
          message: translator(languageOf(c.req.header('X-UI-Language')))(
            'حجم البيانات أكبر من المسموح.',
          ),
        },
        413,
      ),
  })(c, next),
);
app.use('*', async (c, next) => {
  // Meta can fall back to a POST targeting its pixel iframe. Allow only that
  // HTTPS endpoint; merchant domains and external gateway hosts are not pinned here.
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://connect.facebook.net https://analytics.tiktok.com https://analytics.tiktokw.us https://anlytics-ipv6.tiktokw.us https://www.googletagmanager.com https://www.googleadservices.com https://www.google.com https://sc-static.net; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://*.facebook.com https://*.tiktok.com https://*.google-analytics.com https://*.analytics.google.com https://analytics.tiktokw.us https://anlytics-ipv6.tiktokw.us https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://ad.doubleclick.net https://pagead2.googlesyndication.com https://www.google.com https://www.google.co.ma https://www.google.fr https://*.snapchat.com; frame-src 'self' https://www.googletagmanager.com https://challenges.cloudflare.com https://www.facebook.com/tr/; object-src 'none'; base-uri 'self'; form-action 'self' https://www.facebook.com/tr/",
  );
  await next();
});
app.route('/api', api);
app.get('/admin/upsell', (c) => c.redirect('/admin/products', 302));
async function asset(env: Env, request: Request) {
  const response = await env.ASSETS.fetch(request);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}
async function adminAsset(env: Env, request: Request) {
  const response = await asset(env, request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
app.get('/admin', (c) =>
  adminAsset(c.env, new Request(new URL('/admin/index.html', c.req.url).toString())),
);
app.get('/admin/*', (c) =>
  adminAsset(c.env, new Request(new URL('/admin/index.html', c.req.url).toString())),
);
app.get('/demo/*', (c) =>
  c.env.ENVIRONMENT === 'development' ? asset(c.env, c.req.raw) : c.notFound(),
);
app.get('/media/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/.test(id))
    return c.notFound();
  const key = new Request(new URL('/media/' + id, c.req.url), { method: 'GET' });
  const cache = (caches as unknown as { default: Cache }).default;
  const cached = await cache.match(key);
  // Cache API headers are immutable; middleware adds CSP and security headers.
  if (cached)
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers: new Headers(cached.headers),
    });
  const r = await c.env.MEDIA.get(id);
  if (!r) return c.notFound();
  const response = new Response(r.body, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public,max-age=31536000,immutable',
      ETag: r.httpEtag,
    },
  });
  c.executionCtx.waitUntil(cache.put(key, response.clone()));
  return response;
});
async function landingCandidates(env: Env, p: Product, s: Settings) {
  return landingProducts(
    p,
    await safeProducts(env, await cartProducts(env.DB, p.presentation?.landingProductIds || []), s),
  );
}
app.get('/', async (c) => {
  const published = (
    await c.env.DB.prepare('SELECT slug,page_mode FROM products WHERE active=1 LIMIT 2').all<{
      slug: string;
      page_mode: string;
    }>()
  ).results;
  if (published.length === 1 && published[0].page_mode === 'landing') {
    const rawSettings = await settings(c.env.DB);
    const original = await productBySlug(c.env.DB, published[0].slug);
    const p = original ? (await safeProducts(c.env, [original], rawSettings))[0] : undefined;
    if (p?.active) {
      const s = productSettings(c, rawSettings, p);
      const all = await landingCandidates(c.env, p, s);
      c.header('Cache-Control', 'no-store');
      return c.html(
        <Layout
          pageUrl={c.req.url}
          s={s}
          products={all}
          product={p}
          title={p.name}
          development={c.env.ENVIRONMENT === 'development'}
        >
          <ProductPage p={p} s={s} recommendations={all} />
        </Layout>,
      );
    }
  }
  const s = visitorSettings(c, await settings(c.env.DB)),
    p = (await safeProducts(c.env, await products(c.env.DB, true), s)).filter((p) => p.active);
  const query = (c.req.query('q') || '').trim().slice(0, 200);
  const searchIds = query ? (await searchProducts(c.env.DB, query)).map((p) => p.id) : undefined;
  c.header('Cache-Control', 'no-store');
  return c.html(
    <Layout
      pageUrl={c.req.url}
      s={s}
      products={p}
      searchIds={searchIds}
      development={c.env.ENVIRONMENT === 'development'}
    >
      <Home
        s={s}
        products={p}
        categories={await categories(c.env.DB, true)}
        selectedCategory={c.req.query('category') || ''}
        sort={c.req.query('sort') || ''}
        searchIds={searchIds}
      />
    </Layout>,
  );
});
app.get('/products/:slug', async (c) => {
  const rawSettings = await settings(c.env.DB),
    rawProduct = await productBySlug(c.env.DB, c.req.param('slug'));
  const p = rawProduct
    ? (await safeProducts(c.env, [rawProduct], rawSettings)).find((p) => p.id === rawProduct.id)
    : undefined;
  if (!p?.active) return c.notFound();
  const s = productSettings(c, rawSettings, p);
  const all =
    p.pageMode === 'landing'
      ? await landingCandidates(c.env, p, s)
      : await products(c.env.DB, true);

  if (p.pageMode !== 'landing')
    for (const choice of await landingCandidates(c.env, p, s))
      if (!all.some((item) => item.id === choice.id)) all.push(choice);
  if (!all.some((item) => item.id === p.id)) all.push(p);
  const safe = await safeProducts(c.env, all, s);
  c.header('Cache-Control', 'no-store');
  return c.html(
    <Layout
      pageUrl={c.req.url}
      s={s}
      products={safe}
      product={p}
      title={p.name}
      development={c.env.ENVIRONMENT === 'development'}
    >
      <ProductPage p={p} s={s} recommendations={safe} />
    </Layout>,
  );
});
// Independent presentation links share the same SKU, offers and inventory.
for (const [path, mode] of [
  ['/shop/:slug', 'product'],
  ['/offers/:slug', 'landing'],
] as const) {
  app.get(path, async (c) => {
    const rawSettings = await settings(c.env.DB);
    const original = await productBySlug(c.env.DB, c.req.param('slug'));
    if (!original) return c.notFound();
    const p = {
      ...(await safeProducts(c.env, [original], rawSettings)).find((p) => p.id === original.id)!,
      pageMode: mode,
    };
    if (!p.active) return c.notFound();
    const s = productSettings(c, rawSettings, p);
    const all =
      mode === 'landing' ? await landingCandidates(c.env, p, s) : await products(c.env.DB, true);

    if (mode !== 'landing')
      for (const choice of await landingCandidates(c.env, p, s))
        if (!all.some((item) => item.id === choice.id)) all.push(choice);
    if (!all.some((item) => item.id === p.id)) all.push(p);
    const safe = await safeProducts(c.env, all, s);
    c.header('Cache-Control', 'no-store');
    return c.html(
      <Layout
        pageUrl={c.req.url}
        s={s}
        products={safe}
        product={p}
        title={p.name}
        development={c.env.ENVIRONMENT === 'development'}
      >
        <ProductPage p={p} s={s} recommendations={safe} />
      </Layout>,
    );
  });
}
app.get('/checkout', async (c) => {
  const s = visitorSettings(c, await settings(c.env.DB));
  c.header('Cache-Control', 'no-store');
  const all = (await safeProducts(c.env, await products(c.env.DB, true), s)).filter(
    (p) => p.active,
  );

  const id = c.req.query('product');
  let p = id ? all.find((p) => p.id === id) : undefined;
  if (id && !p) {
    const candidate = (await safeProducts(c.env, await cartProducts(c.env.DB, [id]), s)).find(
      (p) => p.id === id,
    );
    if (candidate?.active && candidate.verified && candidate.stock > 0) {
      p = candidate;
      all.push(candidate);
    }
  }
  if (id && (!p || !p.verified || p.stock < 1)) return c.notFound();
  return c.html(
    <Layout
      pageUrl={c.req.url}
      s={s}
      products={await safeProducts(c.env, all, s)}
      product={p ? { ...p, pageMode: 'product' } : undefined}
      direct={!!p}
      title={translator(s.storeLanguage)('إتمام الطلب')}
      checkout
      development={c.env.ENVIRONMENT === 'development'}
    >
      <main class="checkout-page">
        <OrderForm s={s} p={p ? { ...p, pageMode: 'product' } : undefined} direct={!!p} />
      </main>
    </Layout>,
  );
});
for (const path of ['/policies/:type', '/offers/:slug/policies/:type'])
  app.get(path, async (c) => {
    const rawSettings = await settings(c.env.DB);
    const slug = c.req.param('slug');
    const original = slug ? await productBySlug(c.env.DB, slug) : undefined;
    if (slug && !original) return c.notFound();
    const policyFor = original ? { ...original, pageMode: 'landing' as const } : undefined;
    const s = storefrontSettings(
        policyFor ? productSettings(c, rawSettings, policyFor) : visitorSettings(c, rawSettings),
      ),
      type = c.req.param('type') as 'terms' | 'privacy' | 'returns' | 'contact',
      labels = {
        terms: 'الشروط والأحكام',
        privacy: 'سياسة الخصوصية',
        returns: 'سياسة الاسترجاع',
        contact: 'اتصل بنا',
      };
    const t = translator(s.storeLanguage, s.contentTranslations?.[s.storeLanguage]?.copy);
    if (!Object.hasOwn(labels, type) || !policyVisible(s, type)) return c.notFound();
    c.header('Cache-Control', 'no-store');
    return c.html(
      <Layout
        pageUrl={c.req.url}
        s={s}
        products={policyFor ? [] : await products(c.env.DB, true)}
        policyFor={policyFor}
        title={t(labels[type])}
        development={c.env.ENVIRONMENT === 'development'}
      >
        <main class="policy">
          <article class="policy-card">
            <header class="policy-heading">
              <p>{s.brand}</p>
              <h1>{t(labels[type])}</h1>
            </header>
            <div class="policy-content">{raw(policyHtml(s[type]))}</div>
            {type === 'privacy' && s.turnstileSiteKey && (
              <p class="policy-disclosure">
                {t('نستخدم Cloudflare Turnstile للحماية من الطلبات الآلية. تخضع هذه الخدمة إلى')}{' '}
                <a
                  href="https://www.cloudflare.com/privacypolicy/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('سياسة خصوصية Cloudflare')}
                </a>{' '}
                {t('و')}
                <a
                  href="https://www.cloudflare.com/turnstile-privacy-policy/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('ملحق خصوصية Turnstile')}
                </a>
                .
              </p>
            )}
          </article>
        </main>
      </Layout>,
    );
  });
app.get('/robots.txt', (c) =>
  c.text('User-agent: *\nDisallow: /admin\nDisallow: /api\nDisallow: /checkout\n'),
);
app.get('/sitemap.xml', async (c) => {
  const p = await products(c.env.DB, true);
  const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
  return c.body(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      ['', ...p.map((p) => 'shop/' + p.slug)]
        .map((path) => '<url><loc>' + origin + '/' + path + '</loc></url>')
        .join('') +
      '</urlset>',
    200,
    { 'Content-Type': 'application/xml' },
  );
});
app.notFound(async (c) =>
  c.text(translator(requestStoreLanguage(c, await settings(c.env.DB)))('الصفحة غير موجودة'), 404),
);
app.onError(async (e, c) => {
  const s = await settings(c.env.DB).catch(
    () => ({ adminLanguage: 'ar', storeLanguage: 'ar' }) as const,
  );
  const language =
    c.req.path.startsWith('/api/admin/') || c.req.path.startsWith('/api/auth/')
      ? languageOf(c.req.header('X-UI-Language') || s.adminLanguage)
      : requestInterfaceLanguage(c, s as Settings);
  const t = translator(language, {}, translations);
  if (e instanceof DomainError)
    return c.json(
      {
        error: e.code,
        message: t(e.message),
        details: e.details?.map((issue) => ({
          ...issue,
          label: t(issue.label),
          message: t(issue.message),
        })),
      },
      e.status as 400,
    );
  if (e instanceof RemoteError)
    return c.json(
      {
        error: e.code,
        message: t(
          (
            {
              missing_api_key: 'احفظ مفتاح مورد أولًا.',
              invalid_api_key_or_scope:
                'مفتاح مورد غير صالح أو لا يملك الصلاحيات المطلوبة. راجع المفتاح في حساب مورد.',
              rate_limit_exceeded:
                'وصل الاتصال بمورد إلى حد الطلبات المؤقت. ستُعاد المحاولة تلقائيًا.',
              network_unknown: 'تعذر الوصول إلى مورد الآن. حاول مجددًا بعد قليل.',
              remote_server_error: 'خدمة مورد غير متاحة مؤقتًا. حاول مجددًا بعد قليل.',
            } as Record<string, string>
          )[e.code] || 'تعذر إتمام الاتصال بمورد. افحص الربط ثم أعد المحاولة.',
        ),
      },
      502,
    );
  if (e instanceof ZodError)
    return c.json(
      {
        error: 'validation_error',
        message:
          t('صحّح الخانات التالية: ') +
          fieldIssues(e.issues, c.req.path.startsWith('/api/admin/categories'), t)
            .map((i) => i.label + ' — ' + i.message)
            .join(t('؛ ')),
        fields: e.issues.map((i) => i.path.join('.')),
        details: fieldIssues(e.issues, c.req.path.startsWith('/api/admin/categories'), t),
      },
      400,
    );
  console.error(
    'Request failed:',
    e.name,
    c.env.ENVIRONMENT === 'development' && e.name === 'TypeError' ? e.message : '',
  );
  return c.json({ error: 'internal_error', message: t('تعذر إتمام العملية. حاول مجددًا.') }, 500);
});
export default { fetch: app.fetch };
export { app };
