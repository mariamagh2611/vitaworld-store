import { test, expect, type Page } from '@playwright/test';
const origin = 'http://localhost:8788';
async function owner(page: Page, ip: string) {
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin, 'CF-Connecting-IP': ip },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  return { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
}
test('dashboard counts distinguish sending and fulfilment and provide a separate Mowarid account link', async ({
  page,
}) => {
  await owner(page, '198.18.23.1');
  await page.route('**/api/admin/analytics?**', (route) =>
    route.fulfill({
      json: {
        metrics: {
          orders: 9,
          sent: 6,
          not_sent: 3,
          in_progress: 2,
          delivered: 2,
          profit_paid: 1,
          returned: 1,
          cancelled: 2,
          revenue: 45000,
        },
        campaigns: [],
      },
    }),
  );
  await page.goto('/admin/overview');
  for (const [name, value] of [
    ['مجموع الطلبات', 9],
    ['مرسل لمورد', 6],
    ['غير مرسل لمورد', 3],
    ['قيد التنفيذ', 2],
    ['تم التوصيل', 2],
    ['تم دفع الأرباح', 1],
    ['مرتجع', 1],
  ]) {
    const card = page
      .locator('.metric')
      .filter({ has: page.getByText(String(name), { exact: true }) });
    await expect(card.locator('strong')).toHaveText(String(value));
  }
  await expect(page.locator('.metric').getByText('مؤكدة', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'فتح قائمة الإدارة', exact: true }).click();
  await expect(page.getByRole('link', { name: 'حسابي في مورد', exact: true })).toHaveAttribute(
    'href',
    'https://mowarid.ma/login',
  );
});
test('postponement dates and provider tracking appear in the list and details', async ({
  page,
}) => {
  await owner(page, '198.18.23.2');
  const row = {
    id: 'date-fixture',
    ref: 'REF-DATE',
    status: 'confirmed',
    sync_status: 'sent',
    mowarid_id: 'known',
    shipping_status: 'pending',
    financial_status: 'pending',
    customer: { name: 'Customer', phone: '0612345678', city: 'Rabat', address: 'Address' },
    quote: { total: 15900, shipping: 3000, subtotal: 12900, items: [] },
    remote: {
      status: {
        call_status: 'postponed',
        postponed_note: 'بعد استلام الراتب',
        postponed_until: '2026-10-15T09:00:00.000Z',
        last_call_at: '2026-10-09T11:15:24Z',
      },
      shipping: { tracking_number: 'MA020627135828' },
    },
  };
  await page.route('**/api/admin/orders?**', (route) => route.fulfill({ json: [row] }));
  await page.route('**/api/admin/orders/sync', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/admin/orders');
  const scheduled = 'time[datetime="2026-10-15T09:00:00.000Z"]';
  await expect(page.locator(scheduled)).toBeVisible();
  const expected = await page.evaluate(() =>
    new Date('2026-10-15T09:00:00Z').toLocaleString('ar', {
      timeZone: 'Africa/Casablanca',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  );
  await expect(page.locator(scheduled)).toHaveText(expected);
  await expect(page.getByText('MA020627135828', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'التفاصيل', exact: true }).click();
  await expect(page.getByText('MA020627135828', { exact: true })).toBeVisible();
  await expect(page.locator('.order-followup').locator(scheduled)).toHaveText(expected);
  await expect(page.locator('.order-followup')).toContainText('موعد الاتصال أو التسليم القادم');
  await expect(page.locator('.order-followup')).toContainText('بعد استلام الراتب');
  // Older API snapshots still show the original note; no appointment is invented.
  delete (row.remote.status as any).postponed_until;
  row.remote.status.postponed_note = '15/10/2026';
  await page.goto('/admin/orders');
  await expect(page.getByText('15/10/2026', { exact: true })).toBeVisible();
  await expect(page.locator(scheduled)).toHaveCount(0);
});
test('free shipping never blanks product totals and unrelated revisions refresh silently through increasing and decreasing quantity', async ({
  page,
}) => {
  const headers = await owner(page, '198.18.23.3');
  const settings = (await (await page.request.get('/api/admin/settings')).json()).settings;
  const products = await (await page.request.get('/api/admin/products')).json();
  const product = products.find((p: any) => p.id === 'demo-bag');
  try {
    expect(
      (
        await page.request.put('/api/admin/settings', {
          headers,
          data: { ...settings, cartFreeShippingThreshold: 30000 },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/');
    await page.locator('[data-add-product="demo-bag"]').click();
    await page.goto('/checkout');
    await page.locator('[name=city]').fill('Casablanca');
    await expect(page.locator('#total')).toContainText('169');
    // An admin save changes the internal revision while the customer's price stays 149.
    expect(
      (
        await page.request.put('/api/admin/products/' + product.id, { headers, data: product })
      ).ok(),
    ).toBe(true);
    await page.locator('#checkout-items [data-change="1"]').click();
    await expect(page.locator('#subtotal')).toContainText('258');
    await expect(page.locator('#total')).toContainText('258');
    await expect(page.locator('#checkout-error')).toBeEmpty();
    await page.locator('#checkout-items [data-change="1"]').click();
    await expect(page.locator('#subtotal')).toContainText('447');
    await expect(page.locator('#shipping')).toHaveText('مجاني');
    await expect(page.locator('#total')).toContainText('447');
    await page.locator('#checkout-items [data-change="-1"]').click();
    await expect(page.locator('#shipping')).toHaveText('مجاني');
    await expect(page.locator('#total')).toContainText('258');
    await expect(page.getByRole('button', { name: 'تحديث بيانات السلة', exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator('#checkout-error')).toBeEmpty();
  } finally {
    await page.request.put('/api/admin/settings', { headers, data: settings });
    await page.request.put('/api/admin/products/' + product.id, { headers, data: product });
  }
});
