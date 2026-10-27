import { app } from './index';
import type { Env } from './db';
export { PasswordHasher } from './password-hasher';
export { StoreOperations } from './operations';

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!env.OPERATIONS) throw new Error('Operations binding required');
    const stub = env.OPERATIONS.get(env.OPERATIONS.idFromName('store'));
    ctx.waitUntil(
      (async () => {
        const response = await stub.fetch('https://operations.internal/tick', { method: 'POST' });
        if (!response.ok) throw new Error('Scheduled store work failed');
      })(),
    );
  },
};
