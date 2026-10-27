import { maximumShipping } from './shipping-policy';
import { recordRemote } from './tracking';
import { META_GRAPH_VERSION } from './meta';
import {
  flushMetaEvents,
  metaConfiguredPixels,
  metaEventStatement,
  type MetaEvent,
} from './meta-events';
export { recordRemote } from './tracking';
import { deliveredShipping, remoteShipping } from '../shared/order-status';
import { currentOrderCustomer } from '../shared/order-customer';
import type { Env, OrderRow } from './db';
import { settings, cartProducts, cities, order, now, state, setState } from './db';
import { mowarid, RemoteError, syncCatalog, syncCities, submissionResult, cents } from './mowarid';
import { credential, digest, encryptSecret } from './security';
import { mowaridPayload, DomainError, platformShipping, wholesaleTotal } from '../shared/domain';
import type { Quote, Customer } from '../shared/types';
import { backupTables } from './backup';
import { instrument } from './usage';
import { connectWebhooks, processWebhooks, queueWebhookConnection, webhookReady } from './webhooks';
type Job = {
  id: string;
  type: string;
  order_id: string | null;
  attempts: number;
  lease_token: string;
};
export async function enqueue(env: Env, type: string, id: string | null = null) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO jobs(id,type,order_id,run_at,created_at) VALUES(?,?,?,?,?)',
  )
    .bind(id ? type + ':' + id : crypto.randomUUID(), type, id, Date.now(), now())
    .run();
}
// Wake this order's durable outbox immediately. A separate object prevents
// catalogue/backup/tracking work from deferring a new submission to cron.
export async function dispatchSubmission(env: Env, orderId: string) {
  if (!env.OPERATIONS) return false;
  try {
    const stub = env.OPERATIONS.get(env.OPERATIONS.idFromName('submit:' + orderId));
    const response = await stub.fetch('https://operations.internal/submit', {
      method: 'POST',
      body: JSON.stringify({ orderId }),
    });
    if (!response.ok) return false;
    return !!(await order(env.DB, orderId))?.mowarid_id;
  } catch {
    // The outbox was committed before dispatch. A transport failure must not
    // turn a saved checkout into an error or discard its retry job.
    return false;
  }
}
async function reconcileSubmission(env: Env, o: OrderRow) {
  const lookup = await mowarid(env, '/orders?external_order_id=' + encodeURIComponent(o.id));
  if (lookup.success !== true || !Array.isArray(lookup.orders))
    throw new RemoteError('invalid_lookup_contract', false);
  const existing = lookup.orders.find((r: Record<string, any>) => r.external_order_id === o.id);
  if (
    typeof existing?.order_id === 'string' &&
    existing.order_id &&
    existing.order_id.length <= 200
  ) {
    await env.DB.prepare(
      'UPDATE orders SET mowarid_id=?,sync_status=?,last_error=NULL,next_poll=? WHERE id=?',
    )
      .bind(existing.order_id, 'sent', Date.now(), o.id)
      .run();
    if (remoteShipping(existing.status))
      await recordRemote(env, (await order(env.DB, o.id))!, existing);
    return true;
  }
  return false;
}
async function submit(env: Env, o: OrderRow) {
  if (o.status !== 'confirmed') throw new RemoteError('order_not_confirmed', false);
  // Reconcile only a previous POST whose outcome may be unknown. A brand-new
  // submission must not depend on the availability of the order-reading API.
  if (o.post_attempted && (await reconcileSubmission(env, o))) return;
  const s = await settings(env.DB);
  if (!s.contractVerified) throw new RemoteError('supplier_contract_not_verified', false);
  const q = JSON.parse(o.quote) as Quote,
    all = await cartProducts(
      env.DB,
      q.items.map((i) => i.productId),
    );
  for (const item of q.items) {
    const p = all.find((p) => p.id === item.productId);
    if (
      !p ||
      !p.verified ||
      p.supplier !== o.supplier ||
      p.sku !== item.sku ||
      !p.active ||
      item.quantity > p.stock
    )
      throw new RemoteError('catalog_changed_review_required', false);
  }
  const customer = JSON.parse(o.customer) as Customer;
  if (q.total < wholesaleTotal(q.items, all) + (await maximumShipping(env)))
    throw new RemoteError('catalog_cost_changed_review_required', false);
  const locked = await env.DB.prepare(
    "UPDATE orders SET post_attempted=1,sync_status='sending' WHERE id=? AND status='confirmed' AND quote=? AND customer=? AND mowarid_id IS NULL",
  )
    .bind(o.id, o.quote, o.customer)
    .run();
  if (!locked.meta.changes) throw new RemoteError('order_not_confirmed', false);
  let data: Record<string, any>;
  try {
    data = await mowarid(
      env,
      '/orders',
      // POST validates current stock, supplier and billing atomically. The
      // customer's saved total is sent unchanged; no extra quote is needed.
      mowaridPayload({ id: o.id, customer, quote: q }),
    );
  } catch (e) {
    if (e instanceof RemoteError && e.noOrderCreated && !o.post_attempted)
      await env.DB.prepare('UPDATE orders SET post_attempted=0 WHERE id=?').bind(o.id).run();
    throw e;
  }
  let result: Record<string, any>;
  try {
    result = submissionResult(data, o.id);
  } catch (error) {
    if (!(error instanceof RemoteError)) throw error;
    // An unexpected POST envelope is not proof of failure. Verify the exact
    // immutable external ID in the authenticated partner listing before retry.
    await setState(env.DB, 'mowarid_submission_contract', {
      at: now(),
      keys: Object.keys(data),
      success: data.success === true,
      orderKeys: data.order && typeof data.order === 'object' ? Object.keys(data.order) : [],
      resultKeys: Array.isArray(data.results)
        ? data.results.map((r) => (r && typeof r === 'object' ? Object.keys(r) : []))
        : [],
    });
    if (await reconcileSubmission(env, o)) return;
    throw error;
  }
  if (!['created', 'duplicate'].includes(result.status)) {
    if (!['validation_error', 'rejected'].includes(result.status))
      throw new RemoteError('invalid_submission_result', true);
    if (!o.post_attempted)
      await env.DB.prepare('UPDATE orders SET post_attempted=0 WHERE id=?').bind(o.id).run();
    const code =
      typeof result.error === 'string'
        ? result.error
        : result.error?.code || result.code || result.status;
    throw new RemoteError(
      typeof code === 'string' && /^[a-zA-Z0-9_.:-]{1,120}$/.test(code) ? code : 'rejected',
      false,
    );
  }
  if (!result.order_id) throw new RemoteError('duplicate_requires_lookup', true);
  await env.DB.prepare(
    'UPDATE orders SET mowarid_id=?,sync_status=?,last_error=NULL,next_poll=? WHERE id=?',
  )
    .bind(result.order_id, 'sent', Date.now(), o.id)
    .run();
  // The accepted response can already carry the Mowarid number and pending
  // state. Preserve those without waiting for a separate tracking GET.
  if (data.order?.order_id === result.order_id && data.order.external_order_id === o.id) {
    const remote = {
      ...data.order,
      status: data.order.status || {
        shipping_status: data.order.shipping_status,
        shipping_status_label: data.order.shipping_status_label,
        financial_status: data.order.financial_status,
        financial_status_label: data.order.financial_status_label,
        call_status: data.order.call_status,
        call_status_label: data.order.call_status_label,
      },
    };
    const shipping = remoteShipping(remote.status);
    if (shipping && !deliveredShipping(shipping))
      await recordRemote(env, (await order(env.DB, o.id))!, remote);
  }
}
export async function metaPurchase(env: Env, o: OrderRow) {
  if (!deliveredShipping(o.shipping_status) || !o.delivered_at)
    throw new RemoteError('purchase_requires_delivery', false);
  const s = await settings(env.DB),
    token = await credential(env, 'meta');
  const additional = (await metaConfiguredPixels(env)).filter((pixel) => pixel !== s.facebookPixel);
  if (!s.trackingEnabled || ((!s.facebookPixel || !token) && !additional.length))
    throw new RemoteError('meta_not_configured', false);
  const customer = currentOrderCustomer(
      JSON.parse(o.customer) as Customer,
      o.remote ? JSON.parse(o.remote) : null,
    ),
    q = JSON.parse(o.quote) as Quote,
    m = JSON.parse(o.matching);
  const ph = await digest('212' + customer.phone.slice(1));
  const data: MetaEvent = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.parse(o.delivered_at) / 1000),
    event_id: 'purchase:' + o.id,
    action_source: 'other',
    user_data: {
      ph: [ph],
      ...(m.fbp ? { fbp: m.fbp } : {}),
      ...(m.fbc ? { fbc: m.fbc } : {}),
      ...(m.ip ? { client_ip_address: m.ip } : {}),
      ...(m.agent ? { client_user_agent: m.agent } : {}),
    },
    custom_data: {
      currency: 'MAD',
      value: (o.delivered_total ?? q.total) / 100,
      order_id: o.id,
      content_type: 'product',
      contents: q.items.map((i) => ({
        id: i.sku,
        quantity: i.quantity,
        item_price: i.unitPrice / 100,
      })),
    },
  };
  // Secondary destinations have their own durable receipts and retries. A
  // rejected primary must not prevent them from receiving a delivered sale.
  if (additional.length) {
    await env.DB.batch(
      await Promise.all(additional.map((pixel) => metaEventStatement(env, pixel, data))),
    );
    await flushMetaEvents(env, additional.length);
  }
  if (!s.trackingEnabled || !s.facebookPixel || !token)
    throw new RemoteError('meta_not_configured', false);
  let r: Response;
  try {
    r = await fetch(
      'https://graph.facebook.com/' + META_GRAPH_VERSION + '/' + s.facebookPixel + '/events',
      {
        method: 'POST',
        redirect: 'manual',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [data] }),
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    throw new RemoteError('meta_network_error', true);
  }
  if (r.status >= 300 && r.status < 400) throw new RemoteError('meta_redirect_rejected', false);
  const body = (await r.json()) as { events_received?: number; error?: { code?: number } };
  const fingerprint = await digest(s.facebookPixel + ':' + token);
  if (!r.ok || body.events_received !== 1) {
    await setState(env.DB, 'meta_health', {
      fingerprint,
      checkedAt: now(),
      errorCode: body.error?.code || r.status,
    });
    throw new RemoteError('meta_rejected_' + r.status, r.status >= 500 || r.status === 429);
  }
  await setState(env.DB, 'meta_health', {
    fingerprint,
    checkedAt: now(),
    lastSuccess: now(),
    errorCode: null,
  });
}
export async function runJobs(env: Env, max = 3, submissionOrderId?: string) {
  for (let i = 0; i < max; i++) {
    const token = crypto.randomUUID();
    const job = await env.DB.prepare(
      "UPDATE jobs SET status='running',lease_until=?,lease_token=?,attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE ((status='pending' AND run_at<=?) OR (status='running' AND lease_until<?))" +
        (submissionOrderId ? " AND type='submit' AND order_id=?" : '') +
        ' ORDER BY run_at LIMIT 1) RETURNING *',
    )
      .bind(
        Date.now() + 600000,
        token,
        Date.now(),
        Date.now(),
        ...(submissionOrderId ? [submissionOrderId] : []),
      )
      .first<Job>();
    if (!job) break;
    try {
      if (job.type === 'webhook_connect') await connectWebhooks(env);
      else if (job.type === 'catalog') {
        let progress = await state(env.DB, 'catalog_cursor');
        const full = await state(env.DB, 'catalog_full_last');
        if (!progress?.started && (!full?.at || Date.now() - Date.parse(full.at) >= 86400000))
          progress = { cursor: '', since: '' };
        const started = progress?.started || now();
        const p = await syncCatalog(env, progress?.cursor || '', progress?.since || '');
        await setState(
          env.DB,
          'catalog_cursor',
          p.has_more
            ? { cursor: p.next_cursor, since: progress?.since || '', started }
            : { since: started, cursor: '' },
        );
        if (p.has_more) await enqueue(env, 'catalog');
      } else if (job.type === 'cities') await syncCities(env);
      else if (job.type === 'backup') await backupChunk(env);
      else if (job.type === 'backup_cleanup') await backupCleanup(env);
      else {
        const o = job.order_id ? await order(env.DB, job.order_id) : null;
        if (!o) throw new RemoteError('order_missing', false);
        if (job.type === 'submit') await submit(env, o);
        else if (job.type === 'purchase') await metaPurchase(env, o);
        else throw new RemoteError('unknown_job', false);
      }
      await env.DB.prepare(
        "UPDATE jobs SET status='done',lease_until=0,last_error=NULL WHERE id=? AND lease_token=?",
      )
        .bind(job.id, token)
        .run();
    } catch (e) {
      const error =
        e instanceof RemoteError || e instanceof DomainError
          ? e.code
          : e instanceof Error && e.message === 'rate_limited'
            ? 'rate_limit_exceeded'
            : 'internal_job_error';
      const retry =
        (e instanceof RemoteError ? e.retry : (e as { status?: number })?.status === 429) &&
        job.attempts < 12;
      const delay =
        e instanceof RemoteError ? Math.max(e.after, Math.min(3600, 30 * 2 ** job.attempts)) : 60;
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE jobs SET status=?,run_at=?,lease_until=0,last_error=? WHERE id=? AND lease_token=?',
        ).bind(retry ? 'pending' : 'failed', Date.now() + delay * 1000, error, job.id, token),
        ...(job.type === 'submit' && job.order_id
          ? [
              env.DB.prepare(
                'UPDATE orders SET sync_status=?,last_error=? WHERE id=? AND mowarid_id IS NULL',
              ).bind(retry ? 'queued' : 'error', error, job.order_id),
            ]
          : []),
      ]);
    }
  }
}
async function backupChunk(env: Env) {
  if (await state(env.DB, 'backup_cleanup'))
    throw new RemoteError('backup_cleanup_pending', true, 600);
  let progress = await state(env.DB, 'backup_progress');
  if (!progress || progress.complete || progress.cutoffs?.length !== backupTables.length) {
    const cutoffs = await env.DB.batch(
      backupTables.map((table) => env.DB.prepare('SELECT MAX(rowid) upper FROM ' + table)),
    );
    progress = {
      id: Date.now() + '-' + crypto.randomUUID(),
      table: 0,
      offset: 0,
      parts: [],
      at: now(),
      complete: false,
      bytes: 0,
      cutoffs: cutoffs.map((r) => (r.results[0] as { upper: number })?.upper || 0),
    };
  }
  const table = backupTables[progress.table];
  const rows = await env.DB.prepare(
    'SELECT * FROM ' +
      table +
      ' WHERE rowid<=?' +
      (table === 'jobs' ? ' AND order_id IS NOT NULL' : '') +
      ' ORDER BY rowid LIMIT 20 OFFSET ?',
  )
    .bind(progress.cutoffs[progress.table], progress.offset)
    .all();
  const key = 'backup/' + progress.id + '/' + table + '-' + progress.offset + '.enc';
  const blob = await encryptSecret(env, JSON.stringify({ version: 1, table, rows: rows.results }));
  if (progress.bytes + blob.length > 450000000)
    throw new RemoteError('backup_storage_budget', false);
  await env.BACKUPS.put(key, blob, { httpMetadata: { contentType: 'application/octet-stream' } });
  progress.parts.push(key);
  progress.bytes += blob.length;
  if (rows.results.length < 20) {
    progress.table++;
    progress.offset = 0;
  } else progress.offset += 20;
  if (progress.table === backupTables.length) {
    progress.complete = true;
    await env.BACKUPS.put('backup/' + progress.id + '/manifest.json', JSON.stringify(progress));
    await setState(env.DB, 'backup_last', progress);
    const history = (await state(env.DB, 'backup_history')) || [];
    history.unshift(progress.id);
    if (history.length > 2) {
      await setState(env.DB, 'backup_cleanup', history.pop());
      await enqueue(env, 'backup_cleanup');
    }
    await setState(env.DB, 'backup_history', history);
  } else await enqueue(env, 'backup');
  await setState(env.DB, 'backup_progress', progress);
}
async function backupCleanup(env: Env) {
  const id = await state(env.DB, 'backup_cleanup');
  if (!id) return;
  const list = await env.BACKUPS.list({ prefix: 'backup/' + id + '/', limit: 40 });
  if (list.objects.length) await env.BACKUPS.delete(list.objects.map((o) => o.key));
  if (list.truncated) await enqueue(env, 'backup_cleanup');
  else await setState(env.DB, 'backup_cleanup', null);
}
export async function syncUpdatedOrders(env: Env, max = 20) {
  let progress = await state(env.DB, 'tracking_progress');
  if (!progress || progress.mode !== 'cursor-v1') {
    const checkpoint = await state(env.DB, 'tracking_checkpoint');
    const earliest =
      checkpoint?.since || progress?.since
        ? null
        : await env.DB.prepare(
            "SELECT MIN(created_at) since FROM orders WHERE mowarid_id IS NOT NULL AND (shipping_status IS NULL OR shipping_status NOT IN ('paid','returned','cancelled','deleted'))",
          ).first<{ since: string | null }>();
    // Restart legacy Offset progress from its uncommitted boundary. Replaying
    // already-applied snapshots is safe; dropping an old pending page is not.
    progress = {
      mode: 'cursor-v1',
      since:
        progress?.since ||
        checkpoint?.since ||
        new Date(
          (earliest?.since ? Date.parse(earliest.since) : Date.now() - 7 * 86400000) - 300000,
        ).toISOString(),
      started: now(),
      cursor: '',
      pages: 0,
      pending: [],
      lastPage: false,
    };
  }
  if (!progress.pending.length && !progress.lastPage) {
    const data = await mowarid(
      env,
      '/orders?' +
        (progress.cursor
          ? 'cursor=' + encodeURIComponent(progress.cursor)
          : 'updated_since=' + encodeURIComponent(progress.since)) +
        '&limit=20',
    );
    const pagination = data.pagination;
    if (
      data.success !== true ||
      !Array.isArray(data.orders) ||
      typeof pagination?.has_more !== 'boolean' ||
      (pagination.has_more &&
        (typeof pagination.next_cursor !== 'string' ||
          !pagination.next_cursor ||
          pagination.next_cursor.length > 4000 ||
          pagination.next_cursor === progress.cursor)) ||
      (!pagination.has_more && pagination.next_cursor != null && pagination.next_cursor !== '') ||
      progress.pages >= 10000
    )
      throw new RemoteError('invalid_incremental_tracking_contract', false);
    progress.pending = data.orders;
    progress.lastPage = !pagination.has_more;
    progress.cursor = pagination.next_cursor || '';
    progress.pages++;
    // Persist both the page and its continuation before applying any row.
    // A crash resumes the saved rows, without fetching or skipping that page.
    await setState(env.DB, 'tracking_progress', progress);
  }
  for (let i = 0; i < max && progress.pending.length; i++) {
    const remote = progress.pending[0];
    if (typeof remote?.external_order_id === 'string') {
      const o = await order(env.DB, remote.external_order_id);
      if (o?.mowarid_id) {
        try {
          if (remote.order_id !== o.mowarid_id)
            throw new RemoteError('remote_order_identity_mismatch', false);
          await recordRemote(env, o, remote);
        } catch (e) {
          await env.DB.prepare('UPDATE orders SET last_error=? WHERE id=?')
            .bind(e instanceof RemoteError ? e.code : 'tracking_error', o.id)
            .run();
          if (e instanceof RemoteError && e.retry) throw e;
        }
      }
    }
    progress.pending.shift();
  }
  if (!progress.pending.length && progress.lastPage) {
    // Commit only after every cursor page has been processed, with overlap
    // for changes made during the sweep and boundary timestamps.
    await setState(env.DB, 'tracking_checkpoint', {
      since: new Date(Date.parse(progress.started) - 300000).toISOString(),
      at: now(),
    });
    await setState(env.DB, 'tracking_progress', null);
  } else await setState(env.DB, 'tracking_progress', progress);
}
// The private operations object serializes admin refreshes and scheduled polls.
// Opening the dashboard can bypass the normal cadence, never Retry-After or
// the one-minute deduplication window shared by repeated tabs and refreshes.
export async function refreshTracking(env: Env, requested = false) {
  const time = Date.now();
  const previous = await state(env.DB, 'tracking_last');
  const active = await env.DB.prepare(
    "SELECT id FROM orders WHERE mowarid_id IS NOT NULL AND (shipping_status IS NULL OR shipping_status NOT IN ('paid','cancelled','returned','deleted')) AND COALESCE(financial_status,'pending')!='paid' LIMIT 1",
  ).first();
  // Shorten an older 24-hour push-only deadline immediately after upgrading,
  // while keeping the latest request's five-minute window and Retry-After.
  const lastAt = Date.parse(previous?.at || '');
  const nextAt =
    active && Number.isFinite(lastAt)
      ? Math.min(previous?.nextAt || 0, lastAt + 300000)
      : previous?.nextAt || 0;
  if ((previous?.retryAt || 0) > time || (requested ? lastAt + 60000 > time : nextAt > time))
    return { skipped: true };
  if (
    !(await credential(env, 'mowarid')) ||
    !(await env.DB.prepare(
      'SELECT id FROM orders WHERE mowarid_id IS NOT NULL' +
        (requested
          ? ''
          : " AND (shipping_status IS NULL OR shipping_status NOT IN ('paid','returned','cancelled','deleted'))") +
        ' LIMIT 1',
    ).first())
  )
    return { skipped: true };
  try {
    await syncUpdatedOrders(env);
    const pendingPage = await state(env.DB, 'tracking_progress');
    // A successful subscription ping proves transport, not that every provider
    // status/address/tracking update emits a business event. Retain a bounded
    // incremental sweep while orders or delivered profits remain outstanding.
    const interval = pendingPage ? 60000 : active ? 300000 : 1800000;
    await setState(env.DB, 'tracking_last', {
      at: now(),
      error: null,
      nextAt: time + interval,
    });
    return { ok: true };
  } catch (e) {
    await setState(env.DB, 'tracking_last', {
      at: now(),
      error: e instanceof RemoteError ? e.code : 'tracking_error',
      retryAt: time + (e instanceof RemoteError ? e.after : 60) * 1000,
    });
    return { ok: false };
  }
}
export async function tick(env: Env) {
  await flushMetaEvents(env, 25);
  const last = (await state(env.DB, 'schedule')) || {};
  const time = Date.now();
  const key = await credential(env, 'mowarid');
  const imported = await env.DB.prepare('SELECT id FROM products LIMIT 1').first();
  const remoteOrders = await env.DB.prepare(
    'SELECT id FROM orders WHERE mowarid_id IS NOT NULL LIMIT 1',
  ).first();
  const jitter = (window: number) => Math.floor(Math.random() * window);
  if (key && imported && !last.catalogNext)
    last.catalogNext = Math.max(time, (last.catalog || time) + 900000) + jitter(180000);
  if (key && imported && last.catalogNext <= time) {
    await enqueue(env, 'catalog');
    last.catalog = time;
    last.catalogNext = time + 900000 + jitter(180000);
  }
  if ((imported || remoteOrders) && !last.citiesNext) {
    const cached = await env.DB.prepare('SELECT updated_at FROM cities WHERE id=1').first<{
      updated_at: string;
    }>();
    last.citiesNext = cached
      ? Math.max(time, Date.parse(cached.updated_at) + 86400000) + jitter(600000)
      : time;
  }
  if ((imported || remoteOrders) && last.citiesNext <= time) {
    await enqueue(env, 'cities');
    last.cities = time;
    last.citiesNext = time + 86400000 + jitter(600000);
  }
  if (time - (last.backup || 0) > 86400000) {
    await enqueue(env, 'backup');
    last.backup = time;
  }
  await setState(env.DB, 'schedule', last);
  if (key && env.ENVIRONMENT === 'production') {
    const sub = await state(env.DB, 'webhook_subscription');
    if (
      !sub ||
      (sub.requestedKeyFingerprint || sub.keyFingerprint) !== (await digest(key)) ||
      (sub.status === 'error' && (sub.retryAt || 0) <= time) ||
      (sub.status === 'active' && Date.parse(sub.verifiedAt || '') + 86400000 <= time)
    )
      await queueWebhookConnection(env);
  }
  await runJobs(env, 1);
  await processWebhooks(env);
  await refreshTracking(env);
  const push = await webhookReady(env, key);
  const rows = await env.DB.prepare(
    "SELECT * FROM orders WHERE mowarid_id IS NOT NULL AND (shipping_status IS NULL OR shipping_status NOT IN ('paid','returned','cancelled','deleted')) AND next_poll<=? ORDER BY next_poll LIMIT 1",
  )
    .bind(time)
    .all<OrderRow>();
  for (const o of rows.results) {
    if (last.directPollNext && last.directPollNext > time) break;
    if (!key) break;
    last.directPollNext = time + (push ? 3600000 : 600000) + jitter(60000);
    await setState(env.DB, 'schedule', last);
    try {
      const data = await mowarid(env, '/orders?external_order_id=' + encodeURIComponent(o.id));
      const remote = data.orders?.find(
        (r: Record<string, unknown>) => r.external_order_id === o.id,
      );
      if (remote) await recordRemote(env, o, remote);
      else throw new RemoteError('remote_order_missing', false);
      if (push)
        await env.DB.prepare('UPDATE orders SET next_poll=? WHERE id=?')
          .bind(time + 86400000, o.id)
          .run();
    } catch (e) {
      await env.DB.prepare('UPDATE orders SET next_poll=?,last_error=? WHERE id=?')
        .bind(time + 3600000, e instanceof RemoteError ? e.code : 'tracking_error', o.id)
        .run();
    }
  }
  if (time - (last.cleanup || 0) > 3600000) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM limits WHERE expires_at<?').bind(Math.floor(time / 1000)),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(time),
      env.DB.prepare('DELETE FROM auth_challenges WHERE expires_at<?').bind(time),
      env.DB.prepare("DELETE FROM visits WHERE date<date('now','-90 days')"),
      env.DB.prepare('DELETE FROM meta_events WHERE created_at<?').bind(time - 7 * 86400000),
      env.DB.prepare(
        "DELETE FROM webhook_inbox WHERE status IN ('done','ignored') AND received_at<datetime('now','-30 days')",
      ),
      env.DB.prepare("DELETE FROM audit WHERE created_at<datetime('now','-90 days')"),
      env.DB.prepare(
        "DELETE FROM jobs WHERE order_id IS NULL AND status='done' AND created_at<datetime('now','-7 days')",
      ),
    ]);
    last.cleanup = time;
    await setState(env.DB, 'schedule', last);
  }
}
export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const usage = instrument(env.DB);
    ctx.waitUntil(tick({ ...env, DB: usage.db }).finally(() => usage.flush()));
  },
};
