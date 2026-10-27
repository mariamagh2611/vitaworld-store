import { test, expect } from '@playwright/test';

test('mobile administration has a modal menu and separated product fields in all languages', async ({
  page,
}) => {
  test.setTimeout(120000);
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: 'http://localhost:8788', 'CF-Connecting-IP': '198.18.11.90' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const csrf = (await login.json()).csrf;
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const labels = {
    ar: ['فتح قائمة الإدارة', 'إغلاق القائمة', 'المنتجات والصفحات', 'نظرة عامة'],
    fr: ['Ouvrir le menu de gestion', 'Fermer le menu', 'Produits et pages', 'Vue d’ensemble'],
    en: ['Open admin menu', 'Close menu', 'Products and pages', 'Overview'],
  };
  await page.route('**/api/admin/products', (route) =>
    route.fulfill({
      json: [
        {
          id: 'mobile-test',
          name: 'اسم منتج طويل لا يجب أن يتداخل مع القسم — Produit avec un nom très long',
          sku: 'MOBILE-TEST',
          categoryId: 'mobile-category',
          image: '/demo/bag.svg',
          price: 15900,
          stock: 95,
          active: 1,
          verified: 1,
        },
      ],
    }),
  );
  await page.route('**/api/admin/categories', (route) =>
    route.fulfill({
      json: [
        { id: 'mobile-category', name: 'قسم منتجات العناية والمنتجات اليومية الطويل', active: 1 },
      ],
    }),
  );
  try {
    for (const [language, [open, close, products]] of Object.entries(labels)) {
      await page.request.patch('/api/admin/language', {
        headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
        data: { scope: 'admin', language },
      });
      for (const width of [320, 390, 430, 820]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/admin');
        await expect(page.locator('.admin-sidebar')).toBeHidden();
        const button = page.getByRole('button', { name: open, exact: true });
        await button.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(button).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByRole('button', { name: close, exact: true })).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator('.logout-button')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: close, exact: true })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('.admin-sidebar')).toBeHidden();
        await expect(button).toBeFocused();
        await button.click();
        await page.getByRole('link', { name: products, exact: true }).click();
        await expect(page.locator('.admin-sidebar')).toBeHidden();
        const row = page.locator('.admin-products-table tbody tr');
        await expect(row).toContainText('MOBILE-TEST');
        expect(
          await row.evaluate((element) => {
            const title = element.querySelector('.admin-product-title')!.getBoundingClientRect();
            const category = element.querySelector('[data-label]')!.getBoundingClientRect();
            const overlap =
              Math.min(title.right, category.right) > Math.max(title.left, category.left) &&
              Math.min(title.bottom, category.bottom) > Math.max(title.top, category.top);
            return !overlap && document.documentElement.scrollWidth <= innerWidth;
          }),
        ).toBe(true);
        for (const name of [
          'orders',
          'categories',
          'analytics',
          'pixels',
          'settings',
          'appearance',
          'integration',
          'media',
          'account',
        ]) {
          await page.goto('/admin/' + name);
          await expect(page.locator('.admin-header h1')).toBeVisible();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/admin/products');
    await expect(page.locator('.admin-sidebar')).toBeVisible();
    await expect(page.locator('.admin-menu-toggle')).toBeHidden();
  } finally {
    await page.request.patch('/api/admin/language', {
      headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
      data: { scope: 'admin', language: original.adminLanguage },
    });
  }
});
