import { it, expect } from 'vitest';
import { policyHtml } from '../src/server/policy-content';
import { defaults, type Product } from '../src/shared/types';
import { localizedCategory, storefrontSettings, landingSettings } from '../src/shared/i18n';
import { landingFormAppearance } from '../src/shared/landing-appearance';
import { productDeliveryText } from '../src/shared/product-info';
import { Home, ProductPage } from '../src/server/views';
import { categorySchema, settingsSchema } from '../src/server/schemas';
const p: Product = {
  id: 'one',
  slug: 'one',
  sku: 'sku',
  parentId: null,
  name: 'Product',
  description: 'Description',
  image: '',
  price: 10000,
  minimum: 5000,
  fulfillment: 5000,
  stock: 10,
  active: 1,
  featured: 0,
  supplier: 'one',
  verified: 1,
  offers: [],
  blocks: [],
  color: '#173d35',
  formColor: '#f3f0e9',
  revision: 1,
  pageMode: 'product',
  presentation: {},
};
it('phone numbers remain one isolated LTR run inside Arabic without changing stored text or weakening HTML safety', () => {
  const html = policyHtml(
    'تواصل معنا: +212 603 186 116\n\nالسعر: 324.99 درهم\n\n<script>alert(1)</script>',
  );
  expect(html).toContain('<bdi dir="ltr" class="phone-number">+212 603 186 116</bdi>');
  expect(html).toContain('324.99 درهم');
  expect(html).not.toContain('<script>');
  expect(policyHtml('[هاتف +212 603 186 116](tel:+212603186116)')).toContain(
    'href="tel:+212603186116"',
  );
});
it('category translations fall back safely, render the selected storefront language and keep names escaped', async () => {
  const category = categorySchema.parse({
    id: '38194c89-9885-4a62-8eee-aa6c0f70ce9b',
    name: 'إدارة الوزن',
    image: '',
    icon: '',
    position: 0,
    active: 1,
    translations: { fr: 'Gestion du poids', en: '<script>Bad</script>' },
  });
  expect(localizedCategory(category, 'ar').name).toBe('إدارة الوزن');
  const html = await Home({
    s: { ...defaults, storeLanguage: 'fr' },
    products: [],
    categories: [category],
  }).toString();
  expect(html).toContain('Gestion du poids');
  expect(html).not.toContain('إدارة الوزن');
  expect(
    await Home({
      s: { ...defaults, storeLanguage: 'en' },
      products: [],
      categories: [category],
    }).toString(),
  ).toContain('&lt;script&gt;Bad');
});
it('delivery summary is independent of the returns policy, editable in each language and globally hidden', async () => {
  const s = {
    ...defaults,
    returns: 'LONG POLICY MUST NOT BE COPIED',
    contentTranslations: {
      fr: {
        productInfo: {
          deliveryReturnsTitle: 'Livraison et retours',
          deliveryReturnsText: 'Résumé court',
          paymentTitle: 'Paiement à réception',
        },
      },
    },
  };
  const html = await ProductPage({ p, s: { ...s, storeLanguage: 'fr' } }).toString();
  expect(html).toContain('Résumé court');
  expect(html).toContain('Paiement à réception');
  expect(html).not.toContain('LONG POLICY');
  expect(html).not.toContain('href="/policies/returns"');
  expect(
    await ProductPage({
      p,
      s: {
        ...s,
        productInfo: { ...defaults.productInfo, showDeliveryReturns: false },
        storeLanguage: 'fr',
      },
    }).toString(),
  ).not.toContain('product-service-summary');
  expect(storefrontSettings({ ...s, storeLanguage: 'fr' }).productInfo.deliveryTitle).toBe(
    'Livraison à votre adresse',
  );
  expect(productDeliveryText('Casa {casa}, autres {other}', '20 MAD', '30 MAD')).toBe(
    'Casa 20 MAD, autres 30 MAD',
  );
  const parsed = settingsSchema.parse({
    ...defaults,
    contentTranslations: { fr: { productInfo: { paymentTitle: 'Payez à réception' } } },
  });
  expect(parsed.contentTranslations.fr?.productInfo).toEqual({ paymentTitle: 'Payez à réception' });
});
it('saved landing theme preserves all inherited form colors after a storefront theme change, including custom overrides', () => {
  const landing = {
    ...p,
    pageMode: 'landing' as const,
    presentation: { landingFormAppearance: { background: '#123456' } },
  };
  const original = landingFormAppearance(landing, defaults);
  const changed = {
    ...defaults,
    theme: { ...defaults.theme, primary: '#f00000', background: '#000000', text: '#ffffff' },
    landingTheme: defaults.theme,
  };
  expect(landingFormAppearance(landing, landingSettings(changed, landing))).toEqual(original);
  expect(landingSettings(changed, p).theme.primary).toBe('#f00000');
});
