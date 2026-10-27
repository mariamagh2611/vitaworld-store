import { rememberShipping } from './shipping-policy';
import { state } from './db';
import type { Env, OrderRow } from './db';
import { order, now } from './db';
import { RemoteError, cents } from './mowarid';
import type { Quote } from '../shared/types';
import { closedOrder, deliveredShipping, remoteShipping } from '../shared/order-status';
import { merchantOrder } from '../shared/merchant-order';
export async function recordRemote(
  env: Env,
  o: OrderRow,
  remote: Record<string, any>,
  attempt = 0,
) {
  if (remote.order_id && o.mowarid_id && remote.order_id !== o.mowarid_id)
    throw new RemoteError('remote_order_identity_mismatch', false);
  if (remote.external_order_id && remote.external_order_id !== o.id)
    throw new RemoteError('remote_order_identity_mismatch', false);
  remote = merchantOrder(remote)!;
  const previous = o.remote ? JSON.parse(o.remote) : null;
  const oldVersion = Date.parse(previous?.timestamps?.updated_at || ''),
    newVersion = Date.parse(remote.timestamps?.updated_at || '');
  if (Number.isFinite(oldVersion) && Number.isFinite(newVersion) && newVersion < oldVersion) return;
  const shipping = remoteShipping(remote.status),
    financial = remote.status?.financial_status;
  if (
    typeof shipping !== 'string' ||
    !/^[a-z][a-z0-9_]{0,59}$/.test(shipping) ||
    (financial !== undefined &&
      financial !== null &&
      (typeof financial !== 'string' || !/^[a-z][a-z0-9_]{0,59}$/.test(financial)))
  )
    throw new RemoteError('invalid_tracking_contract', false);
  const q = JSON.parse(o.quote) as Quote;
  const closed = closedOrder(shipping);
  if (deliveredShipping(shipping) && remote.financials?.total_cod_amount === undefined)
    throw new RemoteError('missing_delivery_cod_amount', false);
  let remoteTotal = q.total;
  if (remote.financials?.total_cod_amount !== undefined) {
    try {
      remoteTotal = cents(remote.financials.total_cod_amount);
    } catch {
      throw new RemoteError('invalid_remote_cod_amount', false);
    }
  }
  if (remote.financials?.currency && remote.financials.currency !== 'MAD')
    throw new RemoteError('invalid_remote_cod_currency', false);
  if (deliveredShipping(shipping) && remoteTotal <= 0)
    throw new RemoteError('invalid_delivery_cod_amount', false);
  if (
    remote.financials?.currency === 'MAD' &&
    typeof remote.financials.platform_shipping_cost === 'number'
  ) {
    const contract = await state(env.DB, 'supplier_contract');
    if (contract?.source === 'api' && contract.keyFingerprint)
      await rememberShipping(
        env,
        'quote',
        [remote.financials.platform_shipping_cost],
        contract.keyFingerprint,
      );
  }
  const hold =
    shipping === 'pending' &&
    typeof remote.status?.hold_reason === 'string' &&
    !!remote.status.hold_reason.trim();
  const delivered = deliveredShipping(shipping),
    at = remote.timestamps?.delivered_at;
  const validAt =
    typeof at === 'string' &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(at) &&
    Number.isFinite(Date.parse(at)) &&
    Date.parse(at) <= Date.now();
  const statements = [
    env.DB.prepare(
      'UPDATE orders SET shipping_status=?,financial_status=?,remote=?,last_error=?,next_poll=?,delivered_at=CASE WHEN ? THEN COALESCE(delivered_at,?) ELSE delivered_at END,delivery_time_source=CASE WHEN ? THEN COALESCE(delivery_time_source,?) ELSE delivery_time_source END,delivered_total=CASE WHEN ? THEN COALESCE(delivered_total,?) ELSE delivered_total END WHERE id=? AND remote IS ?',
    ).bind(
      shipping,
      financial || null,
      JSON.stringify(remote),
      !closed && remoteTotal !== q.total ? 'remote_cod_changed' : null,
      ['delivered', 'paid', 'cancelled', 'returned', 'deleted'].includes(shipping)
        ? Date.now() + 86400000
        : Date.now() + (hold ? 300000 : 1800000),
      Number(delivered),
      validAt ? at : now(),
      Number(delivered),
      validAt ? 'api' : 'observed',
      Number(delivered),
      remoteTotal,
      o.id,
      o.remote,
    ),
  ];
  const previousTotal =
    typeof previous?.financials?.total_cod_amount === 'number' &&
    Number.isFinite(previous.financials.total_cod_amount)
      ? Math.round(previous.financials.total_cod_amount * 100)
      : q.total;
  if (!closed && remoteTotal !== previousTotal)
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO audit(id,admin_id,action,target,created_at) SELECT ?,'mowarid','remote_cod_changed',?,? FROM orders WHERE id=? AND remote=?",
      ).bind(
        'remote-cod:' + o.id + ':' + (remote.timestamps?.updated_at || remoteTotal),
        o.id,
        now(),
        o.id,
        JSON.stringify(remote),
      ),
    );
  // Delivery + durable Purchase outbox must commit together, including on repeated polls.
  if (delivered)
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO jobs(id,type,order_id,run_at,created_at) SELECT ?,'purchase',id,?,? FROM orders WHERE id=? AND shipping_status IN ('delivered','paid') AND remote=?",
      ).bind('purchase:' + o.id, Date.now(), now(), o.id, JSON.stringify(remote)),
    );
  const result = await env.DB.batch(statements);
  if (!result[0].meta.changes) {
    const latest = await order(env.DB, o.id);
    if (latest && latest.remote !== JSON.stringify(remote)) {
      if (attempt >= 2) throw new RemoteError('tracking_conflict_retry', true);
      await recordRemote(env, latest, remote, attempt + 1);
    }
  }
}
