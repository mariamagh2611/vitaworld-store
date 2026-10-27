import { describe, it, expect } from 'vitest';
import { merchantPricingSnapshot, orderPricing } from '../src/shared/order-pricing';
import type { Product, Quote } from '../src/shared/types';
const q: Quote = {
  supplier: 'same',
  fingerprint: 'fixed',
  items: [
    {
      productId: 'a',
      sku: 'A',
      name: 'First',
      quantity: 2,
      unitPrice: 5000,
      subtotal: 10000,
      offerId: '',
      freeShipping: false,
      revision: 1,
    },
    {
      productId: 'b',
      sku: 'B',
      name: 'Second',
      quantity: 1,
      unitPrice: 7500,
      subtotal: 7500,
      offerId: '',
      freeShipping: false,
      revision: 1,
    },
  ],
  subtotal: 17500,
  shipping: 2000,
  total: 19500,
};
const ps = [
  { id: 'a', fulfillment: 2000 },
  { id: 'b', fulfillment: 3000 },
] as Product[];
describe('private order price breakdown', () => {
  it('does not interpret cancelled collection zeros as changed customer prices', () => {
    const snapshot = merchantPricingSnapshot(q, ps, 3000, 'fixed');
    const pricing = orderPricing({
      quote: { ...q, merchantPricing: snapshot },
      remote: {
        status: { order_status: 'cancelled' },
        financials: {
          products_subtotal: 0,
          customer_shipping_fee: 0,
          total_cod_amount: 0,
          wholesale_subtotal: 0,
          platform_shipping_cost: 0,
          partner_profit: 0,
        },
        items: [{ sku: 'A', quantity: 2, selling_price: 0, subtotal: 0, fulfillment_price: 20 }],
      },
    });
    expect(pricing.closed).toBe(true);
    expect(pricing.customer).toEqual({
      subtotal: 17500,
      shipping: 2000,
      total: 19500,
      originalTotal: 19500,
    });
    expect(pricing.items[0]).toMatchObject({ unitPrice: 5000, subtotal: 10000, unitCost: 2000 });
    expect(pricing.merchant).toMatchObject({ total: 0, profit: 0, source: 'order' });
    expect(q.total).toBe(19500);
  });
  it('retains each unit and quantity and separates customer fees from supplier costs', () => {
    const snapshot = merchantPricingSnapshot(q, ps, 3000, '2026-10-09T10:00:00Z');
    expect(snapshot).toMatchObject({ subtotal: 7000, shipping: 3000, total: 10000, profit: 9500 });
    const pricing = orderPricing({ quote: { ...q, merchantPricing: snapshot } });
    expect(pricing.items[0]).toMatchObject({
      quantity: 2,
      unitPrice: 5000,
      subtotal: 10000,
      unitCost: 2000,
      costSubtotal: 4000,
    });
    expect(pricing.customer).toMatchObject({ subtotal: 17500, shipping: 2000, total: 19500 });
    expect(pricing.merchant).toMatchObject({
      subtotal: 7000,
      shipping: 3000,
      total: 10000,
      profit: 9500,
      source: 'snapshot',
    });
    ps[0].fulfillment = 2500;
    expect(orderPricing({ quote: { ...q, merchantPricing: snapshot } }).items[0].unitCost).toBe(
      2000,
    );
    ps[0].fulfillment = 2000;
  });
  it('keeps customer free delivery distinct from the platform charge and shows zero profit correctly', () => {
    const free = { ...q, shipping: 0, total: 17500 };
    const snapshot = merchantPricingSnapshot(free, ps, 3000, 'fixed');
    const pricing = orderPricing({
      quote: { ...free, merchantPricing: snapshot },
      remote: {
        financials: {
          wholesale_subtotal: 145,
          platform_shipping_cost: 30,
          partner_profit: 0,
          total_cod_amount: 175,
          products_subtotal: 175,
          customer_shipping_fee: 0,
        },
      },
    });
    expect(pricing.customer.shipping).toBe(0);
    expect(pricing.merchant).toMatchObject({
      subtotal: 14500,
      shipping: 3000,
      total: 17500,
      profit: 0,
      source: 'order',
    });
    expect(pricing.items[0].unitCost).toBeNull(); // an old estimate cannot invent new per-item charges
  });
  it('uses authoritative order item costs and keeps the original total when staff update delivery', () => {
    const pricing = orderPricing({
      quote: q,
      remote: {
        financials: {
          wholesale_subtotal: 70,
          platform_shipping_cost: 30,
          partner_profit: 105,
          total_cod_amount: 205,
          products_subtotal: 175,
          customer_shipping_fee: 30,
        },
        items: [
          { sku: 'A', quantity: 2, selling_price: 50, fulfillment_price: 20, subtotal: 100 },
          { sku: 'B', quantity: 1, selling_price: 75, fulfillment_price: 30, subtotal: 75 },
        ],
      },
    });
    expect(pricing.customer).toMatchObject({ total: 20500, originalTotal: 19500, shipping: 3000 });
    expect(pricing.items.map((r) => r.costSubtotal)).toEqual([4000, 3000]);
    expect(q.total).toBe(19500);
  });
  it('marks missing costs unavailable and verifies quotes without replacing saved customer prices', () => {
    const missing = orderPricing({ quote: q });
    expect(missing.merchant).toMatchObject({
      subtotal: null,
      shipping: null,
      total: null,
      profit: null,
      source: 'unavailable',
    });
    const verified = orderPricing({
      quote: q,
      remote_quote: {
        approved: true,
        raw: {
          financials: {
            total_wholesale: 70,
            platform_shipping_cost: 20,
            estimated_partner_profit: 105,
          },
        },
      },
    });
    expect(verified.merchant).toMatchObject({
      subtotal: 7000,
      shipping: 2000,
      total: 9000,
      profit: 10500,
      source: 'quote',
    });
    expect(verified.customer.total).toBe(19500);
  });
});
