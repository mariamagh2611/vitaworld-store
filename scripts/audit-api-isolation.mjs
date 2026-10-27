// Bounded, read-only checks using two controlled merchant accounts and known orders.
// No raw responses, credentials, customer records, or financial values are recorded.
import { readFile, writeFile, mkdir, lstat, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const configPath = process.argv[2];
const reportPath = resolve('.wrangler/audit/api-isolation-report.json');
const checks = [];
let requests = 0;
const add = (test, account, verdict, evidence) =>
  checks.push({ test, account, verdict, ...evidence });
const fields = (value, prefix = '', result = new Set()) => {
  if (!value || typeof value !== 'object') return result;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? prefix + '.' + key : key;
    result.add(path);
    if (Array.isArray(child)) for (const entry of child) fields(entry, path + '[]', result);
    else fields(child, path, result);
  }
  return result;
};
function orderRecords(body) {
  if (Array.isArray(body?.orders)) return body.orders;
  if (body?.order?.order_id) return [body.order];
  if (body?.data?.order?.order_id) return [body.data.order];
  if (body?.order_id) return [body];
  return [];
}
async function request(path, account, mode = 'bearer') {
  if (++requests > 40) throw new Error('request budget exceeded');
  const response = await fetch('https://mowarid.ma/api/v1' + path, {
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    headers:
      mode === 'none'
        ? {}
        : mode === 'header'
          ? { 'X-API-Key': account.apiKey }
          : { Authorization: 'Bearer ' + account.apiKey },
  });
  const reader = response.body?.getReader();
  const chunks = [];
  let bytes = 0;
  if (reader)
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > 1024 * 1024) {
        await reader.cancel();
        throw new Error('response too large');
      }
      chunks.push(Buffer.from(next.value));
    }
  const raw = Buffer.concat(chunks).toString('utf8');
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* non-JSON results are inconclusive */
  }
  return {
    body,
    raw,
    http: response.status,
    privateCache:
      /no-store/.test(response.headers.get('cache-control') || '') &&
      /(?:^|,)\s*private(?:\s|,|$)/i.test(response.headers.get('cache-control') || '') &&
      // Cloudflare consumes Cloudflare-CDN-Cache-Control at the edge rather
      // than forwarding it to clients. Its absence is not a cache failure.
      !/^(?:HIT|MISS|STALE|UPDATING|REVALIDATED|EXPIRED)$/i.test(
        response.headers.get('cf-cache-status') || '',
      ),
  };
}
async function run(config) {
  const accounts = config.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 2) throw new Error('two accounts required');
  for (const account of accounts) {
    if (
      !/^[A-Z0-9_-]{1,20}$/.test(account.label || '') ||
      typeof account.apiKey !== 'string' ||
      account.apiKey.length < 20 ||
      account.apiKey.length > 500 ||
      !/^[A-Za-z0-9_-]{1,150}$/.test(account.orderId || '') ||
      !/^[A-Za-z0-9_#.-]{1,150}$/.test(account.externalOrderId || '')
    )
      throw new Error('invalid config');
  }
  if (
    accounts[0].apiKey === accounts[1].apiKey ||
    accounts[0].label === accounts[1].label ||
    accounts[0].orderId === accounts[1].orderId ||
    accounts[0].externalOrderId === accounts[1].externalOrderId
  )
    throw new Error('distinct fixtures required');
  if (
    typeof config.updatedSince !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
      config.updatedSince,
    ) ||
    !Number.isFinite(Date.parse(config.updatedSince))
  )
    throw new Error('valid timestamp required');
  const inspect = (test, account, result) => {
    if (accounts.some((owner) => result.raw.includes(owner.apiKey)))
      add(test + ': credential echo', account.label, 'FAIL', { http: result.http });
    if (/SQLSTATE|Traceback|\/var\/www\/|\/app\/node_modules\//i.test(result.raw))
      add(test + ': internal error details', account.label, 'FAIL', { http: result.http });
    if (!result.privateCache)
      add(test + ': private cache headers', account.label, 'REVIEW', { http: result.http });
  };
  // A successful own-order read is mandatory. A random UUID or empty account cannot prove isolation.
  for (const account of accounts) {
    for (const mode of ['bearer', 'header']) {
      const result = await request(
        '/orders?external_order_id=' + encodeURIComponent(account.externalOrderId) + '&limit=2',
        account,
        mode,
      );
      inspect('own order', account, result);
      const valid =
        result.http === 200 &&
        orderRecords(result.body).some(
          (order) =>
            order.order_id === account.orderId &&
            order.external_order_id === account.externalOrderId,
        );
      add('own external ID lookup via ' + mode, account.label, valid ? 'PASS' : 'INCONCLUSIVE', {
        http: result.http,
      });
      if (!valid) return;
    }
    if (config.orderDetailSupported !== true) continue;
    const result = await request('/orders/' + encodeURIComponent(account.orderId), account);
    inspect('own lookup', account, result);
    const valid =
      result.http === 200 &&
      orderRecords(result.body).some(
        (order) =>
          order.order_id === account.orderId && order.external_order_id === account.externalOrderId,
      );
    add('own detail endpoint baseline', account.label, valid ? 'PASS' : 'INCONCLUSIVE', {
      http: result.http,
    });
    if (!valid) return;
  }
  for (const [index, account] of accounts.entries()) {
    const other = accounts[1 - index];
    if (config.orderDetailSupported === true) {
      const detail = await request('/orders/' + encodeURIComponent(other.orderId), account);
      inspect('other account detail', account, detail);
      add(
        'other account order detail',
        account.label,
        orderRecords(detail.body).some((order) => order.order_id === other.orderId)
          ? 'FAIL'
          : [403, 404].includes(detail.http)
            ? 'PASS'
            : 'INCONCLUSIVE',
        { http: detail.http },
      );
    } else add('order ID detail endpoint not documented', account.label, 'NOT_TESTED', {});
    for (const suffix of ['', '&updated_since=' + encodeURIComponent(config.updatedSince)]) {
      const result = await request(
        '/orders?external_order_id=' +
          encodeURIComponent(other.externalOrderId) +
          '&limit=2' +
          suffix,
        account,
      );
      inspect('other account lookup', account, result);
      const denied =
        [403, 404].includes(result.http) ||
        (result.http === 200 &&
          Array.isArray(result.body?.orders) &&
          result.body.orders.length === 0 &&
          (!result.body.pagination?.total_count || result.body.pagination.total_count === 0));
      add(
        'other account external ID' + (suffix ? ' with updated_since' : ''),
        account.label,
        denied
          ? 'PASS'
          : orderRecords(result.body).some(
                (order) =>
                  order.order_id === other.orderId ||
                  order.external_order_id === other.externalOrderId,
              )
            ? 'FAIL'
            : 'INCONCLUSIVE',
        { http: result.http },
      );
    }
    const list = await request(
      '/orders?limit=1&updated_since=' + encodeURIComponent(config.updatedSince),
      account,
    );
    inspect('incremental list', account, list);
    add(
      'incremental list excludes known foreign fixture',
      account.label,
      list.http !== 200 || !Array.isArray(list.body?.orders)
        ? 'INCONCLUSIVE'
        : orderRecords(list.body).some((order) => order.order_id === other.orderId)
          ? 'FAIL'
          : 'PASS',
      { http: list.http },
    );
    const cursor = list.body?.pagination?.next_cursor;
    if (typeof cursor === 'string' && cursor.length > 0 && cursor.length < 4000) {
      const cross = await request(
        '/orders?cursor=' + encodeURIComponent(cursor) + '&limit=2',
        other,
      );
      inspect('foreign cursor', other, cross);
      add(
        'cursor reuse excludes known foreign fixture',
        other.label,
        [400, 403, 404].includes(cross.http)
          ? 'PASS'
          : cross.http === 200 && Array.isArray(cross.body?.orders)
            ? orderRecords(cross.body).some((order) => order.order_id === account.orderId)
              ? 'FAIL'
              : 'PASS'
            : 'INCONCLUSIVE',
        { http: cross.http },
      );
    } else add('foreign cursor reuse', account.label, 'NOT_TESTED', {});
    const subscriptions = await request('/webhooks/subscriptions', account);
    inspect('subscriptions', account, subscriptions);
    const paths = [...fields(subscriptions.body)];
    const secretPaths = paths.filter((path) =>
      /(?:^|\.)(?:secret|webhook_secret|password|api_key|token)$/.test(path),
    );
    add(
      'subscription list hides credential fields',
      account.label,
      subscriptions.http !== 200 ? 'INCONCLUSIVE' : secretPaths.length ? 'REVIEW' : 'PASS',
      { http: subscriptions.http, fieldPathsRequiringReview: secretPaths },
    );
  }
  const anonymous = await request(
    '/orders?external_order_id=' + encodeURIComponent(accounts[0].externalOrderId) + '&limit=1',
    accounts[0],
    'none',
  );
  add(
    'known order requires authentication',
    'ANONYMOUS',
    anonymous.http === 401 ? 'PASS' : anonymous.http === 200 ? 'FAIL' : 'INCONCLUSIVE',
    { http: anonymous.http },
  );
  for (const path of [
    '/orders?cursor=invalid-audit-cursor&limit=1',
    '/orders?updated_since=invalid-audit-date&limit=1',
  ]) {
    const result = await request(path, accounts[0]);
    inspect('invalid sync input', accounts[0], result);
    add(
      path.includes('cursor=') ? 'invalid cursor rejected' : 'invalid timestamp rejected',
      accounts[0].label,
      result.http === 400 ? 'PASS' : 'REVIEW',
      { http: result.http },
    );
  }
}
try {
  if (!configPath) throw new Error('config required');
  const stat = await lstat(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 16384)
    throw new Error('private regular config file required');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await run(config);
  await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(reportPath), 0o700);
  const report = {
    at: new Date().toISOString(),
    requests,
    mutations: 0,
    scope: 'Known fixtures in two controlled accounts; bounded API reads',
    checks,
    notProven: [
      'all account records',
      'write authorization',
      'internal supplier or carrier acquisition costs',
      'SSRF',
      'rate-limit resilience',
      'complete pagination under concurrent changes',
    ],
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await chmod(reportPath, 0o600);
  const counts = Object.fromEntries(
    ['PASS', 'FAIL', 'REVIEW', 'INCONCLUSIVE', 'NOT_TESTED'].map((verdict) => [
      verdict,
      checks.filter((check) => check.verdict === verdict).length,
    ]),
  );
  console.log(
    JSON.stringify({
      requests,
      mutations: 0,
      ...counts,
      report: '.wrangler/audit/api-isolation-report.json',
      completeSecurityAudit: false,
    }),
  );
  process.exitCode = counts.FAIL
    ? 1
    : counts.INCONCLUSIVE || counts.REVIEW || counts.NOT_TESTED
      ? 2
      : 0;
} catch {
  console.error(
    'Audit did not complete. Use a private (chmod 600) JSON file with two distinct controlled accounts and known order fixtures. No credentials or raw responses were printed.',
  );
  process.exitCode = 2;
}
