import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const origin = 'http://localhost:8788';
async function owner(page: Page) {
  const account = { email: 'owner@example.test', password: 'local-admin-test-password-2026' };
  if ((await (await page.request.get('/api/auth/status')).json()).setup) {
    const vars = await readFile('.dev.vars', 'utf8');
    expect(
      (
        await page.request.post('/api/auth/setup', {
          headers: { Origin: origin },
          data: { ...account, token: vars.match(/^SETUP_TOKEN=(.+)$/m)![1] },
        })
      ).ok(),
    ).toBe(true);
  }
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.75.1' },
    data: account,
  });
  expect(login.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
}
test('landing choices preserve customer fields and cart and submit the selected SKU using its real bundles and delivery', async ({
  page,
}) => {
  const headers = await owner(page);
  const originals = await (await page.request.get('/api/admin/products')).json();
  const bag = originals.find((p: any) => p.id === 'demo-bag');
  const notebook = originals.find((p: any) => p.id === 'demo-notebook');
  const candle = originals.find((p: any) => p.id === 'demo-candle');
  try {
    // A hidden but published SKU is a valid landing alternative, unrelated drafts are never shown.
    expect(
      (
        await page.request.put('/api/admin/products/' + notebook.id, {
          headers,
          data: { ...notebook, storefrontVisible: 0 },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.put('/api/admin/products/' + bag.id, {
          headers,
          data: {
            ...bag,
            pageMode: 'landing',
            blocks: [],
            presentation: { ...bag.presentation, landingLanguage: 'ar' },
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: bag.sku })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    const picker = page.locator('.landing-products-editor');
    await picker.getByLabel('البحث باسم أو كود المنتج', { exact: true }).fill('DEMO-A2');
    await picker.locator('.landing-product-pick > label input').check();
    await picker.getByLabel('مكوّن من الباك الحالي (قطعة واحدة)', { exact: true }).check();
    await picker.getByLabel('البحث باسم أو كود المنتج', { exact: true }).fill('DEMO-B1');
    await picker.locator('.landing-product-pick > label input').check();
    await picker.getByLabel('مكوّن من الباك الحالي (قطعة واحدة)', { exact: true }).check();
    await page.getByLabel('شارة الدفع أعلى الاستمارة', { exact: true }).fill('اطلب بأمان');
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === bag.id,
    );
    expect(saved.presentation.landingProductIds).toEqual([notebook.id, candle.id]);
    await page.goto('/shop/' + bag.slug);
    await page.locator('#add-offer').click();
    const cart = await page.evaluate(() => localStorage.getItem('dar-cart-v1'));
    await page.goto('/offers/' + bag.slug);
    await expect(page.locator('.cod-badge')).toHaveText('اطلب بأمان');
    await expect(page.locator('input[name=landing-product]')).toHaveCount(3);
    await expect(page.locator('[data-pack-savings]')).toContainText('19');
    await page.locator('[name=name]').fill('Landing choices fixture');
    await page.locator('[name=phone]').fill('0612345678');
    await page.locator('[name=city]').fill('Rabat');
    await page.locator('[name=address]').fill('Local fixture address');
    await page.locator('input[name=offer][value=bag-two]').check();
    await expect(page.locator('#subtotal')).toContainText('258');
    await expect(page.locator('#shipping')).toHaveText('مجاني');
    await page.locator('input[name=landing-product][value=demo-notebook]').check();
    await expect(page.locator('#checkout-items')).toContainText(notebook.name);
    await expect(page.locator('#subtotal')).toContainText('69');
    await expect(page.locator('#shipping')).toContainText('30');
    await expect(page.locator('[data-offer-choices] input')).toHaveCount(0);
    await expect(page.locator('[name=name]')).toHaveValue('Landing choices fixture');
    await page.locator('input[name=landing-product][value=demo-candle]').check();
    await expect(page.locator('#subtotal')).toContainText('99');
    await expect(page.locator('#checkout-items')).toContainText(candle.name);
    const quotes: any[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/checkout/quote')) quotes.push(r.postDataJSON());
    });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: 'test-results/landing-products-' + width + '.png',
        fullPage: true,
      });
    }
    // Actual local demo order exercises validation and idempotency, not a mocked order response.
    const posted = page.waitForResponse(
      (r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST',
    );
    await page.locator('#checkout-form button[type=submit]').click();
    const response = await posted;
    expect(response.ok()).toBe(true);
    const payload = response.request().postDataJSON();
    expect(payload.cart).toEqual([
      { productId: candle.id, offerId: '', quantity: 1, revision: expect.any(Number) },
    ]);
    expect(payload.checkoutMode).toBe('direct');
    expect(quotes.at(-1).cart[0].productId).toBe(candle.id);
    await expect(page.locator('#thanks-dialog')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dar-cart-v1'))).toBe(cart);
    expect(
      (
        await page.request.put('/api/admin/products/' + bag.id, {
          headers,
          data: {
            ...saved,
            blocks: saved.blocks.map((b: any) =>
              b.type === 'ORDER_FORM' ? { ...b, settings: { ...b.settings, codBadgeText: '' } } : b,
            ),
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/offers/' + bag.slug);
    await expect(page.locator('.cod-badge')).toHaveCount(0);
    await page.goto('/checkout?product=' + bag.id);
    await expect(page.locator('.cod-badge')).toHaveText('الدفع عند الاستلام ✓');
  } finally {
    for (const p of [bag, notebook, candle])
      expect(
        (await page.request.put('/api/admin/products/' + p.id, { headers, data: p })).ok(),
      ).toBe(true);
  }
});
test('a sole published landing renders its complete page at root even when hidden from the storefront; multiple products retain homepage', async ({
  page,
}) => {
  const headers = await owner(page);
  const originals = await (await page.request.get('/api/admin/products')).json();
  const bag = originals.find((p: any) => p.id === 'demo-bag');
  try {
    for (const p of originals)
      expect(
        (
          await page.request.put('/api/admin/products/' + p.id, {
            headers,
            data: { ...p, active: p.id === bag.id ? 1 : 0 },
          })
        ).ok(),
      ).toBe(true);
    expect(
      (
        await page.request.put('/api/admin/products/' + bag.id, {
          headers,
          data: {
            ...bag,
            pageMode: 'landing',
            storefrontVisible: 0,
            presentation: { ...bag.presentation, landingLanguage: 'fr' },
            blocks: [
              {
                id: 'root-image',
                type: 'IMAGE',
                enabled: true,
                order: 0,
                settings: { image: '/demo/bag.svg', alt: 'Root landing fixture' },
              },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/');
    await expect(page.locator('main.landing')).toBeVisible();
    await expect(page.locator('img.image-slice')).toHaveAttribute('alt', 'Root landing fixture');
    await expect(page.locator('#checkout-form')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('.shop-home')).toHaveCount(0);
    const config = JSON.parse((await page.locator('#store-data').textContent()) || '{}');
    expect(config.products).toHaveLength(1);
    expect(config.products[0].id).toBe(bag.id);
    const other = originals.find((p: any) => p.id !== 'demo-bag');
    expect(
      (await page.request.put('/api/admin/products/' + other.id, { headers, data: other })).ok(),
    ).toBe(true);
    await page.goto('/');
    await expect(page.locator('.shop-home')).toBeVisible();
    await expect(page.locator('main.landing')).toHaveCount(0);
    await expect(page.locator('.hero-product > span')).toHaveCount(0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator('.hero-product img').first()).toHaveCSS('object-fit', 'contain');
      const sizes = await page
        .locator('.hero-product img')
        .first()
        .evaluate((img) => ({ h: img.clientHeight, parent: img.parentElement!.clientHeight }));
      expect(sizes.h).toBeGreaterThan(sizes.parent * 0.8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: 'test-results/home-hero-' + width + '.png', fullPage: true });
    }
  } finally {
    for (const p of originals)
      expect(
        (await page.request.put('/api/admin/products/' + p.id, { headers, data: p })).ok(),
      ).toBe(true);
  }
});

test('regular product choices update the actual SKU, cart, stock limit, offer and direct checkout on mobile and desktop', async ({
  page,
}) => {
  const headers = await owner(page);
  const originals = await (await page.request.get('/api/admin/products')).json();
  const bag = originals.find((p: any) => p.id === 'demo-bag'),
    notebook = originals.find((p: any) => p.id === 'demo-notebook'),
    candle = originals.find((p: any) => p.id === 'demo-candle');
  try {
    for (const p of [notebook, candle])
      expect(
        (
          await page.request.put('/api/admin/products/' + p.id, {
            headers,
            data: { ...p, storefrontVisible: 0 },
          })
        ).ok(),
      ).toBe(true);
    expect(
      (
        await page.request.put('/api/admin/products/' + bag.id, {
          headers,
          data: {
            ...bag,
            pageMode: 'product',
            presentation: {
              ...bag.presentation,
              landingProductIds: [notebook.id, candle.id],
              landingPackComponentIds: [notebook.id, candle.id],
            },
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/shop/' + bag.slug);
    await expect(page.locator('input[name=landing-product]')).toHaveCount(3);
    await page.locator('input[name=offer][value=bag-two]').check();
    await page.locator('input[name=landing-product][value=demo-notebook]').check();
    await expect(page.locator('#product-quantity')).toHaveValue('1');
    await expect(page.locator('[data-offer-choices] input')).toHaveCount(0);
    await expect(page.locator('#add-offer')).toHaveAttribute('data-product-id', notebook.id);
    await expect(page.locator('.product-price-line [data-product-price]')).toContainText('69');
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.locator('#add-offer').click();
    const lines = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('dar-cart-v1'))) || '[]',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ productId: notebook.id, quantity: 1 });
    await page.locator('[data-close-cart]').first().click();
    await page.locator('input[name=landing-product][value=demo-candle]').check();
    await expect(page.locator('[data-buy-now]')).toHaveAttribute('data-product-id', candle.id);
    await page.locator('#buy-now').click();
    await expect(page).toHaveURL(/\/checkout\?product=demo-candle/);
    await expect(page.locator('#checkout-items')).toContainText(candle.name);
    await expect(page.locator('#subtotal')).toContainText('99');
    expect(
      JSON.parse((await page.evaluate(() => localStorage.getItem('dar-cart-v1'))) || '[]')[0]
        .productId,
    ).toBe(notebook.id);
  } finally {
    for (const p of [bag, notebook, candle])
      expect(
        (await page.request.put('/api/admin/products/' + p.id, { headers, data: p })).ok(),
      ).toBe(true);
  }
});

test('TikTok and Google Ads settings save independently and legacy settings writes preserve Ads configuration', async ({
  page,
}) => {
  const headers = await owner(page);
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  try {
    await page.goto('/admin/pixels');
    await page.getByLabel('TikTok Pixel ID', { exact: true }).fill('TESTTIKTOK123');
    await page.getByLabel('Google Tag / GA4 ID', { exact: true }).fill('G-TEST123');
    await page.getByLabel('معرّف تحويل Google Ads (AW-)', { exact: true }).fill('AW-123456789');
    await page
      .getByLabel('تصنيف تحويل الطلب (Conversion Label)', { exact: true })
      .fill('Label_Test-123');
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByText('تم حفظ التغييرات.', { exact: true })).toBeVisible();
    const saved = (await (await page.request.get('/api/admin/settings')).json()).settings;
    expect(saved).toMatchObject({
      tiktokPixel: 'TESTTIKTOK123',
      googleId: 'G-TEST123',
      googleAdsId: 'AW-123456789',
      googleAdsLeadLabel: 'Label_Test-123',
      trackingEnabled: true,
    });
    const { googleAdsId, googleAdsLeadLabel, ...legacy } = saved;
    expect((await page.request.put('/api/admin/settings', { headers, data: legacy })).ok()).toBe(
      true,
    );
    expect((await (await page.request.get('/api/admin/settings')).json()).settings).toMatchObject({
      googleAdsId,
      googleAdsLeadLabel,
    });
  } finally {
    expect((await page.request.put('/api/admin/settings', { headers, data: original })).ok()).toBe(
      true,
    );
  }
});
