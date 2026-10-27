import { describe, it, expect, vi, afterEach } from 'vitest';
import { defaults, type Product } from '../src/shared/types';
import {
  assertPricePackage,
  minimumPackagePrice,
  shippingScenarios,
  assertPublishedPrices,
  quoteCart,
  priceProjection,
  platformShipping,
} from '../src/shared/domain';
import { pricedProduct } from '../src/shared/commerce';
import { protectPrices } from '../src/server/price-safety';
import {
  officialAmount,
  maximumShipping,
  rememberShipping,
  shippingCosts,
} from '../src/server/shipping-policy';
import type { Env } from '../src/server/db';
const product = (id: string, price = 30000, cost = 23000): Product => ({
  id,
  slug: id,
  sku: id,
  parentId: null,
  name: id,
  description: '',
  image: '',
  price,
  fulfillment: cost,
  minimum: cost,
  stock: 100,
  active: 1,
  featured: 0,
  supplier: 'same',
  verified: 1,
  offers: [],
  blocks: [],
  color: '#173d35',
  formColor: '#ffffff',
  revision: 1,
});
const free = { ...defaults, shippingCasa: 0, shippingOther: 0 };
const line = (p: Product) => ({ productId: p.id, offerId: '', quantity: 1, revision: p.revision });
afterEach(() => vi.useRealTimers());
describe('worst official cost protection and editor projections', () => {
  it('allows zero profit, rejects one cent of loss and protects Casablanca against the highest fee', () => {
    expect(() => assertPublishedPrices(13000, [], 10000, free, {}, 3000)).not.toThrow();
    expect(() => assertPublishedPrices(12999, [], 10000, free, {}, 3000)).toThrow();
    expect(() => assertPublishedPrices(13000, [], 10000, free, {}, 4500)).toThrow();
    expect(() => assertPublishedPrices(14500, [], 10000, free, {}, 4500)).not.toThrow();
    const p = product('p', 13000, 10000);
    expect(quoteCart([line(p)], [p], 'Casablanca', free, [], 'direct', 3000).total).toBe(13000);
    expect(() => quoteCart([line(p)], [p], 'Casablanca', free, [], 'direct', 4500)).toThrow();
    expect(priceProjection(13000, 10000, false, free, {}, 3000)).toMatchObject({
      profit: 0,
      shippingCost: 3000,
    });
    expect(priceProjection(13000, null, false, free, {}, null).profit).toBeNull();
    expect(platformShipping('New city', [{ city: 'New city', shipping_fee_mad: 45 }])).toBe(4500);
  });
  it('checks quantity offers, direct fees and the exact free-delivery threshold', () => {
    const p = product('p', 13000, 10000);
    const gift = { id: 'gift', label: '3', quantity: 3, total: 33000, freeShipping: true };
    expect(() =>
      assertPublishedPrices(p.price, [gift], p.fulfillment, defaults, {}, 3000),
    ).not.toThrow();
    expect(() =>
      assertPublishedPrices(
        p.price,
        [{ ...gift, total: 32999 }],
        p.fulfillment,
        defaults,
        {},
        3000,
      ),
    ).toThrow();
    const s = { ...defaults, shippingCasa: 3000, cartFreeShippingThreshold: 60000 };
    expect(() => assertPublishedPrices(2000, [], 1900, s, {}, 3000)).not.toThrow();
    expect(() => assertPublishedPrices(2000, [], 1901, s, {}, 3000)).toThrow();
    expect(() =>
      assertPublishedPrices(11000, [], 10000, defaults, { shippingCasa: 0 }, 3000),
    ).toThrow();
  });
  it('hides unsafe prices after provider costs change and preserves the stored product', () => {
    const p = product('p', 13000, 10000);
    const before = JSON.stringify(p);
    expect(protectPrices([p], free, 3000).products[0].active).toBe(1);
    expect(protectPrices([p], free, 4500).products[0].active).toBe(0);
    expect(protectPrices([p], free, null).products[0].active).toBe(0);
    expect(JSON.stringify(p)).toBe(before);
    p.offers = [
      { id: 'bad', label: 'bad', quantity: 2, total: 20500, freeShipping: true, enabled: false },
    ];
    expect(() =>
      assertPublishedPrices(p.price, p.offers, p.fulfillment, free, {}, 3000),
    ).not.toThrow();
  });
});
describe('real server expiry', () => {
  it('expires quantity offers and promotions exactly at the UTC deadline, rejecting forged carts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T08:59:59.999Z'));
    const p = product('p');
    p.presentation = { promotion: { price: 29000, endsAt: '2026-10-15T09:00:00Z' } };
    p.offers = [
      {
        id: 'quantity',
        label: '2',
        quantity: 2,
        total: 55000,
        freeShipping: false,
        endsAt: '2026-10-15T10:00:00+01:00',
      },
    ];
    const offer = {
      productId: p.id,
      offerId: 'quantity',
      quantity: 2,
      revision: pricedProduct(p).revision,
    };
    const accepted = quoteCart([offer], [p], 'Rabat', defaults);
    expect(accepted.subtotal).toBe(55000);
    vi.advanceTimersByTime(1);
    expect(pricedProduct(p).price).toBe(30000);
    expect(pricedProduct(p).offers).toEqual([]);
    expect(() => quoteCart([offer], [p], 'Rabat', defaults)).toThrow();
    expect(accepted.subtotal).toBe(55000);
    p.offers[0].endsAt = null;
    expect(pricedProduct(p).offers).toHaveLength(1);
  });
});
describe('official shipping provenance', () => {
  const envFixture = () => {
    const values = new Map<string, unknown>([['supplier_contract', { keyFingerprint: 'current' }]]);
    let cityRows: unknown[] = [];
    const env = {
      ENVIRONMENT: 'production',
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => ({
            run: async () => {
              values.set(args[0] as string, JSON.parse(args[1] as string));
            },
          }),
          first: async () => (sql.includes('cities') ? { json: JSON.stringify(cityRows) } : null),
        }),
      },
    };
    // state queries use bind(name).first(); keep a minimal genuine state interface.
    env.DB.prepare = (sql: string) =>
      ({
        bind: (...args: unknown[]) => ({
          first: async () =>
            values.has(args[0] as string)
              ? { json: JSON.stringify(values.get(args[0] as string)) }
              : null,
          run: async () => {
            values.set(args[0] as string, JSON.parse(args[1] as string));
          },
        }),
        first: async () => (sql.includes('cities') ? { json: JSON.stringify(cityRows) } : null),
      }) as any;
    return {
      env: env as unknown as Env,
      values,
      setCities: (rows: unknown[]) => {
        cityRows = rows;
      },
    };
  };
  it('calculates official delivery for a full 726-city catalogue without repeated list searches', async () => {
    const { env, setCities } = envFixture();
    setCities(
      Array.from({ length: 726 }, (_, i) => ({
        city: i === 0 ? 'Casablanca' : 'City ' + i,
        is_casablanca: i === 0,
        is_serviceable: true,
        shipping_fee_mad: i === 0 ? 20 : 30,
      })),
    );
    const find = vi.spyOn(Array.prototype, 'find');
    try {
      expect(await shippingCosts(env)).toEqual({ casa: 2000, other: 3000, maximum: 3000 });
      expect(
        find.mock.contexts.filter((list) => Array.isArray(list) && list.length === 726),
      ).toHaveLength(0);
    } finally {
      find.mockRestore();
    }
  });
  it('fails closed without reliable costs, ignores another credential and adopts official higher fees', async () => {
    const { env, values, setCities } = envFixture();
    await expect(maximumShipping(env)).rejects.toMatchObject({ code: 'shipping_policy_missing' });
    values.set('shipping_policy', { catalog: { maximum: 4500, keyFingerprint: 'old' } });
    await expect(maximumShipping(env)).rejects.toThrow();
    setCities([
      { city: 'Casa', shipping_fee_mad: 20 },
      { city: 'Rabat', shipping_fee_mad: 30 },
    ]);
    expect(await maximumShipping(env)).toBe(3000);
    await rememberShipping(env, 'catalog', [20, 45], 'current');
    expect(await maximumShipping(env)).toBe(4500);
    await rememberShipping(env, 'quote', [50], 'current');
    await rememberShipping(env, 'quote', [20], 'current');
    expect(await maximumShipping(env)).toBe(5000);
    expect(officialAmount('45')).toBeNull();
    expect(officialAmount(-45)).toBeNull();
    expect(officialAmount(45.001)).toBeNull();
  });
});

describe('merchant feedback: separate retail, delivery and minimum prices', () => {
  it('matches 295/175 product profit with matching-area delivery and counts an extra shipping margin', () => {
    const costs = { casa: 2000, other: 3000, maximum: 3000 };
    const original = shippingScenarios(29500, 17500, false, defaults, {}, costs).filter(
      (s) => s.mode === 'direct',
    );
    expect(
      original.map((s) => [s.products, s.customerShipping, s.shippingCost, s.total, s.profit]),
    ).toEqual([
      [29500, 2000, 2000, 31500, 12000],
      [29500, 3000, 3000, 32500, 12000],
    ]);
    const plus = shippingScenarios(
      29500,
      17500,
      false,
      defaults,
      { shippingCasa: 4000, shippingOther: 4000 },
      costs,
    ).filter((s) => s.mode === 'direct');
    expect(plus[1]).toMatchObject({
      products: 29500,
      customerShipping: 4000,
      shippingCost: 3000,
      total: 33500,
      profit: 13000,
    });
    const sale = shippingScenarios(26550, 17500, false, defaults, {}, costs).filter(
      (s) => s.mode === 'direct',
    );
    expect(sale.map((s) => s.profit)).toEqual([9050, 9050]);
  });
  it('matches all four 60-product / 40-delivery examples including exact break-even', () => {
    for (const [quantity, total, allowed] of [
      [1, 14900, true],
      [2, 16000, true],
      [3, 20000, false],
      [3, 22000, true],
    ] as const) {
      const cost = 6000 * quantity;
      expect(minimumPackagePrice(cost, true, defaults, {}, 4000)).toBe(cost + 4000);
      if (allowed)
        expect(() => assertPricePackage(total, cost, true, defaults, {}, 4000)).not.toThrow();
      else expect(() => assertPricePackage(total, cost, true, defaults, {}, 4000)).toThrow();
    }
    expect(minimumPackagePrice(18000, true, defaults, {}, 4000)).toBe(22000);
    expect(
      minimumPackagePrice(
        18000,
        false,
        { ...defaults, shippingCasa: 4000, shippingOther: 4000 },
        {},
        4000,
      ),
    ).toBe(18000);
  });
  it('the advertised minimum is accepted, and one cent less is rejected for paid, free and threshold policies', () => {
    for (const cost of [0, 1000, 6000, 18000])
      for (const threshold of [0, 1000, 10000, 50000])
        for (const freeShipping of [false, true]) {
          const s = { ...defaults, cartFreeShippingThreshold: threshold };
          const minimum = minimumPackagePrice(cost, freeShipping, s, {}, 4000);
          expect(() => assertPricePackage(minimum, cost, freeShipping, s, {}, 4000)).not.toThrow();
          if (minimum > 1)
            expect(() =>
              assertPricePackage(minimum - 1, cost, freeShipping, s, {}, 4000),
            ).toThrow();
        }
  });
  it('shipping fees can fund a small retail discount if all supported quantities remain safe', () => {
    const s = { ...defaults, shippingCasa: 3100, shippingOther: 3100 };
    expect(() => assertPublishedPrices(1999, [], 2000, s, {}, 3000)).not.toThrow();
    expect(() => assertPublishedPrices(1998, [], 2000, s, {}, 3000)).toThrow();
  });
  it('product-level free shipping persists for regular quantities and quantity offers', () => {
    const p = product('p', 14900, 6000);
    p.presentation = { freeShipping: true };
    p.offers = [{ id: 'two', label: 'two', quantity: 2, total: 16000, freeShipping: false }];
    expect(() =>
      assertPublishedPrices(p.price, p.offers, p.fulfillment, defaults, p, 4000),
    ).not.toThrow();
    expect(
      quoteCart(
        [{ ...line(p), offerId: 'two', quantity: 2 }],
        [p],
        'Rabat',
        defaults,
        [],
        'direct',
        4000,
      ),
    ).toMatchObject({ subtotal: 16000, shipping: 0, total: 16000 });
    expect(quoteCart([line(p)], [p], 'Rabat', defaults, [], 'direct', 4000)).toMatchObject({
      subtotal: 14900,
      shipping: 0,
      total: 14900,
    });
  });
});
