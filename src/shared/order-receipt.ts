import type { Customer, Quote } from './types';
import { orderPricing } from './order-pricing';
import { closedOrder, remoteShipping } from './order-status';

// Customer-facing content is constructed explicitly: wholesale, profit and
// supplier identifiers never appear in a receipt, even in hidden markup.
export function orderReceipt(order: {
  ref: string;
  created_at?: string;
  customer: Customer;
  quote: Quote;
  status?: string;
  shipping_status?: string | null;
  remote?: Record<string, any> | null;
}) {
  const pricing = orderPricing(order);
  return {
    number: order.remote?.order_number || order.ref,
    brand: order.quote.storeIdentity?.name || '',
    createdAt: order.created_at || '',
    customer: { ...order.customer },
    closed: closedOrder(
      order.shipping_status || remoteShipping(order.remote?.status),
      order.status,
    ),
    items: pricing.items.map(({ name, quantity, unitPrice, subtotal }) => ({
      name,
      quantity,
      unitPrice,
      subtotal,
    })),
    subtotal: pricing.customer.subtotal,
    shipping: pricing.customer.shipping,
    total: pricing.customer.total,
  };
}
export type OrderReceiptData = ReturnType<typeof orderReceipt>;
