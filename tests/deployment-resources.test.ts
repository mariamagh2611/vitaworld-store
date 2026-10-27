import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const helpers = await import(pathToFileURL(resolve('scripts/deployment-resources.mjs')).href);
const { deploymentResources, deploymentDiagnostic, deploymentOrigin, waitForDeploymentStatus } =
  helpers;
const id = '11111111-1111-4111-8111-111111111111';
const config = {
  name: 'trainee-store',
  main: 'worker/index.js',
  vars: { INSTALLATION_MODE: 'cloudflare-button' },
  assets: { directory: 'dist' },
  d1_databases: [{ binding: 'DB', database_name: 'chosen-db', migrations_dir: 'migrations' }],
  r2_buckets: [
    { binding: 'MEDIA', bucket_name: 'chosen-images' },
    { binding: 'BACKUPS', bucket_name: 'chosen-backups' },
  ],
};
describe('resuming a Cloudflare button installation', () => {
  it('connects the selected existing database instead of trying to recreate it, preserving source and names', () => {
    const before = structuredClone(config);
    const resolved = deploymentResources(config, [
      { name: 'other-store', uuid: 'other' },
      { name: 'chosen-db', uuid: id },
    ]);
    expect(resolved.d1_databases[0]).toEqual({ ...config.d1_databases[0], database_id: id });
    expect(resolved.r2_buckets).toEqual(config.r2_buckets);
    expect(resolved.assets).toEqual(config.assets);
    expect(config).toEqual(before);
  });
  it('keeps a fully configured database ID even when another resource has the same name', () => {
    const explicit = { ...config, d1_databases: [{ ...config.d1_databases[0], database_id: id }] };
    expect(
      deploymentResources(explicit, [{ name: 'chosen-db', uuid: 'other' }]).d1_databases,
    ).toEqual(explicit.d1_databases);
  });
  it('uses the CI Worker name for a new installation, matching Wrangler resource naming', () => {
    const unnamed = {
      ...config,
      d1_databases: [{ binding: 'DB' }],
      r2_buckets: [{ binding: 'MEDIA' }, { binding: 'BACKUPS' }],
    };
    const result = deploymentResources(unnamed, [{ name: 'new-shop-db', uuid: id }], 'new-shop');
    expect(result.d1_databases[0]).toEqual({
      binding: 'DB',
      database_name: 'new-shop-db',
      database_id: id,
    });
    expect(result.r2_buckets).toEqual(unnamed.r2_buckets);
    const fresh = deploymentResources(unnamed, [], 'new-shop');
    expect(fresh.d1_databases[0]).toEqual({ binding: 'DB', database_name: 'new-shop-db' });
  });
  it('stops on invalid or ambiguous resource lists, and keeps images separate from backups', () => {
    expect(() => deploymentResources(config, null)).toThrow('database list');
    expect(() => deploymentResources(config, [{ name: 'chosen-db', uuid: 'invalid' }])).toThrow(
      'identifier',
    );
    expect(() =>
      deploymentResources(config, [
        { name: 'chosen-db', uuid: id },
        { name: 'chosen-db', uuid: id },
      ]),
    ).toThrow('More than one');
    expect(() =>
      deploymentResources(
        {
          ...config,
          r2_buckets: [
            { binding: 'MEDIA', bucket_name: 'same' },
            { binding: 'BACKUPS', bucket_name: 'same' },
          ],
        },
        [],
      ),
    ).toThrow('different R2');
  });
  it('shows the actual provider error while redacting credentials from the diagnostic', () => {
    const secret = 'a-private-installation-test-token';
    const output = deploymentDiagnostic(
      `Progress...\n\u001b[31m✘ [ERROR] A database with that name already exists\u001b[0m\nBearer test-only-auth-token\n${secret}\nSETUP_TOKEN=unrecognized-private-value`,
      [secret],
    );
    expect(output).toContain('A database with that name already exists');
    expect(output).not.toContain(secret);
    expect(output).not.toContain('test-only-auth-token');
    expect(output).not.toContain('unrecognized-private-value');
    expect(deploymentDiagnostic('opaque failure')).toContain('recognizable error');
  });
  it('prepares an empty installation before DNS is ready and preserves the canonical origin of existing stores', () => {
    const fresh = {
      deploymentUrl: 'https://new-store.trainee.workers.dev',
      initialized: false,
      counts: { owners: 0, credentials: 0, orders: 0 },
      status: null,
    };
    expect(deploymentOrigin(fresh)).toBe(fresh.deploymentUrl);
    expect(deploymentOrigin({ ...fresh, configuredOrigin: 'https://shop.example.test/' })).toBe(
      'https://shop.example.test',
    );
    expect(
      deploymentOrigin({
        ...fresh,
        initialized: true,
        status: { storeOrigin: 'https://existing.example.test' },
      }),
    ).toBe('https://existing.example.test');
    expect(() => deploymentOrigin({ ...fresh, counts: { ...fresh.counts, orders: 1 } })).toThrow(
      'existing store origin',
    );
    expect(() => deploymentOrigin({ ...fresh, initialized: true })).toThrow(
      'existing store origin',
    );
    expect(() =>
      deploymentOrigin({ ...fresh, configuredOrigin: 'http://insecure.example.test' }),
    ).toThrow('Invalid');
    expect(() =>
      deploymentOrigin({ ...fresh, configuredOrigin: 'https://user:pass@example.test' }),
    ).toThrow('Invalid');
  });
  it('waits through DNS errors, unavailable responses and the preceding deployed version', async () => {
    const url = 'https://new-store.trainee.workers.dev';
    const responses = [
      new Error('DNS propagation'),
      new Response('', { status: 503 }),
      Response.json({ storeOrigin: '' }),
      Response.json({ storeOrigin: url }),
    ];
    let calls = 0,
      pauses = 0;
    const result = await waitForDeploymentStatus({
      url,
      expectedOrigin: url,
      attempts: 5,
      request: async () => {
        calls++;
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
      },
      pause: async () => {
        pauses++;
      },
    });
    expect(result).toEqual({ storeOrigin: url });
    expect(calls).toBe(4);
    expect(pauses).toBe(3);
    expect(
      await waitForDeploymentStatus({
        url,
        expectedOrigin: url,
        attempts: 2,
        request: async () => Response.json({ storeOrigin: '' }),
        pause: async () => {},
      }),
    ).toBeNull();
  });
});
