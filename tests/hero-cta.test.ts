import { it, expect } from 'vitest';
import { Home, ProductPage } from '../src/server/views';
import { defaults, type Product, type Settings } from '../src/shared/types';
import { blockSchema, settingsSchema } from '../src/server/schemas';
import { storefrontSettings } from '../src/shared/i18n';
const product: Product = {
  id: 'one',
  slug: 'one',
  sku: 'sku-one',
  parentId: null,
  name: 'Product',
  description: 'Description',
  image: '/demo/bag.svg',
  price: 14900,
  minimum: 11000,
  fulfillment: 8000,
  stock: 10,
  active: 1,
  featured: 0,
  supplier: 'one',
  verified: 1,
  offers: [],
  blocks: [],
  color: '#173d35',
  formColor: '#f3f0e9',
  formLayout: 'side',
  revision: 1,
  categoryId: '',
  pageMode: 'landing',
} as Product;
it('keeps automatic hero images by default and stores two independently validated replacements', async () => {
  const old = { ...defaults, home: { ...defaults.home } } as any;
  delete old.home.heroCardImages;
  expect(settingsSchema.parse(old).home.heroCardImages).toEqual(['', '']);
  const s = {
    ...defaults,
    home: {
      ...defaults.home,
      heroCardImages: ['/demo/candle.svg', '/demo/notebook.svg'] as [string, string],
    },
  };
  const html = await Home({ s, products: [product] }).toString();
  expect(html.match(/data-hero-custom="true"/g)).toHaveLength(2);
  expect(html).toContain('src="/demo/candle.svg"');
  expect(html).toContain('src="/demo/notebook.svg"');
  expect(await Home({ s: defaults, products: [product] }).toString()).not.toContain(
    'data-hero-custom',
  );
  expect(
    settingsSchema.safeParse({
      ...s,
      home: { ...s.home, heroCardImages: ['javascript:alert(1)', ''] },
    }).success,
  ).toBe(false);
});
it('custom cards survive empty catalogs, keep their slot indices and use common images across storefront languages', async () => {
  const s: Settings = {
    ...defaults,
    home: { ...defaults.home, heroCardImages: ['', '/demo/candle.svg'] },
    contentTranslations: { fr: { home: { heroCardImages: ['/demo/bag.svg', ''] } } },
  };
  for (const language of ['ar', 'fr', 'en'] as const)
    expect(storefrontSettings({ ...s, storeLanguage: language }).home.heroCardImages).toEqual([
      '',
      '/demo/candle.svg',
    ]);
  const html = await Home({ s, products: [] }).toString();
  expect(html).toContain('data-hero-index="1"');
  expect(html).not.toContain('hero-empty-mark');
  expect(html).toContain('src="/demo/candle.svg"');
});
it('retains an existing legacy single hero and restores automatic images when custom slots are cleared', async () => {
  const s = { ...defaults, home: { ...defaults.home, heroImage: '/demo/candle.svg' } };
  expect(await Home({ s, products: [product] }).toString()).toContain('hero-image');
  expect(
    await Home({
      s: { ...s, home: { ...s.home, heroCardImages: ['/demo/bag.svg', ''] } },
      products: [product],
    }).toString(),
  ).toContain('hero-collection');
});
it('colors the CTA section without changing the button, text or order form, and inherits the page when unset', async () => {
  const block = blockSchema.parse({
    id: 'cta',
    type: 'CTA',
    order: 0,
    enabled: true,
    settings: {
      text: 'Order now',
      color: '#770044',
      textColor: '#ffffff',
      backgroundColor: '#fff1f8',
      margin: 24,
      size: 18,
    },
  });
  const p = { ...product, blocks: [block] };
  const html = await ProductPage({ p, s: defaults, recommendations: [] }).toString();
  expect(html).toContain('padding:24px;background:#fff1f8');
  expect(html).toContain('background:#770044;color:#ffffff');
  expect(html).toContain('data-scroll-order');
  const restored = await ProductPage({
    p: {
      ...p,
      blocks: [{ ...block, settings: { ...block.settings, backgroundColor: undefined } }],
    },
    s: defaults,
    recommendations: [],
  }).toString();
  expect(restored).toContain('background:transparent');
  expect(
    blockSchema.safeParse({
      ...block,
      settings: { backgroundColor: 'url(https://foreign.example/)' },
    }).success,
  ).toBe(false);
});
