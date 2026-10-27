import { test, expect, type Page } from '@playwright/test';
test.use({ actionTimeout: 7000 });
const origin = 'http://localhost:8788';
async function owner(page: Page, ip: string) {
  const response = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': ip },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(response.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await response.json()).csrf };
}
test('dashboard and storefront switch independently and retain editable content on phones', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.11.21');
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  try {
    await page.goto('/admin/settings');
    await page.getByRole('button', { name: 'فتح قائمة الإدارة', exact: true }).click();
    await page.locator('.admin-sidebar select').selectOption('fr');
    await page.getByRole('button', { name: 'Fermer le menu', exact: true }).click();
    await expect(page.locator('.admin-header h1')).toHaveText('Paramètres de la boutique');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('searchbox', { name: 'البحث عن منتج' })).toBeVisible();
    await page.goto('/admin/settings');
    await page.getByLabel('Activer English', { exact: true }).check();
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/admin/settings')).json()).settings.storeLanguages,
      )
      .toContain('en');
    await page.getByLabel('Langue par défaut de la boutique', { exact: true }).selectOption('en');
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/admin/settings')).json()).settings.storeLanguage,
      )
      .toBe('en');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('searchbox', { name: 'Search products' })).toBeVisible();
    await expect(page.locator('.product-card').first()).toContainText('Add to cart');
    await page.goto('/admin/appearance');
    await page
      .getByLabel('Titre de la page d’accueil', { exact: true })
      .fill('My custom English storefront');
    await page.getByRole('button', { name: 'Enregistrer les paramètres', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Modifications enregistrées.');
    await page.goto('/');
    await expect(page.locator('.hero h1')).toHaveText('My custom English storefront');
    await page.goto('/admin/settings');
    await page.getByLabel('Langue par défaut de la boutique', { exact: true }).selectOption('ar');
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/admin/settings')).json()).settings.storeLanguage,
      )
      .toBe('ar');
    await page.goto('/');
    await expect(page.locator('.hero h1')).not.toHaveText('My custom English storefront');
    await page.request.patch('/api/admin/language', {
      headers,
      data: { scope: 'admin', language: 'ar' },
    });
    await page.request.patch('/api/admin/language', {
      headers,
      data: { scope: 'store', language: 'en' },
    });
    await page.goto('/admin/settings');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.admin-header h1')).toHaveText('إعدادات المتجر');
    await page.goto('/');
    await expect(page.locator('.hero h1')).toHaveText('My custom English storefront');
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  } finally {
    await page.request.put('/api/admin/settings', { headers, data: original });
  }
});
test('French product policies, manual recommendations, matching cart buttons and checkout promotion work together', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.11.22');
  const settings = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const rows = await (await page.request.get('/api/admin/products')).json();
  const product = rows.find((p: any) => p.id === 'demo-bag');
  try {
    const save = await page.request.put('/api/admin/settings', {
      headers,
      data: {
        ...settings,
        storeLanguage: 'fr',
        storeLanguages: ['fr'],
        cartFreeShippingThreshold: 20000,
        contentTranslations: {
          ...settings.contentTranslations,
          fr: {
            returns: 'Retours selon la politique générale de la boutique',
            copy: { 'متابعة التسوق': 'Poursuivre mes achats' },
          },
        },
      },
    });
    expect(save.ok()).toBe(true);
    expect(
      (
        await page.request.put('/api/admin/products/' + product.id, {
          headers,
          data: {
            ...product,
            presentation: {
              deliveryReturns: 'Livraison personnalisée et retours sur demande',
              recommendationMode: 'manual',
              recommendedIds: ['demo-notebook', 'demo-candle'],
              translations: {
                fr: {
                  name: 'Sac quotidien',
                  description: 'Une description française personnalisée',
                },
              },
            },
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: product.sku })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await expect(page.getByLabel('محتوى التوصيل والاسترجاع', { exact: true })).toHaveCount(0);
    await page.goto('/shop/' + product.slug);
    await expect(page.locator('h1')).toHaveText('Sac quotidien');
    await page
      .locator('.product-description-panel > summary')
      .filter({ hasText: 'Livraison et retours' })
      .click();
    await expect(page.locator('.product-description-panel')).toContainText([
      'Une description française personnalisée',
      'Retours selon la politique générale de la boutique',
    ]);
    await expect(page.locator('[data-related-products] [data-product-card]')).toHaveCount(1);
    await expect(page.locator('[data-related-products] [data-product-card]')).toHaveAttribute(
      'data-product-card',
      'demo-notebook',
    );
    const search = await (await page.request.get('/api/products?q=Sac%20quotidien')).json();
    expect(search.some((p: any) => p.id === product.id)).toBe(true);
    await page.locator('#add-offer').click();
    await expect(
      page.getByRole('button', { name: 'Poursuivre mes achats', exact: true }),
    ).toBeVisible();
    const styles = await page.evaluate(() => {
      const a = getComputedStyle(document.querySelector('[data-cart-checkout]')!),
        b = getComputedStyle(document.querySelector('.cart-continue')!);
      return [
        a.backgroundColor,
        b.backgroundColor,
        a.color,
        b.color,
        a.fontSize,
        b.fontSize,
        a.borderRadius,
        b.borderRadius,
      ];
    });
    expect(styles[0]).toBe(styles[1]);
    expect(styles[2]).toBe(styles[3]);
    expect(styles[4]).toBe(styles[5]);
    expect(styles[6]).toBe(styles[7]);
    await page.locator('[data-cart-checkout]').click();
    const promotion = page.locator('#order-form [data-cart-threshold]');
    await expect(promotion).toBeVisible();
    await expect(promotion).toContainText('51 MAD');
    await expect(page.getByLabel('Nom complet', { exact: true })).toBeVisible();
    await page.locator('#checkout-items [data-change="1"]').click();
    await expect(promotion).toContainText('Félicitations');
    await expect(page.locator('#shipping')).toHaveText('Gratuite');
    await page.locator('#checkout-items [data-change="-1"]').click();
    await expect(promotion).toContainText('51 MAD');
    await expect(page.locator('#shipping')).toContainText('30');
    await page.goto('/offers/' + product.slug);
    await expect(page.locator('[data-cart-threshold]')).toHaveCount(0);
    await expect(page.locator('.landing-footer summary')).toHaveText('Politiques');
  } finally {
    await page.request.put('/api/admin/products/' + product.id, { headers, data: product });
    await page.request.put('/api/admin/settings', { headers, data: settings });
  }
});

test('visitors choose from published languages and keep their basket, location and preference independently', async ({
  page,
  context,
  browser,
}) => {
  const headers = await owner(page, '198.18.11.23');
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const rows = await (await page.request.get('/api/admin/products')).json();
  const product = rows.find((p: any) => p.id === 'demo-bag');
  let other;
  try {
    expect(
      (
        await page.request.put('/api/admin/products/' + product.id, {
          headers,
          data: { ...product, presentation: { ...product.presentation, landingLanguage: 'ar' } },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin/settings');
    await page.getByLabel('تفعيل اللغة Français', { exact: true }).check();
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/admin/settings')).json()).settings.storeLanguages,
      )
      .toEqual(['ar', 'fr']);
    await page.getByLabel('لغة المحتوى الذي تعدّله', { exact: true }).selectOption('fr');
    await page.getByLabel('الشريط الترويجي', { exact: true }).fill('Bienvenue dans notre boutique');
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    const saved = (await (await page.request.get('/api/admin/settings')).json()).settings;
    expect(saved.storeLanguage).toBe('ar');
    expect(saved.adminLanguage).toBe('ar');
    expect(saved.contentTranslations.fr.announcement).toBe('Bienvenue dans notre boutique');
    await page.goto(
      '/shop/' + product.slug + '?utm_source=facebook&utm_campaign=language-test#product-buy',
    );
    await page.locator('#add-offer').click();
    await page.locator('.dialog-heading [data-close-cart]').click();
    const before = await page.evaluate(() => localStorage.getItem('dar-cart-v1'));
    await page.locator('[data-store-language]').selectOption('fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page).toHaveURL(/lang=fr/);
    expect(new URL(page.url()).pathname).toBe('/shop/' + product.slug);
    expect(new URL(page.url()).searchParams.get('utm_campaign')).toBe('language-test');
    expect(new URL(page.url()).hash).toBe('#product-buy');
    expect(await page.evaluate(() => localStorage.getItem('dar-cart-v1'))).toBe(before);
    await expect(page.locator('[data-cart-count]').first()).toHaveText('1');
    await page.locator('.store-header [data-open-cart]').click();
    await expect(page.locator('#cart-dialog')).toBeVisible();
    await expect(page.locator('#cart-dialog')).toContainText('Commander');
    await page.locator('[data-cart-checkout]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByLabel('Nom complet', { exact: true })).toBeVisible();
    await expect(page.locator('#subtotal')).toContainText('149');
    const cartPayload = JSON.parse(before!).map(
      ({ productId, offerId, quantity, revision }: any) => ({
        productId,
        offerId,
        quantity,
        revision,
      }),
    );
    const responseFr = await page.request.post('/api/checkout/quote', {
      data: { cart: cartPayload, city: 'Rabat' },
      headers: { Origin: origin, 'X-UI-Language': 'fr' },
    });
    const responseAr = await page.request.post('/api/checkout/quote', {
      data: { cart: cartPayload, city: 'Rabat' },
      headers: { Origin: origin, 'X-UI-Language': 'ar' },
    });
    expect(responseFr.ok()).toBe(true);
    expect(responseAr.ok()).toBe(true);
    const quoteFr = await responseFr.json(),
      quoteAr = await responseAr.json();
    expect(quoteFr.fingerprint).toBe(quoteAr.fingerprint);
    expect(quoteFr.total).toBe(quoteAr.total);
    await page.getByLabel('Nom complet', { exact: true }).fill('Client de test');
    await page.getByLabel('Numéro de téléphone', { exact: true }).fill('0612345678');
    await page.getByLabel('Ville', { exact: true }).fill('Casablanca');
    await page.getByLabel('Adresse complète', { exact: true }).fill('Adresse de test');
    await page.locator('[data-store-language]').selectOption('ar');
    await expect(page.getByLabel('الاسم الكامل', { exact: true })).toHaveValue('Client de test');
    await expect(page.getByLabel('المدينة', { exact: true })).toHaveValue('Casablanca');
    await expect(page.locator('#shipping')).toContainText('20');
    expect(await page.evaluate(() => sessionStorage.getItem('dar-language-draft'))).toBeNull();
    await page.locator('[data-store-language]').selectOption('fr');
    await expect(page.getByLabel('Numéro de téléphone', { exact: true })).toHaveValue('0612345678');
    await expect(page.getByLabel('Adresse complète', { exact: true })).toHaveValue(
      'Adresse de test',
    );
    await page.goto('/policies/privacy');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await page.goto('/offers/' + product.slug);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('.store-header')).toHaveCount(0);
    await expect(page.locator('[data-store-language]')).toHaveCount(0);
    await expect(page.locator('link[rel=alternate]')).toHaveCount(0);
    await expect(page.getByLabel('الاسم الكامل', { exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.goto('/offers/' + product.slug + '/policies/privacy?lang=fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('[data-store-language]')).toHaveCount(0);
    expect(
      (await context.cookies()).find((cookie) => cookie.name === 'store-language')?.value,
    ).toBe('fr');
    await page.goto('/shop/' + product.slug);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    expect(await page.evaluate(() => localStorage.getItem('dar-cart-v1'))).toBe(before);
    for (const language of ['ar', 'fr'])
      for (const width of [320, 390, 430, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/?lang=' + language + '&category=&q=');
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(page.locator('[data-store-language]')).toBeVisible();
      }
    await page.goto('/?lang=fr');
    await expect(page.locator('.announcement')).toHaveText('Bienvenue dans notre boutique');
    await expect(page.locator('link[rel=alternate][hreflang=ar]')).toHaveAttribute(
      'href',
      /lang=ar/,
    );
    other = await browser.newContext();
    const fresh = await other.newPage();
    await fresh.goto(origin + '/');
    await expect(fresh.locator('html')).toHaveAttribute('lang', 'ar');
    await fresh.goto(origin + '/?lang=en');
    await expect(fresh.locator('html')).toHaveAttribute('lang', 'ar');
    await page.goto('/admin/settings');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await page.getByLabel('تفعيل اللغة Français', { exact: true }).uncheck();
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/admin/settings')).json()).settings.storeLanguages,
      )
      .toEqual(['ar']);
    await page.goto('/?lang=fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('[data-store-language]')).toHaveCount(0);
    expect(
      (await context.cookies()).find((cookie) => cookie.name === 'store-language')?.value,
    ).toBe('fr');
  } finally {
    await other?.close();
    await page.request.put('/api/admin/products/' + product.id, { headers, data: product });
    await page.request.put('/api/admin/settings', { headers, data: original });
  }
});

test('merchant edits optional product translations and pins image landing UI independently', async ({
  page,
  context,
}) => {
  const headers = await owner(page, '198.18.11.24');
  const settings = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const rows = await (await page.request.get('/api/admin/products')).json();
  const product = rows.find((p: any) => p.id === 'demo-bag');
  try {
    expect(
      (
        await page.request.put('/api/admin/settings', {
          headers,
          data: {
            ...settings,
            adminLanguage: 'ar',
            storeLanguage: 'ar',
            storeLanguages: ['ar', 'fr', 'en'],
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: product.sku })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await expect(page.getByLabel('اسم المنتج', { exact: true })).toHaveCount(1);
    await expect(page.getByText('نسخ المحتوى باللغات', { exact: true })).toHaveCount(0);
    await page.getByLabel('لغة محتوى المنتج', { exact: true }).selectOption('fr');
    await page.getByLabel('اسم المنتج', { exact: true }).fill('Sac pour les voyages');
    await page.getByLabel('الوصف', { exact: true }).fill('Description française pour les voyages');
    await page.getByLabel('كلمات مفتاحية (اختياري)', { exact: true }).fill('motcampagnefr');
    await page.getByLabel('لغة محتوى المنتج', { exact: true }).selectOption('en');
    await page.getByLabel('اسم المنتج', { exact: true }).fill('');
    await page.getByLabel('الوصف', { exact: true }).fill('');
    await page.getByLabel('لغة اللاندينج باج', { exact: true }).selectOption('fr');
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === product.id,
    );
    expect(saved.presentation.landingLanguage).toBe('fr');
    expect(saved.presentation.translations.fr.name).toBe('Sac pour les voyages');
    expect(saved.presentation.translations.fr.keywords).toBe('motcampagnefr');
    const found = await (await page.request.get('/api/products?q=motcampagnefr')).json();
    expect(found.some((p: any) => p.id === product.id)).toBe(true);
    expect(saved.image).toBe(product.image);
    expect(saved.blocks).toEqual(product.blocks);
    await page.goto('/shop/' + product.slug + '?lang=ar');
    await expect(page.locator('h1')).toHaveText(
      product.presentation?.translations?.ar?.name || product.name,
    );
    await page.locator('[data-store-language]').selectOption('fr');
    await expect(page.locator('h1')).toHaveText('Sac pour les voyages');
    await page.waitForLoadState('load');
    await expect(page.locator('.product-description-panel').first()).toContainText(
      'Description française pour les voyages',
    );
    await page.locator('[data-store-language]').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.waitForLoadState('load');
    await expect(page.locator('h1')).toHaveText(product.name);
    await expect(page.locator('.product-description-panel').first()).toContainText(
      product.description,
    );
    expect(
      (
        await page.request.patch('/api/admin/store-languages', {
          headers,
          data: { storeLanguage: 'ar', storeLanguages: ['ar'] },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/?lang=ar');
    for (const path of ['/offers/' + product.slug, '/offers/' + product.slug + '?lang=en']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
      await expect(page.locator('[data-store-language]')).toHaveCount(0);
      await expect(page.getByLabel('Nom complet', { exact: true })).toBeVisible();
      await expect(page.locator('.landing-footer summary')).toHaveText('Politiques');
      await expect(page.locator('.image-slice').first()).toHaveAttribute(
        'src',
        product.blocks.find((b: any) => b.enabled && b.type === 'IMAGE')?.settings.image ||
          product.image,
      );
    }
    await page.locator('#checkout-form a').filter({ hasText: 'confidentialité' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('h1')).toHaveText('Politique de confidentialité');
    await expect(page.locator('[data-store-language]')).toHaveCount(0);
    expect(
      (await context.cookies()).find((cookie) => cookie.name === 'store-language')?.value,
    ).toBe('ar');
    const review = await (
      await page.request.get('/api/products?ids=' + product.id, {
        headers: { 'X-UI-Language': 'fr' },
      })
    ).json();
    expect(review[0].name).toBe('Sac pour les voyages');
    const invalid = await page.request.post('/api/checkout/quote', {
      headers: { Origin: origin, 'X-UI-Language': 'fr' },
      data: { cart: [], city: 'Rabat' },
    });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).message).toContain('Corrigez');
    const preview = await page.request.post('/api/admin/preview', {
      headers,
      data: { ...saved, pageMode: 'landing' },
    });
    expect(preview.ok()).toBe(true);
    const html = (await preview.json()).html;
    expect(html).toContain('lang="fr"');
    expect(html).toContain('Nom complet');
    expect(html).not.toContain('data-store-language');
    expect(
      (
        await page.request.put('/api/admin/products/' + product.id, {
          headers,
          data: { ...saved, pageMode: 'landing' },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/products/' + product.slug + '?lang=ar');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('[data-store-language]')).toHaveCount(0);
    await page.goto('/shop/' + product.slug);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  } finally {
    await page.request.put('/api/admin/products/' + product.id, { headers, data: product });
    await page.request.put('/api/admin/settings', { headers, data: settings });
  }
});
