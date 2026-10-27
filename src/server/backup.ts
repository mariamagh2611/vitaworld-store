import type { Env } from './db';
import { decryptSecret } from './security';
export const backupTables = [
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
  'visits',
] as const;
export type BackupTable = (typeof backupTables)[number];
export async function readBackupPart(env: Env, key: string) {
  if (
    !/^backup\/[\w-]+\/(settings|credentials|catalog|categories|products|orders|order_items|ad_spend|media|jobs|webhook_inbox|campaign_links|visits)-\d+\.enc$/.test(
      key,
    )
  )
    throw new Error('Invalid backup key');
  const object = await env.BACKUPS.get(key);
  if (!object) throw new Error('Backup part missing');
  const part = JSON.parse(await decryptSecret(env, await object.text()));
  if (part.version !== 1 || !backupTables.includes(part.table) || !Array.isArray(part.rows))
    throw new Error('Invalid backup contract');
  return part as {
    version: number;
    table: BackupTable;
    rows: Record<string, string | number | null>[];
  };
}
export async function restorePartIntoEmptyDatabase(
  db: D1Database,
  part: Awaited<ReturnType<typeof readBackupPart>>,
) {
  const columns = (
    await db.prepare('PRAGMA table_info(' + part.table + ')').all<{ name: string }>()
  ).results.map((c) => c.name);
  const statements = part.rows.map((row) => {
    if (part.table === 'products' && !Object.hasOwn(row, 'page_mode'))
      row.page_mode = JSON.parse(String(row.blocks || '[]')).some(
        (block: { type: string }) => block.type === 'IMAGE' || block.type === 'CTA',
      )
        ? 'landing'
        : 'product';
    const keys = Object.keys(row);
    if (keys.some((k) => !columns.includes(k))) throw new Error('Unknown backup column');
    return db
      .prepare(
        'INSERT INTO ' +
          part.table +
          '(' +
          keys.join(',') +
          ') VALUES(' +
          keys.map(() => '?').join(',') +
          ')',
      )
      .bind(...keys.map((k) => row[k]));
  });
  if (statements.length) await db.batch(statements);
}
