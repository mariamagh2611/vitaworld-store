import { pricedProduct, promotionClock, promotionRemaining } from '../src/shared/commerce';
import { publicProduct } from '../src/shared/types';
import { describe, it, expect } from 'vitest';
import { defaults, type Product } from '../src/shared/types';
import {
  quoteCart,
  normalizePhone,
  addToCart,
  mowaridPayload,
  checkoutIntent,
  assertPublishedPrices,
} from '../src/shared/domain';
import { supplierKey, cents } from '../src/server/mowarid';
import { safeJson } from '../src/server/views';
import { businessDate, businessStart } from '../src/shared/time';
import { marketingSource } from '../src/shared/marketing';
const product = (id: string, supplier = 'a'): Product => ({
  id,
  slug: id,
  sku: id,
  parentId: null,
  name: id,
  description: '',
  image: '',
  price: 19900,
  minimum: 10000,
  fulfillment: 6000,
  stock: 100,
  active: 1,
  featured: 0,
  supplier,
  verified: 1,
  offers: [],
  blocks: [],
  color: '#173d35',
  formColor: '#f3f0e9',
  revision: 1,
});
const line = (id: string) => ({ productId: id, offerId: '', quantity: 1, revision: 1 });
describe('supplier-safe cart and financial contract', () => {
  it('waives shipping at the exact cart subtotal threshold, reverses it below the threshold, and excludes direct orders', () => {
    const p = { ...product('a'), price: 20000, fulfillment: 10000 };
    const s = { ...defaults, shippingCasa: 3000, cartFreeShippingThreshold: 60000 };
    expect(quoteCart([{ ...line('a'), quantity: 2 }], [p], 'Rabat', s)).toMatchObject({
      subtotal: 40000,
      shipping: 3000,
      shippingReason: 'standard',
    });
    const quote = quoteCart([{ ...line('a'), quantity: 3 }], [p], 'Rabat', s);
    expect(quote).toMatchObject({
      subtotal: 60000,
      shipping: 0,
      total: 60000,
      shippingReason: 'threshold',
    });
    expect(quoteCart([{ ...line('a'), quantity: 3 }], [p], 'Casablanca', s).shipping).toBe(0);
    expect(quoteCart([{ ...line('a'), quantity: 3 }], [p], 'Rabat', s, [], 'direct').shipping).toBe(
      3000,
    );
    expect(quoteCart([{ ...line('a'), quantity: 2 }], [p], 'Rabat', s).shipping).toBe(3000);
    expect(
      quoteCart([{ ...line('a'), quantity: 3 }], [p], 'Rabat', {
        ...s,
        cartFreeShippingThreshold: 0,
      }).shipping,
    ).toBe(3000);
  });
  it('rejects a free-shipping threshold that can lose money and allows exact break-even with integer cents', () => {
    const s = { ...defaults, shippingCasa: 3000, cartFreeShippingThreshold: 60000 };
    expect(() => assertPublishedPrices(2000, [], 1900, s)).not.toThrow();
    expect(() => assertPublishedPrices(2000, [], 1901, s)).toThrow('التوصيل المجاني');
    expect(() => assertPublishedPrices(2000, [], 2000, s)).toThrow();
    const p = { ...product('a'), price: 2000, fulfillment: 1900 };
    expect(quoteCart([{ ...line('a'), quantity: 30 }], [p], 'Rabat', s)).toMatchObject({
      shipping: 0,
      total: 60000,
    });
    p.fulfillment = 1901;
    expect(() => quoteCart([{ ...line('a'), quantity: 30 }], [p], 'Rabat', s)).toThrow();
    // An item already above the threshold may cover delivery by itself.
    expect(() =>
      assertPublishedPrices(20000, [], 17000, { ...s, cartFreeShippingThreshold: 10000 }),
    ).not.toThrow();
  });
  it('uses product delivery fees only for independent orders and keeps the shared cart fee uniform', () => {
    const p = { ...product('a'), shippingCasa: 0, shippingOther: 5500 };
    expect(quoteCart([line('a')], [p], 'Casablanca', defaults, [], 'direct').shipping).toBe(0);
    expect(quoteCart([line('a')], [p], 'Rabat', defaults, [], 'direct').shipping).toBe(5500);
    expect(quoteCart([line('a')], [p], 'Rabat', defaults).shipping).toBe(3000);
    const second = { ...product('b'), shippingOther: 9000 };
    expect(quoteCart([line('a'), line('b')], [p, second], 'Rabat', defaults).shipping).toBe(3000);
    expect(() =>
      quoteCart([line('a'), line('b')], [p, second], 'Rabat', defaults, [], 'direct'),
    ).toThrow();
    expect(() =>
      assertPublishedPrices(4000, [], 2000, defaults, { shippingCasa: 0, shippingOther: 0 }),
    ).toThrow();
    expect(() =>
      assertPublishedPrices(5000, [], 2000, defaults, { shippingCasa: 0, shippingOther: 0 }),
    ).not.toThrow();
  });
  it('identifies a marketing source without pixels and rejects lookalike referrer domains', () => {
    expect(
      marketingSource(
        new URLSearchParams('utm_source=instagram&fbclid=x'),
        '',
        'https://store.test',
      ),
    ).toBe('instagram');
    expect(marketingSource(new URLSearchParams('fbclid=x'), '', 'https://store.test')).toBe('meta');
    expect(
      marketingSource(
        new URLSearchParams(),
        'https://m.facebook.com/posts/1',
        'https://store.test',
      ),
    ).toBe('facebook');
    expect(
      marketingSource(
        new URLSearchParams(),
        'https://facebook.com.evil.test/',
        'https://store.test',
      ),
    ).toBe('referral');
    expect(
      marketingSource(
        new URLSearchParams(),
        'https://store.test/products/item',
        'https://store.test',
      ),
    ).toBe('');
  });
  it('keeps an order intent stable across price revisions and phone formatting', () => {
    const customer = {
      name: 'Test',
      phone: '+212612345678',
      city: 'Rabat',
      address: 'Street 12',
      notes: '',
    };
    expect(checkoutIntent([line('a')], customer)).toBe(
      checkoutIntent([{ ...line('a'), revision: 2 }], { ...customer, phone: '0612345678' }),
    );
    expect(checkoutIntent([line('a')], customer)).not.toBe(
      checkoutIntent([{ ...line('a'), quantity: 2 }], customer),
    );
  });
  it('uses Morocco business dates rather than the host timezone', () => {
    expect(businessDate(new Date('2024-10-05T23:30:00Z'))).toBe('2024-10-06');
    expect(businessStart('2024-10-06')).toBe('2024-10-05T23:00:00.000Z');
    expect(businessDate(new Date('2026-10-05T23:30:00Z'))).toBe('2026-10-05');
    expect(businessStart('2026-10-06')).toBe('2026-10-06T00:00:00.000Z');
    expect(businessDate(new Date('2026-09-20T00:59:59Z'))).toBe('2026-09-20');
    expect(businessDate(new Date('2026-09-20T01:00:00Z'))).toBe('2026-09-20');
    expect(businessStart('2026-09-20')).toBe('2026-09-19T23:00:00.000Z');
    expect(businessStart('2026-09-21')).toBe('2026-09-21T00:00:00.000Z');
    expect(() => businessStart('2026-02-31')).toThrow();
  });
  it('ten products produce one shipping fee and one multi-item payload', () => {
    const p = Array.from({ length: 10 }, (_, i) => product('p' + i));
    const q = {
      ...quoteCart(
        p.map((p) => line(p.id)),
        p,
        'Rabat',
        defaults,
      ),
      fingerprint: 'x',
    };
    expect(q.shipping).toBe(3000);
    expect(q.total).toBe(202000);
    const remote = mowaridPayload({
      id: 'STORE-1',
      customer: {
        name: 'Test',
        phone: '0612345678',
        city: 'Rabat',
        address: 'Rue test 12',
        notes: '',
      },
      quote: q,
    });
    expect(remote.items).toHaveLength(10);
    expect(remote.customer_shipping_fee).toBe(30);
    expect(remote.items[0].retail_price).toBe(199);
  });
  it('rejects a forged mixed-supplier request', () =>
    expect(() =>
      quoteCart([line('a'), line('b')], [product('a'), product('b', 'b')], 'Rabat', defaults),
    ).toThrow('موردين'));
  it('does not infer supplier identity from a SKU', () => {
    expect(supplierKey({ sku: 'SUPPLIER-A-1' }, '')).toBeNull();
    expect(supplierKey({ supplier: { id: 'a' } }, 'supplier.id')).toBe('a');
    expect(supplierKey({ supplier_group_id: 'supp_a' }, defaults.supplierField)).toBe('supp_a');
  });
  it('rejects missing or unverified suppliers', () => {
    const p = product('a');
    p.verified = 0;
    expect(() => quoteCart([line('a')], [p], 'Rabat', defaults)).toThrow();
  });
  it('free shipping affects whole cart, and removing offer restores the single fee', () => {
    const a = product('a');
    a.offers = [{ id: 'two', label: 'two', quantity: 2, total: 29900, freeShipping: true }];
    const p = [a, product('b')],
      l = [{ ...line('a'), offerId: 'two', quantity: 2 }, line('b')];
    expect(quoteCart(l, p, 'Rabat', defaults).shipping).toBe(0);
    expect(quoteCart([line('b')], p, 'Rabat', defaults).shipping).toBe(3000);
  });
  it('allows bundles below the advisory minimum and validates stock and revisions', () => {
    const p = product('a');
    p.offers = [{ id: 'three', label: 'three', quantity: 3, total: 29900, freeShipping: true }];
    expect(
      quoteCart([{ ...line('a'), offerId: 'three', quantity: 3 }], [p], 'Rabat', defaults).total,
    ).toBe(29900);
    expect(() => quoteCart([{ ...line('a'), quantity: 101 }], [p], 'Rabat', defaults)).toThrow();
    expect(() => quoteCart([{ ...line('a'), revision: 2 }], [p], 'Rabat', defaults)).toThrow();
  });
  it('keeps bundle totals exact while sending a rounded unit price and an explicit COD total', () => {
    const p = product('a');
    p.minimum = 9000;
    p.fulfillment = 8000;
    p.offers = [{ id: 'three', label: '3 for 299', quantity: 3, total: 29900, freeShipping: true }];
    const quote = {
      ...quoteCart([{ ...line('a'), offerId: 'three', quantity: 3 }], [p], 'Rabat', defaults),
      fingerprint: 'x',
    };
    expect(quote.items[0]).toMatchObject({ unitPrice: 9967, subtotal: 29900 });
    expect(quote.total).toBe(29900);
    const remote = mowaridPayload({
      id: 'BUNDLE',
      customer: {
        name: 'Test',
        phone: '0612345678',
        city: 'قرية جديدة',
        address: 'Street 12',
        notes: '',
      },
      quote,
    });
    expect(remote.items[0].retail_price).toBe(99.67);
    expect(remote.cod_to_collect).toBe(299);
    expect(remote.customer_shipping_fee).toBe(0);
  });
  it('does not treat the advisory minimum as a per-unit floor', () => {
    const p = product('a');
    p.minimum = 9967;
    p.offers = [{ id: 'three', label: 'three', quantity: 3, total: 29900, freeShipping: false }];
    expect(
      quoteCart([{ ...line('a'), offerId: 'three', quantity: 3 }], [p], 'Rabat', defaults).subtotal,
    ).toBe(29900);
  });
  it('rejects missing wholesale costs and orders that do not cover wholesale plus base shipping', () => {
    const p = product('a');
    p.minimum = 0;
    p.fulfillment = 10000;
    p.offers = [{ id: 'three', label: 'three', quantity: 3, total: 29900, freeShipping: true }];
    expect(() =>
      quoteCart([{ ...line('a'), offerId: 'three', quantity: 3 }], [p], 'Rabat', defaults),
    ).toThrow('غير متاح');
    p.offers[0].total = 33000;
    expect(
      quoteCart([{ ...line('a'), offerId: 'three', quantity: 3 }], [p], 'Rabat', defaults).total,
    ).toBe(33000);
    p.fulfillment = null;
    expect(() => quoteCart([line('a')], [p], 'Rabat', defaults)).toThrow();
  });
  it('accepts buy-two-get-one-free using total margin, including zero-profit orders', () => {
    const p = product('a');
    p.minimum = 5000;
    p.fulfillment = 2000;
    p.price = 5000;
    p.offers = [{ id: 'gift', label: '2 + 1', quantity: 3, total: 10000, freeShipping: true }];
    const lines = [{ ...line('a'), quantity: 3, offerId: 'gift' }];
    expect(quoteCart(lines, [p], 'Rabat', defaults).total).toBe(10000);
    p.offers[0].total = 9000;
    expect(quoteCart(lines, [p], 'Rabat', defaults).total).toBe(9000);
    p.offers[0].total = 8000;
    expect(() => quoteCart(lines, [p], 'الدار البيضاء', defaults)).toThrow();
    expect(() => quoteCart(lines, [p], 'Rabat', defaults)).toThrow();
  });
  it('rejects a nationwide free-shipping offer that only breaks even in Casablanca', () => {
    const offer = { id: 'gift', label: '2 + 1', quantity: 3, total: 8000, freeShipping: true };
    expect(() => assertPublishedPrices(5000, [offer], 2000, defaults)).toThrow();
    expect(() =>
      assertPublishedPrices(5000, [{ ...offer, total: 9000 }], 2000, defaults),
    ).not.toThrow();
    expect(() => assertPublishedPrices(2000, [], 2000, defaults)).toThrow();
    expect(() =>
      assertPublishedPrices(2000, [], 2000, { ...defaults, shippingCasa: 3000 }),
    ).not.toThrow();
  });
  it('separates customer shipping from platform shipping and includes it in the total margin', () => {
    const p = product('a');
    p.minimum = 5000;
    p.fulfillment = 2000;
    p.price = 2000;
    const s = { ...defaults, shippingCasa: 3000, shippingOther: 5000 };
    expect(quoteCart([line('a')], [p], 'Casablanca', s).total).toBe(5000);
    expect(quoteCart([line('a')], [p], 'Rabat', s).total).toBe(7000);
    expect(() =>
      assertPublishedPrices(p.price, [], p.fulfillment, { ...s, shippingCasa: 0 }),
    ).toThrow();
  });
  it('allows reduced customer shipping when product margin covers the platform fee', () => {
    const p = product('a');
    p.price = 3500;
    p.fulfillment = 2000;
    p.minimum = 5000;
    const s = { ...defaults, shippingCasa: 1500, shippingOther: 1500 };
    expect(quoteCart([line('a')], [p], 'Rabat', s).total).toBe(5000);
    expect(() => assertPublishedPrices(p.price, [], p.fulfillment, s)).not.toThrow();
    p.price = 3499;
    expect(() => quoteCart([line('a')], [p], 'Rabat', s)).toThrow();
  });
  it('uses city metadata for Casablanca fees and accepts unlisted Arabic destinations', () => {
    expect(
      quoteCart([line('a')], [product('a')], 'BOUSKOURA', defaults, [
        { city: 'BOUSKOURA', is_casablanca: true },
      ]).shipping,
    ).toBe(2000);
    expect(quoteCart([line('a')], [product('a')], 'قرية جديدة', defaults).shipping).toBe(3000);
  });
  it('rejects duplicate SKU rows', () =>
    expect(() => quoteCart([line('a'), line('a')], [product('a')], 'Rabat', defaults)).toThrow());
  it('normalizes Moroccan and Arabic phones', () => {
    for (const v of ['+212 6 12 34 56 78', '00212612345678', '٠٦١٢٣٤٥٦٧٨', '۰۶۱۲۳۴۵۶۷۸'])
      expect(normalizePhone(v)).toBe('0612345678');
    expect(() => normalizePhone('0412345678')).toThrow();
  });
  it('accepts Casablanca aliases and exact financial cents', () => {
    expect(quoteCart([line('a')], [product('a')], 'الدار البيضاء', defaults).shipping).toBe(2000);
    expect(cents(149.5)).toBe(14950);
    expect(() => cents(149.333)).toThrow();
  });
  it('escapes embedded JSON script terminators', () =>
    expect(safeJson({ name: '</script><img onerror=x>' })).not.toContain('<'));
  it('replaces the same SKU but rejects switching supplier without emptying', () => {
    const a: any = { sku: 'a', supplier: 'a' },
      b: any = { sku: 'b', supplier: 'b' };
    expect(addToCart([a], { ...a, quantity: 2 })).toHaveLength(1);
    expect(() => addToCart([a], b)).toThrow();
    expect(addToCart([], b)).toEqual([b]);
  });
});

describe('promotions and explicit checkout additions', () => {
  it('expires a sale, preserves the original price, and requires review of a stale discounted cart', () => {
    const p = {
      ...product('sale'),
      presentation: { promotion: { price: 14900, endsAt: '2026-10-11T00:00:00Z' } },
    };
    expect(pricedProduct(p, Date.parse('2026-10-10T12:00:00Z')).price).toBe(14900);
    expect(pricedProduct(p, Date.parse('2026-10-11T00:00:00Z')).price).toBe(19900);
    expect(p.price).toBe(19900);
    expect(pricedProduct(p, Date.parse('2026-10-10T12:00:00Z')).revision).not.toBe(
      product('later').revision + 2,
    );
    const expired = {
      ...p,
      presentation: { promotion: { price: 14900, endsAt: '2020-01-01T00:00:00Z' } },
    };
    expect(() =>
      quoteCart([{ ...line('sale'), revision: 3 }], [expired], 'Rabat', defaults),
    ).toThrow('تغيرت بيانات');
    expect(
      quoteCart(
        [{ ...line('sale'), revision: pricedProduct(expired).revision }],
        [expired],
        'Rabat',
        defaults,
      ).subtotal,
    ).toBe(19900);
  });
});

it('counts down to the absolute sale deadline without resetting and bases the bar on the real saved interval', () => {
  const start = '2026-10-10T08:00:00Z',
    end = '2026-10-12T08:00:00Z';
  expect(promotionClock(end, Date.parse('2026-10-11T06:57:56Z'))).toEqual({
    days: 1,
    hours: 1,
    minutes: 2,
    seconds: 4,
    expired: false,
  });
  expect(promotionRemaining(start, end, Date.parse('2026-10-11T08:00:00Z'))).toBe(0.5);
  expect(promotionRemaining('', end)).toBeNull();
  expect(promotionClock(end, Date.parse(end))).toMatchObject({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    expired: true,
  });
});
