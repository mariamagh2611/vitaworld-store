import { test, expect, type Page } from '@playwright/test';
const origin = 'http://localhost:8788';
async function owner(page: Page, ip: string) {
  const response = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': ip },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(response.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await response.json()).csrf };
}
const html =
  '<div dir="rtl" style="max-width:900px;margin:0 auto;padding:24px;background:#f3f8f3;border:1px solid #d7e6d8;border-right:5px solid #286b3b;border-radius:14px"><h2>المكونات</h2><p>وصف قابل للتعديل</p><ul style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;list-style:none"><li style="padding:14px 16px;border:1px solid #d8e6d9">ميزة أولى</li><li>ميزة ثانية</li><li>ميزة ثالثة</li></ul><div style="display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #d8e6d9"><span>مكوّن تجريبي</span><strong>1 مليار</strong></div></div>';
test('visual HTML editing preserves supplier layout, safely pastes content, and round-trips through source and published description', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.16.1');
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
            pageMode: 'product',
            presentation: {
              ...original.presentation,
              descriptionFormat: 'html',
              descriptionHtml: html,
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
    const editor = page.frameLocator('iframe[title="المحرر البصري · الوصف"]');
    const root = editor.locator('#rich-root');
    await expect(root).toContainText('وصف قابل للتعديل');
    await expect(editor.locator('#rich-root > div')).toHaveCSS('border-right-width', '5px');
    await root.click();
    await root.evaluate((el) => {
      (el as HTMLElement).focus();
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el.querySelector('p')!);
      range.collapse(false);
      const selected = el.ownerDocument.defaultView!.getSelection()!;
      selected.removeAllRanges();
      selected.addRange(range);
    });
    await page.keyboard.type(' نص جديد محفوظ');
    await expect(root).toContainText('نص جديد محفوظ');
    await root.evaluate((el) => {
      const p = el.querySelector('p')!,
        range = el.ownerDocument.createRange();
      range.selectNodeContents(p);
      const selected = el.ownerDocument.defaultView!.getSelection()!;
      selected.removeAllRanges();
      selected.addRange(range);
    });
    await page.getByRole('button', { name: 'عريض', exact: true }).first().click();
    expect(
      await editor
        .locator('p')
        .evaluate((el) =>
          [el, ...el.querySelectorAll('*')].some(
            (node) => getComputedStyle(node).fontWeight === '700',
          ),
        ),
    ).toBe(true);
    await root.evaluate((el) => {
      (el as HTMLElement).focus();
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selected = el.ownerDocument.defaultView!.getSelection()!;
      selected.removeAllRanges();
      selected.addRange(range);
      const clipboard = new DataTransfer();
      clipboard.setData(
        'text/html',
        '<p style="font-style:italic">إضافة آمنة</p><img src="https://invalid.example.test/image.jpg" onerror="top.injectedDescription=true"><script>top.injectedDescription=true</script>',
      );
      el.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }),
      );
    });
    await expect(root).toContainText('إضافة آمنة');
    await expect(root.locator('script,[onerror]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).injectedDescription)).toBeUndefined();
    await page.getByRole('button', { name: 'كود HTML', exact: true }).first().click();
    const source = page.getByLabel('الوصف', { exact: true });
    await expect(source).toHaveValue(/نص جديد محفوظ/);
    expect(await source.inputValue()).toContain('display:grid');
    expect(await source.inputValue()).toContain('border-right:5px');
    await page.getByRole('button', { name: 'تعديل بصري', exact: true }).first().click();
    await expect(root).toContainText('إضافة آمنة');
    await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
    const preview = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(preview.locator('.product-rich-details .formatted-description')).toContainText(
      'نص جديد محفوظ',
    );
    await expect(preview.locator('.product-rich-details .formatted-description > div')).toHaveCSS(
      'border-right-width',
      '5px',
    );
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await preview
          .locator('body')
          .evaluate(
            (el) =>
              el.ownerDocument.documentElement.scrollWidth <=
              el.ownerDocument.defaultView!.innerWidth,
          ),
      ).toBe(true);
    }
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === original.id,
    );
    expect(saved.description).toContain('نص جديد محفوظ');
    expect(saved.presentation.descriptionHtml).toContain('font-style:italic');
    expect(saved.presentation.descriptionHtml).not.toMatch(/onerror|script/);
    await page.goto('/shop/' + original.slug);
    await expect(page.locator('.product-rich-details .formatted-description')).toContainText(
      'إضافة آمنة',
    );
    expect(
      await page
        .locator('.product-rich-details')
        .evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThan(900);
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});
test('draft preview languages update unsaved names and descriptions without altering the store or fixed image landing locale', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.16.2');
  const rows = await (await page.request.get('/api/admin/products')).json(),
    original = rows.find((p: any) => p.id === 'demo-bag');
  const settings = (await (await page.request.get('/api/admin/settings')).json()).settings;
  try {
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, {
          headers,
          data: {
            ...original,
            pageMode: 'product',
            presentation: {
              ...original.presentation,
              landingLanguage: 'ar',
              translations: {
                fr: {
                  name: 'Sac français',
                  descriptionFormat: 'html',
                  descriptionHtml: '<h2>Détails en français</h2>',
                },
                en: { name: 'English bag', description: 'English description' },
              },
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
    await page.getByLabel('اسم المنتج', { exact: true }).fill('اسم عربي غير محفوظ');
    await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
    const preview = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(preview.locator('h1')).toHaveText('اسم عربي غير محفوظ');
    await page.getByLabel('لغة المعاينة', { exact: true }).selectOption('fr');
    await expect(preview.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(preview.locator('h1')).toHaveText('Sac français');
    await expect(preview.locator('.formatted-description')).toHaveText('Détails en français');
    await expect(preview.locator('[data-store-language]')).toHaveCount(0);
    await page.getByLabel('لغة المعاينة', { exact: true }).selectOption('en');
    await expect(preview.locator('h1')).toHaveText('English bag');
    await expect(preview.locator('.product-description')).toHaveText('English description');
    await page.getByLabel('لغة المعاينة', { exact: true }).selectOption('ar');
    await expect(preview.locator('h1')).toHaveText('اسم عربي غير محفوظ');
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await page.getByLabel('طريقة عرض المنتج', { exact: true }).selectOption('landing');
    await expect(page.getByLabel('لغة المعاينة', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
    await expect(preview.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(preview.locator('[data-store-language]')).toHaveCount(0);
    const after = (await (await page.request.get('/api/admin/settings')).json()).settings;
    expect(after.storeLanguage).toBe(settings.storeLanguage);
    expect(after.storeLanguages).toEqual(settings.storeLanguages);
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === original.id,
    );
    expect(saved.name).toBe(original.name);
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});
