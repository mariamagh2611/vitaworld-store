// Generates an import for a NEW, EMPTY database. Never executes SQL or overwrites live data.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath || !process.env.ENCRYPTION_KEY)
  throw new Error(
    'Usage: ENCRYPTION_KEY=<original key> node scripts/restore-backup.mjs manifest.json output.sql',
  );
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!manifest.complete || !Array.isArray(manifest.parts)) throw new Error('Incomplete backup');
const key = await crypto.subtle.importKey(
  'raw',
  Buffer.from(process.env.ENCRYPTION_KEY, 'base64'),
  'AES-GCM',
  false,
  ['decrypt'],
);
const tables = new Set([
  'settings',
  'credentials',
  'catalog',
  'categories',
  'products',
  'orders',
  'order_items',
  'ad_spend',
  'media',
  'jobs',
  'webhook_inbox',
  'campaign_links',
]);
let sql = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
sql += await readFile(new URL('../migrations/0002_submission_guard.sql', import.meta.url), 'utf8');
sql += await readFile(new URL('../migrations/0003_mowarid_contract.sql', import.meta.url), 'utf8');
sql += await readFile(new URL('../migrations/0004_quote_and_dry_run.sql', import.meta.url), 'utf8');
sql += await readFile(new URL('../migrations/0005_delivery_total.sql', import.meta.url), 'utf8');
sql += await readFile(new URL('../migrations/0006_owner_access.sql', import.meta.url), 'utf8');
sql += await readFile(new URL('../migrations/0007_product_shipping.sql', import.meta.url), 'utf8');
sql += await readFile(new URL('../migrations/0008_categories.sql', import.meta.url), 'utf8');
sql += await readFile(new URL('../migrations/0009_product_page_mode.sql', import.meta.url), 'utf8');
sql += await readFile(new URL('../migrations/0010_webhooks.sql', import.meta.url), 'utf8');
sql += await readFile(
  new URL('../migrations/0011_storefront_visibility.sql', import.meta.url),
  'utf8',
);
sql += await readFile(new URL('../migrations/0012_product_search.sql', import.meta.url), 'utf8');
sql += await readFile(
  new URL('../migrations/0013_product_presentation.sql', import.meta.url),
  'utf8',
);
sql += await readFile(new URL('../migrations/0014_campaign_links.sql', import.meta.url), 'utf8');
const value = (v) =>
  v === null
    ? 'NULL'
    : typeof v === 'number' && Number.isFinite(v)
      ? String(v)
      : "'" + String(v).replaceAll("'", "''") + "'";
for (const name of manifest.parts) {
  if (!/^backup\/[\w-]+\/[a-z_]+-\d+\.enc$/.test(name)) throw new Error('Invalid backup path');
  const [iv, data] = (await readFile(resolve(dirname(manifestPath), basename(name)), 'utf8')).split(
    '.',
  );
  const decoded = JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Buffer.from(iv, 'base64') },
        key,
        Buffer.from(data, 'base64'),
      ),
    ),
  );
  if (decoded.version !== 1 || !tables.has(decoded.table) || !Array.isArray(decoded.rows))
    throw new Error('Invalid backup part');
  for (const row of decoded.rows) {
    if (decoded.table === 'products' && !Object.hasOwn(row, 'page_mode'))
      row.page_mode = JSON.parse(String(row.blocks || '[]')).some(
        (block) => block.type === 'IMAGE' || block.type === 'CTA',
      )
        ? 'landing'
        : 'product';
    const keys = Object.keys(row);
    if (keys.some((k) => !/^[a-z_]+$/.test(k))) throw new Error('Invalid column');
    sql +=
      '\nINSERT INTO ' +
      decoded.table +
      '(' +
      keys.join(',') +
      ') VALUES(' +
      keys.map((k) => value(row[k])).join(',') +
      ');';
  }
}
sql +=
  "\nUPDATE settings SET json=json_set(json,'$.contractVerified',json('false')) WHERE id=1;\nUPDATE products SET verified=0;\n";
await writeFile(outputPath, sql, { flag: 'wx', mode: 0o600 });
console.log('Created import for a NEW database:', resolve(outputPath));
