import { test, expect } from '@playwright/test';

for (const failure of ['forbidden_origin', 'network'])
  test(`landing quote recovers from ${failure} without claiming an offer changed or clearing customer fields`, async ({
    page,
  }) => {
    let fail = true,
      attempts = 0;
    await page.route('**/api/checkout/quote', async (route) => {
      attempts++;
      if (fail) {
        if (failure === 'network') await route.abort('failed');
        else
          await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'forbidden_origin', message: 'الطلب غير مصرح به.' }),
          });
      } else await route.continue();
    });
    await page.goto('/offers/daily-bag');
    const retry = page.getByRole('button', { name: 'إعادة حساب الإجمالي', exact: true });
    await expect(retry).toBeVisible();
    if (failure === 'network')
      await expect(page.locator('#checkout-error')).toContainText('تعذر الاتصال. حاول مجددًا.');
    await expect(
      page.getByRole('button', { name: 'مراجعة بيانات العرض وتحديثها', exact: true }),
    ).toHaveCount(0);
    await page.locator('input[name=name]').fill('اسم للتجربة');
    await page.locator('input[name=phone]').fill('0612345678');
    await page.locator('input[name=address]').fill('عنوان للتجربة');
    const count = attempts;
    fail = false;
    const quoted = page.waitForResponse(
      (r) => r.url().includes('/api/checkout/quote') && r.status() === 200,
    );
    await retry.click();
    await quoted;
    await expect(page.locator('#checkout-error')).toHaveText('');
    await expect(page.locator('input[name=name]')).toHaveValue('اسم للتجربة');
    await expect(page.locator('input[name=phone]')).toHaveValue('0612345678');
    await expect(page.locator('input[name=address]')).toHaveValue('عنوان للتجربة');
    expect(attempts).toBe(count + 1);
  });
