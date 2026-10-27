import { expect, it } from 'vitest';
import { orderReceipt } from '../src/shared/order-receipt';
import type { Quote } from '../src/shared/types';
const quote: Quote = {
  supplier: 'supplier-private',
  fingerprint: 'fingerprint-private',
  storeIdentity: { name: 'My shop', url: 'https://shop.test' },
  items: [
    {
      productId: 'p',
      sku: 'private-sku',
      name: 'Product',
      quantity: 2,
      unitPrice: 12900,
      subtotal: 25800,
      offerId: '',
      revision: 1,
      freeShipping: false,
    },
  ],
  subtotal: 25800,
  shipping: 2000,
  total: 27800,
};
const order = {
  ref: 'REF-RECEIPT',
  customer: {
    name: 'Customer',
    phone: '0612345678',
    city: 'CASABLANCA',
    address: 'Address',
    notes: '',
  },
  quote,
};
it('constructs a customer receipt without merchant costs, profit or supplier identifiers', () => {
  const receipt = orderReceipt({
    ...order,
    remote: {
      order_number: 'MDK-2026-00379',
      financials: { wholesale_subtotal: 158, platform_shipping_cost: 20, partner_profit: 100 },
      supplier_secret: 'do not copy',
    },
  });
  expect(receipt).toMatchObject({
    brand: 'My shop',
    number: 'MDK-2026-00379',
    subtotal: 25800,
    shipping: 2000,
    total: 27800,
    items: [{ name: 'Product', quantity: 2, unitPrice: 12900, subtotal: 25800 }],
  });
  for (const secret of [
    'wholesale',
    'profit',
    'fulfillment',
    'supplier-private',
    'private-sku',
    'fingerprint-private',
    'do not copy',
  ])
    expect(JSON.stringify(receipt)).not.toContain(secret);
});
it('retains a cancelled order’s recorded prices and marks it as closed without claiming payment', () => {
  const receipt = orderReceipt({
    ...order,
    remote: {
      status: { order_status: 'cancelled' },
      financials: { products_subtotal: 0, customer_shipping_fee: 0, total_cod_amount: 0 },
    },
  });
  expect(receipt).toMatchObject({ closed: true, total: 27800, subtotal: 25800, shipping: 2000 });
  expect(quote.total).toBe(27800);
});
