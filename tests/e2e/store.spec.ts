import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) =>
  context.setExtraHTTPHeaders({
    'CF-Connecting-IP':
      '198.18.' + Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255),
  }),
);
test('recovers a lost submit response after a price revision without creating another order', async ({
  page,
}) => {
  const origin = 'http://localhost:8788';
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const csrf = (await login.json()).csrf;
  const all = await (await page.request.get('/api/admin/products')).json();
  const product = all.find((p: any) => p.id === 'demo-bag');
  await page.goto('/');
  await page.locator('[data-add-product="demo-bag"]').click();
  await page.goto('/checkout');
  const fill = async () => {
    await page.locator('[name=name]').fill('عميل اختبار الاستعادة');
    await page.locator('[name=phone]').fill('0611112222');
    await page.locator('[name=city]').fill('Rabat');
    await page.locator('[name=address]').fill('Recovery test street 12');
  };
  await fill();
  let reference = '';
  await page.route(
    '**/api/orders',
    async (route) => {
      const response = await route.fetch();
      reference = (await response.json()).ref;
      await route.abort();
    },
    { times: 1 },
  );
  await page.locator('#checkout-form [type=submit]').click();
  await expect(page.locator('#checkout-error')).not.toBeEmpty();
  try {
    const updated = await page.request.put('/api/admin/products/' + product.id, {
      headers: { Origin: origin, 'X-CSRF-Token': csrf },
      data: { ...product, price: product.price + 100 },
    });
    expect(updated.ok()).toBe(true);
    await page.reload();
    await fill();
    await page.locator('#checkout-form [type=submit]').click();
    await expect(page.locator('#thanks-dialog')).toBeVisible();
    await expect(page.locator('#order-ref')).toHaveText(reference);
    const orders = await (await page.request.get('/api/admin/orders')).json();
    expect(
      orders.filter((o: any) => o.customer.phone === '0611112222' && o.ref === reference),
    ).toHaveLength(1);
  } finally {
    await page.request.put('/api/admin/products/' + product.id, {
      headers: { Origin: origin, 'X-CSRF-Token': csrf },
      data: product,
    });
  }
});
test('shared checkout keeps supplier filtering, tab synchronization, and free shipping', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-product-card]')).toHaveCount(3);
  await page.locator('[data-add-product="demo-bag"]').click();
  await expect(page.locator('[data-product-card="demo-candle"]')).toBeHidden();
  await page.goto('/products/calm-candle');
  await expect(page.locator('#add-offer')).toBeEnabled();
  await expect(page.locator('#supplier-conflict')).toBeVisible();
  await page.goto('/products/daily-bag');
  await page.locator('[name=offer][value=bag-two]').check();
  await page.locator('#add-offer').click();
  await expect(page.locator('#cart-dialog')).toBeVisible();
  await page.goto('/');
  await page.locator('[data-add-product="demo-notebook"]').click();
  await page.goto('/checkout');
  await page.locator('[name=name]').fill('عميل تجريبي');
  await page.locator('[name=phone]').fill('0612345678');
  await page.locator('[name=city]').fill('Rabat');
  await page.locator('[name=address]').fill('Rue test 12');
  await expect(page.locator('#shipping')).toHaveText('مجاني');
  const second = await context.newPage();
  await second.goto('/');
  await second.locator('.store-header [data-open-cart]').click();
  await second.locator('[data-remove="DEMO-A1"]').click();
  await expect(page.locator('#shipping')).not.toHaveText('مجاني');
  await second.close();
  await page.locator('#checkout-form [type=submit]').click();
  await expect(page.locator('#thanks-dialog')).toBeVisible();
  await expect(page.locator('#order-ref')).toHaveText(/^REF-/);
  await page.goto('/');
  await expect(page.locator('[data-product-card="demo-candle"]')).toBeVisible();
});

test('switching supplier requires the customer to confirm replacement', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-add-product="demo-bag"]').click();
  const previous = await page.evaluate(() => localStorage.getItem('dar-cart-v1'));
  await page.goto('/products/calm-candle');
  await page.locator('#add-offer').click();
  await expect(page.locator('#replace-cart-dialog')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('dar-cart-v1'))).toBe(previous);
  await page.locator('[data-cancel-replace]').click();
  expect(await page.evaluate(() => localStorage.getItem('dar-cart-v1'))).toBe(previous);
  await page.locator('#add-offer').click();
  await page.locator('[data-confirm-replace]').click();
  await expect(page.locator('#replace-cart-dialog')).toBeHidden();
  const current = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dar-cart-v1') || '[]'),
  );
  expect(current).toHaveLength(1);
  expect(current[0].sku).toBe('DEMO-B1');
  await page.goto('/');
  await expect(page.locator('[data-product-card="demo-bag"]')).toBeHidden();
  await expect(page.locator('[data-hero-product]:visible')).toHaveCount(1);
  await expect(page.locator('[data-hero-product]:visible')).toHaveAttribute(
    'data-supplier',
    'demo-b',
  );
  await page.locator('.store-header [data-open-cart]').click();
  await page.locator('[data-empty-cart]').click();
  await page.locator('.dialog-heading [data-close-cart]').click();
  await expect(page.locator('[data-product-card="demo-bag"]')).toBeVisible();
});

for (const scenario of [
  {
    slug: 'daily-bag',
    productId: 'demo-bag',
    offer: 'bag-two',
    quantity: 2,
    total: 25800,
    shipping: 0,
  },
  {
    slug: 'calm-candle',
    productId: 'demo-candle',
    offer: '',
    quantity: 1,
    total: 12900,
    shipping: 3000,
  },
]) {
  test(
    'landing checkout preserves a previous cart: ' + scenario.slug,
    async ({ page, context }) => {
      await page.goto('/');
      await page.locator('[data-add-product="demo-bag"]').click();
      await page.locator('[data-add-product="demo-notebook"]').click();
      const previous = await page.evaluate(() => localStorage.getItem('dar-cart-v1'));
      await page.goto('/offers/' + scenario.slug);
      if (scenario.offer)
        await page.locator('[name=offer][value="' + scenario.offer + '"]').check();
      await expect(page.locator('#checkout-items .cart-line')).toHaveCount(1);
      await page.locator('[name=name]').fill('عميل صفحة هبوط');
      await page.locator('[name=phone]').fill('0612345678');
      const quoteResponse = page.waitForResponse(
        (r) =>
          r.url().includes('/api/checkout/quote') &&
          r.request().postDataJSON().city === 'قرية غير مدرجة',
      );
      await page.locator('[name=city]').fill('قرية غير مدرجة');
      await page.locator('[name=address]').fill('عنوان تجربة صفحة الهبوط 12');
      const quote = await (await quoteResponse).json();
      expect(quote.total).toBe(scenario.total);
      expect(quote.shipping).toBe(scenario.shipping);
      const second = await context.newPage();
      await second.goto('/checkout');
      await expect(second.locator('#checkout-items .cart-line')).toHaveCount(2);
      await second.close();
      const sent = page.waitForRequest(
        (r) => r.url().endsWith('/api/orders') && r.method() === 'POST',
      );
      await page.locator('#checkout-form [type=submit]').click();
      expect((await sent).postDataJSON().cart).toEqual([
        expect.objectContaining({
          productId: scenario.productId,
          offerId: scenario.offer,
          quantity: scenario.quantity,
        }),
      ]);
      await expect(page.locator('#thanks-dialog')).toBeVisible();
      await expect(page.locator('#saved-cart-reminder')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('dar-cart-v1'))).toBe(previous);
      await page.goto('/checkout');
      await expect(page.locator('#checkout-items .cart-line')).toHaveCount(2);
    },
  );
}

test('recovers a lost direct-order response without changing the saved cart or its checkout attempt', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('[data-add-product="demo-bag"]').click();
  await page.evaluate(() => localStorage.setItem('dar-order-attempt', 'saved-cart-attempt'));
  const previous = await page.evaluate(() => localStorage.getItem('dar-cart-v1'));
  await page.goto('/offers/calm-candle');
  const fill = async () => {
    await page.locator('[name=name]').fill('عميل استعادة صفحة الهبوط');
    await page.locator('[name=phone]').fill('0611113333');
    await page.locator('[name=city]').fill('فاس');
    await page.locator('[name=address]').fill('Direct recovery test street 12');
  };
  await fill();
  let reference = '';
  await page.route(
    '**/api/orders',
    async (route) => {
      const response = await route.fetch();
      reference = (await response.json()).ref;
      await route.abort();
    },
    { times: 1 },
  );
  await page.locator('#checkout-form [type=submit]').click();
  await expect(page.locator('#checkout-error')).not.toBeEmpty();
  await page.reload();
  await fill();
  let repeatedPosts = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/orders') && r.method() === 'POST') repeatedPosts++;
  });
  await page.locator('#checkout-form [type=submit]').click();
  await expect(page.locator('#thanks-dialog')).toBeVisible();
  await expect(page.locator('#order-ref')).toHaveText(reference);
  expect(repeatedPosts).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('dar-cart-v1'))).toBe(previous);
  expect(await page.evaluate(() => localStorage.getItem('dar-order-attempt'))).toBe(
    'saved-cart-attempt',
  );
});

test('shows revised landing prices for review before submitting an independent order', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: 'http://localhost:8788' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const csrf = (await login.json()).csrf;
  const all = await (await page.request.get('/api/admin/products')).json();
  const original = all.find((p: any) => p.id === 'demo-candle');
  await page.goto('/offers/calm-candle');
  await page.locator('[name=name]').fill('عميل مراجعة السعر');
  await page.locator('[name=phone]').fill('0611114444');
  await page.locator('[name=city]').fill('Rabat');
  await page.locator('[name=address]').fill('Price review test street 12');
  let posts = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/orders') && r.method() === 'POST') posts++;
  });
  let primaryError: unknown;
  try {
    const updated = await page.request.put('/api/admin/products/' + original.id, {
      headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
      data: { ...original, price: original.price + 100 },
    });
    expect(updated.ok()).toBe(true);
    await page.locator('#checkout-form [type=submit]').click();
    const review = page.getByRole('button', { name: 'مراجعة بيانات العرض وتحديثها' });
    await expect(review).toBeVisible();
    expect(posts).toBe(0);
    // A later city quote must not silently accept the refreshed product or
    // remove the review action while the customer is deciding.
    const repeated = page.waitForResponse((r) => r.url().endsWith('/api/checkout/quote'));
    await page.locator('[name=city]').fill('Casablanca');
    await repeated;
    await expect(review).toBeVisible();
    const restoreCity = page.waitForResponse((r) => r.url().endsWith('/api/checkout/quote'));
    await page.locator('[name=city]').fill('Rabat');
    await restoreCity;
    await expect(review).toBeVisible();
    await expect(page.locator('#checkout-items')).toContainText(String(original.price / 100));
    await review.click();
    await expect(page.locator('#checkout-items')).toContainText('100');
    await expect(page.locator('#checkout-items')).toContainText('100');
    await expect(page.locator('#checkout-error')).toBeEmpty();
    await page.locator('#checkout-form [type=submit]').click();
    await expect(page.locator('#thanks-dialog')).toBeVisible();
    expect(posts).toBe(1);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await page.request.put('/api/admin/products/' + original.id, {
        headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
        data: original,
        timeout: 5000,
      });
    } catch (error) {
      if (!primaryError) throw error;
    }
  }
});
test('publishes and checks out a gift bundle below the advisory unit minimum at exact break-even', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: 'http://localhost:8788' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const csrf = (await login.json()).csrf;
  const all = await (await page.request.get('/api/admin/products')).json();
  const original = all.find((p: any) => p.id === 'demo-candle');
  expect(original.minimum).toBe(7000);
  try {
    const update = await page.request.put('/api/admin/products/' + original.id, {
      headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
      data: {
        ...original,
        offers: [
          {
            id: 'gift-three',
            label: 'ثلاث وحدات بسعر التعادل',
            quantity: 3,
            total: 15000,
            freeShipping: true,
          },
        ],
      },
    });
    expect(update.ok()).toBe(true);
    await page.goto('/offers/calm-candle');
    await page.locator('[name=name]').fill('عميل عرض التعادل');
    await page.locator('[name=phone]').fill('0611115555');
    await page.locator('[name=city]').fill('Rabat');
    await page.locator('[name=address]').fill('Gift bundle test street 12');
    await expect(page.locator('#shipping')).toContainText('30');
    await page.locator('[name=offer][value=gift-three]').check();
    await expect(page.locator('#shipping')).toHaveText('مجاني');
    const sent = page.waitForRequest(
      (r) => r.url().endsWith('/api/orders') && r.method() === 'POST',
    );
    await page.locator('#checkout-form [type=submit]').click();
    expect((await sent).postDataJSON().cart[0].quantity).toBe(3);
    await expect(page.locator('#thanks-dialog')).toBeVisible();
    const ref = await page.locator('#order-ref').textContent();
    const orders = await (await page.request.get('/api/admin/orders')).json();
    const saved = orders.find((o: any) => o.ref === ref);
    expect(saved.quote).toMatchObject({ total: 15000, shipping: 0 });
    expect(saved.quote.items[0]).toMatchObject({ quantity: 3, unitPrice: 5000, subtotal: 15000 });
    expect(saved.status).toBe('pending_confirmation');
  } finally {
    await page.request.put('/api/admin/products/' + original.id, {
      headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
      data: original,
    });
  }
});

test('mobile city choices use touch, alias search and keyboard selection with the Casablanca fee', async ({
  page,
}) => {
  await page.route('**/api/cities', (route) =>
    route.fulfill({ json: ['CASABLANCA', 'RABAT', 'FES'] }),
  );
  await page.goto('/');
  await page.locator('[data-add-product="demo-bag"]').click();
  await page.goto('/checkout');
  const city = page.locator('[name=city]'),
    toggle = page.getByRole('button', { name: 'عرض قائمة المدن', exact: true });
  await toggle.click();
  await expect(page.getByRole('listbox', { name: 'المدن', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'CASABLANCA', exact: true }).click();
  await expect(city).toHaveValue('CASABLANCA');
  await city.fill('كازا');
  await expect(page.getByRole('option', { name: 'CASABLANCA', exact: true })).toBeVisible();
  await city.press('ArrowDown');
  await city.press('Enter');
  await expect(city).toHaveValue('CASABLANCA');
  await expect(page.locator('#thanks-dialog')).not.toBeVisible();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/checkout/quote') && r.request().postDataJSON()?.city === 'Casa',
  );
  await city.fill('Casa');
  expect((await (await response).json()).shipping).toBe(2000);
  await page.getByRole('option', { name: 'CASABLANCA', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
