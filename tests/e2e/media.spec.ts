import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('long landing images keep their full resolution, original bytes, proportions and adjacent edges', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: 'http://localhost:8788' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  const csrf = (await login.json()).csrf;
  const product = (await (await page.request.get('/api/admin/products')).json())[0];
  await page.goto('/admin/media');
  const media: any[] = [];
  for (const [index, height] of [9320, 11141].entries()) {
    const source = process.env['LANDING_IMAGE_' + (index + 1)];
    const buffer = source
      ? await readFile(source)
      : Buffer.from(
          await page.evaluate(async (height) => {
            const canvas = document.createElement('canvas');
            canvas.width = 1080;
            canvas.height = height;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#1672b8';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ffffff';
            ctx.font = '48px sans-serif';
            for (let y = 100; y < height; y += 250)
              ctx.fillText('Landing image · full width · ' + y, 30, y);
            const blob = await new Promise<Blob>((done) =>
              canvas.toBlob((b) => done(b!), 'image/webp', 0.9),
            );
            return Array.from(new Uint8Array(await blob.arrayBuffer()));
          }, height),
        );
    const uploading = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/media') && r.request().method() === 'POST',
    );
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'landing.webp', mimeType: 'image/webp', buffer });
    const response = await uploading;
    expect(response.status()).toBe(200);
    const item = await response.json();
    expect(item.width).toBe(1080);
    expect(item.height).toBe(height);
    const stored = await page.request.get(item.url);
    expect(await stored.body()).toEqual(buffer);
    media.push(item);
    // Dimensions cannot be forged to bypass upload limits or break layout reservation.
    const invalid = await page.request.post('/api/admin/media', {
      headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
      multipart: {
        file: { name: 'image.webp', mimeType: 'image/webp', buffer },
        width: '1',
        height: '1',
      },
    });
    expect(invalid.status()).toBe(400);
  }
  try {
    const updated = {
      ...product,
      pageMode: 'landing',
      blocks: media.map((m, i) => ({
        id: crypto.randomUUID(),
        type: 'IMAGE',
        enabled: true,
        order: i,
        settings: { image: m.url, width: m.width, height: m.height, alt: 'Full long image ' + i },
      })),
    };
    const save = await page.request.put('/api/admin/products/' + product.id, {
      headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
      data: updated,
    });
    expect(save.ok()).toBe(true);
    await page.goto('/products/' + product.slug);
    const first = page.locator('.image-slice').nth(0),
      second = page.locator('.image-slice').nth(1);
    await expect(first).toHaveJSProperty('naturalHeight', 9320);
    await second.scrollIntoViewIfNeeded();
    await expect(second).toHaveJSProperty('naturalHeight', 11141);
    const a = (await first.boundingBox())!,
      b = (await second.boundingBox())!;
    expect(Math.abs(a.height / a.width - 9320 / 1080)).toBeLessThan(0.01);
    expect(Math.abs(b.height / b.width - 11141 / 1080)).toBeLessThan(0.01);
    expect(Math.abs(b.y - a.y - a.height)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await page.request.put('/api/admin/products/' + product.id, {
      headers: { Origin: 'http://localhost:8788', 'X-CSRF-Token': csrf },
      data: product,
    });
  }
});
