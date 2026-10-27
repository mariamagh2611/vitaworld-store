import { test, expect, type Page } from '@playwright/test';
import { money } from '../../src/shared/types';
import { readFileSync } from 'node:fs';
const translations = JSON.parse(readFileSync('src/shared/translations.json', 'utf8'));
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
async function editBag(page: Page) {
  await page.goto('/admin/products');
  await page
    .locator('tbody tr')
    .filter({ hasText: 'DEMO-A1' })
    .getByRole('button', { name: 'تعديل', exact: true })
    .click();
}
for (const language of ['ar', 'fr', 'en'] as const) {
  test(`catalog cards show supplier customer price, wholesale and profit without delivery in ${language}`, async ({
    page,
  }) => {
    await owner(page, '198.18.15.' + (['ar', 'fr', 'en'].indexOf(language) + 1));
    const t = (key: string) => (language === 'ar' ? key : translations[key][language]);
    await page.route('**/api/auth/status', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), adminLanguage: language },
      });
    });
    await page.route('**/api/admin/catalog*', async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      const change = (c: any) => ({
        ...c,
        ...(c.sku === 'DEMO-A1'
          ? { suggested_retail_price: 295, fulfillment_price: 175, minimum_selling_price: 205 }
          : {}),
        ...(c.sku === 'DEMO-A2' ? { fulfillment_price: null } : {}),
        ...(c.sku === 'DEMO-A3'
          ? { suggested_retail_price: 186.18, fulfillment_price: 160.09 }
          : {}),
        ...(c.sku === 'DEMO-B1' ? { fulfillment_price: 0 } : {}),
      });
      await route.fulfill({
        response,
        json: Array.isArray(body)
          ? body.map(change)
          : { ...body, products: body.products.map(change) },
      });
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: 'DEMO-A1' })
      .getByRole('button', { name: t('تعديل'), exact: true })
      .click();
    await page
      .locator('summary')
      .filter({ hasText: t('تغيير منتج مورد') + ' · DEMO-A1' })
      .click();
    const catalog = page.locator('.catalog-grid').first();
    const prices = (sku: string) =>
      catalog.locator('.catalog-card').filter({ hasText: sku }).locator('.catalog-price');
    const bag = prices('DEMO-A1');
    await expect(bag).toHaveCount(3);
    await expect(bag.locator('small')).toHaveText([
      t('سعر الزبون'),
      t('سعر المسوق'),
      t('الربح (دون توصيل)'),
    ]);
    await expect(bag.locator('strong')).toHaveText([
      money(29500, language),
      money(17500, language),
      money(12000, language),
    ]);
    await expect(prices('DEMO-A2').nth(1)).toContainText(t('غير متاح'));
    await expect(prices('DEMO-A2').nth(2)).toContainText(t('غير متاح'));
    await expect(prices('DEMO-A3').nth(2)).toContainText(money(2609, language));
    await expect(prices('DEMO-B1').nth(1)).toContainText(money(0, language));
    await expect(prices('DEMO-B1').nth(2)).toContainText(money(9900, language));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await bag.first().scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(await catalog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(
        await bag.evaluateAll((elements) =>
          elements.every((element) => element.scrollWidth <= element.clientWidth),
        ),
      ).toBe(true);
      await catalog.screenshot({ path: `test-results/catalog-prices-${language}-${width}.png` });
    }
  });
}
test('settings saving prevents duplicate requests and brings its confirmation into view', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.14.1');
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  let writes = 0;
  await page.route('**/api/admin/settings', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes++;
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({ response });
  });
  try {
    await page.goto('/admin/appearance');
    const save = page.getByRole('button', { name: 'حفظ الإعدادات', exact: true });
    await save.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
    await save.click();
    await expect(page.getByRole('button', { name: 'جارٍ الحفظ…', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('status').filter({ hasText: 'تم حفظ التغييرات.' }),
    ).toBeInViewport();
    expect(writes).toBe(1);
    expect(await page.evaluate(() => scrollY)).toBeLessThan(100);
  } finally {
    await page.unroute('**/api/admin/settings');
    await page.request.put('/api/admin/settings', { headers, data: original });
  }
});
test('supplier text or HTML can be imported and formatted descriptions are safe in previews and public pages', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.14.2');
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  const html =
    '<div dir="rtl"><h2>تفاصيل منسقة</h2><p>محتوى <strong>مهم</strong></p><ul><li>ميزة عملية</li></ul><img src="https://catalog-images.example.test/detail.svg" onerror="window.unsafeDescription=true"><script>window.unsafeDescription=true</script></div>';
  await page.route('**/api/admin/catalog*', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    const change = (c: any) => ({
      ...c,
      description: html,
      keywords: ['sac', 'voyage'],
      stock_quantity: 997,
    });
    await route.fulfill({
      response,
      json: Array.isArray(body)
        ? body.map(change)
        : { ...body, products: body.products.map(change) },
    });
  });
  await page.route('https://catalog-images.example.test/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="green"/></svg>',
    }),
  );
  try {
    await editBag(page);
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await page.getByLabel('نوع الوصف المستورد من مورد', { exact: true }).selectOption('text');
    await page.getByRole('button', { name: 'اختيار حقيبة يومية أنيقة', exact: true }).click();
    await expect(page.getByLabel('الوصف', { exact: true })).toHaveValue(
      'تفاصيل منسقة\nمحتوى مهم\nميزة عملية',
    );
    await expect(page.getByLabel('كلمات مفتاحية (اختياري)', { exact: true })).toHaveValue(
      'sac, voyage',
    );
    await expect(page.locator('.catalog-grid').first()).not.toContainText('997');
    await page.getByLabel('نوع الوصف المستورد من مورد', { exact: true }).selectOption('html');
    await page.getByRole('button', { name: 'استيراد الوصف من مورد', exact: true }).click();
    await page.getByRole('button', { name: 'كود HTML', exact: true }).first().click();
    await expect(page.getByLabel('الوصف', { exact: true })).toHaveValue(html);
    await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
    const preview = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(preview.locator('.formatted-description h2')).toHaveText('تفاصيل منسقة');
    await expect(preview.locator('.formatted-description strong')).toHaveText('مهم');
    await expect(preview.locator('.formatted-description script')).toHaveCount(0);
    await expect(preview.locator('.formatted-description [onerror]')).toHaveCount(0);
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === original.id,
    );
    expect(saved.description).toBe('تفاصيل منسقة\nمحتوى مهم\nميزة عملية');
    expect(saved.presentation.descriptionHtml).not.toContain('script');
    await page.goto('/shop/' + original.slug);
    await expect(page.locator('.formatted-description img')).toHaveJSProperty('naturalWidth', 128);
    expect(await page.evaluate(() => (window as any).unsafeDescription)).toBeUndefined();
    const search = await (
      await page.request.get('/api/products?q=' + encodeURIComponent('ميزة عملية'))
    ).json();
    expect(search.some((p: any) => p.id === original.id)).toBe(true);
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});
test('a gallery thumbnail becomes the main image without losing the previous photo', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.14.3');
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  try {
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, {
          headers,
          data: { ...original, gallery: ['/demo/notebook.svg', '/demo/candle.svg'] },
        })
      ).ok(),
    ).toBe(true);
    await editBag(page);
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    const photo = page
      .locator('.gallery-editor-row')
      .filter({ has: page.locator('img[src="/demo/notebook.svg"]') });
    await photo.getByRole('button', { name: 'تعيين كصورة رئيسية', exact: true }).click();
    await expect(
      photo.getByRole('button', { name: 'الصورة الرئيسية', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === original.id,
    );
    expect(saved.image).toBe('/demo/notebook.svg');
    expect(saved.gallery).toContain(original.image);
    await page.goto('/shop/' + original.slug);
    await expect(page.locator('#product-main-image')).toHaveAttribute('src', '/demo/notebook.svg');
    await expect(page.locator('[data-gallery-image="' + original.image + '"]')).toHaveCount(1);
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});
test('manual recommendations show catalog photos and import a new product only after its price is confirmed', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.14.4');
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  let imported: any;
  await page.route('https://catalog-images.example.test/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="green"/></svg>',
    }),
  );
  try {
    await editBag(page);
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await page.getByLabel('طريقة اختيار المنتجات المقترحة', { exact: true }).selectOption('manual');
    const card = page.getByRole('button', { name: 'اقتراح حافظة للبطاقات', exact: true });
    await expect(card.locator('img')).toHaveJSProperty('naturalWidth', 128);
    await expect(card).not.toContainText('997');
    await expect(
      page.getByRole('button', { name: 'اقتراح شمعة بلحظات هادئة', exact: true }),
    ).toBeDisabled();
    const before = await (await page.request.get('/api/admin/products')).json();
    expect(before.some((p: any) => p.sku === 'DEMO-A3')).toBe(false);
    await card.click();
    await expect(
      page.getByLabel('سعر بيع المنتج المقترح بالدرهم', { exact: true }),
    ).toBeInViewport();
    await page.getByLabel('سعر بيع المنتج المقترح بالدرهم', { exact: true }).fill('95');
    await page.getByRole('button', { name: 'نشر المنتج وإضافته للمقترحات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم نشر المنتج واختياره للمقترحات.');
    imported = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.sku === 'DEMO-A3',
    );
    expect(imported.active).toBe(1);
    expect(imported.price).toBe(9500);
    await expect(page.locator('.selected-recommendations')).toContainText('حافظة للبطاقات');
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    await page.goto('/shop/' + original.slug);
    await expect(page.locator('[data-related-products] [data-product-card]')).toHaveAttribute(
      'data-product-card',
      imported.id,
    );
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
    if (imported)
      await page.request.put('/api/admin/products/' + imported.id, {
        headers,
        data: { ...imported, active: 0, storefrontVisible: 0 },
      });
  }
});
test('desktop product inputs share a row and publication sits beside Save, with one multi-image picker', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.14.5');
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await editBag(page);
    const sku = page.locator('[data-field=sku] input'),
      category = page.locator('[data-field=categoryId] select');
    const bounds = await Promise.all([sku.boundingBox(), category.boundingBox()]);
    expect(
      Math.max(...bounds.map((b) => b!.y)) - Math.min(...bounds.map((b) => b!.y)),
    ).toBeLessThan(8);
    await expect(
      page.locator('.product-save-controls').getByLabel('نشر المنتج', { exact: true }),
    ).toBeChecked();
    await expect(page.locator('.product-publish-state')).toContainText('سيُنشر عند الحفظ');
    await expect(page.getByLabel('نشر المنتج', { exact: true })).toHaveCount(1);
    await expect(page.locator('.product-media-editor input[type=file]')).toHaveCount(1);
    await expect(page.locator('.product-media-editor input[type=file]')).toHaveAttribute(
      'multiple',
      '',
    );
    await expect(page.locator('[data-field=slug] input')).toBeHidden();
    const basicPanel = page.locator('.product-editor-section').first();
    await basicPanel.screenshot({ path: 'test-results/compact-product-basics.png' });
    expect((await basicPanel.boundingBox())!.height).toBeLessThan(450);
    await page.screenshot({ path: 'test-results/compact-product-desktop.png', fullPage: true });
    await page.getByLabel('نشر المنتج', { exact: true }).uncheck();
    await expect(page.locator('.product-publish-state')).toContainText('سيُحفظ كمسودة');
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    expect(
      (await (await page.request.get('/api/admin/products')).json()).find(
        (p: any) => p.id === original.id,
      ).active,
    ).toBe(0);
    await editBag(page);
    await expect(page.getByLabel('نشر المنتج', { exact: true })).not.toBeChecked();
    const pictures = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      const files = [];
      for (const color of ['#173d35', '#d08a40']) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 64, 64);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), 'image/png'),
        );
        files.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
      }
      return files;
    });
    const count = await page.locator('.gallery-editor-row').count();
    await page.locator('.product-media-editor input[type=file]').setInputFiles(
      pictures.map((bytes, i) => ({
        name: `image-${i}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from(bytes),
      })),
    );
    await expect(page.locator('.gallery-editor-row')).toHaveCount(count + 2);
    await expect(page.locator('.gallery-editor-row.is-main-image img')).toHaveAttribute(
      'src',
      original.image,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'test-results/compact-product-mobile.png', fullPage: true });
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});
test('the single content editor remains compact in Arabic, French and English on desktop and phone', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.14.6');
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const labels = {
    ar: ['اسم المنتج', 'الوصف', 'كلمات مفتاحية (اختياري)'],
    fr: ['Nom du produit', 'Description', 'Mots-clés (facultatif)'],
    en: ['Product name', 'Description', 'Keywords (optional)'],
  };
  try {
    expect(
      (
        await page.request.put('/api/admin/settings', {
          headers,
          data: { ...original, storeLanguages: ['ar', 'fr', 'en'] },
        })
      ).ok(),
    ).toBe(true);
    for (const [language, copyLabels] of Object.entries(labels)) {
      expect(
        (
          await page.request.patch('/api/admin/language', {
            headers,
            data: { scope: 'admin', language },
          })
        ).ok(),
      ).toBe(true);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('/admin/products');
        await page
          .locator('tbody tr')
          .filter({ hasText: 'DEMO-A1' })
          .locator('.admin-product-actions button')
          .click();
        await expect(page.locator('.product-copy-editor')).toHaveCount(1);
        await expect(page.locator('.product-copy-heading select')).toHaveCount(1);
        for (const label of copyLabels)
          await expect(page.getByLabel(label, { exact: true })).toHaveCount(1);
        await page.locator('.product-copy-heading select').selectOption('ar');
        await expect(page.getByLabel(copyLabels[0], { exact: true })).toHaveAttribute('dir', 'rtl');
        await page.locator('.product-copy-heading select').selectOption('fr');
        await expect(page.getByLabel(copyLabels[0], { exact: true })).toHaveAttribute('dir', 'ltr');
        await page.locator('.product-copy-heading select').selectOption('en');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `test-results/compact-editor-${language}-${width}.png`,
          fullPage: true,
        });
      }
    }
  } finally {
    await page.request.put('/api/admin/settings', { headers, data: original });
  }
});
