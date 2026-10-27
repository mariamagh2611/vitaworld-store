import { it, expect } from 'vitest';
import { productSort, sortedProducts } from '../src/shared/product-sort';
import { defaults, type Product } from '../src/shared/types';
import { Home } from '../src/server/views';
import { settingsSchema } from '../src/server/schemas';
import { storefrontSettings } from '../src/shared/i18n';
it('price order uses current prices, keeps ties stable and default search relevance without mutation', () => {
  const products = [
    { id: 'a', price: 200 },
    { id: 'b', price: 100 },
    { id: 'c', price: 100 },
  ];
  expect(sortedProducts(products, 'price-asc', (p) => p.price).map((p) => p.id)).toEqual([
    'b',
    'c',
    'a',
  ]);
  expect(sortedProducts(products, 'price-desc', (p) => p.price).map((p) => p.id)).toEqual([
    'a',
    'b',
    'c',
  ]);
  expect(sortedProducts(products, '', (p) => p.price, ['c', 'a']).map((p) => p.id)).toEqual([
    'c',
    'a',
    'b',
  ]);
  expect(products.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  expect(productSort('price-desc', false)).toBe('');
  expect(productSort('invalid')).toBe('');
});
it('server ordering uses promotion prices and hiding is global across translated storefronts', async () => {
  const products = [
    {
      id: 'one',
      name: 'One',
      slug: 'one',
      price: 20000,
      presentation: { promotion: { price: 5000 } },
      active: 1,
      stock: 10,
      verified: 1,
      supplier: 'one',
      offers: [],
      blocks: [],
    },
    {
      id: 'two',
      name: 'Two',
      slug: 'two',
      price: 10000,
      active: 1,
      stock: 10,
      verified: 1,
      supplier: 'one',
      offers: [],
      blocks: [],
    },
  ] as unknown as Product[];
  const html = await Home({ s: defaults, products, sort: 'price-asc' }).toString();
  expect(html.indexOf('data-product-card="one"')).toBeLessThan(
    html.indexOf('data-product-card="two"'),
  );
  expect(html).toContain('data-price-sort');
  const s = {
    ...defaults,
    home: { ...defaults.home, showPriceSort: false },
    contentTranslations: { fr: { home: { showPriceSort: true } } },
    storeLanguage: 'fr' as const,
  };
  expect(storefrontSettings(s).home.showPriceSort).toBe(false);
  expect(await Home({ s, products, sort: 'price-desc' }).toString()).not.toContain(
    'data-price-sort',
  );
  const { showPriceSort: _, ...old } = defaults.home;
  expect(settingsSchema.parse({ ...defaults, home: old }).home.showPriceSort).toBe(true);
});
