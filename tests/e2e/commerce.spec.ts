import { test, expect } from '@playwright/test';
const origin = 'http://localhost:8788';
test('a sale uses server prices while Buy now preserves a basket from another warehouse', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.31.1' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const headers = { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
  const settings = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const products = await (await page.request.get('/api/admin/products')).json();
  const bag = products.find((p: any) => p.id === 'demo-bag');
  try {
    const configured = await page.request.put('/api/admin/settings', {
      headers,
      data: {
        ...settings,
        whatsapp: '212600000000',
        contactEmail: 'owner@example.test',
        contactPhone: '+212600000000',
        socials: { ...settings.socials, instagram: 'https://instagram.com/example' },
      },
    });
    expect(configured.ok()).toBe(true);
    const sale = await page.request.put('/api/admin/products/' + bag.id, {
      headers,
      data: {
        ...bag,
        storefrontVisible: 0,
        presentation: {
          ...bag.presentation,
          promotion: { price: 12000, endsAt: new Date(Date.now() + 48 * 3600000).toISOString() },
        },
      },
    });
    expect(sale.ok()).toBe(true);
    await page.goto('/');
    await expect(page.locator('.store-contacts a[href="mailto:owner@example.test"]')).toBeVisible();
    await expect(page.locator('.whatsapp svg path')).toHaveCount(1);
    await page.locator('[data-add-product="demo-candle"]').click();
    await page.goto('/shop/daily-bag');
    await expect(page.locator('.product-price-line del')).toBeVisible();
    await expect(page.locator('[data-promo-countdown]')).toBeVisible();
    await expect(page.locator('[data-clock-part]')).toHaveCount(4);
    const buy = await page.locator('#buy-now').boundingBox(),
      add = await page.locator('#add-offer').boundingBox();
    expect(Math.abs(buy!.y - add!.y)).toBeLessThan(1);
    await page.screenshot({ path: 'test-results/promotion-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const desktopBuy = await page.locator('#buy-now').boundingBox(),
      desktopAdd = await page.locator('#add-offer').boundingBox();
    expect(Math.abs(desktopBuy!.y - desktopAdd!.y)).toBeLessThan(1);
    await page.locator('#product-buy').scrollIntoViewIfNeeded();
    await expect(page.locator('#product-dock')).not.toHaveClass(/dock-visible/);
    await page.screenshot({ path: 'test-results/promotion-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });

    await page.locator('#buy-now').click();
    await expect(page).toHaveURL(/checkout\?product=demo-bag/);
    await expect(page.locator('#checkout-upsells,[data-cross-sell]')).toHaveCount(0);
    await page.locator('#checkout-items [data-direct-quantity][data-change="1"]').click();
    await expect(page.locator('#subtotal')).toContainText('258');
    await page.locator('#checkout-items [data-direct-quantity][data-change="-1"]').click();
    await expect(page.locator('#subtotal')).toContainText('120');
    await page.getByLabel('الاسم الكامل', { exact: true }).fill('Direct checkout fixture');
    await page.getByLabel('رقم الهاتف', { exact: true }).fill('0612345678');
    await page.getByLabel('المدينة', { exact: true }).fill('Rabat');
    await page.getByLabel('العنوان بالتفصيل', { exact: true }).fill('Local test address');
    const posted = page.waitForResponse(
      (r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST',
    );
    await page.locator('#checkout-form button[type=submit]').click();
    const response = await posted;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON().checkoutMode).toBe('direct');
    await expect(page.locator('#thanks-dialog')).toBeVisible();
    const remaining = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('dar-cart-v1') || '[]'),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].productId).toBe('demo-candle');
    const publicHTML = await (await page.request.get('/')).text();
    expect(publicHTML).not.toContain('CAPI');
  } finally {
    await page.request.put('/api/admin/products/' + bag.id, { headers, data: bag });
    await page.request.put('/api/admin/settings', { headers, data: settings });
  }
});
test('campaign visits and checkout visits are recorded once per browser session with full campaign parameters', async ({
  page,
}) => {
  const campaign = 'funnel-browser-' + crypto.randomUUID();
  await page.goto(
    '/?utm_source=facebook&utm_campaign=' +
      campaign +
      '&utm_medium=paid&utm_content=creative1&utm_id=campaign42&fbclid=click-test',
  );
  await page.locator('[data-add-product="demo-bag"]').click();
  await page.goto('/checkout');
  await expect(page.locator('#checkout-form')).toBeVisible();
  await page.locator('#checkout-form').scrollIntoViewIfNeeded();
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.31.2' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  await expect
    .poll(async () => {
      const data = await (await page.request.get('/api/admin/analytics')).json();
      return data.campaigns.find((row: any) => row.campaign === campaign);
    })
    .toMatchObject({ visits: 1, checkouts: 1, orders: 0 });
  const attr = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dar-attribution') || '{}'),
  );
  expect(attr.last).toMatchObject({
    utm_medium: 'paid',
    utm_content: 'creative1',
    utm_id: 'campaign42',
    fbclid: 'click-test',
  });
});

test('saved CAPI credentials stay write-only and saving settings also persists the entered server token', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.31.3' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  await page.route('**/api/admin/settings', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (route.request().method() === 'GET') data.credentials = ['meta'];
    await route.fulfill({ response, json: data });
  });
  await page.route('**/api/admin/credentials', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/admin/pixels');
  await page.getByText('إعداد حدث الشراء عند التوصيل إلى Meta', { exact: true }).click();
  const token = page.getByLabel(/Meta CAPI Token/);
  await expect(token).toHaveValue('');
  await expect(token).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: /إظهار Meta CAPI/ })).toHaveCount(0);
  await token.fill('isolated-browser-secret-fixture');
  await page.getByRole('button', { name: 'حفظ CAPI Token', exact: true }).click();
  await expect(token).toHaveValue('');
  await expect(page.getByLabel('Meta Test Event Code', { exact: true })).toHaveCount(0);
  await token.fill('second-isolated-browser-fixture');
  const saved = page.waitForRequest(
    (r) => r.url().endsWith('/api/admin/credentials') && r.method() === 'PUT',
  );
  await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
  expect((await saved).postDataJSON()).toEqual({ meta: 'second-isolated-browser-fixture' });
  await expect(token).toHaveValue('');
  await expect(page.getByRole('status').filter({ hasText: 'تم حفظ التغييرات.' })).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
});

test('analytics has only the three campaign inputs and no conversion percentage', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.31.4' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  await page.goto('/admin/analytics');
  await expect(
    page.getByRole('heading', { name: 'أنشئ رابطًا لمعرفة مصدر الطلب', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'معدل التحويل', exact: true })).toHaveCount(
    0,
  );
  for (const label of ['UTM medium', 'UTM content', 'UTM term'])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('اسم الحملة (اختياري)', { exact: true })).toBeVisible();
});

for (const bundleMode of [false, true])
  test(`an open ${bundleMode ? 'fixed bundle' : 'legacy tier'} checkout requires review when its selected quantity discount expires`, async ({
    page,
  }) => {
    const login = await page.request.post('/api/auth/login', {
      headers: { Origin: origin, 'CF-Connecting-IP': '198.18.31.6' },
      data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
    });
    expect(login.ok()).toBe(true);
    const headers = { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
    const original = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === 'demo-bag',
    );
    try {
      const offer = {
        id: 'expires-in-tab',
        label: 'عرض كمية مؤقت',
        quantity: 2,
        total: 20000,
        freeShipping: false,
        enabled: true,
        endsAt: new Date(Date.now() + 6000).toISOString(),
      };
      expect(
        (
          await page.request.put('/api/admin/products/' + original.id, {
            headers,
            data: {
              ...original,
              offers: [offer],
              presentation: {
                ...original.presentation,
                ...(bundleMode ? { bundleMode: true } : {}),
              },
            },
          })
        ).ok(),
      ).toBe(true);
      await page.goto('/checkout?product=demo-bag&offer=' + offer.id);
      await expect(page.locator('input[name=offer]')).toHaveCount(0);
      if (bundleMode) await expect(page.locator('[data-bundle-quantity]')).toHaveValue('2');
      else await expect(page.locator('#checkout-items .quantity-controls span')).toHaveText('2');
      await expect(
        page.getByRole('button', { name: 'مراجعة بيانات العرض وتحديثها', exact: true }),
      ).toBeVisible({ timeout: 10000 });
      await expect(page.locator('input[name=offer]')).toHaveCount(0);
      if (bundleMode) await expect(page.locator('[data-bundle-quantity]')).toHaveValue('2');
      else await expect(page.locator('#checkout-items .quantity-controls span')).toHaveText('2');
      await page.getByRole('button', { name: 'مراجعة بيانات العرض وتحديثها', exact: true }).click();
      await expect(page.locator('input[name=offer][value="' + offer.id + '"]')).toHaveCount(0);
      await expect(page.locator('#checkout-error')).toHaveText('');
      if (bundleMode) {
        await expect(page.locator('[data-bundle-quantity]')).toHaveValue('1');
        await expect(page.locator('#subtotal')).toContainText(String(original.price / 100));
      }
    } finally {
      await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
    }
  });

test('choosing a quantity offer on the product page carries its price and free delivery into checkout without repeating the selector', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.31.7' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const headers = { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
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
            offers: [
              {
                id: 'feedback-two',
                label: 'عرض الكمية 2',
                quantity: 2,
                total: 50000,
                freeShipping: true,
                enabled: true,
              },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/shop/daily-bag');
    await page.locator('input[name=offer][value="feedback-two"]').check();
    await expect(page.locator('[data-product-price]').first()).toContainText('500');
    const quoted = page.waitForResponse(
      (r) =>
        r.url().includes('/api/checkout/quote') &&
        r.request().method() === 'POST' &&
        r.request().postDataJSON()?.cart?.[0]?.offerId === 'feedback-two',
    );
    await page.locator('#buy-now').click();
    expect(await (await quoted).json()).toMatchObject({
      subtotal: 50000,
      shipping: 0,
      total: 50000,
      items: [{ quantity: 2, offerId: 'feedback-two' }],
    });
    await expect(page.locator('input[name=offer],.offer-options')).toHaveCount(0);
    await expect(page.locator('#checkout-items .quantity-controls span')).toHaveText('2');
    await expect(page.locator('#checkout-items')).not.toContainText('وحدة');
    await expect(page.locator('#subtotal')).toContainText('500');
    await expect(page.locator('#shipping')).toContainText('مجاني');
    await expect(page.locator('[data-quote-total]').first()).toContainText('500');
    await page.reload();
    await expect(page.locator('#subtotal')).toContainText('500');
    await expect(page.locator('#shipping')).toContainText('مجاني');
    await expect(page.locator('input[name=offer]')).toHaveCount(0);
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});

test('the editor has five sections, compact profit, bundles next to prices and actionable loss feedback', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.31.8' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  await page.goto('/admin/products');
  await page
    .locator('tr')
    .filter({ hasText: 'حقيبة يومية أنيقة' })
    .getByRole('button', { name: 'تعديل', exact: true })
    .click();
  const panel = page
    .locator('.product-editor-section')
    .filter({ has: page.locator('summary').getByText('السعر والباقات', { exact: true }) });
  await expect(page.locator('.product-editor-section')).toHaveCount(5);
  await expect(panel.locator('.bundles-editor')).toBeVisible();
  await page.getByLabel('السعر الأصلي بالدرهم', { exact: true }).fill('295');
  await expect(panel.locator('.profit-line').first()).toContainText('ربحك الصافي التقريبي');
  await expect(page.locator('.profit-scenario,.profit-row')).toHaveCount(0);
  await expect(page.getByText('الحد الأقصى للكمية', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'إضافة عرض مكمل', exact: true })).toHaveCount(0);
  await expect(page.getByText('الإعلان والمرتجعات غير مشمولين', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
  await expect(page.locator('.product-editor-section[open],.offers-subsection[open]')).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
  await expect(page.getByLabel('السعر الأصلي بالدرهم', { exact: true })).toBeVisible();
  await page.getByLabel('السعر الأصلي بالدرهم', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
  const error = page
    .getByRole('alert')
    .filter({ hasText: 'السعر لا يغطي التكلفة الإجمالية القصوى لمورد.' });
  await expect(error).toBeVisible();
  await page.getByLabel('السعر الأصلي بالدرهم', { exact: true }).fill('295');
  await expect(error).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/simplified-product-mobile.png', fullPage: true });
});

test('retired complementary lines in an existing basket require review before removal and retain the main product', async ({
  page,
}) => {
  await page.goto('/');
  const products = await (await page.request.get('/api/products')).json();
  const bag = products.find((p: any) => p.id === 'demo-bag');
  const extra = products.find((p: any) => p.id === 'demo-notebook');
  const makeLine = (p: any, offerId = '') => ({
    productId: p.id,
    sku: p.sku,
    name: p.name,
    image: p.image,
    supplier: p.supplier,
    offerId,
    quantity: 1,
    unitPrice: p.price,
    freeShipping: !!p.freeShipping,
    revision: p.revision,
  });
  await page.evaluate(
    (lines) => localStorage.setItem('dar-cart-v1', JSON.stringify(lines)),
    [makeLine(bag), { ...makeLine(extra, 'checkout:retired'), subtotal: 1000 }],
  );
  await page.goto('/checkout');
  await expect(page.locator('#checkout-items .cart-line')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'تحديث بيانات السلة', exact: true })).toBeVisible();
  await expect(page.locator('#checkout-upsells,[data-cross-sell]')).toHaveCount(0);
  await page.getByRole('button', { name: 'تحديث بيانات السلة', exact: true }).click();
  await expect(page.locator('#checkout-error')).toHaveText('');
  await expect(page.locator('#checkout-items .cart-line')).toHaveCount(1);
  await expect(page.locator('#checkout-items')).toContainText(bag.name);
});
