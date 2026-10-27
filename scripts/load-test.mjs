import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const code = await build({
  entryPoints: ['src/server/index.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  jsxImportSource: 'hono/jsx',
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: code.outputFiles[0].text,
    compatibilityDate: '2026-10-01',
    d1Databases: ['DB'],
    r2Buckets: ['MEDIA', 'BACKUPS'],
    bindings: {
      ENVIRONMENT: 'development',
      ENCRYPTION_KEY: btoa('a'.repeat(32)),
      AUTH_PEPPER: 'load-test',
      MEDIA_ORIGIN: 'http://load.test/media',
    },
  }),
);
try {
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
  await db.exec(
    (await readFile('fixtures/demo.sql', 'utf8'))
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n'),
  );
  for (let i = 0; i < 10; i++)
    await db
      .prepare(
        "INSERT INTO products(id,slug,sku,name,price,minimum,fulfillment,stock,active,supplier,verified) VALUES(?,?,?,?,14900,8000,8000,100,1,'demo-a',1)",
      )
      .bind('load-' + i, 'load-' + i, 'LOAD-' + i, 'Load product ' + i)
      .run();
  const duration = [],
    started = Date.now();
  for (let batch = 0; batch < 250; batch++) {
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        const at = performance.now();
        const r = await mf.dispatchFetch('http://load.test/');
        await r.text();
        if (r.status !== 200) throw new Error('Storefront load failed');
        duration.push(performance.now() - at);
      }),
    );
    if (batch % 50 === 0) console.log('Storefront requests:', (batch + 1) * 20);
  }
  const cart = Array.from({ length: 10 }, (_, i) => ({
    productId: 'load-' + i,
    offerId: '',
    quantity: 1,
    revision: 1,
  }));
  const request = (path, body, ip) =>
    mf.dispatchFetch('http://load.test/api' + path, {
      method: 'POST',
      headers: {
        Origin: 'http://load.test',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': ip,
      },
      body: JSON.stringify(body),
    });
  for (let i = 0; i < 100; i++) {
    const ip = '192.0.2.' + (i + 1),
      quote = await (await request('/checkout/quote', { cart, city: 'Rabat' }, ip)).json();
    const r = await request(
      '/orders',
      {
        cart,
        fingerprint: quote.fingerprint,
        idempotency: crypto.randomUUID(),
        customer: {
          name: 'Load Customer ' + i,
          phone: '06' + String(i).padStart(8, '0'),
          city: 'Rabat',
          address: 'Load test street 12',
          notes: '',
        },
        matching: { consent: false },
      },
      ip,
    );
    if (r.status !== 201) throw new Error('Order load failed: ' + (await r.text()));
  }
  duration.sort((a, b) => a - b);
  const usage = await db.prepare('SELECT SUM(reads) reads,SUM(writes) writes FROM metrics').first();
  const counts = await db
    .prepare('SELECT (SELECT COUNT(*) FROM orders) orders,(SELECT COUNT(*) FROM order_items) items')
    .first();
  const report = {
    environment: 'Local Miniflare, not a Cloudflare production CPU benchmark',
    requests: 5000,
    orders: counts.orders,
    items: counts.items,
    concurrency: 20,
    p50Ms: duration[2500],
    p95Ms: duration[4750],
    elapsedSeconds: (Date.now() - started) / 1000,
    meteredApplicationRows: usage,
    externalCalls: 0,
  };
  if (
    counts.orders !== 100 ||
    counts.items !== 1000 ||
    usage.reads >= 5000000 ||
    usage.writes >= 100000
  )
    throw new Error('Capacity acceptance failed');
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/load.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await mf.dispose();
}
