import { createHmac, pbkdf2Sync, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Env } from './db';
import { verifyPasskey } from './passkey-verifier';

// Native scrypt runs only in this private Durable Object, whose CPU allowance
// supports a password KDF. The public Worker never performs this heavy work.
// OWASP profile: 32 MiB, N=2^15, r=8, p=3. No persistent DO data or logs.
const profile = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const saltPattern = /^[A-Za-z0-9+/]{22}==$/;
const hashPattern = /^[A-Za-z0-9+/]{43}=$/;
export class PasswordHasher {
  constructor(
    _state: DurableObjectState,
    private env: Env,
  ) {}
  private input(password: string) {
    if (!this.env.AUTH_PEPPER) throw new Error('Missing auth secret');
    return createHmac('sha256', this.env.AUTH_PEPPER).update(password).digest();
  }
  private hash(password: string, salt = Buffer.from(randomBytes(16)).toString('base64')) {
    const result = scryptSync(this.input(password), Buffer.from(salt, 'base64'), 32, profile);
    return 'scrypt:32768:8:3:' + salt + ':' + Buffer.from(result).toString('base64');
  }
  private matches(password: string, stored: string) {
    const parts = stored.split(':');
    if (
      parts.length === 6 &&
      parts.slice(0, 4).join(':') === 'scrypt:32768:8:3' &&
      saltPattern.test(parts[4]) &&
      hashPattern.test(parts[5])
    ) {
      const actual = this.hash(password, parts[4]).split(':')[5];
      return timingSafeEqual(Buffer.from(actual, 'base64'), Buffer.from(parts[5], 'base64'));
    }
    // Existing supported PBKDF2 accounts may migrate after a successful login.
    if (
      parts.length === 4 &&
      parts[0] === 'pbkdf2-sha256' &&
      /^[0-9]+$/.test(parts[1]) &&
      Number(parts[1]) >= 600000 &&
      Number(parts[1]) <= 1000000 &&
      saltPattern.test(parts[2]) &&
      hashPattern.test(parts[3])
    ) {
      const actual = pbkdf2Sync(
        this.input(password),
        Buffer.from(parts[2], 'base64'),
        Number(parts[1]),
        32,
        'sha256',
      );
      return timingSafeEqual(actual, Buffer.from(parts[3], 'base64'));
    }
    return false;
  }
  async fetch(request: Request) {
    if (request.method !== 'POST' || Number(request.headers.get('content-length') || 0) > 65536)
      return new Response(null, { status: 400 });
    try {
      const text = await request.text();
      if (text.length > 65536) return new Response(null, { status: 400 });
      const body = JSON.parse(text);
      if (['passkey-register', 'passkey-authenticate'].includes(body.operation)) {
        if (body.origin !== this.env.APP_ORIGIN) return new Response(null, { status: 400 });
        try {
          return Response.json(await verifyPasskey(body));
        } catch {
          return new Response(null, { status: 401 });
        }
      }
      if (text.length > 4096) return new Response(null, { status: 400 });
      if (body.operation === 'check') {
        const hash = this.hash('internal-scrypt-availability-check');
        return Response.json({
          ok:
            this.matches('internal-scrypt-availability-check', hash) &&
            !this.matches('incorrect-value', hash),
        });
      }
      if (typeof body.password !== 'string' || body.password.length > 128)
        return new Response(null, { status: 400 });
      if (body.operation === 'hash' && body.password.length >= 8)
        return Response.json({ hash: this.hash(body.password) });
      if (
        body.operation === 'verify' &&
        typeof body.stored === 'string' &&
        body.stored.length <= 200
      )
        return Response.json({ matches: this.matches(body.password, body.stored) });
      return new Response(null, { status: 400 });
    } catch {
      // Never return KDF inputs, secrets or platform error details.
      return new Response(null, { status: 503 });
    }
  }
}
