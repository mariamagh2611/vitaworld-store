import { test, expect } from '@playwright/test';
let csrf = '',
  cookies: any[] = [];
test.beforeAll(async ({ request }) => {
  const r = await request.post('/api/auth/login', {
    headers: { Origin: 'http://localhost:8788', 'CF-Connecting-IP': '192.0.2.20' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(r.ok()).toBe(true);
  csrf = (await r.json()).csrf;
  cookies = (await request.storageState()).cookies;
});
test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});
test('daily pages show sources and a simple supplier connection without technical operations or advertising spend', async ({
  page,
}) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'من أين جاءت الطلبات؟' })).toBeVisible();
  await expect(page.getByText('ROAS', { exact: true })).toHaveCount(0);
  await expect(page.getByText('التخزين والنسخ', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'المزامنة والنسخ', exact: true })).toHaveCount(0);
  await page.goto('/admin/integration');
  await expect(page.getByRole('button', { name: 'فحص الاتصال', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'مزامنة المنتجات', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeVisible();
  await expect(page.getByLabel('إرسال الطلبات تلقائيًا إلى مورد')).toBeVisible();
  await expect(page.getByRole('button', { name: 'اعتماد حقل المورد', exact: true })).toHaveCount(0);
  await expect(page.getByText('supplier_group_id', { exact: false })).toHaveCount(0);
  await page.goto('/admin/analytics');
  await expect(page.getByText('تسجيل الإنفاق الإعلاني', { exact: true })).toHaveCount(0);
  await page.getByLabel('اسم الحملة (اختياري)').fill('free-course-test');
  await page.getByRole('button', { name: 'إنشاء الرابط', exact: true }).click();
  await expect(page.getByLabel('رابط تتبع مصدر الطلب')).toHaveValue(/utm_source=facebook/);
  const link = await page.getByLabel('رابط تتبع مصدر الطلب').inputValue();
  await page.reload();
  await expect(page.getByLabel('رابط تتبع مصدر الطلب')).toHaveValue(link);
  await expect(page.getByLabel('رابط الحملة المحفوظ')).toHaveValue(link);
  expect(new URL(link).searchParams.get('utm_source')).toBe('facebook');
  await page.goto(link);
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('dar-attribution') || '{}').last?.utm_source,
      ),
    )
    .toBe('facebook');
  expect(await page.evaluate(() => (window as any).fbq)).toBeUndefined();
});
test('an owner replaces the hero image, edits home content and changes the storefront palette from the dashboard', async ({
  page,
}) => {
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  try {
    await page.goto('/admin/appearance');
    await page
      .getByRole('textbox', { name: 'عنوان الرئيسية', exact: true })
      .fill('الرئيسية من لوحة المتدرب', { timeout: 5000 });
    await page
      .getByLabel('عبارات شريط المزايا 1', { exact: true })
      .fill('توصيل سريع من متجري', { timeout: 5000 });
    await page
      .getByLabel('لون الأزرار والشريط', { exact: true })
      .fill('#633090', { timeout: 5000 });
    await page.getByLabel('خلفية المتجر', { exact: true }).fill('#faf2ff', { timeout: 5000 });
    const buffer = Buffer.from(
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 420;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#633090';
        ctx.fillRect(0, 0, 640, 420);
        const blob = await new Promise<Blob>((done) =>
          canvas.toBlob((b) => done(b!), 'image/webp'),
        );
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      }),
    );
    const uploaded = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/media') && r.request().method() === 'POST',
    );
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'hero.webp', mimeType: 'image/webp', buffer });
    expect((await uploaded).ok()).toBe(true);
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/settings') && r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'الرئيسية من لوحة المتدرب' })).toBeVisible();
    await expect(page.getByText('توصيل سريع من متجري', { exact: true })).toBeVisible();
    await expect(page.locator('.hero-image')).toHaveJSProperty('naturalWidth', 640);
    await expect(page.locator('.art-bag')).toHaveCount(0);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 242, 255)');
    await expect(page.locator('.announcement')).toHaveCSS('background-color', 'rgb(99, 48, 144)');
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain(
      'IBM Plex Sans Arabic',
    );
    await page.screenshot({ path: 'test-results/custom-home-mobile.png', fullPage: true });
  } finally {
    await page.request
      .put('/api/admin/settings', {
        headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
        data: original,
      })
      .catch(() => {});
  }
});
test('the real form appears in the draft preview and published landing, with product delivery independent from cart delivery', async ({
  page,
}) => {
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
    await page.locator('.product-editor-section > summary').filter({ hasText: 'التوصيل' }).click();
    await page.getByLabel('توصيل هذا المنتج', { exact: true }).selectOption('custom');
    await page.getByLabel('توصيل المنتج داخل الدار البيضاء — درهم').fill('10');
    await page.getByLabel('توصيل المنتج خارج الدار البيضاء — درهم').fill('60');
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'طريقة عرض المنتج', exact: true })
      .selectOption('landing');
    await page.getByRole('button', { name: 'استمارة +', exact: true }).click();
    await page.getByLabel('عنوان الاستمارة', { exact: true }).fill('اطلب من متجري الآن');
    await page.getByLabel('تسمية خانة المدينة', { exact: true }).fill('مدينة التوصيل');
    await page.getByLabel('النص داخل خانة الاسم', { exact: true }).fill('اكتب اسمك هنا');
    await page.getByLabel('إظهار خانة ملاحظات التوصيل').uncheck();
    await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
    const preview = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(preview.getByRole('heading', { name: 'اطلب من متجري الآن' })).toBeVisible();
    await expect(preview.getByLabel('مدينة التوصيل', { exact: true })).toBeVisible();
    await expect(preview.getByPlaceholder('اكتب اسمك هنا')).toBeVisible();
    await expect(preview.locator('[name=notes]')).toHaveCount(0);
    await expect(
      preview.getByRole('button', { name: 'تأكيد الطلب · الدفع عند الاستلام ←', exact: true }),
    ).toBeDisabled();
    await expect(preview.locator('script[src]')).toHaveCount(0);
    const saving = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/admin/products/' + original.id) && r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    expect((await saving).ok()).toBe(true);
    await page.goto('/products/' + original.slug);
    await expect(page.getByRole('heading', { name: 'اطلب من متجري الآن' })).toBeVisible();
    await expect(page.getByLabel('مدينة التوصيل', { exact: true })).toBeVisible();
    await page.getByLabel('مدينة التوصيل', { exact: true }).fill('Rabat');
    await expect(page.locator('#shipping')).toContainText('60');
    await page.goto('/shop/' + original.slug);
    await page.locator('#add-offer').click();
    await page.goto('/checkout');
    await page.getByLabel('المدينة', { exact: true }).fill('Rabat');
    await expect(page.locator('#shipping')).toContainText('30');
    await page.screenshot({ path: 'test-results/custom-form-mobile.png', fullPage: true });
  } finally {
    await page.request
      .put('/api/admin/products/' + original.id, {
        headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
        data: original,
      })
      .catch(() => {});
  }
});

test('catalog photos select a product without exposing supplier IDs and invalid draft fields explain and focus the problem', async ({
  page,
}) => {
  await page.route('**/api/admin/catalog*', async (route) => {
    const response = await route.fetch(),
      catalog = await response.json();
    await route.fulfill({
      response,
      json: catalog.map((product: any) => ({
        ...product,
        main_image: 'https://catalog-images.example.test/product.svg',
        images: ['https://catalog-images.example.test/product.svg'],
        description:
          '<div><h2>وصف واضح</h2><p>تفاصيل المنتج</p><script>window.untrustedCatalog=true</script></div>',
      })),
    });
  });
  await page.route('https://catalog-images.example.test/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="green"/></svg>',
    }),
  );
  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'إضافة منتج +', exact: true }).click();
  const product = page.getByRole('button', { name: 'اختيار حقيبة يومية أنيقة', exact: true });
  await expect(product.locator('img')).toHaveJSProperty('naturalWidth', 120);
  await product.click();
  await expect(page.getByText('تغيير منتج مورد · DEMO-A1', { exact: true })).toBeVisible();
  await expect(page.locator('[data-field="sku"] input')).toHaveValue('DEMO-A1');
  await expect(page.locator('[data-field="description"] textarea')).toHaveValue(
    'وصف واضح\nتفاصيل المنتج',
  );
  expect(await page.evaluate(() => (window as any).untrustedCatalog)).toBeUndefined();
  await expect(page.getByText('demo-a', { exact: true })).toHaveCount(0);
  await page.locator('[data-field="name"] input').fill('');
  await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
  await expect(page.locator('[data-field="name"] .field-error')).toContainText('الحد الأدنى');
  await expect(page.locator('[data-field="name"] input')).toBeFocused();
  await page.locator('[data-field="name"] input').fill('اسم صحيح');
  await page.locator('[data-field="description"] textarea').fill('x'.repeat(20001));
  await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
  await expect(page.locator('[data-field="description"] .field-error')).toContainText('20000');
  await expect(page.locator('[data-field="description"] textarea')).toBeFocused();
});

test('a purchase CTA reaches the order form in the script-free draft preview and on the published product', async ({
  page,
}) => {
  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'إضافة منتج +', exact: true }).click();
  await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
  await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'طريقة عرض المنتج', exact: true })
    .selectOption('landing');
  await page.getByRole('button', { name: 'زر +', exact: true }).click();
  await page.getByRole('button', { name: 'استمارة +', exact: true }).click();
  await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
  const frame = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
  const link = frame.getByRole('link', { name: 'اطلب الآن', exact: true });
  await expect(link).toHaveAttribute('href', /order-form$/);
  await link.click();
  await expect(frame.locator('#order-form')).toBeVisible();
  await expect
    .poll(() =>
      frame.locator('#order-form').evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeLessThan(100);
  await expect(frame.locator('script[src]')).toHaveCount(0);
  await page.goto('/offers/daily-bag');
  const orderForm = page.locator('#order-form');
  await expect(orderForm).toBeVisible();
  await expect(page.locator('.store-header')).toHaveCount(0);
});

test('saving a pixel ID activates events on arrival without a consent banner or admin switch', async ({
  page,
}) => {
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  try {
    await page.goto('/admin/pixels');
    await expect(page.getByLabel('تفعيل البكسلات', { exact: true })).toHaveCount(0);
    await page.getByLabel('معرّف بكسل Meta / Facebook', { exact: true }).fill('123456789012345');
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByText('تم حفظ التغييرات.', { exact: true })).toBeVisible();
    await page.route('https://connect.facebook.net/**', (route) =>
      route.fulfill({ contentType: 'application/javascript', body: '' }),
    );
    await page.goto('/');
    await expect(page.locator('#consent-banner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'أوافق', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => typeof (window as any).fbq)).toBe('function');
    expect(
      await page.evaluate(
        () =>
          JSON.parse(document.getElementById('store-data')!.textContent!).settings.trackingEnabled,
      ),
    ).toBe(true);
  } finally {
    await page.request.put('/api/admin/settings', {
      headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
      data: original,
    });
  }
});

test('an owner manages categories and category filters preserve the single-supplier cart restriction', async ({
  page,
}) => {
  const original = await (await page.request.get('/api/admin/products')).json();
  const headers = { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf };
  const ids: string[] = [];
  try {
    await page.goto('/admin/categories');
    for (const name of ['العناية التجريبية', 'المنزل التجريبي']) {
      await page.getByRole('button', { name: 'إضافة قسم +', exact: true }).click();
      await page.getByLabel('اسم القسم', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'حفظ القسم', exact: true }).click();
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    const categories = await (await page.request.get('/api/admin/categories')).json();
    ids.push(...categories.map((category: any) => category.id));
    const home = categories.find((category: any) => category.name === 'المنزل التجريبي');
    await page.getByRole('button', { name: 'تقديم المنزل التجريبي', exact: true }).click();
    await expect(page.locator('.category-admin-row').first()).toContainText('المنزل التجريبي');
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: 'حقيبة يومية أنيقة' })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    const care = categories.find((category: any) => category.name === 'العناية التجريبية');
    await page.getByRole('combobox', { name: 'قسم المنتج', exact: true }).selectOption(care.id);
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.locator('tbody')).toBeVisible();
    for (const product of original.filter((product: any) => product.id !== 'demo-bag')) {
      const saved = await page.request.put('/api/admin/products/' + product.id, {
        headers,
        data: { ...product, categoryId: product.id === 'demo-candle' ? care.id : home.id },
      });
      expect(saved.ok()).toBe(true);
    }
    await page.goto('/');
    expect(
      await page.evaluate(() => {
        const hero = document.querySelector('.shop-hero')!,
          benefits = document.querySelector('.benefits-strip')!,
          categories = document.querySelector('#categories')!,
          products = document.querySelector('#products')!;
        return (
          !!(hero.compareDocumentPosition(benefits) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          !!(benefits.compareDocumentPosition(categories) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          !!(categories.compareDocumentPosition(products) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      }),
    ).toBe(true);
    await page.getByRole('link', { name: 'العناية التجريبية', exact: true }).click();
    await expect(page.locator('[data-product-card]:visible')).toHaveCount(2);
    await page.locator('[data-add-product="demo-bag"]').click();
    await expect(page.locator('[data-product-card]:visible')).toHaveCount(1);
    await page.getByRole('link', { name: 'المنزل التجريبي', exact: true }).click();
    await expect(page.locator('[data-product-card]:visible')).toHaveCount(1);
    await expect(page.locator('[data-product-card="demo-notebook"]')).toBeVisible();
    await expect(page.locator('[data-product-card="demo-candle"]')).toBeHidden();
    await page.getByRole('button', { name: 'فتح سلة المشتريات', exact: true }).click();
    await page.locator('[data-empty-cart]').click();
    await page.locator('.dialog-heading [data-close-cart]').click();
    await page.getByRole('link', { name: 'كل الأقسام', exact: true }).click();
    await expect(page.locator('[data-product-card]:visible')).toHaveCount(3);
    await page.screenshot({ path: 'test-results/categories-mobile.png', fullPage: true });
    await page.goto('/admin/categories');
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .locator('.category-admin-row')
      .filter({ hasText: 'العناية التجريبية' })
      .getByRole('button', { name: 'حذف القسم', exact: true })
      .click();
    await expect(
      page.locator('.category-admin-row').filter({ hasText: 'العناية التجريبية' }),
    ).toHaveCount(0);
    const after = await (await page.request.get('/api/admin/products')).json();
    expect(after.find((product: any) => product.id === 'demo-bag').categoryId).toBe(null);
    expect(after.length).toBe(original.length);
  } finally {
    for (const product of original)
      await page.request.put('/api/admin/products/' + product.id, { headers, data: product });
    for (const id of ids) await page.request.delete('/api/admin/categories/' + id, { headers });
  }
});

test('the owner switches between a regular product and a focused landing without losing long descriptions or the customer cart', async ({
  page,
}) => {
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (product: any) => product.id === 'demo-candle',
  );
  const headers = { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf };
  const description = 'تفاصيل المنتج واستخداماته ومزاياه.\n'.repeat(180);
  try {
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: original.name })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'طريقة عرض المنتج', exact: true })
      .selectOption('product');
    await page.locator('[data-field="description"] textarea').fill(description);
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.locator('tbody')).toBeVisible();
    await page.goto('/products/' + original.slug);
    await expect(page.locator('.store-header')).toBeVisible();
    await expect(page.locator('.product-description')).toHaveText(description.trim());
    await expect(page.locator('.offer-card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'أضف للسلة', exact: true })).toBeVisible();
    expect(
      (await page.locator('meta[name=description]').getAttribute('content'))!.length,
    ).toBeLessThanOrEqual(300);
    await page.goto('/');
    await page.locator('[data-add-product="demo-bag"]').click();
    const cart = await page.evaluate(() => localStorage.getItem('dar-cart-v1'));
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: original.name })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'طريقة عرض المنتج', exact: true })
      .selectOption('landing');
    await page.getByRole('button', { name: 'صورة +', exact: true }).click();
    await page.getByLabel('رابط الصورة', { exact: true }).fill('/demo/candle.svg');
    await page.getByRole('button', { name: 'زر +', exact: true }).click();
    await page.getByRole('button', { name: 'استمارة +', exact: true }).click();
    await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
    const preview = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(preview.locator('.store-header')).toHaveCount(0);
    await expect(preview.locator('[data-open-cart]')).toHaveCount(0);
    await expect(preview.locator('#add-offer')).toHaveCount(0);
    await expect(preview.locator('#checkout-form')).toBeVisible();
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.locator('tbody')).toBeVisible();
    await page.goto('/products/' + original.slug);
    await expect(page.locator('.store-header,.announcement,.breadcrumb')).toHaveCount(0);
    await expect(page.locator('#add-offer,[data-open-cart]')).toHaveCount(0);
    await expect(page.locator('.offer-card')).toHaveCount(0);
    await page.getByText('السياسات', { exact: true }).click();
    await expect(page.getByRole('link', { name: 'الخصوصية', exact: true })).toBeVisible();
    await page.locator('[name=name]').fill('عميل اختبار صفحة هبوط');
    await page.locator('[name=phone]').fill('0611117777');
    await page.locator('[name=city]').fill('Rabat');
    await page.locator('[name=address]').fill('Landing test street 12');
    await page.locator('#checkout-form [type=submit]').click();
    await expect(page.locator('#thanks-dialog')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dar-cart-v1'))).toBe(cart);
    await expect(page.locator('#saved-cart-reminder')).toHaveCount(0);
    await page.getByRole('button', { name: 'إغلاق الرسالة', exact: true }).click();
    await page.screenshot({ path: 'test-results/focused-landing-mobile.png', fullPage: true });
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});

test('orders expose official filters and shipment tracking without a carrier name', async ({
  page,
}) => {
  await page.route('**/api/admin/orders?*', (route) =>
    route.fulfill({
      json: [
        {
          id: 'ui-status-fixture',
          ref: 'LOCAL-STATUS',
          status: 'confirmed',
          sync_status: 'sent',
          mowarid_id: 'local-vendor-order',
          customer: {
            name: 'عميل اختبار محلي',
            phone: '0612345678',
            city: 'Rabat',
            address: 'عنوان اختبار',
          },
          supplier: 'local-supplier',
          shipping_status: 'paid',
          financial_status: 'cleared',
          delivered_total: 10000,
          quote: { total: 10000, items: [{ sku: 'LOCAL', name: 'منتج اختبار', quantity: 1 }] },
          remote: {
            shipping: {
              carrier: 'شركة شحن جديدة',
              tracking_number: 'LOCAL-TRACK',
              tracking_url: 'https://mowarid.ma/dashboard/orders',
            },
          },
        },
      ],
    }),
  );
  await page.goto('/admin/orders');
  const filters = page.getByRole('combobox', { name: 'حالة الشحن والتوريد' });
  for (const code of [
    'not_sent',
    'pending',
    'confirmed',
    'sent',
    'shipped',
    'delivered',
    'returned',
    'cancelled',
  ])
    await expect(filters.locator('option[value="' + code + '"]')).toHaveCount(1);
  const profits = page.getByRole('combobox', { name: 'حالة الأرباح' });
  await expect(profits.locator('option')).toHaveCount(5);
  for (const code of ['pending', 'awaiting_settlement', 'paid', 'cancelled'])
    await expect(profits.locator('option[value="' + code + '"]')).toHaveCount(1);
  await expect(
    page.locator('.order-status-badge').filter({ hasText: 'تم التوصيل (مدفوعة الأرباح)' }),
  ).toBeVisible();
  await expect(
    page.locator('.order-status-badge').filter({ hasText: 'بانتظار التسوية' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'التفاصيل', exact: true }).click();
  await expect(page.getByText('شركة شحن جديدة', { exact: true })).toHaveCount(0);
  await expect(page.getByText('شركة الشحن', { exact: true })).toHaveCount(0);
  await expect(page.getByText('LOCAL-TRACK', { exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: 'تتبع الطلب بمورد', exact: true });
  await expect(link).toHaveAttribute('href', 'https://mowarid.ma/dashboard/orders');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('desktop product edit labels stay on one line and delivery notes are directly visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/admin/products');
  const buttons = page.locator('.admin-product-actions button');
  await expect(buttons.first()).toBeVisible();
  for (const button of await buttons.all()) {
    expect(
      await button.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getClientRects().length;
      }),
    ).toBe(1);
  }
  await page.goto('/');
  await page.locator('[data-add-product="demo-bag"]').click();
  await page.goto('/checkout');
  await expect(page.locator('[name=notes]')).toBeVisible();
  await expect(page.locator('.order-notes summary')).toHaveCount(0);
  await page.locator('[name=notes]').fill('اتصل قبل التوصيل');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[name=notes]')).toBeVisible();
});
test('pending sending has no stray zero, technical checks or private store identifiers', async ({
  page,
}) => {
  const row = {
    id: 'pending-ui-fixture',
    ref: 'REF-PENDING-UI',
    status: 'confirmed',
    sync_status: 'queued',
    post_attempted: 0,
    mowarid_id: null,
    last_error: null,
    customer: {
      name: 'عميل محلي',
      phone: '0612345678',
      city: 'Rabat',
      address: 'عنوان محلي',
      notes: 'اتصل قبل التوصيل',
    },
    attribution: {},
    supplier: 'technical-supplier-fixture',
    quote: {
      total: 15900,
      subtotal: 12900,
      shipping: 3000,
      storeIdentity: { name: 'internal-store-fixture', url: 'https://internal-store.test' },
      items: [
        { sku: 'UI-SKU', name: 'منتج اختبار', quantity: 1, subtotal: 12900, unitPrice: 12900 },
      ],
    },
  };
  await page.route('**/api/admin/orders?**', (route) => route.fulfill({ json: [row] }));
  await page.route('**/api/admin/orders/sync', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/admin/orders');
  await expect(page.getByText('جارٍ الإرسال إلى مورد', { exact: true })).toBeVisible();
  await expect(page.locator('.editor-block').getByText('0', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'إلغاء الطلب', exact: true })).toBeVisible();
  for (const name of ['محاكاة آمنة دون توريد', 'فحص التسعير لدى مورد'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'التفاصيل', exact: true }).click();
  for (const text of [
    'اسم المتجر عند إنشاء الطلب',
    'رابط المتجر',
    'مورد الطلب',
    'معرف مورد',
    'المعرف الخارجي لدى مورد',
    'internal-store-fixture',
    'technical-supplier-fixture',
    'مدفوعة تعني اكتمال التسوية وإضافة الأرباح إلى رصيدك لدى مورد.',
  ])
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  row.post_attempted = 1;
  row.sync_status = 'error';
  await page.reload();
  await expect(
    page.getByText('لم تتأكد نتيجة الإرسال بعد. حدّث حالة الإرسال قبل إعادة المحاولة.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'تحديث حالة الإرسال', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'إعادة الإرسال إلى مورد', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'إلغاء الطلب', exact: true })).toHaveCount(0);
});

test('order prices explain multi-unit sales, customer free delivery and authoritative Mowarid charges', async ({
  page,
}) => {
  const row = {
    id: 'pricing-fixture',
    ref: 'REF-PRICING',
    status: 'confirmed',
    sync_status: 'sent',
    mowarid_id: 'mw-pricing',
    post_attempted: 1,
    customer: {
      name: 'عميل اختبار',
      phone: '0612345678',
      city: 'Rabat',
      address: 'عنوان محلي',
      notes: '',
    },
    attribution: {},
    quote: {
      total: 25000,
      subtotal: 25000,
      shipping: 0,
      items: [
        {
          productId: 'a',
          sku: 'A',
          name: 'المنتج الأول',
          quantity: 2,
          unitPrice: 10000,
          subtotal: 20000,
        },
        {
          productId: 'b',
          sku: 'B',
          name: 'المنتج الثاني',
          quantity: 1,
          unitPrice: 5000,
          subtotal: 5000,
        },
      ],
    },
    remote: {
      financials: {
        products_subtotal: 250,
        customer_shipping_fee: 0,
        total_cod_amount: 250,
        wholesale_subtotal: 130,
        platform_shipping_cost: 30,
        partner_profit: 90,
      },
      items: [
        { sku: 'A', quantity: 2, selling_price: 100, fulfillment_price: 60, subtotal: 200 },
        { sku: 'B', quantity: 1, selling_price: 50, fulfillment_price: 10, subtotal: 50 },
      ],
    },
  };
  await page.route('**/api/admin/orders?**', (route) => route.fulfill({ json: [row] }));
  await page.route('**/api/admin/orders/sync', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/admin/orders');
  await page.getByRole('button', { name: 'التفاصيل', exact: true }).click();
  const panel = page.getByRole('region', { name: 'تفاصيل الأسعار', exact: true });
  await expect(panel.locator('.order-price-line')).toHaveCount(2);
  const first = panel.locator('.order-price-line').first();
  await expect(
    first
      .getByText('سعر المنتج الواحد للزبون', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toContainText('100');
  await expect(
    first
      .getByText('مجموع بيع هذا المنتج', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toContainText('200');
  await expect(
    first
      .getByText('تكلفة المنتج الواحد لدى مورد', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toContainText('60');
  await expect(
    first
      .getByText('مجموع تكلفة هذا المنتج', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toContainText('120');
  const customer = page.getByRole('region', { name: 'ما يدفعه الزبون', exact: true });
  await expect(
    customer.getByText('التوصيل للزبون', { exact: true }).locator('xpath=following-sibling::dd[1]'),
  ).toContainText('0');
  await expect(
    customer
      .getByText('الإجمالي الذي يدفعه الزبون', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toContainText('250');
  const merchant = page.getByRole('region', { name: 'ما تدفعه لمورد', exact: true });
  await expect(
    merchant
      .getByText('إجمالي المستحق لمورد', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toContainText('160');
  await expect(
    panel
      .getByText('صافي الربح المتوقع', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toContainText('90');
  await expect(panel.getByText('تكاليف معتمدة من طلبك لدى مورد', { exact: true })).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('the compact table opens a separate partner-style detail view and returns to the list', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/admin/orders');
  await expect(page.locator('.admin-orders-table')).toBeVisible();
  const row = page.locator('.admin-orders-table tbody tr').first();
  await row.getByRole('button', { name: 'التفاصيل', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/STORE-/);
  await expect(page.locator('.admin-orders-table')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'الملخص المالي', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'بيانات الزبون', exact: true })).toBeVisible();
  const boxes = await page.locator('.order-detail-layout').evaluate((root) => {
    const finance = root.querySelector('.order-financial-card')!.getBoundingClientRect();
    const customer = root.querySelector('.order-customer-column')!.getBoundingClientRect();
    return { financeRight: finance.right, customerLeft: customer.left };
  });
  expect(boxes.financeRight).toBeLessThanOrEqual(boxes.customerLeft);
  await page.reload();
  await expect(page.getByRole('region', { name: 'الملخص المالي', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'العودة إلى الطلبات', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expect(page.locator('.admin-orders-table')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
