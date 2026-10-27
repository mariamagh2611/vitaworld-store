import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

describe('read-only API isolation reviewer', () => {
  for (const scenario of [
    'safe',
    'safe-list-only',
    'cross-leak',
    'error-leak',
    'no-baseline',
    'invalid-input',
  ]) {
    it('classifies ' + scenario + ' without printing secrets or customer data', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mowarid-audit-test-'));
      const accounts = [
        {
          label: 'A',
          apiKey: 'private-fixture-key-AAAA',
          orderId: 'order-A',
          externalOrderId: 'STORE-A',
        },
        {
          label: 'B',
          apiKey: 'private-fixture-key-BBBB',
          orderId: 'order-B',
          externalOrderId: 'STORE-B',
        },
      ];
      try {
        const config = join(directory, 'accounts.json');
        await writeFile(
          config,
          JSON.stringify({
            updatedSince: '2026-10-01T00:00:00Z',
            accounts,
            orderDetailSupported: scenario !== 'safe-list-only',
          }),
          { mode: 0o600 },
        );
        const mock = join(directory, 'mock.mjs');
        await writeFile(
          mock,
          `
const accounts = ${JSON.stringify(accounts)};
const scenario = ${JSON.stringify(scenario)};
globalThis.fetch = async (url, init) => {
  if (init.method !== 'GET' || init.redirect !== 'error' || new URL(url).origin !== 'https://mowarid.ma') throw new Error('unsafe request');
  const key = init.headers.Authorization?.slice(7) || init.headers['X-API-Key'];
  const current = accounts.find(a => a.apiKey === key), parsed = new URL(url);
  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Cache-Control': 'private, no-store', 'CF-Cache-Status': 'BYPASS' } });
  if (!current) return respond({ error: 'unauthorized' }, 401);
  const record = owner => ({ order_id: owner.orderId, external_order_id: owner.externalOrderId, customer: { name: 'PRIVATE CUSTOMER FIXTURE' }, financials: { partner_profit: 12 } });
  if (scenario === 'no-baseline') return respond({}, 404);
  if (parsed.pathname.endsWith('/webhooks/subscriptions')) return respond({ subscriptions: [] });
  if (parsed.searchParams.get('cursor') === 'invalid-audit-cursor' || parsed.searchParams.get('updated_since') === 'invalid-audit-date') return respond({}, scenario === 'invalid-input' ? 200 : 400);
  if (parsed.searchParams.has('cursor')) return respond({ orders: [record(current)] });
  const id = parsed.pathname.split('/').at(-1);
  const target = accounts.find(a => a.orderId === id);
  if (target && scenario === 'safe-list-only') throw new Error('undocumented route');
  if (target) return target === current || scenario === 'cross-leak' || scenario === 'error-leak' ? respond({ order: record(target) }, target !== current && scenario === 'error-leak' ? 404 : 200) : respond({}, 404);
  const external = parsed.searchParams.get('external_order_id');
  return respond({ orders: external && external !== current.externalOrderId ? [] : [record(current)], pagination: { next_cursor: external ? null : 'cursor-' + current.label } });
};`,
        );
        let output = '',
          code = 0;
        try {
          output = execFileSync(
            process.execPath,
            ['--import', mock, resolve('scripts/audit-api-isolation.mjs'), config],
            { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          );
        } catch (error: any) {
          code = error.status;
          output = String(error.stdout) + String(error.stderr);
        }
        const report = await readFile(
          join(directory, '.wrangler/audit/api-isolation-report.json'),
          'utf8',
        );
        for (const secret of [...accounts.map((a) => a.apiKey), 'PRIVATE CUSTOMER FIXTURE']) {
          expect(output).not.toContain(secret);
          expect(report).not.toContain(secret);
        }
        expect(JSON.parse(report).mutations).toBe(0);
        expect(JSON.parse(report).requests).toBeLessThanOrEqual(40);
        expect(code).toBe(
          scenario.includes('leak')
            ? 1
            : ['no-baseline', 'invalid-input', 'safe-list-only'].includes(scenario)
              ? 2
              : 0,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
