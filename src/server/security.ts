import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Env } from './db';
import { DomainError } from '../shared/domain';
const enc = new TextEncoder();
const b64 = (v: Uint8Array) => {
  // Catalog and product backup parts can exceed the JavaScript argument limit.
  let binary = '';
  for (let at = 0; at < v.length; at += 8192)
    binary += String.fromCharCode(...v.subarray(at, at + 8192));
  return btoa(binary);
};
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const random = (size = 32) => b64(crypto.getRandomValues(new Uint8Array(size)));
export async function digest(s: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
async function pepper(value: string, secret: string) {
  if (!secret) throw new Error('AUTH_PEPPER is required');
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}
export async function passwordHash(
  value: string,
  secret: string,
  salt = random(16),
  iterations = 600000,
) {
  const key = await crypto.subtle.importKey('raw', await pepper(value, secret), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations },
    key,
    256,
  );
  return 'pbkdf2-sha256:' + iterations + ':' + salt + ':' + b64(new Uint8Array(bits));
}
export async function passwordMatches(
  value: string,
  stored: string,
  secret: string,
  allowLegacy = false,
) {
  const parts = stored.split(':');
  if (parts.length === 2) {
    if (!allowLegacy) return false;
    const result = await passwordHash(value, secret, parts[0], 100000);
    return constantEqual(result.split(':').slice(2).join(':'), stored);
  }
  if (
    parts.length !== 4 ||
    parts[0] !== 'pbkdf2-sha256' ||
    Number(parts[1]) < 600000 ||
    Number(parts[1]) > 1000000
  )
    return false;
  const actual = await passwordHash(value, secret, parts[2], Number(parts[1]));
  return constantEqual(actual, stored);
}
export function constantEqual(a: string, b: string) {
  let n = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    n |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return n === 0;
}
export const dummyOwnerHash =
  'scrypt:32768:8:3:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
export function requireOwnerAuth(env: Env) {
  if (env.ENVIRONMENT !== 'development' && !env.PASSWORD_HASHER)
    throw new DomainError('auth_unavailable', 'خدمة الدخول الآمن لم تُجهّز بعد.', 503);
}
async function ownerKdf(env: Env, body: Record<string, unknown>) {
  requireOwnerAuth(env);
  const stub = env.PASSWORD_HASHER!.get(env.PASSWORD_HASHER!.idFromName('owner'));
  const response = await stub.fetch('https://password.internal/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new DomainError('auth_unavailable', 'تعذر تشغيل خدمة الدخول الآمن.', 503);
  return response.json() as Promise<{ hash?: string; matches?: boolean; ok?: boolean }>;
}
export async function ownerPasswordHash(env: Env, value: string) {
  if (!env.PASSWORD_HASHER) {
    requireOwnerAuth(env);
    return passwordHash(value, env.AUTH_PEPPER);
  }
  const result = await ownerKdf(env, { operation: 'hash', password: value });
  if (!result.hash?.startsWith('scrypt:32768:8:3:'))
    throw new DomainError('auth_unavailable', 'استجابة خدمة الدخول غير صالحة.', 503);
  return result.hash;
}
export async function ownerPasswordMatches(env: Env, value: string, stored: string) {
  if (!env.PASSWORD_HASHER) {
    requireOwnerAuth(env);
    return passwordMatches(value, stored, env.AUTH_PEPPER, true);
  }
  const result = await ownerKdf(env, { operation: 'verify', password: value, stored });
  return result.matches === true;
}
export async function checkOwnerAuth(env: Env) {
  return (await ownerKdf(env, { operation: 'check' })).ok === true;
}
async function aes(env: Env) {
  const key = bytes(env.ENCRYPTION_KEY || '');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must contain 32 base64-encoded bytes');
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptSecret(env: Env, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return (
    b64(iv) +
    '.' +
    b64(
      new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(env), enc.encode(value)),
      ),
    )
  );
}
export async function decryptSecret(env: Env, value: string) {
  const [iv, cipher] = value.split('.');
  return new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, await aes(env), bytes(cipher)),
  );
}
export async function credential(env: Env, name: string) {
  const r = await env.DB.prepare('SELECT encrypted FROM credentials WHERE name=?')
    .bind(name)
    .first<{ encrypted: string }>();
  return r ? decryptSecret(env, r.encrypted) : '';
}
export async function saveCredential(env: Env, name: string, value: string) {
  if (!value) return;
  await env.DB.prepare(
    'INSERT INTO credentials VALUES(?,?) ON CONFLICT(name) DO UPDATE SET encrypted=excluded.encrypted',
  )
    .bind(name, await encryptSecret(env, value))
    .run();
}
export function sameOrigin(c: Context) {
  const origin = c.req.header('Origin');
  const expected = new URL(c.req.url).origin;
  if (!origin || (origin !== expected && origin !== (c.env as Env).APP_ORIGIN))
    throw new DomainError('forbidden_origin', 'الطلب غير مصرح به.', 403);
}
export async function limit(env: Env, key: string, max: number, seconds: number) {
  const current = Math.floor(Date.now() / 1000),
    bucket = Math.floor(current / seconds),
    safeKey = await digest(key + ':' + bucket);
  const r = await env.DB.prepare(
    'INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
  )
    .bind(safeKey, (bucket + 1) * seconds)
    .first<{ count: number }>();
  if (r && r.count > max)
    throw new DomainError('rate_limited', 'طلبات كثيرة. حاول مجددًا بعد قليل.', 429);
}
export async function rate(c: Context, max: number, seconds: number, label: string) {
  const env = c.env as Env;
  const ip =
    c.req.header('CF-Connecting-IP') || (env.ENVIRONMENT === 'development' ? 'local' : 'unknown');
  await limit(env, label + ':' + b64(await pepper(ip, env.AUTH_PEPPER)), max, seconds);
}
export async function turnstile(
  env: Env,
  token: string,
  action: string,
  verification: { secret?: string; origin?: string } = {},
) {
  // Bindings can be supplied by a runtime proxy; keep the original Env object.
  if (env.ENVIRONMENT === 'development' && !env.TURNSTILE_SECRET && !verification.secret) return;
  const secret =
    verification.secret || env.TURNSTILE_SECRET || (await credential(env, 'turnstile'));
  if (env.ENVIRONMENT === 'development' && !secret) return;
  if (!secret || !token) throw new DomainError('captcha_required', 'أكمل التحقق الأمني.');
  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token }),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await result.json()) as { success: boolean; action?: string; hostname?: string };
  const expectedOrigin = verification.origin || env.APP_ORIGIN;
  const host = expectedOrigin ? new URL(expectedOrigin).hostname : undefined;
  if (!data.success || data.action !== action || (host && data.hostname !== host))
    throw new DomainError('captcha_failed', 'لم ينجح التحقق الأمني. حاول مجددًا.');
}
const sessionLifetime = 30 * 24 * 3600000;
const sessionRenewInterval = 24 * 3600000;
type AdminSession = { admin_id: string; csrf: string; expires_at: number };
function sessionCookie(c: Context, token: string, expiresAt: number) {
  setCookie(c, 'session', token, {
    httpOnly: true,
    secure: (c.env as Env).ENVIRONMENT !== 'development',
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
    expires: new Date(expiresAt),
  });
}
export async function startSession(
  c: Context,
  admin: string,
  proof: { password?: string; passkey?: string },
) {
  const env = c.env as Env,
    token = random(),
    csrf = random(),
    expiresAt = Date.now() + sessionLifetime;
  if (!proof.password && !proof.passkey) throw new Error('Missing authentication proof');
  // Validate the proof in the same statement that creates the session. A reset
  // between password/passkey verification and this insert must not restore access.
  const result = await env.DB.prepare(
    "INSERT INTO sessions SELECT ?,id,?,? FROM admins WHERE id=? AND (?='' OR password=?) AND (?='' OR EXISTS(SELECT 1 FROM passkeys WHERE id=? AND admin_id=admins.id))",
  )
    .bind(
      await digest(token),
      csrf,
      expiresAt,
      admin,
      proof.password || '',
      proof.password || '',
      proof.passkey || '',
      proof.passkey || '',
    )
    .run();
  if (!result.meta.changes)
    throw new DomainError('auth_changed', 'تغيرت بيانات الحساب أثناء الدخول. أعد المحاولة.', 401);
  sessionCookie(c, token, expiresAt);
  return csrf;
}
export async function session(c: Context) {
  const token = getCookie(c, 'session');
  if (!token) return null;
  const db = (c.env as Env).DB,
    hash = await digest(token),
    time = Date.now();
  const read = () =>
    db
      .prepare('SELECT admin_id,csrf,expires_at FROM sessions WHERE hash=? AND expires_at>?')
      .bind(hash, Date.now())
      .first<AdminSession>();
  let current = await read();
  if (!current) return null;
  if (current.expires_at <= time + sessionLifetime - sessionRenewInterval) {
    // Renew existing valid sessions at most once per day. Never insert/upsert:
    // a logout or password reset racing this request must not restore access.
    current =
      (await db
        .prepare(
          'UPDATE sessions SET expires_at=? WHERE hash=? AND expires_at>? AND expires_at<=? RETURNING admin_id,csrf,expires_at',
        )
        .bind(
          time + sessionLifetime,
          hash,
          Date.now(),
          time + sessionLifetime - sessionRenewInterval,
        )
        .first<AdminSession>()) || (await read());
    // Another request may already have renewed it; a revoked/expired one stays invalid.
    if (!current) return null;
    sessionCookie(c, token, current.expires_at);
  }
  return { admin_id: current.admin_id, csrf: current.csrf };
}
export async function endSession(c: Context) {
  const token = getCookie(c, 'session');
  if (token)
    await (c.env as Env).DB.prepare('DELETE FROM sessions WHERE hash=?')
      .bind(await digest(token))
      .run();
  deleteCookie(c, 'session', { path: '/' });
}
