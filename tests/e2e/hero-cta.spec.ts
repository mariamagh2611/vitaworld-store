import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const origin = 'http://localhost:8788';
async function owner(page: Page) {
  const account = { email: 'owner@example.test', password: 'local-admin-test-password-2026' };
  if ((await (await page.request.get('/api/auth/status')).json()).setup) {
    const token = (await readFile('.dev.vars', 'utf8')).match(/^SETUP_TOKEN=(.+)$/m)![1];
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
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.96.1' },
    data: account,
  });
  expect(login.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
}
test('both homepage cards can be uploaded, saved, kept through cart filtering and reset independently', async ({
  page,
}) => {
  const headers = await owner(page),
    original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const images: string[] = [];
  try {
    await page.goto('/admin/appearance');
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 80;
      const g = c.getContext('2d')!;
      g.fillStyle = '#e8b4ca';
      g.fillRect(0, 0, 80, 80);
      return c.toDataURL('image/png').split(',')[1];
    });
    for (const [index, label] of ['تغيير الصورة الأولى', 'تغيير الصورة الثانية'].entries()) {
      await page.getByLabel(label, { exact: true }).setInputFiles({
        name: 'hero-' + index + '.png',
        mimeType: 'image/png',
        buffer: Buffer.from(png, 'base64'),
      });
      const image = page.locator('.hero-card-setting').nth(index).locator('img');
      await expect(image).toBeVisible();
      images.push((await image.getAttribute('src'))!);
    }
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByText('تم حفظ التغييرات.', { exact: true })).toBeVisible();
    const saved = (await (await page.request.get('/api/admin/settings')).json()).settings;
    expect(saved.home.heroCardImages).toEqual(images);
    const legacy = structuredClone(saved);
    delete legacy.home.heroCardImages;
    expect((await page.request.put('/api/admin/settings', { headers, data: legacy })).ok()).toBe(
      true,
    );
    expect(
      (await (await page.request.get('/api/admin/settings')).json()).settings.home.heroCardImages,
    ).toEqual(images);
    for (const query of ['', '?lang=fr']) {
      await page.goto('/' + query);
      await expect(page.locator('[data-hero-product]')).toHaveCount(2);
      for (const index of [0, 1])
        await expect(page.locator(`[data-hero-index="${index}"] img`)).toHaveAttribute(
          'src',
          images[index],
        );
    }
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.locator('[data-hero-product]').evaluateAll((cards) =>
        cards.map((card) => {
          const image = card.querySelector('img')!;
          const style = getComputedStyle(card);
          return {
            background: style.backgroundColor,
            padding: style.padding,
            ratio: image.clientWidth / image.clientHeight,
            naturalRatio: image.naturalWidth / image.naturalHeight,
          };
        }),
      );
      for (const card of geometry) {
        expect(card.background).toBe('rgba(0, 0, 0, 0)');
        expect(card.padding).toBe('0px');
        expect(card.ratio).toBeCloseTo(card.naturalRatio, 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.locator('.shop-hero').screenshot({ path: `test-results/hero-${width}.png` });
    }
    await page.goto('/');
    await page.locator('[data-add-product="demo-candle"]').click();
    for (const index of [0, 1]) {
      await expect(page.locator(`[data-hero-index="${index}"]`)).toBeVisible();
      await expect(page.locator(`[data-hero-index="${index}"] img`)).toHaveAttribute(
        'src',
        images[index],
      );
    }
    await page.goto('/admin/appearance');
    await page
      .locator('.hero-card-setting')
      .first()
      .getByRole('button', { name: 'استخدام صورة المنتج تلقائيًا', exact: true })
      .click();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByText('تم حفظ التغييرات.', { exact: true })).toBeVisible();
    await page.goto('/');
    await expect(page.locator('[data-hero-index="0"]')).not.toHaveAttribute(
      'data-hero-custom',
      'true',
    );
    await expect(page.locator('[data-hero-index="1"] img')).toHaveAttribute('src', images[1]);
  } finally {
    await page.request.put('/api/admin/settings', { headers, data: original });
    for (const image of images)
      await page.request.delete('/api/admin/media/' + image.split('/').pop(), { headers });
  }
});
test('CTA duplication preserves all controls, inserts an independent button in order, and survives saving', async ({
  page,
}) => {
  const headers = await owner(page),
    original = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === 'demo-bag',
    );
  try {
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, {
          headers,
          data: { ...original, pageMode: 'landing', blocks: [] },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: original.sku })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    const editor = page.locator('.product-customization');
    await editor.getByRole('button', { name: 'زر +', exact: true }).click();
    const background = editor.getByLabel('خلفية المساحة حول الزر', { exact: true });
    await background.fill('#fff1f8');
    await editor.getByLabel('لون الزر', { exact: true }).fill('#770044');
    await editor.getByLabel('لون النص', { exact: true }).fill('#ffffee');
    await editor.getByLabel('نص الزر', { exact: true }).fill('اطلب الآن');
    await editor.getByLabel('حجم النص', { exact: true }).fill('21');
    await editor.getByLabel('المسافة حول الزر', { exact: true }).fill('32');
    await editor.getByRole('button', { name: 'استمارة +', exact: true }).click();
    const blocks = editor.locator('.editor-block');
    await blocks.first().getByLabel('ظاهر', { exact: true }).uncheck();
    await blocks.first().getByRole('button', { name: 'نسخ الزر', exact: true }).click();
    await expect(blocks).toHaveCount(3);
    await expect(blocks.nth(1).getByLabel('ظاهر', { exact: true })).not.toBeChecked();
    for (const block of [blocks.first(), blocks.nth(1)]) {
      await expect(block.getByLabel('نص الزر', { exact: true })).toHaveValue('اطلب الآن');
      await expect(block.getByLabel('لون الزر', { exact: true })).toHaveValue('#770044');
      await expect(block.getByLabel('لون النص', { exact: true })).toHaveValue('#ffffee');
      await expect(block.getByLabel('خلفية المساحة حول الزر', { exact: true })).toHaveValue(
        '#fff1f8',
      );
      await expect(block.getByLabel('حجم النص', { exact: true })).toHaveValue('21');
      await expect(block.getByLabel('المسافة حول الزر', { exact: true })).toHaveValue('32');
      await block.getByLabel('ظاهر', { exact: true }).check();
    }
    await blocks.nth(1).getByLabel('نص الزر', { exact: true }).fill('نسخة مستقلة');
    await expect(blocks.first().getByLabel('نص الزر', { exact: true })).toHaveValue('اطلب الآن');
    await expect(
      editor.getByRole('button', { name: 'استخدام خلفية الصفحة', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'معاينة المسودة', exact: true }).click();
    const frame = page.frameLocator('iframe[title="معاينة صفحة المنتج"]');
    await expect(frame.locator('.cta-block')).toHaveCount(2);
    await expect(frame.locator('.cta-block').first()).toHaveCSS(
      'background-color',
      'rgb(255, 241, 248)',
    );
    await expect(frame.locator('.cta-block a').first()).toHaveCSS(
      'background-color',
      'rgb(119, 0, 68)',
    );
    await page.getByRole('button', { name: 'إغلاق المعاينة', exact: true }).click();
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByText('تم حفظ المنتج.', { exact: true })).toBeVisible();
    await page.goto('/offers/daily-bag');
    await expect(page.locator('.cta-block')).toHaveCount(2);
    await expect(page.locator('.cta-block').first()).toHaveCSS(
      'background-color',
      'rgb(255, 241, 248)',
    );
    for (const button of await page.locator('.cta-block a').all()) {
      await button.click();
      await expect(page.locator('#order-form')).toBeInViewport();
    }
    const saved = (await (await page.request.get('/api/admin/products')).json()).find(
      (p: any) => p.id === original.id,
    );
    expect(saved.blocks[0].settings.backgroundColor).toBe('#fff1f8');
    expect(saved.blocks.map((b: any) => b.type)).toEqual(['CTA', 'CTA', 'ORDER_FORM']);
    expect(saved.blocks.map((b: any) => b.order)).toEqual([0, 1, 2]);
    expect(new Set(saved.blocks.map((b: any) => b.id)).size).toBe(3);
    expect(saved.blocks[1].settings).toEqual({ ...saved.blocks[0].settings, text: 'نسخة مستقلة' });
    await page.goto('/admin/products');
    await page
      .locator('tbody tr')
      .filter({ hasText: original.sku })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    await expect(blocks.nth(1).getByLabel('نص الزر', { exact: true })).toHaveValue('نسخة مستقلة');
    const nearLimit = Array.from({ length: 47 }, (_, index) => ({
      id: 'image-' + index,
      type: 'IMAGE',
      order: index + 1,
      enabled: false,
      settings: {},
    }));
    expect(
      (
        await page.request.put('/api/admin/products/' + original.id, {
          headers,
          data: {
            ...saved,
            blocks: [saved.blocks[0], ...nearLimit, { ...saved.blocks[2], order: 48 }],
          },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await page
      .locator('tbody tr')
      .filter({ hasText: original.sku })
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();
    await page.getByRole('button', { name: 'تعديل صفحة الهبوط', exact: true }).click();
    await blocks.first().getByRole('button', { name: 'نسخ الزر', exact: true }).click();
    await expect(blocks).toHaveCount(50);
    await expect(
      blocks.first().getByRole('button', { name: 'نسخ الزر', exact: true }),
    ).toBeDisabled();
    await expect(editor.getByRole('button', { name: 'زر +', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'حفظ المنتج', exact: true }).click();
    await expect(page.getByText('تم حفظ المنتج.', { exact: true })).toBeVisible();
  } finally {
    await page.request.put('/api/admin/products/' + original.id, { headers, data: original });
  }
});
