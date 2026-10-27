import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('owner login, unpublished landing editor preview, and responsive pages', async ({ page }) => {
  const password = 'local-admin-test-password-2026',
    email = 'owner@example.test';
  await page.goto('/admin');
  const status = await (await page.request.get('/api/auth/status')).json();
  if (status.setup) {
    const vars = await readFile('.dev.vars', 'utf8');
    const token = vars.match(/^SETUP_TOKEN=(.+)$/m)![1];
    await page.goto('/admin#setup=' + encodeURIComponent(token));
    await expect(page.getByRole('button', { name: 'إنشاء حسابي' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('رمز التجهيز من إعدادات الخادم')).toHaveCount(0);
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'إظهار كلمة المرور', exact: true }).click();
    await expect(page.getByLabel('كلمة المرور', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'إخفاء كلمة المرور', exact: true }).click();
    await expect(page.getByLabel('كلمة المرور', { exact: true })).toHaveAttribute(
      'type',
      'password',
    );
    await page.getByRole('button', { name: 'إنشاء حسابي' }).click();
    await expect(page.getByText('احفظ وسيلة استعادة حسابك')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'تنزيل ملف الاسترداد' }).click();
    await download;
    await page.getByRole('button', { name: 'حفظت الملف · دخول الإدارة' }).click();
  } else {
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  }
  await expect(page.locator('.admin-header h1')).toHaveText('نظرة عامة');
  await page.getByRole('button', { name: 'فتح قائمة الإدارة', exact: true }).click();
  await page.getByRole('link', { name: 'المنتجات والصفحات', exact: true }).click();
  await page.getByRole('button', { name: 'تعديل', exact: true }).first().click();
  await page.getByRole('button', { name: 'طي جميع الأقسام', exact: true }).click();
  await page.getByRole('button', { name: 'فتح جميع الأقسام', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'طريقة عرض المنتج', exact: true })
    .selectOption('landing');
  await page.getByRole('button', { name: 'زر +', exact: true }).click();
  await page.getByLabel('نص الزر').fill('اختبار معاينة المسودة');
  await page.getByRole('button', { name: 'معاينة المسودة' }).click();
  await expect(
    page
      .frameLocator('iframe[title="معاينة صفحة المنتج"]')
      .getByRole('link', { name: 'اختبار معاينة المسودة' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-mobile.png', fullPage: true });
  await page.goto('/');
  await expect(page.locator('.product-image img').first()).toHaveJSProperty('naturalWidth', 480);
  await page.screenshot({ path: 'test-results/store-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/store-desktop.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('owner sees financial holds and revised delivery totals while retaining the original receipt', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: 'http://localhost:8788' },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  let order: any = {
    id: 'ui-held-order',
    ref: 'REF-HOLD',
    customer: {
      name: 'عميل اختبار التجميد',
      phone: '0612345678',
      city: 'الدار البيضاء',
      address: 'العنوان الأصلي',
      notes: '',
    },
    supplier: 'demo-a',
    status: 'confirmed',
    sync_status: 'sent',
    mowarid_id: 'mw-held-ui',
    shipping_status: 'pending',
    post_attempted: 1,
    quote: { total: 4500, items: [{ name: 'دفتر', quantity: 1 }] },
    attribution: {},
    delivered_total: null,
    hold_reason: 'negative_margin_on_shipping_update',
    remote: {
      status: { shipping_status: 'pending', hold_reason: 'negative_margin_on_shipping_update' },
      customer: { city: 'Rabat', address: 'العنوان المصحح' },
      financials: { total_cod_amount: 45, partner_profit: -10 },
      shipping: { delivery_warning: 'تغيرت الوجهة وتحتاج مراجعة التحصيل' },
    },
  };
  await page.route('**/api/admin/orders?**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([order]) }),
  );
  await page.goto('/admin/orders');
  await expect(page.getByText('موقوف للمراجعة', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'مراجعة التعديل في لوحة مورد' })).toHaveAttribute(
    'href',
    'https://mowarid.ma/dashboard/orders',
  );
  await page.getByRole('button', { name: 'التفاصيل', exact: true }).click();
  await expect(page.getByLabel('مبلغ التحصيل', { exact: true })).toContainText('45');
  order = {
    ...order,
    shipping_status: 'delivered',
    hold_reason: null,
    delivered_total: 5500,
    last_error: 'remote_cod_changed',
    remote: {
      ...order.remote,
      status: { shipping_status: 'delivered', hold_reason: null },
      financials: { total_cod_amount: 55, partner_profit: 0 },
      shipping: {},
    },
  };
  await page.getByRole('button', { name: 'تحديث', exact: true }).click();
  await expect(page.getByText('موقوف للمراجعة', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('مبلغ التحصيل', { exact: true })).toContainText('55');
  await expect(
    page
      .getByText('مبلغ التحصيل الأصلي', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toContainText('45');
  await expect(
    page
      .getByText('المبلغ المرصود عند التسليم', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toContainText('55');
});
