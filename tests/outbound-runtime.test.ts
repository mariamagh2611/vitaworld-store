import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { saveCredential } from '../src/server/security';
import type { Env } from '../src/server/db';

let runtime: Miniflare;
let redirect = false;
const requests: string[] = [];
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { mowarid } from './src/server/mowarid';
        import { metaPurchase } from './src/server/jobs';
        export default { async fetch(request, env) {
          try {
            if (new URL(request.url).pathname === '/meta') {
              await metaPurchase(env, {id:'native-purchase',shipping_status:'delivered',delivered_at:new Date().toISOString(),customer:JSON.stringify({phone:'0612345678'}),remote:null,matching:JSON.stringify({}),quote:JSON.stringify({total:15900,items:[]})});
              return Response.json({ok:true});
            }
            return Response.json(await mowarid(env, '/orders?action=ping'));
          } catch(error) { return Response.json({error:error.code},{status:502}); }
        }};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-10-01',
      d1Databases: ['DB'],
      bindings: { ENVIRONMENT: 'development', ENCRYPTION_KEY: btoa('a'.repeat(32)) },
      outboundService: async (request: Request) => {
        requests.push(request.url);
        const url = new URL(request.url);
        expect(['mowarid.ma', 'graph.facebook.com']).toContain(url.hostname);
        expect(request.headers.has('Authorization')).toBe(true);
        if (redirect)
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://untrusted.test/steal' },
          });
        return Response.json(
          url.hostname === 'mowarid.ma' ? { success: true, orders: [] } : { events_received: 1 },
        );
      },
    }),
  );
  const DB = await runtime.getD1Database('DB');
  await DB.exec(await readFile('migrations/0001_initial.sql', 'utf8'));
  const env = { DB, ENCRYPTION_KEY: btoa('a'.repeat(32)) } as Env;
  await saveCredential(env, 'mowarid', 'mw_live_native-runtime-fixture');
  await saveCredential(env, 'meta', 'native-meta-fixture');
  await DB.prepare('INSERT INTO settings VALUES(1,?)')
    .bind(JSON.stringify({ trackingEnabled: true, facebookPixel: '12345' }))
    .run();
});
afterAll(async () => runtime?.dispose());
describe('credentialed requests in the actual Workers runtime', () => {
  it('reaches the partner without using unsupported redirect modes', async () => {
    const response = await runtime.dispatchFetch('https://store.test/ping');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
  });
  it('rejects partner redirects without forwarding credentials to another host', async () => {
    redirect = true;
    const before = requests.length;
    const response = await runtime.dispatchFetch('https://store.test/ping');
    expect(await response.json()).toEqual({ error: 'remote_redirect_rejected' });
    expect(requests.length - before).toBe(1);
    redirect = false;
  });
  it('also delivers Meta events and rejects redirects in native runtime', async () => {
    expect((await runtime.dispatchFetch('https://store.test/meta')).status).toBe(200);
    redirect = true;
    const before = requests.length;
    expect(await (await runtime.dispatchFetch('https://store.test/meta')).json()).toEqual({
      error: 'meta_redirect_rejected',
    });
    expect(requests.length - before).toBe(1);
    redirect = false;
  });
});
