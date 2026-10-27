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
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.76.1' },
    data: account,
  });
  expect(login.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
}
test('badge editing belongs to the form, survives implicit form materialization and hides when empty while footer checks stay compact', async ({
  page,
}) => {
  const headers = await owner(page);
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
            pageMode: 'landing',
            blocks: [],
            presentation: {
              ...original.presentation,
              landingCodBadge: { visible: false, text: 'old text' },
            },
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: original.sku })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    const form = page.getByLabel('شارة الدفع أعلى الاستمارة', { exact: true });
    await expect(form).toHaveValue('');
    await expect(page.locator('.landing-cod-badge-settings')).toHaveCount(0);
    await form.pressSequentially('اطلب بثقة');
    await expect(form).toHaveValue('اطلب بثقة');
    await expect(page.locator('.editor-block').filter({ has: form })).toContainText(
      'عنوان الاستمارة',
    );
    const footer = page.locator('.landing-footer-settings');
    await expect(footer).toHaveCSS('padding-top', '12px');
    for (const label of await footer.locator('.admin-check').all()) {
      await expect(label).toHaveCSS('display', 'flex');
      const positions = await label.evaluate((label) => {
        const a = label.querySelector('input')!.getBoundingClientRect(),
          b = label.querySelector('span')!.getBoundingClientRect();
        return {
          delta: Math.abs(a.y + a.height / 2 - b.y - b.height / 2),
          height: label.getBoundingClientRect().height,
        };
      });
      expect(positions.delta).toBeLessThan(2);
      expect(positions.height).toBeLessThan(65);
    }
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    await page.goto('/offers/' + original.slug);
    await expect(page.locator('.cod-badge')).toHaveText('اطلب بثقة');
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: original.sku })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await page.getByLabel('شارة الدفع أعلى الاستمارة', { exact: true }).fill('');
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    await page.goto('/offers/' + original.slug);
    await expect(page.locator('.cod-badge')).toHaveCount(0);
    await page.goto('/checkout?product=' + original.id);
    await expect(page.locator('.cod-badge')).toHaveText('الدفع عند الاستلام ✓');
  } finally {
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, { headers, data: original })
      ).ok(),
    ).toBe(true);
  }
});
test('larger benefit cards and the optional authority card save and hide without mobile overflow', async ({
  page,
}) => {
  const headers = await owner(page);
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  try {
    await page.goto('/');
    await expect(page.locator('.license-card')).toHaveCount(0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator('.benefits-strip > span').first()).toHaveCSS('font-size', '16px');
      const card = await page.locator('.benefits-strip > span').first().boundingBox();
      expect(card!.height).toBeGreaterThanOrEqual(90);
    }
    await page.goto('/admin/appearance');
    await page.getByLabel('إظهار بطاقة التراخيص والشهادات', { exact: true }).check();
    await page.getByLabel('عنوان بطاقة التراخيص', { exact: true }).fill('شهادات المنتجات');
    await page
      .getByLabel('وصف بطاقة التراخيص', { exact: true })
      .fill('تفاصيل التسجيل الخاصة بمنتجات المتجر');
    await page
      .getByLabel('رابط التسجيل أو الشهادات (اختياري)', { exact: true })
      .fill('https://example.test/certificates');
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/');
      await expect(page.locator('.license-card')).toBeVisible();
      await expect(page.locator('.license-card img')).toHaveCount(2);
      await expect(page.locator('.license-card h2')).toHaveText('شهادات المنتجات');
      await expect(page.locator('.license-card a')).toHaveAttribute(
        'href',
        'https://example.test/certificates',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: 'test-results/trust-cards-' + width + '.png', fullPage: true });
    }
    await page.goto('/admin/appearance');
    await page.getByLabel('إظهار بطاقة التراخيص والشهادات', { exact: true }).uncheck();
    await page.getByLabel('إظهار شريط المزايا', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    await page.goto('/');
    await expect(page.locator('.license-card')).toHaveCount(0);
    await expect(page.locator('.benefits-strip')).toHaveCount(0);
  } finally {
    expect((await page.request.put('/api/admin/settings', { headers, data: original })).ok()).toBe(
      true,
    );
  }
});
test('price sorting stays with category, search, reload and history, and the merchant can hide it globally', async ({
  page,
}) => {
  const headers = await owner(page);
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const category = {
    id: 'aa2475c7-383b-4834-b091-38e4a7dddc3d',
    name: 'Price sort test',
    image: '',
    icon: '',
    position: 99,
    active: 1,
  };
  const products = await (await page.request.get('/api/admin/products')).json();
  const targets = products.filter((p: any) => ['demo-bag', 'demo-notebook'].includes(p.id));
  const prices = async () =>
    page.locator('.shop-home [data-product-card]:visible').evaluateAll((cards) => {
      const data = JSON.parse(document.getElementById('store-data')!.textContent!);
      return cards.map(
        (card) =>
          data.products.find((p: any) => p.id === (card as HTMLElement).dataset.productCard).price,
      );
    });
  try {
    expect(
      (
        await page.request.put('/api/admin/categories/' + category.id, { headers, data: category })
      ).ok(),
    ).toBe(true);
    for (const p of targets)
      expect(
        (
          await page.request.put('/api/admin/products/' + p.id, {
            headers,
            data: { ...p, categoryId: category.id },
          })
        ).ok(),
      ).toBe(true);
    await page.goto('/');
    await expect(
      page.locator('.price-sort > span, #supplier-notice, .categories-section h2'),
    ).toHaveCount(0);
    await page.getByLabel('ترتيب المنتجات', { exact: true }).selectOption('price-asc');
    expect(await prices()).toEqual([...(await prices())].sort((a, b) => a - b));
    await page.locator('[data-category="' + category.id + '"]').click();
    await expect(page).toHaveURL(/sort=price-asc/);
    expect((await prices()).length).toBe(targets.length);
    await page.getByLabel('ترتيب المنتجات', { exact: true }).selectOption('price-desc');
    await page.reload();
    await expect(page.getByLabel('ترتيب المنتجات', { exact: true })).toHaveValue('price-desc');
    expect(await prices()).toEqual([...(await prices())].sort((a, b) => b - a));
    await page.getByLabel('ترتيب المنتجات', { exact: true }).selectOption('');
    await page.goBack();
    await expect(page.getByLabel('ترتيب المنتجات', { exact: true })).toHaveValue('price-desc');
    await page.goto('/?q=DEMO&sort=price-asc');
    await expect(page.locator('#store-search')).toHaveValue('DEMO');
    expect(await prices()).toEqual([...(await prices())].sort((a, b) => a - b));
    await page.goto('/admin/appearance');
    await page.getByLabel('إظهار ترتيب المنتجات حسب السعر', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    expect(
      (await (await page.request.get('/api/admin/settings')).json()).settings.home.showPriceSort,
    ).toBe(false);
    for (const path of [
      '/?sort=price-desc',
      '/?category=' + category.id + '&sort=price-asc',
      '/?lang=fr&sort=price-desc',
    ]) {
      await page.goto(path);
      await expect(page.locator('[data-price-sort]')).toHaveCount(0);
    }
  } finally {
    for (const p of targets)
      expect(
        (await page.request.put('/api/admin/products/' + p.id, { headers, data: p })).ok(),
      ).toBe(true);
    expect(
      (await page.request.delete('/api/admin/categories/' + category.id, { headers })).ok(),
    ).toBe(true);
    expect((await page.request.put('/api/admin/settings', { headers, data: original })).ok()).toBe(
      true,
    );
  }
});
