import { z } from 'zod';
import { state, setState, order, now, type Env } from './db';
import { credential, digest, encryptSecret, decryptSecret } from './security';
import { mowarid, RemoteError } from './mowarid';
import { DomainError } from '../shared/domain';
import { recordRemote } from './tracking';
import { verifyMowaridWebhook } from './webhook-signature';

const events = ['order.delivered', 'order.status_updated', 'order.financial_updated'];
const subscriptionSchema = z.object({
  id: z.string().min(1).max(200),
  url: z.url(),
  events: z.array(z.string()),
  is_active: z.boolean(),
  secret: z.string().min(16).max(500).optional(),
});
function receiverUrl(env: Env) {
  if (!env.APP_ORIGIN) return null;
  const url = new URL(env.APP_ORIGIN);
  return url.protocol === 'https:' && !url.username && !url.password
    ? url.origin + '/api/webhooks/mowarid'
    : null;
}
export async function queueWebhookConnection(env: Env, requested = false) {
  if (env.ENVIRONMENT !== 'production' || !receiverUrl(env) || !(await credential(env, 'mowarid')))
    return false;
  await env.DB.prepare(
    "INSERT INTO jobs(id,type,run_at,created_at) SELECT ?,'webhook_connect',0,? WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE type='webhook_connect' AND status IN ('pending','running'))",
  )
    .bind(crypto.randomUUID(), now())
    .run();
  if (requested)
    await env.DB.prepare(
      "UPDATE jobs SET run_at=0 WHERE type='webhook_connect' AND status='pending' AND COALESCE(last_error,'')<>'rate_limit_exceeded'",
    ).run();
  return true;
}
export async function connectWebhooks(env: Env) {
  const url = receiverUrl(env),
    key = await credential(env, 'mowarid');
  if (!url || !key) throw new RemoteError('webhook_configuration_missing', false);
  const fingerprint = await digest(key),
    old = await state(env.DB, 'webhook_subscription');
  let connection: Record<string, any> = {
    ...old,
    requestedKeyFingerprint: fingerprint,
    status: 'connecting',
    error: null,
    attemptAt: now(),
  };
  await setState(env.DB, 'webhook_subscription', connection);
  try {
    // Reconcile every creation, including lost POST responses. Never blindly
    // consume another subscription slot; a one-time secret can be recovered
    // by rotating only the subscription owned by this URL.
    const list = await mowarid(env, '/webhooks/subscriptions');
    if (list.success !== true || !Array.isArray(list.subscriptions))
      throw new RemoteError('invalid_webhook_list', false);
    const parsed = list.subscriptions.map((value: unknown) => subscriptionSchema.parse(value));
    let sub =
      parsed.find(
        (value: z.infer<typeof subscriptionSchema>) =>
          value.id === old?.id && value.url === url && value.is_active,
      ) ||
      parsed.find(
        (value: z.infer<typeof subscriptionSchema>) => value.url === url && value.is_active,
      );
    if (sub && !events.every((event) => sub!.events.includes(event)))
      throw new RemoteError('webhook_events_missing', false);
    const savedSecret = await credential(env, 'mowarid_webhook');
    let secret = old?.id === sub?.id && old?.keyFingerprint === fingerprint ? savedSecret : '';
    if (!sub) {
      const result = await mowarid(env, '/webhooks/subscriptions', {
        url,
        events,
        description: 'متجر Cloudflare مستقل',
      });
      if (result.success !== true) throw new RemoteError('webhook_creation_rejected', false);
      sub = subscriptionSchema.parse(result.subscription);
      secret = sub.secret || '';
    } else if (!secret) {
      const result = await mowarid(
        env,
        '/webhooks/subscriptions/' + encodeURIComponent(sub.id) + '/rotate-secret',
        {},
      );
      if (result.success !== true) throw new RemoteError('webhook_rotation_rejected', false);
      secret = result.subscription?.secret || result.secret || '';
    }
    if (
      sub.url !== url ||
      !sub.is_active ||
      !events.every((event) => sub!.events.includes(event)) ||
      typeof secret !== 'string' ||
      secret.length < 16 ||
      secret.length > 500
    )
      throw new RemoteError('invalid_webhook_subscription', false);
    if (key !== (await credential(env, 'mowarid')))
      throw new RemoteError('credentials_changed', true);
    connection = {
      id: sub.id,
      url,
      keyFingerprint: fingerprint,
      requestedKeyFingerprint: fingerprint,
      status: 'testing',
      error: null,
      attemptAt: now(),
      verifiedAt: null,
    };
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO credentials VALUES(?,?) ON CONFLICT(name) DO UPDATE SET encrypted=excluded.encrypted',
      ).bind('mowarid_webhook', await encryptSecret(env, secret)),
      env.DB.prepare(
        'INSERT INTO sync_state VALUES(?,?) ON CONFLICT(name) DO UPDATE SET json=excluded.json',
      ).bind('webhook_subscription', JSON.stringify(connection)),
    ]);
    const requestedAt = Date.now();
    const subscriptionPath = '/webhooks/subscriptions/' + encodeURIComponent(sub.id);
    let test;
    try {
      test = await mowarid(env, subscriptionPath + '/ping', {});
    } catch (error) {
      // Older deployments expose /test. Only a missing route permits this
      // compatibility retry; auth, rate limits and server errors still stop setup.
      if (
        !(error instanceof RemoteError) ||
        !['remote_http_404', 'remote_http_405'].includes(error.code)
      )
        throw error;
      test = await mowarid(env, subscriptionPath + '/test', {});
    }
    const received = await state(env.DB, 'webhook_last_received');
    if (
      test.success !== true ||
      Date.parse(received?.at || '') < requestedAt ||
      received?.keyFingerprint !== fingerprint
    )
      throw new RemoteError('webhook_delivery_test_failed', true, 300);
    // Do not let an in-flight setup for an older API key activate this account.
    if (key !== (await credential(env, 'mowarid')))
      throw new RemoteError('credentials_changed', true);
    await setState(env.DB, 'webhook_subscription', {
      ...connection,
      status: 'active',
      verifiedAt: now(),
    });
    await setState(env.DB, 'tracking_last', { nextAt: 0 });
  } catch (error) {
    await setState(env.DB, 'webhook_subscription', {
      ...connection,
      status: 'error',
      error: error instanceof RemoteError ? error.code : 'invalid_webhook_contract',
      retryAt: Date.now() + 1800000,
    });
    throw error;
  }
}
export async function webhookReady(env: Env, key?: string) {
  const sub = await state(env.DB, 'webhook_subscription');
  if (sub?.status !== 'active' || !sub.verifiedAt || sub.url !== receiverUrl(env)) return false;
  const current = key ?? (await credential(env, 'mowarid'));
  if (
    !current ||
    sub.keyFingerprint !== (await digest(current)) ||
    !(await credential(env, 'mowarid_webhook'))
  )
    return false;
  return !(await env.DB.prepare(
    "SELECT event_id FROM webhook_inbox WHERE status='failed' OR (status IN ('pending','processing') AND received_at<?) LIMIT 1",
  )
    .bind(new Date(Date.now() - 120000).toISOString())
    .first());
}
export async function receiveWebhook(env: Env, raw: Uint8Array, signature: string) {
  const sub = await state(env.DB, 'webhook_subscription');
  const secret = await credential(env, 'mowarid_webhook');
  if (!sub?.keyFingerprint || !secret || !(await verifyMowaridWebhook(raw, signature, secret)))
    throw new DomainError('webhook_signature_invalid', 'توقيع الإشعار غير صالح.', 401);
  const key = await credential(env, 'mowarid');
  if (!key || (await digest(key)) !== sub.keyFingerprint)
    throw new DomainError('webhook_account_changed', 'تغير حساب الربط.', 401);
  const schema = z.object({
    event_id: z.string().min(1).max(200),
    event_type: z.string().min(1).max(100),
    api_version: z.string().optional(),
    data: z.unknown().optional(),
  });
  let event: z.infer<typeof schema>;
  try {
    event = schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
  } catch {
    throw new DomainError('webhook_payload_invalid', 'بيانات الإشعار غير صالحة.', 422);
  }
  const data = event.data as Record<string, any> | undefined;
  const remote = data?.order ?? data;
  const isOrder = events.includes(event.event_type);
  if (
    isOrder &&
    (event.api_version !== 'v1' ||
      !remote ||
      typeof remote.external_order_id !== 'string' ||
      typeof remote.order_id !== 'string')
  )
    throw new DomainError('webhook_order_invalid', 'بيانات الطلب في الإشعار غير صالحة.', 422);
  const local = isOrder ? await order(env.DB, remote!.external_order_id) : null;
  const relevant = !!local && (!!local.mowarid_id || !!local.post_attempted);
  const hash = await digest(new TextDecoder().decode(raw));
  const payload = relevant ? await encryptSecret(env, JSON.stringify(remote)) : null;
  const result = await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO webhook_inbox(event_id,body_hash,event_type,external_order_id,key_fingerprint,payload,status,received_at) VALUES(?,?,?,?,?,?,?,?)',
    ).bind(
      event.event_id,
      hash,
      event.event_type,
      isOrder ? remote!.external_order_id : null,
      sub.keyFingerprint,
      payload,
      relevant ? 'pending' : 'ignored',
      now(),
    ),
    env.DB.prepare('SELECT body_hash FROM webhook_inbox WHERE event_id=?').bind(event.event_id),
  ]);
  if ((result[1].results[0] as { body_hash: string }).body_hash !== hash)
    throw new DomainError('webhook_event_conflict', 'معرف الإشعار مستخدم ببيانات مختلفة.', 409);
  await setState(env.DB, 'webhook_last_received', {
    at: now(),
    eventId: event.event_id,
    eventType: event.event_type,
    keyFingerprint: sub.keyFingerprint,
  });
  // Acknowledge only after D1 persists the signed event. Processing is replayable
  // independently of the vendor's five-second delivery deadline.
  return { ok: true, duplicate: !result[0].meta.changes };
}
export async function processWebhooks(env: Env, max = 3) {
  for (let i = 0; i < max; i++) {
    const token = crypto.randomUUID();
    const row = await env.DB.prepare(
      "UPDATE webhook_inbox SET status='processing',attempts=attempts+1,lease_token=?,lease_until=? WHERE event_id=(SELECT event_id FROM webhook_inbox WHERE (status='pending' AND run_at<=?) OR (status='processing' AND lease_until<?) ORDER BY received_at LIMIT 1) RETURNING *",
    )
      .bind(token, Date.now() + 120000, Date.now(), Date.now())
      .first<{
        event_id: string;
        payload: string;
        key_fingerprint: string;
        external_order_id: string;
        attempts: number;
      }>();
    if (!row) break;
    try {
      if (row.key_fingerprint !== (await digest(await credential(env, 'mowarid'))))
        throw new RemoteError('webhook_account_changed', false);
      const remote = JSON.parse(await decryptSecret(env, row.payload));
      const local = await order(env.DB, row.external_order_id);
      if (!local?.mowarid_id) throw new RemoteError('webhook_waiting_for_order_acceptance', true);
      if (local.mowarid_id !== remote.order_id)
        throw new RemoteError('remote_order_identity_mismatch', false);
      if (!Number.isFinite(Date.parse(remote.timestamps?.updated_at || '')))
        throw new RemoteError('webhook_order_version_missing', false);
      await recordRemote(env, local, remote);
      await env.DB.prepare(
        "UPDATE webhook_inbox SET status='done',payload=NULL,lease_until=0,processed_at=?,last_error=NULL WHERE event_id=? AND lease_token=?",
      )
        .bind(now(), row.event_id, token)
        .run();
    } catch (error) {
      const retry = error instanceof RemoteError && error.retry && row.attempts < 12;
      await env.DB.prepare(
        'UPDATE webhook_inbox SET status=?,run_at=?,lease_until=0,last_error=? WHERE event_id=? AND lease_token=?',
      )
        .bind(
          retry ? 'pending' : 'failed',
          Date.now() + 60000,
          error instanceof RemoteError ? error.code : 'webhook_processing_error',
          row.event_id,
          token,
        )
        .run();
    }
  }
}
