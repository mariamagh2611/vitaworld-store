import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Env } from './db';
import { digest, random } from './security';
import { DomainError } from '../shared/domain';
import type { PasskeyInput } from './passkey-verifier';
export const challengeValue = () =>
  random().replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export async function issueChallenge(
  c: Context,
  kind: string,
  challenge: string,
  admin: string | null = null,
  binding = '',
) {
  const env = c.env as Env,
    token = random();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_challenges WHERE expires_at<?').bind(Date.now()),
    env.DB.prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?,?)').bind(
      await digest(token),
      kind,
      admin,
      challenge,
      binding,
      Date.now() + (kind === 'bootstrap' ? 86400000 : 300000),
    ),
  ]);
  setCookie(c, kind === 'bootstrap' ? 'owner_setup' : 'owner_challenge', token, {
    httpOnly: true,
    secure: env.ENVIRONMENT !== 'development',
    sameSite: 'Strict',
    path: '/api/',
    maxAge: kind === 'bootstrap' ? 86400 : 300,
  });
}
export async function bootstrapAllowed(c: Context) {
  const token = getCookie(c, 'owner_setup');
  if (!token) return false;
  return !!(await (c.env as Env).DB.prepare(
    "SELECT hash FROM auth_challenges WHERE hash=? AND kind='bootstrap' AND expires_at>?",
  )
    .bind(await digest(token), Date.now())
    .first());
}
export async function consumeChallenge(c: Context, kind: string, binding = '') {
  const token = getCookie(c, 'owner_challenge');
  if (!token) throw new DomainError('challenge_expired', 'أعد المحاولة لبدء التحقق من جهازك.', 401);
  deleteCookie(c, 'owner_challenge', { path: '/api/' });
  const row = await (c.env as Env).DB.prepare(
    'DELETE FROM auth_challenges WHERE hash=? AND kind=? AND binding=? AND expires_at>? RETURNING challenge,admin_id',
  )
    .bind(await digest(token), kind, binding, Date.now())
    .first<{ challenge: string; admin_id: string | null }>();
  if (!row) throw new DomainError('challenge_expired', 'انتهت صلاحية التحقق. أعد المحاولة.', 401);
  return row;
}
export async function verifiedPasskey(env: Env, input: PasskeyInput) {
  try {
    if (!env.PASSWORD_HASHER && env.ENVIRONMENT === 'development')
      return await (await import('./passkey-verifier')).verifyPasskey(input);
    if (!env.PASSWORD_HASHER) throw new Error('Unavailable');
    const response = await env.PASSWORD_HASHER.get(env.PASSWORD_HASHER.idFromName('owner')).fetch(
      'https://password.internal/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) throw new Error('Verification failed');
    return (await response.json()) as {
      id?: string;
      publicKey?: string;
      counter: number;
      transports?: string[];
    };
  } catch {
    throw new DomainError(
      'invalid_passkey',
      'لم ينجح التحقق من مفتاح الدخول. أعد المحاولة أو استخدم ملف الاسترداد.',
      401,
    );
  }
}
