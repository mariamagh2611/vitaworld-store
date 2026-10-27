import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
async function owner(page: Page) {
  const origin = 'http://localhost:8788';
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
  const response = await page.request.post('/api/auth/login', {
    headers: { Origin: origin },
    data: account,
  });
  expect(response.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await response.json()).csrf };
}
test('selected catalog imports resume after a lost response and preserve existing drafts on full import', async ({
  page,
}) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(5000);
  let importedId = '';
  const existingIds = new Set<string>();
  try {
    await owner(page);
    const before = await (await page.request.get('/api/admin/products')).json();
    before.forEach((p: any) => existingIds.add(p.id));
    await page.goto('/admin/products');
    await expect(
      page.getByRole('button', { name: 'استيراد كل المنتجات مفعّلة', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'استيراد كل المنتجات مسودة', exact: true }),
    ).toBeVisible();
    await page.getByLabel('البحث باسم أو كود المنتج', { exact: true }).fill('DEMO-A3');
    await page.locator('.bulk-catalog-selection > summary').click();
    await page.getByLabel('اختيار المنتج DEMO-A3', { exact: true }).check();
    await expect(
      page.getByRole('button', { name: 'استيراد المحدد مسودة', exact: true }),
    ).toBeVisible();
    let dropped = false;
    await page.route('**/api/admin/catalog/import', async (route) => {
      if (dropped) return route.continue();
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByRole('button', { name: 'استيراد المحدد مسودة', exact: true }).click();
    await expect(page.getByRole('button', { name: 'متابعة الاستيراد', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.bulk-import-progress')).toContainText('تمت معالجة 1 من 1 منتج');
    await expect(page.locator('.bulk-import-counts')).toContainText('مسودة: 1');
    const after = await (await page.request.get('/api/admin/products')).json();
    const imported = after.find((p: any) => p.sku === 'DEMO-A3');
    importedId = imported.id;
    expect(imported.active).toBe(0);
    expect(imported.presentation.descriptionFormat).toBe('html');
    expect(after).toHaveLength(before.length + 1);
    expect(after.filter((p: any) => before.some((old: any) => old.id === p.id))).toEqual(before);
    await page.getByLabel('البحث باسم أو كود المنتج', { exact: true }).fill('demo-a3');
    await expect(page.locator('.panel > .table-wrap tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: 'استيراد كل المنتجات مفعّلة', exact: true }).click();
    await expect(page.locator('.bulk-import-progress')).toContainText('تمت معالجة 4 من 4 منتج');
    await expect(page.locator('.bulk-import-counts')).toContainText('تم تخطيه: 4');
    const repeated = await (await page.request.get('/api/admin/products')).json();
    expect(repeated).toEqual(after);
    await page.getByLabel('حالة المنتجات', { exact: true }).selectOption('published');
    await expect(page.locator('.panel > .table-wrap tbody tr')).toHaveCount(0);
    await page.getByLabel('حالة المنتجات', { exact: true }).selectOption('draft');
    await expect(page.locator('.panel > .table-wrap tbody tr')).toHaveCount(1);
    await page.getByLabel('حالة المنتجات', { exact: true }).selectOption('all');
    expect(await page.evaluate(() => sessionStorage.getItem('dar-catalog-import-v1'))).toBeNull();
    await expect(page.locator('.bulk-import-progress')).toHaveCount(0, { timeout: 15000 });
    await page.evaluate(() =>
      sessionStorage.setItem(
        'dar-catalog-import-v1',
        JSON.stringify({
          version: 1,
          scope: 'legacy',
          mode: 'draft',
          skus: ['old'],
          offset: 1,
          requests: [],
          items: [],
        }),
      ),
    );
    await page.reload();
    await expect(page.locator('.bulk-import-progress')).toHaveCount(0);

    await page
      .getByLabel('البحث باسم أو كود المنتج', { exact: true })
      .fill(imported.name.slice(0, 6));
    await expect(page.locator('.panel > .table-wrap tbody tr')).toHaveCount(1);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: 'test-results/bulk-import-' + width + '.png', fullPage: true });
    }
  } finally {
    if (!importedId) {
      const current = await page.request
        .get('/api/admin/products', { timeout: 5000 })
        .then((r) => r.json())
        .catch(() => []);
      importedId = current.find((p: any) => p.sku === 'DEMO-A3')?.id || '';
    }
    if (importedId && !existingIds.has(importedId)) {
      const { persist } = JSON.parse(await readFile('test-results/e2e-database.json', 'utf8'));
      expect(persist.startsWith(join(tmpdir(), 'mowarid-e2e-'))).toBe(true);
      expect(importedId).toMatch(/^[a-f0-9-]+$/);
      await promisify(execFile)(process.execPath, [
        'node_modules/wrangler/bin/wrangler.js',
        'd1',
        'execute',
        'DB',
        '--local',
        '--persist-to',
        persist,
        '--command',
        "DELETE FROM products WHERE id='" + importedId + "'",
      ]);
    }
  }
});
test('the appearance search switch saves for every language and retains the mobile menu', async ({
  page,
}) => {
  const headers = await owner(page);
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  try {
    await page.goto('/admin/appearance');
    await page.getByLabel('إظهار مربع البحث في المتجر', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    const saved = (await (await page.request.get('/api/admin/settings')).json()).settings;
    expect(saved.home.showSearch).toBe(false);
    for (const path of ['/', '/shop/daily-bag', '/?lang=fr']) {
      await page.goto(path);
      await expect(page.locator('form.store-search')).toHaveCount(0);
      await expect(page.locator('.mobile-menu')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.goto('/admin/appearance');
    await expect(page.getByLabel('إظهار مربع البحث في المتجر', { exact: true })).not.toBeChecked();
    await page.getByLabel('إظهار مربع البحث في المتجر', { exact: true }).check();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    await page.goto('/');
    await expect(page.locator('#store-search')).toBeVisible();
  } finally {
    expect((await page.request.put('/api/admin/settings', { headers, data: original })).ok()).toBe(
      true,
    );
  }
});
