import { it, expect } from 'vitest';
import { defaults, type Product } from '../src/shared/types';
import { settingsSchema } from '../src/server/schemas';
import { landingBadgeText } from '../src/shared/landing-appearance';
import { storefrontSettings } from '../src/shared/i18n';
import { Home, OrderForm } from '../src/server/views';
const p = {
  id: 'one',
  name: 'one',
  pageMode: 'landing',
  price: 10000,
  revision: 1,
  offers: [],
  blocks: [],
  presentation: { landingCodBadge: { visible: false, text: 'legacy' } },
  verified: 1,
  stock: 10,
  supplier: 'one',
} as unknown as Product;
it('empty and whitespace form text hides the badge while preserving previous settings and ordinary checkout', async () => {
  for (const text of ['', '   ']) {
    const html = await OrderForm({ p, s: defaults, content: { codBadgeText: text } }).toString();
    expect(html).not.toContain('class="cod-badge"');
  }
  expect(landingBadgeText(p, {}, defaults)).toBe('');
  expect(landingBadgeText(p, { codBadgeText: 'Custom badge' }, defaults)).toBe('Custom badge');
  expect(
    landingBadgeText(
      { ...p, presentation: {} },
      { codBadgeText: 'الدفع عند الاستلام ✓' },
      { ...defaults, storeLanguage: 'fr' },
    ),
  ).toBe('Paiement à la livraison ✓');
  const normal = await OrderForm({
    p: { ...p, pageMode: 'product' },
    s: defaults,
    content: { codBadgeText: '' },
  }).toString();
  expect(normal).toContain('الدفع عند الاستلام ✓');
});
it('the authority card is optional, safe and globally hidden across locales until enabled', async () => {
  const { licenseCard: _, ...legacy } = defaults.home;
  expect(settingsSchema.parse({ ...defaults, home: legacy }).home.licenseCard.enabled).toBe(false);
  const s = {
    ...defaults,
    contentTranslations: {
      fr: { home: { licenseCard: { ...defaults.home.licenseCard, enabled: true } } },
    },
  };
  expect(storefrontSettings({ ...s, storeLanguage: 'fr' }).home.licenseCard.enabled).toBe(false);
  const hidden = await Home({ s, products: [], categories: [] }).toString();
  expect(hidden).not.toContain('/trust/ammps.png');
  const shown = await Home({
    s: {
      ...s,
      home: {
        ...s.home,
        licenseCard: {
          enabled: true,
          title: '<b>Certificates</b>',
          text: 'Details',
          documentUrl: 'https://example.test/certificates',
        },
      },
    },
    products: [],
    categories: [],
  }).toString();
  expect(shown).toContain('/trust/ammps.png');
  expect(shown).toContain('/trust/onssa.png');
  expect(shown).toContain('&lt;b&gt;Certificates');
  expect(shown).toContain('rel="noopener noreferrer"');
  expect(
    settingsSchema.safeParse({
      ...defaults,
      home: {
        ...defaults.home,
        licenseCard: { ...defaults.home.licenseCard, documentUrl: 'javascript:alert(1)' },
      },
    }).success,
  ).toBe(false);
});

it('saving unrelated translated home content does not inject an overriding default trust card', () => {
  const saved = settingsSchema.parse({
    ...defaults,
    contentTranslations: {
      ar: { home: { productsTitle: 'منتجاتنا' } },
      fr: { home: { tagline: 'Bienvenue' } },
    },
  });
  expect(saved.contentTranslations?.ar?.home).toEqual({ productsTitle: 'منتجاتنا' });
  expect(saved.contentTranslations?.fr?.home).toEqual({ tagline: 'Bienvenue' });
  expect(
    storefrontSettings({
      ...saved,
      home: {
        ...saved.home,
        licenseCard: { ...defaults.home.licenseCard, enabled: true, title: 'منتجات مرخّصة' },
      },
    }).home.licenseCard.title,
  ).toBe('منتجات مرخّصة');
});
