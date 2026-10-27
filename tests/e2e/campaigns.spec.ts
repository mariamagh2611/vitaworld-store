import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults } from '../../src/shared/types';
const origin = 'http://localhost:8788';
async function fixture(page: Page) {
  const status = await (await page.request.get('/api/auth/status')).json();
  const response = await page.request.post('/api/auth/' + (status.setup ? 'setup' : 'login'), {
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.42.1' },
    data: {
      email: 'owner@example.test',
      password: 'local-admin-test-password-2026',
      ...(status.setup
        ? { token: (await readFile('.dev.vars', 'utf8')).match(/^SETUP_TOKEN=(.+)$/m)![1] }
        : {}),
    },
  });
  expect(response.ok()).toBe(true);
  const base = { checkouts: 0, orders: 0, delivered: 0, revenue: 0 };
  const campaigns = [
    { ...base, source: 'facebook', campaign: 'Gluta V1', visits: 4, orders: 1 },
    { ...base, source: 'fb', campaign: 'Gluta V1', visits: 6, orders: 2 },
    { ...base, source: 'ig', campaign: 'Gluta V1', visits: 3 },
    ...Array.from({ length: 24 }, (_, i) => ({
      ...base,
      source: 'fb',
      campaign: 'Campaign ' + String(i).padStart(2, '0'),
      visits: 2,
    })),
  ];
  let links = Array.from({ length: 24 }, (_, i) => ({
    id: crypto.randomUUID(),
    campaign: 'Campaign ' + String(i).padStart(2, '0'),
    source: 'facebook',
    target: origin + '/offers/daily-bag',
    url: origin + '/?utm_source=facebook&utm_campaign=Campaign' + i,
    created_at: '2026-10-16T10:00:00Z',
  }));
  const posts: any[] = [];
  let fail = false;
  await page.route('**/api/admin/analytics?**', (route) =>
    route.fulfill({
      json: {
        metrics: { ...base },
        campaigns,
        note: 'الزيارات والوصول لصفحة الشراء تُحسب مرة لكل جلسة متصفح في اليوم والمصدر والحملة؛ الإيراد من الطلبات المسلّمة.',
      },
    }),
  );
  await page.route('**/api/admin/campaign-links', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      if (fail) return route.fulfill({ status: 400, json: { message: 'اختر رابطًا من متجرك.' } });
      const b = posts.at(-1),
        row = {
          id: crypto.randomUUID(),
          campaign: b.campaign,
          source: b.source,
          target: b.target,
          url:
            b.target +
            '?utm_source=' +
            b.source +
            '&utm_campaign=' +
            encodeURIComponent(b.campaign),
          created_at: '2026-10-16T12:00:00Z',
        };
      links = [row, ...links];
      return route.fulfill({ status: 201, json: row });
    }
    return route.fulfill({ json: links });
  });
  await page.route('**/api/admin/campaign-links/*', (route) => {
    links = links.filter((link) => !route.request().url().endsWith(link.id));
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/admin/analytics');
  await expect(page.getByRole('tab', { name: 'الأداء', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  return {
    posts,
    failCreation: () => {
      fail = true;
    },
  };
}
test('campaigns combine sources, search all pages, and filter and sort their actual totals', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  const table = page.locator('.campaign-table').first();
  await expect(table.locator('tbody > tr')).toHaveCount(10);
  const gluta = table.getByRole('row').filter({ hasText: 'Gluta V1' });
  await expect(gluta.locator('td').nth(1)).toHaveText('13');
  await expect(gluta.locator('td').nth(3)).toHaveText('3');
  await page.getByRole('button', { name: 'تفاصيل الحملة: Gluta V1', exact: true }).click();
  const detail = page.getByRole('table', { name: 'تفاصيل المصادر', exact: true });
  await expect(detail.locator('tbody tr')).toHaveCount(2);
  await expect(
    detail.getByRole('row').filter({ hasText: 'فيسبوك' }).locator('td').nth(1),
  ).toHaveText('10');
  await page.getByLabel('البحث باسم الحملة', { exact: true }).fill('campaign 23');
  await expect(table.locator('tbody > tr')).toHaveCount(1);
  await expect(table).toContainText('Campaign 23');
  await expect(page.getByRole('button', { name: 'السابق', exact: true })).toBeDisabled();
  await page.getByLabel('البحث باسم الحملة', { exact: true }).fill('Gluta');
  await page.getByLabel('المصدر', { exact: true }).selectOption('instagram');
  await expect(table.locator('tbody > tr').locator('td').nth(1)).toHaveText('3');
  await page.getByLabel('المصدر', { exact: true }).selectOption('');
  await page.getByLabel('البحث باسم الحملة', { exact: true }).fill('');
  await page.getByLabel('ترتيب حسب', { exact: true }).selectOption('orders');
  await expect(table.locator('tbody > tr').first()).toContainText('Gluta V1');
  await page.getByRole('button', { name: 'التالي', exact: true }).click();
  await expect(table.locator('tbody > tr')).toHaveCount(10);
  await page.screenshot({ path: 'test-results/campaign-performance-desktop.png', fullPage: true });
});
test('links search reaches later pages, shows details on demand and copies the full unchanged URL', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fixture(page);
  await page.getByRole('tab', { name: 'الروابط', exact: true }).click();
  await expect(page.getByLabel('رابط الصفحة التي ستعلن عنها', { exact: true })).toHaveCount(0);
  await page.getByLabel('البحث باسم الحملة', { exact: true }).fill('CAMPAIGN 23');
  await expect(page.locator('.campaign-links-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'نسخ الرابط', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    origin + '/?utm_source=facebook&utm_campaign=Campaign23',
  );
  await page.getByRole('button', { name: 'تفاصيل الرابط: Campaign 23', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'تفاصيل الرابط', exact: true });
  await expect(dialog.getByLabel('رابط الحملة المحفوظ', { exact: true })).toHaveValue(
    origin + '/?utm_source=facebook&utm_campaign=Campaign23',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'تفاصيل الرابط: Campaign 23', exact: true }).click();
  await dialog.getByRole('button', { name: 'حذف الرابط', exact: true }).click();
  await expect(
    page.getByText('لا توجد نتائج تطابق البحث أو الفلاتر.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'الأداء', exact: true }).click();
  await expect(page.locator('.campaign-table')).toContainText('Campaign 23');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'الروابط', exact: true }).click();
  await page.getByRole('button', { name: 'فتح قائمة الإدارة', exact: true }).click();
  await page.getByRole('link', { name: 'نظرة عامة', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'أداء الحملات', exact: true })).toBeVisible();
  await expect(page.locator('.campaign-links-table')).toHaveCount(0);
});
test('creation opens only on request, preserves input after errors, and provides the saved URL after success', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.getByRole('button', { name: 'إنشاء رابط', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'إنشاء رابط', exact: true });
  await form.getByLabel('اسم الحملة (اختياري)', { exact: true }).fill('New Gluta');
  await form.getByRole('button', { name: 'إنشاء الرابط', exact: true }).click();
  const saved = page.getByRole('dialog', { name: 'تفاصيل الرابط', exact: true });
  await expect(saved).toBeVisible();
  await expect(saved.getByLabel('رابط الحملة المحفوظ', { exact: true })).toHaveValue(
    origin + '/?utm_source=facebook&utm_campaign=New%20Gluta',
  );
  expect(f.posts).toHaveLength(1);
  await saved.getByRole('button', { name: 'إغلاق', exact: true }).click();
  f.failCreation();
  await page.getByRole('button', { name: 'إنشاء رابط', exact: true }).click();
  await form.getByLabel('اسم الحملة (اختياري)', { exact: true }).fill('Keep this draft');
  await form.getByRole('button', { name: 'إنشاء الرابط', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('اختر رابطًا من متجرك.');
  await expect(form.getByLabel('اسم الحملة (اختياري)', { exact: true })).toHaveValue(
    'Keep this draft',
  );
  await expect(form.getByRole('button', { name: 'إنشاء الرابط', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/campaign-create-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
for (const [language, tab, search, create] of [
  ['fr', 'Performances', 'Rechercher par nom de campagne', 'Créer un lien'],
  ['en', 'Performance', 'Search by campaign name', 'Create link'],
])
  test('campaign controls are translated in ' + language, async ({ page }) => {
    await fixture(page);
    await page.route('**/api/admin/settings', (route) =>
      route.fulfill({
        json: { settings: { ...defaults, adminLanguage: language }, credentials: [] },
      }),
    );
    await page.evaluate(
      (language) => localStorage.setItem('store-admin-language', language),
      language,
    );
    await page.route('**/api/auth/status', async (route) => {
      const response = await route.fetch();
      return route.fulfill({
        response,
        json: { ...(await response.json()), adminLanguage: language },
      });
    });
    await page.reload();
    await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible();
    await expect(page.getByLabel(search, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: create, exact: true })).toBeVisible();
  });
