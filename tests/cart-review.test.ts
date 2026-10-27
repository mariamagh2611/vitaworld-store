import { expect, it } from 'vitest';
import { compatibleCartLine } from '../src/shared/cart-review';
import type { LocalCartLine, PublicProduct } from '../src/shared/types';
const product = {
  id: 'p',
  sku: 'SKU',
  supplier: 's',
  price: 12900,
  active: 1,
  verified: 1,
  stock: 20,
  offers: [],
  revision: 4,
} as unknown as PublicProduct;
const line = {
  productId: 'p',
  sku: 'SKU',
  supplier: 's',
  offerId: '',
  quantity: 4,
  unitPrice: 12900,
  freeShipping: false,
  revision: 1,
} as LocalCartLine;
it('accepts operational revisions and stock changes while retaining the customer’s same purchase', () => {
  expect(compatibleCartLine(line, product)).toBe(true);
  expect(compatibleCartLine(line, { ...product, stock: 10, revision: 5 })).toBe(true);
  expect(line.revision).toBe(1);
});
it('requires review of real prices, suppliers, shipping offers and unavailable quantities', () => {
  for (const updated of [
    { ...product, price: 13900 },
    { ...product, supplier: 'other' },
    { ...product, sku: 'OTHER' },
    { ...product, stock: 3 },
    { ...product, active: 0 },
    { ...product, verified: 0 },
  ])
    expect(compatibleCartLine(line, updated)).toBe(false);
  const offer = { id: 'pack', quantity: 4, total: 39900, freeShipping: true, label: 'Pack' };
  const packed = { ...line, offerId: 'pack', unitPrice: 9975, subtotal: 39900, freeShipping: true };
  expect(compatibleCartLine(packed, { ...product, offers: [offer] })).toBe(true);
  expect(
    compatibleCartLine(packed, { ...product, offers: [{ ...offer, freeShipping: false }] }),
  ).toBe(false);
  expect(compatibleCartLine(packed, { ...product, offers: [{ ...offer, total: 39500 }] })).toBe(
    false,
  );
});

it('recognizes product-wide free delivery on ordinary lines without generating false cart updates', () => {
  expect(
    compatibleCartLine({ ...line, freeShipping: true }, { ...product, freeShipping: true }),
  ).toBe(true);
  expect(compatibleCartLine(line, { ...product, freeShipping: true })).toBe(false);
});
