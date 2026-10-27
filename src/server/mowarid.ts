import { reviewPrices } from './price-safety';
import { rememberShipping } from './shipping-policy';
import { catalogMedia, catalogKeywords } from '../shared/catalog';
import type { Env } from './db';
import { settings, setState, state, now } from './db';
import { credential, limit, digest, encryptSecret } from './security';
import { DomainError } from '../shared/domain';
export class RemoteError extends Error {
  constructor(
    public code: string,
    public retry: boolean,
    public after = 60,
    public noOrderCreated = false,
  ) {
    super(code);
  }
}
async function mowaridResponse(
  env: Env,
  path: string,
  body?: unknown,
  etag?: string,
  method?: 'POST' | 'DELETE',
) {
  const publicCities = path === '/cities' && body === undefined && !method;
  // Public cities remain usable without credentials; configured calls share one budget.
  let key = '';
  try {
    key = await credential(env, 'mowarid');
  } catch (e) {
    if (!publicCities) throw e;
  }
  if (!publicCities && !key) throw new RemoteError('missing_api_key', false, 60, true);
  const privateRead = !publicCities && body === undefined && !method;
  const requestUrl = new URL('https://mowarid.ma/api/v1' + path);
  // The partner now bypasses its CDN for private endpoints. Keep no-store and
  // reject cached private responses; public cities retain their CDN and ETag.
  try {
    await limit(env, key ? 'mowarid:' + (await digest(key)) : 'mowarid:public-cities', 40, 60);
  } catch (e) {
    if ((e as { status?: number }).status === 429)
      throw new RemoteError('rate_limit_exceeded', true, 60, true);
    throw e;
  }
  let r: Response;
  try {
    r = await fetch(requestUrl.href, {
      method: method || (body ? 'POST' : 'GET'),
      // Workers supports manual redirects. Never forward bearer credentials
      // to a redirect destination, even when the upstream asks us to.
      redirect: 'manual',
      headers: {
        ...(key && !publicCities ? { Authorization: 'Bearer ' + key } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(publicCities && etag ? { 'If-None-Match': etag } : {}),
        ...(privateRead ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } : {}),
      },
      ...(!publicCities ? { cache: 'no-store' as const } : {}),
      ...(privateRead ? { cf: { cacheTtlByStatus: { '100-599': -1 } } } : {}),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    // Keep runtime diagnostics encrypted and private; never return request
    // headers, payloads or provider credentials in merchant error messages.
    try {
      await setState(env.DB, 'mowarid_network_failure', {
        at: now(),
        method: body ? 'POST' : 'GET',
        endpoint: path.split('?')[0],
        encrypted: await encryptSecret(
          env,
          error instanceof Error ? error.message : 'Unknown fetch failure',
        ),
      });
    } catch {
      /* diagnostics must not replace the original transport error */
    }
    throw new RemoteError('network_unknown', true);
  }
  if (r.status >= 300 && r.status < 400 && r.status !== 304)
    throw new RemoteError('remote_redirect_rejected', false);
  if (r.status === 429)
    throw new RemoteError(
      'rate_limit_exceeded',
      true,
      Math.min(86400, Math.max(60, Number(r.headers.get('Retry-After')) || 60)),
      true,
    );
  if (r.status === 401 || r.status === 403)
    throw new RemoteError('invalid_api_key_or_scope', false, 60, true);
  if (r.status >= 500) throw new RemoteError('remote_server_error', true);
  if (
    privateRead &&
    ['HIT', 'STALE', 'UPDATING'].includes((r.headers.get('CF-Cache-Status') || '').toUpperCase())
  )
    throw new RemoteError('cached_private_api_response', true, 60, true);
  if (publicCities && etag && r.status === 304) return r;
  if (!r.ok) throw new RemoteError('remote_http_' + r.status, false, 60, r.status === 400);
  return r;
}
export async function mowarid(
  env: Env,
  path: string,
  body?: unknown,
  method?: 'POST' | 'DELETE',
): Promise<Record<string, any>> {
  const response = await mowaridResponse(env, path, body, undefined, method);
  return response.status === 204 ? { success: true } : remoteJson(response);
}
async function remoteJson(r: Response) {
  try {
    return (await r.json()) as Record<string, any>;
  } catch {
    throw new RemoteError('invalid_remote_json', true);
  }
}
export function field(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    );
}
export function supplierKey(raw: unknown, path: string): string | null {
  if (!path) return null;
  const v = field(raw, path);
  return (typeof v === 'string' && v.trim()) || (typeof v === 'number' && Number.isFinite(v))
    ? String(v)
    : null;
}
export function cents(raw: unknown) {
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    raw < 0 ||
    raw > 1000000 ||
    Math.abs(raw * 100 - Math.round(raw * 100)) > 0.00001
  )
    throw new DomainError('invalid_catalog_price', 'قيمة مالية غير صالحة في الكتالوج.');
  return Math.round(raw * 100);
}
export async function syncCatalog(env: Env, cursor = '', since = '') {
  const s = await settings(env.DB);
  const syncKey = await credential(env, 'mowarid');
  let work = await state(env.DB, 'catalog_pending');
  const fingerprint = await digest(syncKey);
  let scan = await state(env.DB, 'catalog_full_scan');
  // Only a complete, uninterrupted full traversal may retire missing SKUs.
  // Incremental pages and failed/incomplete scans never imply deletion.
  if (!since && !cursor && (!work || work.cursor !== cursor || work.since !== since)) {
    scan = { id: crypto.randomUUID(), keyFingerprint: fingerprint, cursor: '', startedAt: now() };
    await setState(env.DB, 'catalog_full_scan', scan);
  }
  if (scan && (since || scan.keyFingerprint !== fingerprint || scan.cursor !== cursor)) {
    // Switching traversal modes/accounts interrupts the scan; never infer removals from it.
    await setState(env.DB, 'catalog_full_scan', null);
    scan = null;
  }
  const fullScan = scan;
  if (!work || work.cursor !== cursor || work.since !== since) {
    const data = await mowarid(
      env,
      '/products?limit=5' +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : '') +
        (since ? '&updated_since=' + encodeURIComponent(since) : ''),
    );
    if (data.success !== true || !Array.isArray(data.products))
      throw new RemoteError('invalid_catalog_contract', false);
    if (
      data.pagination?.has_more &&
      (typeof data.pagination.next_cursor !== 'string' ||
        !data.pagination.next_cursor ||
        data.pagination.next_cursor === cursor)
    )
      throw new RemoteError('invalid_catalog_pagination', false);
    if (data.shipping_policy?.currency === 'MAD')
      await rememberShipping(
        env,
        'catalog',
        [data.shipping_policy.casablanca_rate, data.shipping_policy.other_cities_rate],
        await digest(syncKey),
      );
    work = {
      cursor,
      since,
      pagination: data.pagination || { has_more: false },
      pairs: data.products.flatMap((parent: Record<string, any>) => {
        const { variants, ...base } = parent;
        return [
          { parent: base, raw: base, parentRow: true },
          ...(Array.isArray(variants) ? variants : []).map((raw) => ({
            parent: base,
            raw,
            parentRow: false,
          })),
        ];
      }),
    };
  }
  if (syncKey !== (await credential(env, 'mowarid')))
    throw new RemoteError('credentials_changed', true);
  const statements: D1PreparedStatement[] = [];
  const proof = await state(env.DB, 'supplier_contract');
  if (
    (!s.contractVerified ||
      proof?.source !== 'api' ||
      proof.keyFingerprint !== fingerprint ||
      proof.field !== s.supplierField) &&
    work.pairs.some(
      ({ raw }: { raw: Record<string, any> }) =>
        typeof raw.sku === 'string' &&
        !!supplierKey(raw, s.supplierField) &&
        typeof raw.fulfillment_price === 'number',
    )
  ) {
    s.contractVerified = true;
    await env.DB.prepare(
      "INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=json_set(settings.json,'$.contractVerified',json('true'))",
    )
      .bind(JSON.stringify(s))
      .run();
    await setState(env.DB, 'supplier_contract', {
      source: 'api',
      field: s.supplierField,
      keyFingerprint: fingerprint,
      verifiedAt: now(),
    });
  }
  for (const { parent, raw, parentRow } of work.pairs.slice(0, 8)) {
    if (typeof raw.sku !== 'string' || !raw.sku || raw.sku.length > 100) continue;
    const supplier = supplierKey(raw, s.supplierField);
    const rawCost = raw.fulfillment_price ?? parent.fulfillment_price;
    const fulfillment = rawCost === undefined || rawCost === null ? null : cents(rawCost);
    const verified = Number(!!supplier && s.contractVerified && fulfillment !== null),
      minimum = cents(raw.minimum_selling_price ?? parent.minimum_selling_price ?? 0);
    const stock =
      Number.isInteger(raw.stock_quantity) && raw.stock_quantity >= 0 ? raw.stock_quantity : 0;
    const mapped = {
      ...raw,
      supplier_key: supplier,
      key_fingerprint: fingerprint,
      ...(fullScan ? { full_scan_id: fullScan.id } : {}),
      minimum_selling_price: minimum / 100,
      suggested_retail_price: raw.suggested_retail_price ?? parent.suggested_retail_price,
      fulfillment_price: fulfillment === null ? null : fulfillment / 100,
      stock_quantity: stock,
      is_active: raw.is_active === true && parent.is_active === true,
      parent_id: parentRow ? null : parent.product_id,
      parent_name: parent.name,
      description: raw.description ?? parent.description ?? '',
      description_html:
        raw.description_html ??
        raw.html_description ??
        parent.description_html ??
        parent.html_description,
      description_text:
        raw.description_text ??
        raw.plain_description ??
        parent.description_text ??
        parent.plain_description,
      search_keywords: catalogKeywords(raw, parent),
      ...catalogMedia(raw, parent),
    };
    statements.push(
      env.DB.prepare(
        'INSERT INTO catalog VALUES(?,?,?) ON CONFLICT(sku) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at',
      ).bind(raw.sku, JSON.stringify(mapped), now()),
    );
    statements.push(
      env.DB.prepare(
        'UPDATE products SET revision=revision+CASE WHEN minimum!=? OR fulfillment IS NOT ? OR supplier IS NOT ? OR verified!=? OR (?=0 AND active=1) THEN 1 ELSE 0 END,minimum=?,fulfillment=?,stock=?,supplier=?,verified=?,active=CASE WHEN ?=0 THEN 0 ELSE active END WHERE sku=?',
      ).bind(
        minimum,
        fulfillment,
        supplier,
        verified,
        Number(mapped.is_active),
        minimum,
        fulfillment,
        stock,
        supplier,
        verified,
        Number(mapped.is_active),
        raw.sku,
      ),
    );
    if (parentRow && parent.is_active === false && typeof parent.product_id === 'string') {
      statements.push(
        env.DB.prepare(
          "UPDATE catalog SET json=json_set(json,'$.is_active',json('false')) WHERE json_extract(json,'$.parent_id')=?",
        ).bind(parent.product_id),
        env.DB.prepare(
          'UPDATE products SET active=0,revision=revision+1 WHERE parent_id=? AND active=1',
        ).bind(parent.product_id),
      );
    }
  }
  // D1 batches are atomic; keep small groups within Free CPU/subrequest budgets.
  for (let i = 0; i < statements.length; i += 10) await env.DB.batch(statements.slice(i, i + 10));
  work.pairs = work.pairs.slice(8);
  await setState(env.DB, 'catalog_pending', work.pairs.length ? work : null);
  if (
    fullScan &&
    !work.pairs.length &&
    (await state(env.DB, 'catalog_full_scan'))?.id === fullScan.id
  ) {
    if (work.pagination.has_more) {
      await setState(env.DB, 'catalog_full_scan', {
        ...fullScan,
        cursor: work.pagination.next_cursor,
      });
    } else {
      // Preserve product content, merchant prices and every historical order snapshot.
      // Previously scoped rows absent from the completed catalogue cannot be sold.
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE products SET active=0,verified=0,stock=0,revision=revision+1 WHERE (active=1 OR verified=1 OR stock<>0) AND sku IN (SELECT sku FROM catalog WHERE json_extract(json,'$.key_fingerprint')=? AND COALESCE(json_extract(json,'$.full_scan_id'),'')<>?)",
        ).bind(fingerprint, fullScan.id),
        env.DB.prepare(
          "UPDATE catalog SET json=json_set(json,'$.is_active',json('false'),'$.stock_quantity',0) WHERE json_extract(json,'$.key_fingerprint')=? AND COALESCE(json_extract(json,'$.full_scan_id'),'')<>?",
        ).bind(fingerprint, fullScan.id),
      ]);
      await setState(env.DB, 'catalog_full_last', { at: now(), keyFingerprint: fingerprint });
      await setState(env.DB, 'catalog_full_scan', null);
    }
  }
  await setState(env.DB, 'catalog_last', { at: now(), remaining: work.pairs.length });
  await reviewPrices(env);
  return work.pairs.length ? { has_more: true, next_cursor: cursor } : work.pagination;
}
export async function syncCities(env: Env) {
  const s = await settings(env.DB);
  if (!s.citiesField || !s.cityNameField) throw new RemoteError('cities_contract_missing', false);
  const cached = await env.DB.prepare('SELECT json FROM cities WHERE id=1').first<{
    json: string;
  }>();
  const previous = await state(env.DB, 'cities_cache');
  const existing = cached ? JSON.parse(cached.json) : null;
  const etag =
    Array.isArray(existing) && existing.length && typeof previous?.etag === 'string'
      ? previous.etag
      : undefined;
  const response = await mowaridResponse(env, '/cities', undefined, etag);
  if (response.status === 304) {
    await env.DB.prepare('UPDATE cities SET updated_at=? WHERE id=1').bind(now()).run();
    await setState(env.DB, 'cities_cache', { etag, checkedAt: now() });
    await reviewPrices(env);
    return existing.length;
  }
  const raw = await remoteJson(response);
  const rows = field(raw, s.citiesField);
  if (!Array.isArray(rows)) throw new RemoteError('invalid_cities_contract', false);
  if (raw.success !== true) throw new RemoteError('invalid_cities_contract', false);
  const cities = rows.flatMap((row) => {
    const name = field(row, s.cityNameField);
    if (typeof name !== 'string' || !name.trim() || name.length > 100) return [];
    return [
      {
        city: name.trim(),
        ...(typeof row.is_casablanca === 'boolean' ? { is_casablanca: row.is_casablanca } : {}),
        ...(typeof row.is_serviceable === 'boolean' ? { is_serviceable: row.is_serviceable } : {}),
        ...(typeof row.shipping_fee_mad === 'number'
          ? { shipping_fee_mad: row.shipping_fee_mad }
          : {}),
      },
    ];
  });
  if (!cities.length) throw new RemoteError('empty_cities_contract', false);
  await env.DB.prepare(
    'INSERT INTO cities VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at',
  )
    .bind(
      JSON.stringify([...new Map(cities.map((c) => [c.city.toLowerCase(), c])).values()]),
      now(),
    )
    .run();
  await setState(env.DB, 'cities_cache', { etag: response.headers.get('ETag'), checkedAt: now() });
  await reviewPrices(env);
  return cities.length;
}
export function submissionResult(data: Record<string, any>, externalId: string) {
  if (Array.isArray(data.results)) {
    const result = data.results.find(
      (r: Record<string, any>) => r.external_order_id === externalId,
    );
    if (!result) throw new RemoteError('missing_item_result', true);
    if (['created', 'duplicate'].includes(result.status) && data.success !== true)
      throw new RemoteError('invalid_submission_contract', true);
    return result as Record<string, any>;
  }
  if (
    data.success === true &&
    data.order?.external_order_id === externalId &&
    (data.duplicate === true ||
      (data.duplicate === false &&
        typeof data.order?.order_id === 'string' &&
        data.order.order_id.length > 0 &&
        data.order.order_id.length <= 200))
  ) {
    return { ...data.order, status: data.duplicate ? 'duplicate' : 'created' };
  }
  throw new RemoteError('invalid_submission_contract', true);
}
