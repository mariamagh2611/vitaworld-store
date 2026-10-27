import { rememberShipping } from './shipping-policy';
import { credential } from './security';
import type { Env, OrderRow } from './db';
import { cartProducts, now } from './db';
import type { Quote, Product, Customer } from '../shared/types';
import { mowaridPayload, wholesaleTotal } from '../shared/domain';
import { mowarid, cents, RemoteError } from './mowarid';
import { digest } from './security';
import { merchantQuote } from '../shared/merchant-order';

export function validateSavedCart(o: OrderRow, products: Product[]) {
  const quote = JSON.parse(o.quote) as Quote;
  for (const item of quote.items) {
    const p = products.find((p) => p.id === item.productId);
    if (
      !p ||
      !p.verified ||
      p.supplier !== o.supplier ||
      p.sku !== item.sku ||
      !p.active ||
      item.quantity > p.stock
    )
      throw new RemoteError('catalog_changed_review_required', false);
  }
  return quote;
}

export function validateRemoteQuote(raw: Record<string, any>, quote: Quote, products: Product[]) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new RemoteError('invalid_remote_quote_contract', false);
  if (raw.is_valid !== true) {
    throw new RemoteError(
      raw.code === 'MIXED_SUPPLIERS' ? 'mixed_suppliers_not_allowed' : 'remote_quote_rejected',
      false,
    );
  }
  if (
    raw.success !== true ||
    raw.supplier_group_id !== quote.supplier ||
    typeof raw.quote_id !== 'string' ||
    !raw.quote_id ||
    raw.quote_id.length > 200
  )
    throw new RemoteError('invalid_remote_quote_contract', false);
  const expires =
    typeof raw.expires_at === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw.expires_at)
      ? Date.parse(raw.expires_at)
      : NaN;
  if (!Number.isFinite(expires)) throw new RemoteError('invalid_remote_quote_expiry', false);
  if (expires <= Date.now() + 5000) throw new RemoteError('remote_quote_expired', true);
  const destination = raw.destination;
  if (
    destination?.is_shipping_cost_final !== true ||
    typeof destination.shipping_tier !== 'string' ||
    !/^[a-z0-9_-]{1,50}$/i.test(destination.shipping_tier) ||
    (destination.shipping_tier === 'casablanca' && destination.is_casablanca !== true) ||
    typeof destination.is_casablanca !== 'boolean'
  )
    throw new RemoteError('shipping_review_required', false);
  const guarantee = raw.safety_guarantee;
  if (
    guarantee?.order_created !== false ||
    guarantee.stock_reserved !== false ||
    guarantee.shipping_label_issued !== false
  )
    throw new RemoteError('unsafe_remote_quote_contract', false);
  const f = raw.financials;
  if (f?.currency !== 'MAD') throw new RemoteError('invalid_remote_quote_currency', false);
  const amount = (value: unknown) => {
    try {
      return cents(value);
    } catch {
      throw new RemoteError('invalid_remote_quote_amount', false);
    }
  };
  const wholesale = amount(f.total_wholesale),
    shipping = amount(f.platform_shipping_cost),
    minimum = amount(f.platform_due_break_even),
    total = amount(f.proposed_cod_to_collect),
    profit = amount(f.estimated_partner_profit);
  if (shipping !== amount(destination.platform_shipping_cost))
    throw new RemoteError('shipping_contract_changed_review_required', false);
  if (total !== quote.total || amount(f.customer_shipping_fee) !== quote.shipping)
    throw new RemoteError('remote_quote_total_mismatch', false);
  if (
    minimum !== wholesale + shipping ||
    total < minimum ||
    profit !== total - minimum ||
    f.is_break_even_or_profitable !== true
  )
    throw new RemoteError('invalid_remote_quote_financials', false);
  if (wholesale !== wholesaleTotal(quote.items, products))
    throw new RemoteError('catalog_cost_changed_review_required', false);
  return raw;
}

export async function quoteMowarid(env: Env, o: OrderRow, products?: Product[]) {
  const saved = JSON.parse(o.quote) as Quote;
  const all =
    products ||
    (await cartProducts(
      env.DB,
      saved.items.map((i) => i.productId),
    ));
  const quote = validateSavedCart(o, all);
  const body = mowaridPayload({ id: o.id, customer: JSON.parse(o.customer) as Customer, quote });
  const payload = {
    city: body.city,
    address: body.address,
    customer_shipping_fee: body.customer_shipping_fee,
    cod_to_collect: body.cod_to_collect,
    items: body.items.map((item) => ({
      sku: item.product_code,
      quantity: item.quantity,
      retail_price: item.retail_price,
    })),
  };
  const raw = await mowarid(env, '/orders/quote', payload);
  const proof = {
    checked_at: now(),
    request_fingerprint: await digest(JSON.stringify(payload)),
    approved: false,
    error: null as string | null,
    raw: merchantQuote(raw)!,
  };
  let validationError: unknown;
  try {
    validateRemoteQuote(raw, quote, all);
    proof.approved = true;
    await rememberShipping(
      env,
      'quote',
      [raw.financials.platform_shipping_cost],
      await digest(await credential(env, 'mowarid')),
    );
  } catch (e) {
    validationError = e;
    proof.error = e instanceof RemoteError ? e.code : 'invalid_remote_quote_contract';
  }
  const savedProof = await env.DB.prepare(
    "UPDATE orders SET remote_quote=? WHERE id=? AND quote=? AND customer=? AND mowarid_id IS NULL AND status IN ('pending_confirmation','confirmed')",
  )
    .bind(JSON.stringify(proof), o.id, o.quote, o.customer)
    .run();
  if (!savedProof.meta.changes) throw new RemoteError('order_changed_review_required', false);
  if (validationError) throw validationError;
  return proof;
}

export async function dryRunMowarid(env: Env, o: OrderRow) {
  if (o.post_attempted || o.mowarid_id || !['pending_confirmation', 'confirmed'].includes(o.status))
    throw new RemoteError('dry_run_order_locked', false);
  const checked = await quoteMowarid(env, o);
  const payload = {
    ...mowaridPayload(
      {
        id: o.id,
        customer: JSON.parse(o.customer) as Customer,
        quote: JSON.parse(o.quote) as Quote,
      },
      checked.raw.quote_id,
    ),
    dry_run: true,
  };
  const raw = await mowarid(env, '/orders', payload);
  if (
    !raw ||
    raw.success !== true ||
    raw.dry_run !== true ||
    raw.order_id ||
    raw.order ||
    raw.duplicate === true ||
    raw.order_created === true ||
    raw.stock_reserved === true ||
    raw.shipping_label_issued === true ||
    (raw.safety_guarantee &&
      (raw.safety_guarantee.order_created !== false ||
        raw.safety_guarantee.stock_reserved !== false ||
        raw.safety_guarantee.shipping_label_issued !== false)) ||
    (Array.isArray(raw.results) &&
      raw.results.some(
        (r: Record<string, any>) => r.order_id || ['created', 'duplicate'].includes(r.status),
      ))
  ) {
    // A response that contradicts dry-run cannot prove that no shipment was created.
    await env.DB.prepare(
      "UPDATE orders SET post_attempted=1,last_error='invalid_dry_run_contract' WHERE id=? AND quote=? AND customer=? AND mowarid_id IS NULL",
    )
      .bind(o.id, o.quote, o.customer)
      .run();
    throw new RemoteError('invalid_dry_run_contract', false);
  }
  const proof = {
    checked_at: now(),
    request_fingerprint: await digest(JSON.stringify(payload)),
    dry_run: true,
    success: true,
  };
  const result = await env.DB.prepare(
    "UPDATE orders SET dry_run_result=? WHERE id=? AND quote=? AND customer=? AND post_attempted=0 AND mowarid_id IS NULL AND status IN ('pending_confirmation','confirmed')",
  )
    .bind(JSON.stringify(proof), o.id, o.quote, o.customer)
    .run();
  if (!result.meta.changes) throw new RemoteError('order_changed_review_required', false);
  return proof;
}
