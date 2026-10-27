import type { Env } from './db';

const proofPath = '/api/store-origin-proof';
const encoder = new TextEncoder();

// Domain-separated HMAC: a different installation cannot attest to this store.
export async function storeOriginProof(env: Env, origin: string, challenge: string) {
  if (!env.AUTH_PEPPER) throw new Error('AUTH_PEPPER is required');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.AUTH_PEPPER),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(JSON.stringify(['store-origin-proof-v1', origin, challenge])),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export async function campaignOriginAllowed(env: Env, requestUrl: string, target: URL) {
  if (target.username || target.password || !['https:', 'http:'].includes(target.protocol))
    return false;
  const requestOrigin = new URL(requestUrl).origin;
  const configuredOrigin = new URL(env.APP_ORIGIN || requestUrl).origin;
  if (target.origin === requestOrigin || target.origin === configuredOrigin) return true;
  // Only probe public HTTPS DNS names, on the standard port, at a fixed read-only
  // endpoint. Never forward the admin cookie, CSRF token, campaign or target path.
  if (
    target.protocol !== 'https:' ||
    target.port ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(target.hostname) ||
    /\.(?:localhost|local|internal|lan|home|onion|arpa|invalid)$/.test(target.hostname)
  )
    return false;
  const challenge = crypto.randomUUID();
  const probe = new URL(proofPath, target.origin);
  probe.searchParams.set('challenge', challenge);
  try {
    const response = await fetch(probe, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'text/plain' },
    });
    // No redirects: an unrelated host must not borrow another host's proof.
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('text/plain')) {
      await response.body?.cancel();
      return false;
    }
    // Bound the response even if an unrelated server streams an unbounded body.
    const reader = response.body?.getReader();
    if (!reader) return false;
    let proof = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.length + proof.length > 64) return false;
        proof += new TextDecoder().decode(value);
      }
    } finally {
      await reader.cancel();
    }
    return proof === (await storeOriginProof(env, target.origin, challenge));
  } catch {
    return false;
  }
}
