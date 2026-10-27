import { test, expect } from '@playwright/test';
const origin = 'http://localhost:8788';
test('quantity changes apply exact tiers and the higher-quantity price in product, basket and checkout', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.70.1' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const headers = { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
  const products = await (await page.request.get('/api/admin/products')).json();
  const bag = products.find((p: any) => p.id === 'demo-bag');
  try {
    const response = await page.request.put('/api/admin/products/' + bag.id, {
      headers,
      data: {
        ...bag,
        offers: [
          {
            id: 'quantity-two',
            label: 'الكمية 2 بسعر خاص',
            quantity: 2,
            total: 26000,
            freeShipping: true,
          },
        ],
        presentation: {
          ...bag.presentation,
          promotion: undefined,
          freeShipping: false,
          quantityPricing: { unitPrice: 12000, freeShipping: true, enabled: true },
        },
      },
    });
    expect(response.ok()).toBe(true);
    await page.goto('/shop/daily-bag');
    await expect(page.locator('#product-quantity')).toBeVisible();
    await page.locator('#product-quantity').fill('2');
    await expect(page.locator('.product-price-line')).toContainText('260');
    await expect(page.locator('input[name=offer][value=quantity-two]')).toBeChecked();
    await page.locator('#buy-now').click();
    await expect(page.locator('#subtotal')).toContainText('260');
    await expect(page.locator('#total')).toContainText('260');
    await page.locator('[data-direct-quantity][data-change="1"]').click();
    await expect(page.locator('#subtotal')).toContainText('360');
    await expect(page.locator('#total')).toContainText('360');
    await page.locator('[data-direct-quantity][data-change="1"]').click();
    await expect(page.locator('#subtotal')).toContainText('480');
    await expect(page.locator('#total')).toContainText('480');
    for (let i = 0; i < 3; i++)
      await page.locator('[data-direct-quantity][data-change="-1"]').click();
    await expect(page.locator('#subtotal')).toContainText('149');
    await expect(page.locator('#total')).toContainText('179');
    await page.goto('/shop/daily-bag');
    await page.locator('#product-quantity').fill('2');
    await page.locator('#add-offer').click();
    await page.goto('/checkout');
    await expect(page.locator('#subtotal')).toContainText('260');
    await page.locator('#checkout-items [data-quantity][data-change="1"]').click();
    await expect(page.locator('#subtotal')).toContainText('360');
    await expect(page.locator('#total')).toContainText('360');
    const current = (await (await page.request.get('/api/products')).json()).find(
      (p: any) => p.id === bag.id,
    );
    const quote = await page.request.post('/api/checkout/quote', {
      headers: { Origin: origin },
      data: {
        cart: [{ productId: bag.id, offerId: '', quantity: 4, revision: current.revision }],
        city: 'Rabat',
      },
    });
    expect(quote.ok()).toBe(true);
    expect(await quote.json()).toMatchObject({
      total: 48000,
      shipping: 0,
      items: [{ quantity: 4, subtotal: 48000, offerId: 'quantity:more' }],
    });
  } finally {
    await page.request.put('/api/admin/products/' + bag.id, { headers, data: bag });
  }
});
test('fixed bundles stay within three choices and match product, basket, direct checkout and landing prices', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.70.2' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const headers = { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
  const bag = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  const draft = {
    ...bag,
    offers: [
      { id: 'bundle-two', label: 'الأكثر طلباً', quantity: 2, total: 26000, freeShipping: true },
      { id: 'bundle-three', label: '', quantity: 3, total: 36000, freeShipping: false },
    ],
    presentation: {
      ...bag.presentation,
      promotion: undefined,
      freeShipping: false,
      bundleMode: true,
    },
  };
  try {
    expect(
      (await page.request.put('/api/admin/products/' + bag.id, { headers, data: draft })).ok(),
    ).toBe(true);
    await page.goto('/shop/' + bag.slug);
    await expect(page.locator('#product-quantity')).toBeHidden();
    await expect(page.locator('[data-offer-choices] input[name=offer]')).toHaveCount(3);
    await page.locator('input[name=offer][value=bundle-two]').check();
    await page.locator('#buy-now').click();
    await expect(page.locator('#subtotal')).toContainText('260');
    await expect(page.locator('#total')).toContainText('260');
    await expect(page.locator('[data-direct-quantity]')).toHaveCount(0);
    await expect(page.locator('[data-bundle-quantity] option')).toHaveCount(3);
    await expect(page.locator('[data-bundle-quantity] option[value="2"]')).toContainText(
      'توصيل مجاني',
    );
    await expect(page.locator('#checkout-items .bundle-shipping-benefit')).toHaveText(
      'توصيل مجاني مع هذا العرض',
    );
    await expect(page.locator('#shipping')).toHaveText('مجاني');
    await page.locator('[data-bundle-quantity]').selectOption('3');
    await expect(page.locator('#subtotal')).toContainText('360');
    await expect(page.locator('#shipping')).toContainText('30');
    await expect(page.locator('#checkout-items .bundle-shipping-benefit')).toHaveCount(0);
    await page.locator('[data-bundle-quantity]').selectOption('2');
    await expect(page.locator('#checkout-items .bundle-shipping-benefit')).toBeVisible();
    await expect(page.locator('#shipping')).toHaveText('مجاني');
    await page.goto('/shop/' + bag.slug);
    await page.locator('input[name=offer][value=bundle-two]').check();
    await page.locator('#add-offer').click();
    await page.goto('/checkout');
    await expect(page.locator('#total')).toContainText('260');
    await expect(
      page.locator('#checkout-items [data-bundle-quantity] option[value="2"]'),
    ).toContainText('توصيل مجاني');
    await expect(page.locator('#checkout-items .bundle-shipping-benefit')).toBeVisible();
    await page.locator('#checkout-items [data-bundle-quantity]').selectOption('3');
    await expect(page.locator('#checkout-items .bundle-shipping-benefit')).toHaveCount(0);
    await expect(page.locator('#subtotal')).toContainText('360');
    expect(
      (
        await page.request.put('/api/admin/products/' + bag.id, {
          headers,
          data: { ...draft, pageMode: 'landing' },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/offers/' + bag.slug);
    await expect(page.locator('[data-offer-choices] input[name=offer]')).toHaveCount(3);
    await expect(page.locator('#product-quantity')).toHaveCount(0);
    await page.locator('input[name=offer][value=bundle-two]').check();
    await expect(page.locator('#subtotal')).toContainText('260');
    await expect(page.locator('#shipping')).toHaveText('مجاني');
    await expect(page.locator('#total')).toContainText('260');
    await expect(page.locator('#checkout-items .bundle-shipping-benefit')).toBeVisible();
    await expect(
      page.locator('#checkout-items [data-bundle-quantity] option[value="2"]'),
    ).toContainText('توصيل مجاني');
    await page.locator('input[name=offer][value=bundle-three]').check();
    await expect(page.locator('#checkout-items .bundle-shipping-benefit')).toHaveCount(0);
    await expect(page.locator('#subtotal')).toContainText('360');
    await expect(page.locator('#total')).toContainText('390');
    const current = (await (await page.request.get('/api/products')).json()).find(
      (p: any) => p.id === bag.id,
    );
    const invalid = await page.request.post('/api/checkout/quote', {
      headers: { Origin: origin },
      data: {
        cart: [{ productId: bag.id, offerId: '', quantity: 4, revision: current.revision }],
        city: 'Rabat',
      },
    });
    expect(invalid.status()).toBe(409);
    expect(await invalid.json()).toMatchObject({ error: 'bundle_quantity_unavailable' });
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: bag.sku })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await expect(page.locator('.bundle-edit-row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'إضافة باقة', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/fixed-bundles-admin-mobile.png', fullPage: true });
  } finally {
    await page.request.put('/api/admin/products/' + bag.id, { headers, data: bag });
  }
});
