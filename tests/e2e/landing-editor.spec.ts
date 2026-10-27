import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const origin = 'http://localhost:8788';
async function owner(page: Page) {
  const account = { email: 'owner@example.test', password: 'local-admin-test-password-2026' };
  const status = await (await page.request.get('/api/auth/status')).json();
  if (status.setup) {
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
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.74.1' },
    data: account,
  });
  expect(login.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
}
async function edit(page: Page, sku: string) {
  await page.goto('/admin/products');
  await page
    .locator('tbody tr')
    .filter({ hasText: sku })
    .getByRole('button', { name: 'تعديل', exact: true })
    .click();
}

test('landing editor uploads images and edits buttons and language while retaining a regular primary product page', async ({
  page,
}) => {
  const headers = await owner(page);
  const original = (await (await page.request.get('/api/admin/products')).json()).find(
    (p: any) => p.id === 'demo-bag',
  );
  let media = '';
  try {
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, {
          headers,
          data: { ...original, pageMode: 'product', blocks: [] },
        })
      ).ok(),
    ).toBe(true);
    await edit(page, original.sku);
    await expect(page.getByLabel('طريقة عرض المنتج', { exact: true })).toHaveValue('product');
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    const editor = page.locator('.product-customization');
    await expect(editor.getByLabel('لغة اللاندينج باج', { exact: true })).toBeVisible();
    expect(
      await page.locator('.product-optional-section').getByLabel('لغة اللاندينج باج').count(),
    ).toBe(0);
    await editor.getByLabel('لغة اللاندينج باج', { exact: true }).selectOption('fr');
    await editor.getByRole('button', { name: 'صورة +', exact: true }).click();
    const imageBlock = editor.locator('.editor-block').first();
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 1800;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#e8eddb';
      ctx.fillRect(0, 0, 900, 1800);
      ctx.fillStyle = '#173d35';
      ctx.fillRect(50, 50, 800, 700);
      return c.toDataURL('image/png').split(',')[1];
    });
    const uploaded = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/media') && r.request().method() === 'POST',
    );
    await imageBlock.locator('input[type=file]').setInputFiles({
      name: 'landing-test.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
    const response = await uploaded;
    expect(response.ok()).toBe(true);
    media = (await response.json()).url;
    await expect(imageBlock.getByLabel('رابط الصورة', { exact: true })).toHaveValue(media);
    await editor.getByRole('button', { name: 'زر +', exact: true }).click();
    await editor.getByLabel('نص الزر', { exact: true }).fill('Commander maintenant');
    await editor.getByRole('button', { name: 'استمارة +', exact: true }).click();
    await editor.getByRole('button', { name: 'معاينة صفحة الهبوط', exact: true }).click();
    const preview = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(preview.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(preview.locator('img.image-slice')).toHaveCount(1);
    await expect(
      preview.getByRole('link', { name: 'Commander maintenant', exact: true }),
    ).toBeVisible();
    await expect(preview.locator('#checkout-form')).toBeVisible();
    await expect(page.getByLabel('طريقة عرض المنتج', { exact: true })).toHaveValue('product');
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === original.id,
    );
    expect(saved.pageMode).toBe('product');
    expect(saved.presentation.landingLanguage).toBe('fr');
    expect(saved.blocks.map((b: any) => b.type)).toEqual(['IMAGE', 'CTA', 'ORDER_FORM']);
    const protectedImage = await page.request.delete('/api/admin/media/' + media.split('/').pop(), {
      headers,
    });
    expect(protectedImage.status()).toBe(400);
    expect((await protectedImage.json()).error).toBe('media_in_use');
    await page.goto('/shop/' + saved.slug);
    await expect(page.locator('.image-slice')).toHaveCount(0);
    await page.goto('/offers/' + saved.slug);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('img.image-slice')).toHaveAttribute('src', media);
    await expect
      .poll(() =>
        page
          .locator('img.image-slice')
          .evaluate((img: HTMLImageElement) => img.naturalHeight > img.naturalWidth),
      )
      .toBe(true);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole('link', { name: 'Commander maintenant', exact: true }).click();
      await expect(page.locator('#checkout-form')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: 'test-results/landing-editor-' + width + '.png',
        fullPage: true,
      });
    }
    await edit(page, original.sku);
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    await expect(
      page.locator('.product-customization').getByLabel('رابط الصورة', { exact: true }),
    ).toHaveValue(media);
  } finally {
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, { headers, data: original })
      ).ok(),
    ).toBe(true);
    if (media)
      expect(
        (await page.request.delete('/api/admin/media/' + media.split('/').pop(), { headers })).ok(),
      ).toBe(true);
  }
});

test('featured products get their badge and priority, and bundle profit shows the complete quantity', async ({
  page,
}) => {
  const headers = await owner(page);
  const rows = await (await page.request.get('/api/admin/products')).json();
  const bag = rows.find((p: any) => p.id === 'demo-bag'),
    candle = rows.find((p: any) => p.id === 'demo-candle');
  try {
    for (const product of [bag, candle])
      expect(
        (
          await page.request.put('/api/admin/products/' + product.id, {
            headers,
            data: { ...product, featured: 0 },
          })
        ).ok(),
      ).toBe(true);
    await edit(page, candle.sku);
    await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
    await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
    await page.getByLabel('منتج مميز', { exact: true }).check();
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    await page.goto('/');
    const card = page.locator('[data-product-card="demo-candle"]');
    await expect(card.locator('.product-badge')).toBeVisible();
    const order = await page
      .locator('[data-product-card]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-product-card')));
    expect(order.indexOf(candle.id)).toBeLessThan(order.indexOf(bag.id));
    await edit(page, bag.sku);
    await page.getByLabel('السعر الأصلي بالدرهم', { exact: true }).fill('160');
    await page.getByLabel('بيع المنتج بالباقات', { exact: true }).check();
    const bundle = page.locator('.bundle-edit-row').first();
    await bundle.getByLabel('الكمية', { exact: true }).fill('2');
    await bundle.getByLabel('سعر الباقة بالدرهم', { exact: true }).fill('280');
    await bundle.getByRole('combobox').selectOption('inherit');
    await expect(bundle.locator('.profit-line')).toContainText(
      'إجمالي الربح الصافي للباقة (تقريبي)',
    );
    await expect(bundle.locator('.profit-total strong')).toContainText('120');
    await expect(bundle.locator('.profit-unit strong')).toContainText('60');
    await expect(bundle.locator('.profit-scope')).toContainText('2');
    await bundle.getByLabel('الكمية', { exact: true }).fill('3');
    await expect(bundle.locator('.profit-total strong')).toContainText('40');
    await bundle.getByRole('combobox').selectOption('free');
    await expect(bundle.locator('.profit-total strong')).toContainText('10');
  } finally {
    for (const product of [bag, candle])
      expect(
        (
          await page.request.put('/api/admin/products/' + product.id, { headers, data: product })
        ).ok(),
      ).toBe(true);
  }
});

test('landing form colors persist independently of regular checkout and another product', async ({
  page,
}) => {
  const headers = await owner(page);
  const rows = await (await page.request.get('/api/admin/products')).json();
  const bag = rows.find((p: any) => p.id === 'demo-bag');
  const candle = rows.find((p: any) => p.id === 'demo-candle');
  const colors: Record<string, string> = {
    'خلفية منطقة الطلب': '#eed2db',
    'خلفية الاستمارة والملخص والباقات': '#fff0f4',
    'لون العناوين والنصوص': '#572239',
    'لون النصوص الثانوية': '#805766',
    'خلفية الخانات': '#fff8fb',
    'لون النص داخل الخانات': '#43152d',
    'لون النص الإرشادي داخل الخانات': '#886478',
    'لون حدود الخانات والبطاقات': '#c798ad',
    'لون تحديد الباقة المختارة': '#af3971',
    'خلفية زر تأكيد الطلب': '#95205b',
    'لون نص زر تأكيد الطلب': '#fff1d5',
  };
  const appearance = async () =>
    page.locator('#order-form').evaluate((el) => {
      const input = el.querySelector('input[name=name]')!;
      const button = el.querySelector('.submit-order')!;
      const css = (node: Element) => getComputedStyle(node);
      return {
        background: css(el).backgroundColor,
        surface: css(el.querySelector('#checkout-form')!).backgroundColor,
        text: css(el).color,
        fieldBackground: css(input).backgroundColor,
        fieldText: css(input).color,
        placeholder: getComputedStyle(input, '::placeholder').color,
        border: css(input).borderColor,
        buttonBackground: css(button).backgroundColor,
        buttonText: css(button).color,
      };
    });
  try {
    await page.goto('/checkout?product=' + bag.id);
    const regular = await appearance();
    await page.goto('/offers/' + candle.slug);
    const other = await appearance();
    await edit(page, bag.sku);
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    const editor = page.locator('.landing-form-appearance');
    for (const [label, color] of Object.entries(colors)) {
      await editor.getByLabel(label, { exact: true }).evaluate((el, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, color);
      await expect(editor.getByLabel(label, { exact: true })).toHaveValue(color);
    }
    await page.getByRole('button', { name: 'معاينة صفحة الهبوط', exact: true }).click();
    const preview = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(preview.locator('#order-form')).toHaveCSS(
      'background-color',
      'rgb(238, 210, 219)',
    );
    await page.getByRole('button', { name: 'إغلاق المعاينة', exact: true }).click();
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === bag.id,
    );
    expect(saved.presentation.landingFormAppearance.background).toBe('#eed2db');
    await page.goto('/offers/' + bag.slug);
    expect(await appearance()).toEqual({
      background: 'rgb(238, 210, 219)',
      surface: 'rgb(255, 240, 244)',
      text: 'rgb(87, 34, 57)',
      fieldBackground: 'rgb(255, 248, 251)',
      fieldText: 'rgb(67, 21, 45)',
      placeholder: 'rgb(136, 100, 120)',
      border: 'rgb(199, 152, 173)',
      buttonBackground: 'rgb(149, 32, 91)',
      buttonText: 'rgb(255, 241, 213)',
    });
    await expect(page.locator('.order-summary')).toHaveCSS(
      'background-color',
      'rgb(255, 240, 244)',
    );
    await expect(page.locator('.offer-card').first()).toHaveCSS(
      'border-color',
      'rgb(175, 57, 113)',
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: 'test-results/landing-colors-' + width + '.png',
        fullPage: true,
      });
    }
    await page.goto('/checkout?product=' + bag.id);
    expect(await appearance()).toEqual(regular);
    await page.goto('/offers/' + candle.slug);
    expect(await appearance()).toEqual(other);
    await edit(page, bag.sku);
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    await expect(editor.getByLabel('لون النص داخل الخانات', { exact: true })).toHaveValue(
      '#43152d',
    );
  } finally {
    expect(
      (await page.request.put('/api/admin/products/' + bag.id, { headers, data: bag })).ok(),
    ).toBe(true);
  }
});

test('landing footer switches preserve store contacts and the floating WhatsApp button', async ({
  page,
}) => {
  const headers = await owner(page);
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const rows = await (await page.request.get('/api/admin/products')).json();
  const bag = rows.find((p: any) => p.id === 'demo-bag');
  const phoneLabel = 'إظهار الهاتف والبريد أسفل صفحة الهبوط';
  const socialsLabel = 'إظهار روابط التواصل الاجتماعي أسفل صفحة الهبوط';
  async function save(contact: boolean, socials: boolean) {
    await edit(page, bag.sku);
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    await page.getByLabel(phoneLabel, { exact: true }).setChecked(contact);
    await page.getByLabel(socialsLabel, { exact: true }).setChecked(socials);
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تم حفظ المنتج.');
  }
  try {
    expect(
      (
        await page.request.put('/api/admin/settings', {
          headers,
          data: {
            ...original,
            contactEmail: 'merchant@example.test',
            contactPhone: '+212600000001',
            whatsapp: '212600000002',
            socials: { ...original.socials, facebook: 'https://facebook.com/example-store' },
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/offers/' + bag.slug);
    await expect(page.locator('.landing-footer a[href^="tel:"]')).toBeVisible();
    await expect(
      page.locator('.landing-footer .social-links a[aria-label="facebook"]'),
    ).toBeVisible();
    await save(false, true);
    await page.goto('/offers/' + bag.slug);
    await expect(page.locator('.landing-footer a[href^="tel:"]')).toHaveCount(0);
    await expect(page.locator('.landing-footer a[href^="mailto:"]')).toHaveCount(0);
    await expect(page.locator('.landing-footer .social-links')).toBeVisible();
    await save(true, false);
    await page.goto('/offers/' + bag.slug);
    await expect(page.locator('.landing-footer a[href^="tel:"]')).toBeVisible();
    await expect(page.locator('.landing-footer .social-links')).toHaveCount(0);
    await save(false, false);
    await edit(page, bag.sku);
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    await expect(page.getByLabel(phoneLabel, { exact: true })).not.toBeChecked();
    await expect(page.getByLabel(socialsLabel, { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'معاينة صفحة الهبوط', exact: true }).click();
    const preview = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(preview.locator('.landing-footer .store-contacts')).toHaveCount(0);
    await expect(preview.locator('a.whatsapp')).toBeVisible();
    for (const path of ['/offers/' + bag.slug, '/offers/' + bag.slug + '/policies/terms']) {
      await page.goto(path);
      await expect(page.locator('.landing-footer .store-contacts')).toHaveCount(0);
      await expect(page.locator('a.whatsapp')).toBeVisible();
    }
    await page.goto('/shop/' + bag.slug);
    await expect(page.locator('.store-footer a[href^="tel:"]')).toBeVisible();
    await expect(
      page.locator('.store-footer .social-links a[aria-label="facebook"]'),
    ).toBeVisible();
    await page.goto('/offers/calm-candle');
    await expect(page.locator('.landing-footer a[href^="tel:"]')).toBeVisible();
    await expect(page.locator('.landing-footer .social-links')).toBeVisible();
    const savedSettings = (await (await page.request.get('/api/admin/settings')).json()).settings;
    expect(savedSettings.contactPhone).toBe('+212600000001');
    expect(savedSettings.contactEmail).toBe('merchant@example.test');
    expect(savedSettings.whatsapp).toBe('212600000002');
  } finally {
    expect(
      (await page.request.put('/api/admin/products/' + bag.id, { headers, data: bag })).ok(),
    ).toBe(true);
    expect((await page.request.put('/api/admin/settings', { headers, data: original })).ok()).toBe(
      true,
    );
  }
});
