import type { Env } from './db';
import { runJobs, tick, refreshTracking } from './jobs';
import { instrument } from './usage';
import { receiveWebhook, processWebhooks } from './webhooks';
import { DomainError } from '../shared/domain';
import { importCatalogBatch, catalogImportSchema } from './catalog-import';
import { z } from 'zod';

// A private binding handles scheduled work under Durable Object CPU limits.
// Jobs and idempotency stay durable in D1; overlap defers to the next tick.
export class StoreOperations {
  private busy = false;
  constructor(
    _state: DurableObjectState,
    private env: Env,
  ) {}
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (
      request.method !== 'POST' ||
      ![
        '/tick',
        '/jobs',
        '/submit',
        '/tracking',
        '/webhooks',
        '/receive',
        '/catalog-import',
      ].includes(path)
    )
      return new Response(null, { status: 404 });
    // A signed callback must be persisted even while registration/test awaits
    // the vendor. Inbox writes are atomic and do not require the processing lock.
    if (path === '/receive') {
      const usage = instrument(this.env.DB);
      try {
        return Response.json(
          await receiveWebhook(
            { ...this.env, DB: usage.db },
            new Uint8Array(await request.arrayBuffer()),
            request.headers.get('X-Mowarid-Signature') || '',
          ),
        );
      } catch (error) {
        return Response.json(
          { error: error instanceof DomainError ? error.code : 'webhook_storage_unavailable' },
          { status: error instanceof DomainError ? error.status : 503 },
        );
      } finally {
        await usage.flush();
      }
    }
    if (this.busy)
      return Response.json(
        { ok: path !== '/catalog-import', deferred: true },
        { status: path === '/catalog-import' ? 503 : 200 },
      );
    this.busy = true;
    const usage = instrument(this.env.DB);
    try {
      const env = { ...this.env, DB: usage.db };
      if (path === '/catalog-import') {
        const body = catalogImportSchema
          .extend({ admin: z.string().min(1).max(100) })
          .parse(await request.json());
        return Response.json(
          await importCatalogBatch(env, body.admin, body.requestId, body.mode, body.skus),
        );
      } else if (path === '/tick') await tick(env);
      else if (path === '/tracking') return Response.json(await refreshTracking(env, true));
      else if (path === '/webhooks') await processWebhooks(env);
      else if (path === '/submit') {
        const body = (await request.json()) as { orderId?: unknown };
        if (typeof body.orderId !== 'string' || !body.orderId || body.orderId.length > 100)
          return Response.json({ ok: false }, { status: 400 });
        await runJobs(env, 1, body.orderId);
      } else await runJobs(env, 1);
      return Response.json({ ok: true });
    } catch {
      return Response.json({ ok: false }, { status: 503 });
    } finally {
      try {
        await usage.flush();
      } finally {
        this.busy = false;
      }
    }
  }
}
