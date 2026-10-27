import type { Product, Quote } from './types';
import { closedOrder, remoteShipping } from './order-status';

export type MerchantPricingSnapshot = {
  capturedAt: string;
  items: { sku: string; quantity: number; unitCost: number | null; subtotal: number | null }[];
  subtotal: number | null;
  shipping: number;
  total: number | null;
  profit: number | null;
};
export function merchantPricingSnapshot(
  quote: Quote,
  products: Product[],
  shipping: number,
  capturedAt: string,
): MerchantPricingSnapshot {
  const items = quote.items.map((item) => {
    const cost = products.find((p) => p.id === item.productId)?.fulfillment;
    const unitCost =
      typeof cost === 'number' && Number.isSafeInteger(cost) && cost >= 0 ? cost : null;
    return {
      sku: item.sku,
      quantity: item.quantity,
      unitCost,
      subtotal: unitCost === null ? null : unitCost * item.quantity,
    };
  });
  const subtotal =
    items.length > 0 && items.every((item) => item.subtotal !== null)
      ? items.reduce((sum, item) => sum + item.subtotal!, 0)
      : null;
  const total = subtotal === null ? null : subtotal + shipping;
  return {
    capturedAt,
    items,
    subtotal,
    shipping,
    total,
    profit: total === null ? null : quote.total - total,
  };
}
function amount(value: unknown, signed = false): number | null {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)))
    return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && (signed || cents >= 0) ? cents : null;
}
export type OrderPricing = {
  closed: boolean;
  items: {
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number | null;
    subtotal: number | null;
    unitCost: number | null;
    costSubtotal: number | null;
  }[];
  customer: {
    subtotal: number | null;
    shipping: number | null;
    total: number | null;
    originalTotal: number;
  };
  merchant: {
    subtotal: number | null;
    shipping: number | null;
    total: number | null;
    profit: number | null;
    source: 'order' | 'quote' | 'snapshot' | 'estimate' | 'unavailable';
  };
};
export function orderPricing(
  order: {
    quote: Quote;
    status?: string;
    shipping_status?: string | null;
    remote?: Record<string, any> | null;
    remote_quote?: Record<string, any> | null;
  },
  estimate?: MerchantPricingSnapshot,
): OrderPricing {
  const q = order.quote;
  const closed = closedOrder(
    order.shipping_status || remoteShipping(order.remote?.status),
    order.status,
  );
  const snapshot = q.merchantPricing || estimate;
  const checked = order.remote_quote?.approved === true ? order.remote_quote.raw?.financials : null;
  const final = order.remote?.financials;
  const source =
    final &&
    amount(final.wholesale_subtotal) !== null &&
    amount(final.platform_shipping_cost) !== null
      ? 'order'
      : checked &&
          amount(checked.total_wholesale) !== null &&
          amount(checked.platform_shipping_cost) !== null
        ? 'quote'
        : q.merchantPricing
          ? 'snapshot'
          : estimate
            ? 'estimate'
            : 'unavailable';
  const supplierSubtotal =
    amount(final?.wholesale_subtotal) ??
    amount(checked?.total_wholesale) ??
    snapshot?.subtotal ??
    null;
  const supplierShipping =
    amount(final?.platform_shipping_cost) ??
    amount(checked?.platform_shipping_cost) ??
    snapshot?.shipping ??
    null;
  const supplierTotal =
    supplierSubtotal === null || supplierShipping === null
      ? null
      : supplierSubtotal + supplierShipping;
  const items = q.items.map((item) => {
    const remote = order.remote?.items?.find(
      (r: any) => (r.sku || r.product_code) === item.sku && r.quantity === item.quantity,
    );
    const saved = snapshot?.items.find((r) => r.sku === item.sku && r.quantity === item.quantity);
    const fallbackMatches = snapshot?.subtotal === supplierSubtotal;
    const unitCost =
      amount(remote?.fulfillment_price) ?? (fallbackMatches ? (saved?.unitCost ?? null) : null);
    const unitPrice =
      (closed ? null : amount(remote?.selling_price ?? remote?.retail_price)) ??
      item.unitPrice ??
      null;
    const subtotal =
      (closed ? null : amount(remote?.subtotal)) ??
      (unitPrice === item.unitPrice
        ? (item.subtotal ?? null)
        : unitPrice === null
          ? null
          : unitPrice * item.quantity);
    return {
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPrice,
      subtotal,
      unitCost,
      costSubtotal: unitCost === null ? null : unitCost * item.quantity,
    };
  });
  // Cancellation zeros describe the absence of collection, not a new selling price.
  const customerTotal = closed ? q.total : (amount(final?.total_cod_amount) ?? q.total);
  return {
    closed,
    items,
    customer: {
      subtotal: closed
        ? (q.subtotal ?? null)
        : (amount(final?.products_subtotal) ?? q.subtotal ?? null),
      shipping: closed
        ? (q.shipping ?? null)
        : (amount(final?.customer_shipping_fee) ?? q.shipping ?? null),
      total: customerTotal,
      originalTotal: q.total,
    },
    merchant: {
      subtotal: supplierSubtotal,
      shipping: supplierShipping,
      total: supplierTotal,
      profit:
        amount(final?.partner_profit, true) ??
        (closed ? 0 : null) ??
        amount(checked?.estimated_partner_profit, true) ??
        (supplierTotal === null ? null : customerTotal - supplierTotal),
      source,
    },
  };
}
