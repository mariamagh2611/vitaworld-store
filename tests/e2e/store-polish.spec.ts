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
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.88.1' },
    data: account,
  });
  expect(login.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
}
test('one category language dropdown saves independent names and legacy writes keep translations', async ({
  page,
}) => {
  const headers = await owner(page),
    original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  let category: any;
  try {
    expect(
      (
        await page.request.patch('/api/admin/store-languages', {
          headers,
          data: { storeLanguage: 'ar', storeLanguages: ['ar', 'fr', 'en'] },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin/categories');
    await page.getByRole('button', { name: 'إضافة قسم +', exact: true }).click();
    await page.getByLabel('اسم القسم — العربية', { exact: true }).fill('قسم للتجربة');
    await page.getByLabel('لغة اسم القسم', { exact: true }).selectOption('fr');
    await page.getByLabel('اسم القسم — Français', { exact: true }).fill('Catégorie test');
    await page.getByLabel('لغة اسم القسم', { exact: true }).selectOption('en');
    await page.getByLabel('اسم القسم — English', { exact: true }).fill('Test category');
    await page.getByRole('button', { name: 'حفظ القسم', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ القسم.');
    category = (await (await page.request.get('/api/admin/categories')).json()).find(
      (c: any) => c.name === 'قسم للتجربة',
    );
    expect(category.translations.fr).toBe('Catégorie test');
    const { translations, ...legacy } = category;
    expect(
      (
        await page.request.put('/api/admin/categories/' + category.id, { headers, data: legacy })
      ).ok(),
    ).toBe(true);
    for (const [lang, name] of [
      ['ar', 'قسم للتجربة'],
      ['fr', 'Catégorie test'],
      ['en', 'Test category'],
    ]) {
      await page.goto('/?lang=' + lang);
      await expect(page.locator('[data-category="' + category.id + '"]')).toContainText(name);
    }
  } finally {
    if (category)
      expect(
        (await page.request.delete('/api/admin/categories/' + category.id, { headers })).ok(),
      ).toBe(true);
    expect((await page.request.put('/api/admin/settings', { headers, data: original })).ok()).toBe(
      true,
    );
  }
});
test('regular product copy, optional summary and readable fonts change while landing colors and form geometry stay fixed', async ({
  page,
}) => {
  const headers = await owner(page),
    original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const formStyles = async () =>
    page.locator('.landing-order-form').evaluate((form) => {
      const elements = [
        document.body,
        form,
        ...form.querySelectorAll('h2,label,input,select,button[type=submit]'),
      ];
      return elements.map((el) => {
        const style = getComputedStyle(el);
        return {
          color: style.color,
          background: style.backgroundColor,
          border: style.borderColor,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      });
    });
  try {
    await page.goto('/offers/daily-bag');
    const before = await formStyles();
    await page.goto('/admin/settings');
    await page.locator('.product-info-settings summary').click();
    await page.getByLabel('عنوان ملخص التوصيل والاسترجاع', { exact: true }).fill('معلومات الطلب');
    await page
      .getByLabel('نص ملخص التوصيل والاسترجاع', { exact: true })
      .fill('نؤكد طلبك قبل إرساله.');
    await page.getByLabel('عنوان أيقونة الدفع', { exact: true }).fill('الدفع عند التوصيل');
    await page.getByLabel('نص أيقونة التوصيل', { exact: true }).fill('التوصيل: {casa} / {other}');
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    const current = (await (await page.request.get('/api/admin/settings')).json()).settings;
    expect(
      (
        await page.request.put('/api/admin/settings', {
          headers,
          data: {
            ...current,
            theme: { ...current.theme, primary: '#115544', background: '#eee9da', text: '#123123' },
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/shop/daily-bag');
    await expect(page.locator('.product-service-summary summary')).toContainText('معلومات الطلب');
    await expect(page.locator('.product-delivery')).toContainText('الدفع عند التوصيل');
    await expect(page.locator('[data-product-delivery]')).toContainText('التوصيل:');
    await expect(page.locator('.product-service-summary a')).toHaveCount(0);
    await expect(page.locator('.product-delivery b').first()).toHaveCSS('font-size', '17px');
    await expect(page.locator('.product-offers .offer-card small').first()).toHaveCSS(
      'font-size',
      '16px',
    );
    await page.goto('/offers/daily-bag');
    expect(await formStyles()).toEqual(before);
    await page.goto('/admin/settings');
    await page.locator('.product-info-settings summary').click();
    await page
      .getByLabel('إظهار ملخص التوصيل والاسترجاع في صفحة المنتج', { exact: true })
      .uncheck();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    await page.goto('/shop/daily-bag');
    await expect(page.locator('.product-service-summary')).toHaveCount(0);
  } finally {
    expect((await page.request.put('/api/admin/settings', { headers, data: original })).ok()).toBe(
      true,
    );
  }
});
