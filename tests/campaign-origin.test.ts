import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/server/db';
import { campaignOriginAllowed, storeOriginProof } from '../src/server/campaign-origin';

const env = {
  AUTH_PEPPER: 'per-installation-test-secret',
  APP_ORIGIN: 'https://store.example.test',
} as Env;
const requestUrl = env.APP_ORIGIN + '/api/admin/campaign-links';
const target = new URL('https://shop.example.test/offers/demo?lang=fr');
afterEach(() => vi.unstubAllGlobals());
const respond = (callback: (url: URL, init: RequestInit) => Promise<Response> | Response) => {
  const mock = vi.fn((input: URL, init: RequestInit) => callback(new URL(input), init));
  vi.stubGlobal('fetch', mock);
  return mock;
};
const proofResponse = async (url: URL, proofEnv = env, proofOrigin = url.origin) =>
  new Response(await storeOriginProof(proofEnv, proofOrigin, url.searchParams.get('challenge')!), {
    headers: { 'Content-Type': 'text/plain' },
  });

describe('campaign domain verification', () => {
  it('accepts canonical and current request origins without network requests', async () => {
    const mock = respond(() => {
      throw Error('Unexpected fetch');
    });
    expect(await campaignOriginAllowed(env, requestUrl, new URL(env.APP_ORIGIN!))).toBe(true);
    expect(await campaignOriginAllowed(env, target.href, target)).toBe(true);
    expect(mock).not.toHaveBeenCalled();
  });
  it('proves an alias belongs to this installation using only its fixed read-only endpoint', async () => {
    const mock = respond(async (url, init) => {
      expect(url.pathname).toBe('/api/store-origin-proof');
      expect([...url.searchParams.keys()]).toEqual(['challenge']);
      expect(init.redirect).toBe('manual');
      expect(init.headers).toEqual({ Accept: 'text/plain' });
      expect(init.body).toBeUndefined();
      return proofResponse(url);
    });
    expect(await campaignOriginAllowed(env, requestUrl, target)).toBe(true);
    expect(await campaignOriginAllowed(env, requestUrl, target)).toBe(true);
    expect(mock.mock.calls[0][0].href).not.toBe(mock.mock.calls[1][0].href);
  });
  it('rejects another store and a proof relayed from a different hostname', async () => {
    respond((url) => proofResponse(url, { ...env, AUTH_PEPPER: 'another-store-secret' }));
    expect(await campaignOriginAllowed(env, requestUrl, target)).toBe(false);
    respond((url) => proofResponse(url, env, env.APP_ORIGIN));
    expect(await campaignOriginAllowed(env, requestUrl, target)).toBe(false);
  });
  it('rejects redirects, oversized responses, errors and network timeouts', async () => {
    for (const response of [
      new Response(null, { status: 302, headers: { Location: env.APP_ORIGIN! } }),
      new Response('x'.repeat(1000), { headers: { 'Content-Type': 'text/plain' } }),
      new Response('unrelated', { headers: { 'Content-Type': 'text/plain' } }),
      new Response('unavailable', { status: 503 }),
    ]) {
      respond(() => response);
      expect(await campaignOriginAllowed(env, requestUrl, target)).toBe(false);
    }
    respond(() => {
      throw new DOMException('Timed out', 'TimeoutError');
    });
    expect(await campaignOriginAllowed(env, requestUrl, target)).toBe(false);
  });
  it('does not probe IPs, private hostnames, non-HTTPS aliases, credentials or custom ports', async () => {
    const mock = respond(() => {
      throw Error('Unexpected fetch');
    });
    for (const url of [
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://169.254.169.254/',
      'https://localhost/',
      'https://service.internal/',
      'https://store.local/',
      'https://shop.example.test:8443/',
      'http://shop.example.test/',
      'https://user:password@store.example.test/',
      'ftp://shop.example.test/',
    ])
      expect(await campaignOriginAllowed(env, requestUrl, new URL(url)), url).toBe(false);
    expect(mock).not.toHaveBeenCalled();
  });
});
