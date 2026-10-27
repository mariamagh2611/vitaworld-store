import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('policy switches preserve text, hide all links, and render readable Arabic and French on phones', async ({
  page,
}) => {
  const origin = 'http://localhost:8788';
  const account = { email: 'owner@example.test', password: 'local-admin-test-password-2026' };
  const status = await (await page.request.get('/api/auth/status')).json();
  if (status.setup) {
    const vars = await readFile('.dev.vars', 'utf8');
    const token = vars.match(/^SETUP_TOKEN=(.+)$/m)![1];
    expect(
      (
        await page.request.post('/api/auth/setup', {
          headers: { Origin: origin },
          data: { ...account, token },
        })
      ).ok(),
    ).toBe(true);
  }
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin },
    data: account,
  });
  expect(login.ok()).toBe(true);
  const headers = { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const source =
    '# الشروط والأحكام — متجرنا\n\nأهلًا بك في **متجرنا**.\n\n### 1. المنتجات\n\n** أولوياتنا.**\n\n- تفاصيل واضحة\n- أسعار واضحة\n\n[تواصل معنا](https://example.test/contact)';
  try {
    const response = await page.request.put('/api/admin/settings', {
      headers,
      data: {
        ...original,
        storeLanguage: 'ar',
        storeLanguages: ['ar', 'fr'],
        adminLanguage: 'ar',
        terms: source,
        policyVisibility: { terms: true, privacy: true, returns: true, contact: true },
        contentTranslations: {
          ...original.contentTranslations,
          ar: { ...original.contentTranslations?.ar, terms: source },
          fr: {
            ...original.contentTranslations?.fr,
            terms: '## Conditions\n\n**Livraison**\n\n- Premier point\n- Deuxième point',
          },
        },
      },
    });
    expect(response.ok()).toBe(true);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/policies/terms');
      await expect(page.locator('.policy-heading h1')).toHaveText('الشروط والأحكام');
      await expect(page.locator('.policy-content h3')).toHaveText('1. المنتجات');
      await expect(page.locator('.policy-content strong').last()).toHaveText('أولوياتنا.');
      await expect(page.locator('.policy-content li')).toHaveCount(2);
      const sizes = await page.locator('.policy-heading h1').evaluate((el) => ({
        heading: parseFloat(getComputedStyle(el).fontSize),
        body: parseFloat(getComputedStyle(document.querySelector('.policy-content')!).fontSize),
      }));
      expect(sizes.heading).toBeGreaterThan(sizes.body);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width !== 320)
        await page.screenshot({ path: 'test-results/policy-' + width + '.png', fullPage: true });
    }
    await page.goto('/policies/terms?lang=fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('.policy-content h2')).toHaveText('Conditions');
    await page.goto('/admin/settings');
    for (const name of ['الشروط', 'الخصوصية', 'الاسترجاع', 'اتصل بنا'])
      await page.getByLabel('إظهار صفحة ' + name, { exact: true }).uncheck();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    await page.reload();
    await expect(page.getByLabel('الشروط', { exact: true })).toHaveValue(source);
    for (const path of ['/', '/shop/daily-bag', '/offers/daily-bag']) {
      expect((await page.goto(path))!.ok()).toBe(true);
      expect(await page.locator('a[href*="/policies/"]').count()).toBe(0);
    }
    for (const key of ['terms', 'privacy', 'returns', 'contact']) {
      expect((await page.request.get('/policies/' + key)).status()).toBe(404);
      expect((await page.request.get('/offers/daily-bag/policies/' + key)).status()).toBe(404);
    }
    await page.goto('/admin/settings');
    await page.getByLabel('إظهار صفحة الشروط', { exact: true }).check();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ التغييرات.');
    await page.goto('/policies/terms?lang=ar');
    await expect(page.locator('.policy-content h3')).toHaveText('1. المنتجات');
  } finally {
    expect((await page.request.put('/api/admin/settings', { headers, data: original })).ok()).toBe(
      true,
    );
  }
});
