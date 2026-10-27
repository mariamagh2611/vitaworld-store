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
test('compact appearance controls save a larger wordmark, global header toggle and readable configurable checkout text', async ({
  page,
}) => {
  const headers = await owner(page),
    original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  try {
    await page.goto('/admin/appearance');
    await page
      .locator('summary')
      .filter({ hasText: /^عرض الشعار$/ })
      .click();
    await page.getByLabel('عرض الشعار (بالبكسل)', { exact: true }).fill('176');
    await page.getByLabel('تكبير الشعار داخل الإطار', { exact: true }).fill('4');
    await page.getByLabel('إظهار اسم المتجر بجانب الشعار', { exact: true }).uncheck();
    await page
      .locator('summary')
      .filter({ hasText: /^الخط وحجم الكتابة$/ })
      .click();
    await page.getByLabel('حجم النص على الهاتف', { exact: true }).fill('18');
    await page.getByLabel('حجم النص على الحاسوب', { exact: true }).fill('17');
    await page.getByLabel('سُمك النص', { exact: true }).selectOption('500');
    await page.getByLabel('إظهار القائمة العلوية للمتجر', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    const settings = (await (await page.request.get('/api/admin/settings')).json()).settings;
    expect(settings.branding.logoZoom).toBe(4);
    expect(settings.typography.mobileSize).toBe(18);
    expect(settings.home.showNavigation).toBe(false);
    const { branding, typography, home, ...rest } = settings;
    const { showNavigation, ...oldHome } = home;
    expect(
      (
        await page.request.put('/api/admin/settings', {
          headers,
          data: { ...rest, logo: '/demo/bag.svg', storeLanguages: ['ar', 'fr'], home: oldHome },
        })
      ).ok(),
    ).toBe(true);
    const retained = (await (await page.request.get('/api/admin/settings')).json()).settings;
    expect(retained.branding).toEqual(branding);
    expect(retained.typography).toEqual(typography);
    expect(retained.home.showNavigation).toBe(false);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/');
      await expect(page.locator('.desktop-nav')).toHaveCount(0);
      await expect(page.locator('.mobile-menu')).toHaveCount(0);
      await expect(page.locator('.store-search')).toBeVisible();
      await expect(page.locator('.cart-button')).toBeVisible();
      await page.goto('/checkout?product=demo-bag');
      const size = width <= 700 ? '18px' : '17px';
      for (const selector of [
        'input[name=name]',
        'input[name=phone]',
        'input[name=address]',
        '.checkout-method small',
        '.summary-row',
        '.summary-trust',
      ])
        await expect(page.locator(selector).first()).toHaveCSS('font-size', size);
      await expect(page.locator('.checkout-consent')).toHaveCSS('font-size', '13px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: 'test-results/checkout-reading-' + width + '.png',
        fullPage: true,
      });
    }
    await page.goto('/admin/appearance');
    await page.getByLabel('إظهار القائمة العلوية للمتجر', { exact: true }).check();
    await page
      .locator('summary')
      .filter({ hasText: /^الخط وحجم الكتابة$/ })
      .click();
    await page.getByLabel('خط المتجر', { exact: true }).selectOption('system');
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    await page.goto('/');
    await expect(page.locator('.mobile-menu')).toHaveCount(1);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/');
      await expect(page.locator('.store-language-switcher select')).toBeVisible();
      expect(
        await page
          .locator('.store-header .brand')
          .evaluate((el) => el.getBoundingClientRect().width),
      ).toBeGreaterThanOrEqual(135);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    expect(await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
      'system-ui',
    );
  } finally {
    expect((await page.request.put('/api/admin/settings', { headers, data: original })).ok()).toBe(
      true,
    );
  }
});
