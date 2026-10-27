import { test, expect } from '@playwright/test';

test('an unlisted landing and a regular gallery share one product, and mobile cart checkout keeps one delivery fee', async ({
  page,
}) => {
  const origin = 'http://localhost:8788';
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.10.22' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const csrf = (await login.json()).csrf;
  const headers = { Origin: origin, 'X-CSRF-Token': csrf };
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  try {
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, {
          headers,
          data: {
            ...original,
            offers: [],
            presentation: { ...original.presentation, bundleMode: false },
            gallery: ['/demo/notebook.svg'],
            pageMode: 'landing',
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: original.name })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await page.getByLabel('إظهار في واجهة المتجر', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.locator('tbody tr').filter({ hasText: original.name })).toContainText(
      'بالرابط فقط',
    );
    await page.goto('/');
    await expect(page.locator('[data-product-card="demo-bag"]')).toHaveCount(0);
    await page.goto('/shop/' + original.slug);
    await expect(page.locator('#checkout-form')).toHaveCount(0);
    await expect(page.locator('[data-gallery-image]')).toHaveCount(2);
    await page.getByRole('button', { name: 'صورة المنتج 2', exact: true }).click();
    await expect(page.locator('#product-main-image')).toHaveAttribute('src', '/demo/notebook.svg');
    await page.getByRole('button', { name: 'تكبير صورة المنتج', exact: true }).click();
    await expect(page.locator('#image-dialog')).toBeVisible();
    await page.getByRole('button', { name: 'إغلاق الصورة', exact: true }).click();
    await page.locator('.product-description').scrollIntoViewIfNeeded();
    await expect(page.locator('#product-dock')).toHaveClass(/dock-visible/);
    await page.getByLabel('كمية المنتج', { exact: true }).fill('2');
    await page.locator('#add-offer').click();
    await expect(page.locator('#cart-dialog')).toBeVisible();
    await expect(page.locator('#cart-items .quantity-controls')).toContainText('2');
    await page.locator('#cart-items [data-change="1"]').click();
    await expect(page.locator('#cart-items .quantity-controls')).toContainText('3');
    await page.getByRole('link', { name: 'إتمام الطلب', exact: true }).click();
    await page.getByLabel('المدينة', { exact: true }).fill('Rabat');
    await expect(page.locator('#shipping')).toContainText('30');
    await expect(page.locator('#subtotal')).toContainText('447');
    await expect(page.locator('[data-quote-total]')).toContainText('477');
    await page.locator('.checkout-summary-details > summary').click();
    await expect(page.locator('#checkout-items')).toBeHidden();
    await page.locator('.checkout-summary-details > summary').click();
    const before = await page.evaluate(() => localStorage.getItem('dar-cart-v1'));
    await page.goto('/offers/' + original.slug);
    await expect(page.locator('.store-header')).toHaveCount(0);
    await expect(page.locator('#checkout-form')).toBeVisible();
    await expect(page.locator('.landing-footer summary')).toHaveText('السياسات');
    expect(await page.evaluate(() => localStorage.getItem('dar-cart-v1'))).toBe(before);
    const saved = (await (await page.request.get('/api/admin/products')).json()).filter(
      (p: any) => p.sku === original.sku,
    );
    expect(saved).toHaveLength(1);
    // Review the public layout at common phone widths and desktop, with no live submission.
    for (const width of [320, 390, 430, 820, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/shop/' + original.slug);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});

test('home search and navigation remain usable on phones without horizontal overflow', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'البحث عن منتج' }).fill('دفتر');
  await expect(page.locator('[data-product-card]:visible')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'البحث عن منتج' }).fill('');
  await expect(page.locator('[data-product-card]:visible')).toHaveCount(3);
  await page.locator('.mobile-menu summary').click();
  await expect(page.locator('.mobile-menu nav')).toBeVisible();
  await page.locator('.mobile-menu summary').click();
  for (const width of [320, 390, 430, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/redesigned-store-mobile.png', fullPage: true });
});

test('the owner chooses a cart-only free shipping amount and its progress reverses after removing quantity', async ({
  page,
}) => {
  const origin = 'http://localhost:8788';
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.10.23' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const headers = { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  try {
    await page.goto('/admin/settings');
    await page.getByLabel('تفعيل الشحن المجاني للسلة عند بلوغ مبلغ معين', { exact: true }).check();
    await page
      .getByLabel('مجموع المنتجات المطلوب للشحن المجاني — درهم', { exact: true })
      .fill('200');
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByText('تم حفظ التغييرات.', { exact: true })).toBeVisible();
    await page.goto('/');
    await page.locator('[data-add-product="demo-bag"]').click();
    await page.locator('.store-header [data-open-cart]').click();
    await expect(page.locator('[data-threshold-message]')).toContainText('51');
    await expect(page.locator('#cart-dialog')).not.toContainText('يُحسب التوصيل');
    await page.locator('#cart-items [data-change="1"]').click();
    await expect(page.locator('[data-threshold-message]')).toContainText('مؤهلة');
    await expect(page.locator('[role=progressbar]')).toHaveAttribute('aria-valuenow', '100');
    await page.locator('[data-cart-checkout]').click();
    await page.getByLabel('المدينة', { exact: true }).fill('Rabat');
    await expect(page.locator('#shipping')).toHaveText('مجاني');
    await page.locator('#checkout-items [data-change="-1"]').click();
    await expect(page.locator('#shipping')).toContainText('30');
    const before = await page.evaluate(() => localStorage.getItem('dar-cart-v1'));
    await page.goto('/offers/daily-bag');
    await page.getByLabel('المدينة', { exact: true }).fill('Rabat');
    await expect(page.locator('#shipping')).toContainText('30');
    expect(await page.evaluate(() => localStorage.getItem('dar-cart-v1'))).toBe(before);
  } finally {
    await page.request.put('/api/admin/settings', { headers, data: original });
  }
});

test('keyword and full-description search work from both the live search box and a direct search URL', async ({
  page,
}) => {
  const origin = 'http://localhost:8788';
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.10.24' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const headers = { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  try {
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: original.name })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await page.getByLabel('كلمات مفتاحية (اختياري)', { exact: true }).fill('شنطة، sac، voyage');
    await page
      .locator('[data-field="description"] textarea')
      .fill('تفاصيل المنتج. '.repeat(80) + ' كلمةنادرةللبحث');
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.locator('tbody')).toBeVisible();
    await page.goto('/');
    await page.getByRole('searchbox', { name: 'البحث عن منتج' }).fill('voyage');
    await expect(page.locator('[data-product-card]:visible')).toHaveCount(1);
    await expect(page.locator('[data-product-card="demo-bag"]')).toBeVisible();
    await page.getByRole('searchbox', { name: 'البحث عن منتج' }).fill('كلمةنادرةللبحث');
    await expect(page.locator('[data-product-card="demo-bag"]')).toBeVisible();
    await page.goto('/?q=' + encodeURIComponent('شنطه'));
    await expect(page.locator('[data-product-card]:visible')).toHaveCount(1);
    await expect(page.locator('[data-product-card="demo-bag"]')).toBeVisible();
    await page.getByRole('searchbox', { name: 'البحث عن منتج' }).fill('لايوجدهذاالمنتج');
    await expect(page.locator('#search-status')).toContainText('لم نجد');
    await page.getByRole('searchbox', { name: 'البحث عن منتج' }).fill('');
    await expect(page.locator('[data-product-card]:visible')).toHaveCount(3);
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});
