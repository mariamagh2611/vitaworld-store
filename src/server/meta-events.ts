import type { Env } from './db';
import { settings, now, setState } from './db';
import { credential, constantEqual, digest, encryptSecret, decryptSecret } from './security';
import { storeOriginProof } from './campaign-origin';
import { META_GRAPH_VERSION } from './meta';
import { DomainError } from '../shared/domain';
import { RemoteError } from './mowarid';
import { metaPixelIds, metaCredentialName, metaHealthName } from '../shared/meta-pixels';

export type MetaEvent = {
  event_name: 'PageView' | 'ViewContent' | 'InitiateCheckout' | 'Lead' | 'Purchase';
  event_id: string;
  event_time: number;
  action_source: 'website' | 'other';
  event_source_url?: string;
  user_data: Record<string, string | string[]>;
  custom_data?: Record<string, unknown>;
};
const pagePath =
  /^\/(?:$|checkout$|(?:shop|offers|products)\/[^/?#]+$|(?:offers\/[^/?#]+\/)?policies\/(?:terms|privacy|returns|contact)$)/;
export function metaPageUrl(requestUrl: string, path: string) {
  const origin = new URL(requestUrl).origin;
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password || !pagePath.test(url.pathname))
    throw new DomainError('invalid_tracking_page', 'اختر صفحة من المتجر.');
  // Do not forward arbitrary query strings, fragments or form/customer fields.
  return origin + url.pathname;
}
export async function metaTicket(
  env: Env,
  requestUrl: string,
  pixel: string,
  expires = Date.now() + 2 * 3600000,
) {
  const signature = await storeOriginProof(
    env,
    new URL(requestUrl).origin,
    'meta-events:' + pixel + ':' + expires,
  );
  return expires + '.' + signature;
}
export async function validMetaTicket(env: Env, requestUrl: string, pixel: string, ticket: string) {
  if (!/^\d{13}\.[a-f0-9]{64}$/.test(ticket)) return false;
  const expires = Number(ticket.split('.')[0]);
  if (expires < Date.now() || expires > Date.now() + 2 * 3600000) return false;
  return constantEqual(ticket, await metaTicket(env, requestUrl, pixel, expires));
}
export async function metaConfiguredPixels(env: Env) {
  const s = await settings(env.DB);
  if (!s.trackingEnabled) return [];
  const configured = await Promise.all(
    metaPixelIds(s).map(async (pixel) =>
      (await credential(env, metaCredentialName(s, pixel))) ? pixel : '',
    ),
  );
  return configured.filter(Boolean);
}
export async function metaEventStatement(env: Env, pixel: string, event: MetaEvent) {
  // Bound anonymous web traffic per destination. One failing destination must
  // not exhaust another's queue, or drop a server-authoritative saved sale/lead.
  return env.DB.prepare(
    "INSERT OR IGNORE INTO meta_events(id,pixel_id,payload,run_at,created_at) SELECT ?,?,?,?,? WHERE ?=1 OR (SELECT COUNT(*) FROM meta_events WHERE pixel_id=? AND status IN ('pending','running'))<5000",
  ).bind(
    pixel + ':' + event.event_name + ':' + event.event_id,
    pixel,
    await encryptSecret(env, JSON.stringify(event)),
    Date.now(),
    Date.now(),
    event.event_name === 'Lead' || event.event_name === 'Purchase' ? 1 : 0,
    pixel,
  );
}
export async function sendMetaEvent(env: Env, pixel: string, event: MetaEvent, testCode?: string) {
  const s = await settings(env.DB),
    name = metaCredentialName(s, pixel),
    token = name ? await credential(env, name) : '';
  if (!s.trackingEnabled || !metaPixelIds(s).includes(pixel) || !token)
    throw new RemoteError('meta_not_configured', false);
  let response: Response;
  try {
    response = await fetch(
      'https://graph.facebook.com/' + META_GRAPH_VERSION + '/' + pixel + '/events',
      {
        method: 'POST',
        redirect: 'manual',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [event], ...(testCode ? { test_event_code: testCode } : {}) }),
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch {
    throw new RemoteError('meta_network_error', true);
  }
  if (response.status >= 300 && response.status < 400)
    throw new RemoteError('meta_redirect_rejected', false);
  const body = (await response.json().catch(() => ({}))) as {
    events_received?: number;
    error?: { code?: number };
  };
  const fingerprint = await digest(pixel + ':' + token);
  if (!response.ok || body.events_received !== 1) {
    await setState(env.DB, metaHealthName(s, pixel), {
      fingerprint,
      checkedAt: now(),
      errorCode: body.error?.code || response.status,
    });
    throw new RemoteError(
      'meta_rejected_' + (body.error?.code || response.status),
      response.status >= 500 || response.status === 429,
    );
  }
  await setState(env.DB, metaHealthName(s, pixel), {
    fingerprint,
    checkedAt: now(),
    lastSuccess: now(),
    errorCode: null,
  });
  return { accepted: true, test: !!testCode };
}
export async function flushMetaEvents(env: Env, max = 3) {
  const pixels = await metaConfiguredPixels(env);
  if (!pixels.length) return;
  for (let index = 0; index < max; index++) {
    const lease = crypto.randomUUID();
    const row = await env.DB.prepare(
      "UPDATE meta_events SET status='running',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=(SELECT id FROM meta_events WHERE (status='pending' AND run_at<=?) OR (status='running' AND lease_until<?) ORDER BY created_at LIMIT 1) RETURNING *",
    )
      .bind(lease, Date.now() + 60000, Date.now(), Date.now())
      .first<{
        id: string;
        pixel_id: string;
        payload: string;
        attempts: number;
        created_at: number;
      }>();
    if (!row) break;
    try {
      if (!pixels.includes(row.pixel_id)) throw new RemoteError('meta_pixel_changed', false);
      if (Date.now() - row.created_at > 6 * 86400000)
        throw new RemoteError('meta_event_expired', false);
      await sendMetaEvent(env, row.pixel_id, JSON.parse(await decryptSecret(env, row.payload)));
      await env.DB.prepare(
        "UPDATE meta_events SET status='sent',payload=NULL,lease_until=0,last_error=NULL WHERE id=? AND lease_token=?",
      )
        .bind(row.id, lease)
        .run();
    } catch (error) {
      const code = error instanceof RemoteError ? error.code : 'meta_event_error';
      const retry = error instanceof RemoteError && error.retry && row.attempts < 8;
      await env.DB.prepare(
        'UPDATE meta_events SET status=?,run_at=?,lease_until=0,last_error=? WHERE id=? AND lease_token=?',
      )
        .bind(
          retry ? 'pending' : 'failed',
          Date.now() + Math.min(3600000, 30000 * 2 ** row.attempts),
          code,
          row.id,
          lease,
        )
        .run();
    }
  }
}
export async function retryMetaEvents(env: Env, selected?: string) {
  const pixels = (await metaConfiguredPixels(env)).filter((p) => !selected || p === selected);
  if (!pixels.length) return;
  await env.DB.batch(
    pixels.map((pixel) =>
      env.DB.prepare(
        "UPDATE meta_events SET status='pending',attempts=0,run_at=?,lease_until=0,last_error=NULL WHERE status='failed' AND pixel_id=? AND created_at>?",
      ).bind(Date.now(), pixel, Date.now() - 6 * 86400000),
    ),
  );
}
