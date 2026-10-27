import { expect, it, vi, afterEach } from 'vitest';
import { defaults, publicProduct, type Product } from '../src/shared/types';
import { quantityPrice, pricedProduct, QUANTITY_TAIL_ID } from '../src/shared/commerce';
import { quoteCart, assertPublishedPrices, mowaridPayload } from '../src/shared/domain';
const p: Product = {
  id: 'p',
  slug: 'p',
  sku: 'SKU',
  name: 'p',
  parentId: null,
  description: '',
  image: '',
  price: 30000,
  minimum: 0,
  fulfillment: 17500,
  stock: 100,
  active: 1,
  featured: 0,
  supplier: 's',
  verified: 1,
  revision: 1,
  color: '#173d35',
  formColor: '#ffffff',
  blocks: [],
  offers: [
    { id: 'two', label: '2', quantity: 2, total: 50000, freeShipping: true },
    { id: 'three', label: '3', quantity: 3, total: 69000, freeShipping: false },
  ],
  presentation: {
    quantityPricing: { unitPrice: 22000, fromQuantity: 4, freeShipping: true, enabled: true },
  },
};
const line = (quantity: number, offerId = '') => ({
  productId: 'p',
  quantity,
  offerId,
  revision: 1,
});
afterEach(() => vi.useRealTimers());
it('uses exact quantity prices then one price for every larger quantity, without repeating packs', () => {
  const visible = publicProduct(p);
  for (const [quantity, total] of [
    [1, 30000],
    [2, 50000],
    [3, 69000],
    [4, 88000],
    [5, 110000],
    [100, 2200000],
  ]) {
    expect(quantityPrice(visible, quantity).total).toBe(total);
    expect(quoteCart([line(quantity)], [p], 'Rabat', defaults, [], 'direct').subtotal).toBe(total);
  }
  expect(quantityPrice(visible, 4).offerId).toBe(QUANTITY_TAIL_ID);
  expect(quoteCart([line(2)], [p], 'Rabat', defaults).shipping).toBe(0);
  expect(quoteCart([line(3)], [p], 'Rabat', defaults).shipping).toBe(3000);
  expect(quoteCart([line(4)], [p], 'Rabat', defaults).shipping).toBe(0);
  expect(() => quoteCart([line(3, 'two')], [p], 'Rabat', defaults)).toThrow('كمية العرض');
});
it('keeps gaps and old product quantities deterministic, and requires the whole price including delivery to be safe', () => {
  const legacy = { ...p, presentation: {}, offers: [p.offers[0]] };
  expect(quoteCart([line(4)], [legacy], 'Rabat', defaults).subtotal).toBe(120000);
  const atCost = {
    ...p,
    presentation: { quantityPricing: { unitPrice: 18250, fromQuantity: 4, freeShipping: true } },
  };
  expect(() =>
    assertPublishedPrices(atCost.price, atCost.offers, atCost.fulfillment, defaults, atCost, 3000),
  ).not.toThrow();
  expect(quoteCart([line(4)], [atCost], 'Rabat', defaults).total).toBe(73000);
  const loss = {
    ...atCost,
    presentation: { quantityPricing: { unitPrice: 18249, fromQuantity: 4, freeShipping: true } },
  };
  expect(() =>
    assertPublishedPrices(loss.price, loss.offers, loss.fulfillment, defaults, loss, 3000),
  ).toThrow();
  expect(() => quoteCart([line(4)], [loss], 'Rabat', defaults)).toThrow();
});
it('uses server time for both tiers and the larger quantity price while keeping accepted snapshots exact', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T08:59:59.999Z'));
  const timed = {
    ...p,
    presentation: {
      quantityPricing: { ...p.presentation!.quantityPricing!, endsAt: '2026-10-15T09:00:00Z' },
    },
  };
  const saved = quoteCart([line(4, QUANTITY_TAIL_ID)], [timed], 'Rabat', defaults);
  vi.advanceTimersByTime(1);
  expect(pricedProduct(timed).quantityPricing).toBeUndefined();
  expect(() => quoteCart([line(4, QUANTITY_TAIL_ID)], [timed], 'Rabat', defaults)).toThrow(
    'العرض لم يعد',
  );
  expect(quoteCart([line(4)], [timed], 'Rabat', defaults).subtotal).toBe(120000);
  expect(saved.subtotal).toBe(88000);
});
it('retains old non-divisible exact totals and sends the explicit COD amount to the supplier', () => {
  const product = {
    ...p,
    fulfillment: 6000,
    offers: [{ id: 'three', label: '3', quantity: 3, total: 22000, freeShipping: true }],
    presentation: { quantityPricing: { unitPrice: 10000, fromQuantity: 4, freeShipping: true } },
  };
  const quote = quoteCart([line(3)], [product], 'Rabat', defaults, [], 'direct', 4000);
  expect(quote.subtotal).toBe(22000);
  const payload = mowaridPayload({
    id: 'test',
    customer: { name: 'Test', phone: '0612345678', city: 'Rabat', address: 'Address', notes: '' },
    quote: { ...quote, fingerprint: 'test' },
  });
  expect(payload.cod_to_collect).toBe(220);
  expect(payload.items[0].quantity).toBe(3);
  expect(payload.items[0].retail_price).toBe(73.33);
});
it('does not apply a hidden higher-quantity rule after all quantity tiers are removed or disabled', () => {
  expect(quantityPrice(publicProduct({ ...p, offers: [] }), 4).total).toBe(120000);
  expect(
    quantityPrice(
      publicProduct({ ...p, offers: p.offers.map((o) => ({ ...o, enabled: false })) }),
      4,
    ).total,
  ).toBe(120000);
});
it('fixed bundles accept only configured quantities across cart and direct order, retaining delivery and cents', () => {
  const fixed = { ...p, presentation: { ...p.presentation, bundleMode: true } };
  for (const mode of ['cart', 'direct'] as const) {
    expect(quoteCart([line(1)], [fixed], 'Rabat', defaults, [], mode).subtotal).toBe(30000);
    expect(quoteCart([line(2)], [fixed], 'Rabat', defaults, [], mode)).toMatchObject({
      subtotal: 50000,
      shipping: 0,
      total: 50000,
    });
    expect(quoteCart([line(3)], [fixed], 'Rabat', defaults, [], mode)).toMatchObject({
      subtotal: 69000,
      shipping: 3000,
      total: 72000,
    });
    for (const quantity of [4, 5, 100])
      expect(() => quoteCart([line(quantity)], [fixed], 'Rabat', defaults, [], mode)).toThrow(
        'اختر إحدى الباقات',
      );
  }
  expect(publicProduct(fixed)).not.toHaveProperty('fulfillment');
  expect(publicProduct(fixed).quantityPricing).toBeUndefined();
  const withoutBundles = { ...fixed, presentation: { ...fixed.presentation, bundleMode: false } };
  expect(quoteCart([line(2)], [withoutBundles], 'Rabat', defaults)).toMatchObject({
    subtotal: 60000,
    shipping: 3000,
  });
});
it('fixed bundle expiration, disablement and stock are checked by the server, including a stale explicit offer', () => {
  vi.useFakeTimers();
  const deadline = '2026-10-12T12:00:00.000Z';
  const fixed = {
    ...p,
    presentation: { bundleMode: true },
    offers: [{ ...p.offers[0], endsAt: deadline }],
  };
  vi.setSystemTime(new Date('2026-10-12T11:59:59.999Z'));
  expect(quoteCart([line(2)], [fixed], 'Rabat', defaults).total).toBe(50000);
  for (const at of [deadline, '2026-10-12T12:00:00.001Z']) {
    vi.setSystemTime(new Date(at));
    for (const id of ['', 'two'])
      expect(() => quoteCart([line(2, id)], [fixed], 'Rabat', defaults)).toThrow(
        'اختر إحدى الباقات',
      );
  }
  expect(() =>
    quoteCart(
      [line(2)],
      [{ ...fixed, offers: [{ ...fixed.offers[0], endsAt: null, enabled: false }] }],
      'Rabat',
      defaults,
    ),
  ).toThrow();
  expect(() =>
    quoteCart([line(3)], [{ ...fixed, offers: p.offers, stock: 2 }], 'Rabat', defaults),
  ).toThrow();
});
it('fixed bundle safety permits break-even, refuses one-cent loss, and rechecks official cost increases', () => {
  const fixed = {
    ...p,
    price: 23500,
    fulfillment: 17500,
    presentation: { bundleMode: true },
    offers: [{ ...p.offers[0], total: 38000 }],
  };
  const s = { ...defaults, shippingCasa: 3000, shippingOther: 3000, cartFreeShippingThreshold: 0 };
  expect(() =>
    assertPublishedPrices(fixed.price, fixed.offers, fixed.fulfillment, s, fixed, 3000),
  ).not.toThrow();
  expect(() =>
    assertPublishedPrices(
      fixed.price,
      [{ ...fixed.offers[0], total: 37999 }],
      fixed.fulfillment,
      s,
      fixed,
      3000,
    ),
  ).toThrow();
  expect(() => assertPublishedPrices(fixed.price, fixed.offers, 17501, s, fixed, 3000)).toThrow();
  expect(() =>
    assertPublishedPrices(fixed.price, fixed.offers, fixed.fulfillment, s, fixed, 4000),
  ).toThrow();
  expect(() =>
    assertPublishedPrices(
      20500,
      [],
      17500,
      s,
      { ...fixed, presentation: { ...fixed.presentation, freeShipping: true } },
      3000,
    ),
  ).not.toThrow();
});
