import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const fixture = {
  id: 'receipt-fixture',
  ref: 'REF-RECEIPT',
  created_at: '2026-10-09T11:09:00Z',
  status: 'confirmed',
  sync_status: 'sent',
  mowarid_id: 'own-order',
  post_attempted: 1,
  shipping_status: 'pending',
  financial_status: 'pending',
  attribution: {},
  delivered_total: null,
  customer: {
    name: 'Customer',
    phone: '0612345678',
    city: 'CASABLANCA',
    address: 'Test address',
    notes: '',
  },
  quote: {
    storeIdentity: { name: 'My shop', url: 'https://shop.test' },
    total: 27800,
    subtotal: 25800,
    shipping: 2000,
    items: [
      {
        productId: 'p',
        sku: 'A',
        name: 'Probiotic – Soutien Digestif 10 Milliards',
        quantity: 2,
        unitPrice: 12900,
        subtotal: 25800,
      },
    ],
  },
  remote: {
    order_number: 'MDK-2026-00379',
    timestamps: { updated_at: '2026-10-10T08:15:24Z' },
    status: {
      order_status: 'pending',
      call_status: 'call_attempt_1',
      last_call_at: '2026-10-09T11:15:24Z',
    },
    financials: {
      products_subtotal: 258,
      customer_shipping_fee: 20,
      total_cod_amount: 278,
      wholesale_subtotal: 158,
      platform_shipping_cost: 20,
      partner_profit: 100,
    },
    items: [{ sku: 'A', quantity: 2, selling_price: 129, fulfillment_price: 79, subtotal: 258 }],
  },
};
async function prepare(page: Page, row: any, ip: string) {
  if ((await (await page.request.get('/api/auth/status')).json()).setup) {
    const token = (await readFile('.dev.vars', 'utf8')).match(/^SETUP_TOKEN=(.+)$/m)![1];
    expect(
      (
        await page.request.post('/api/auth/setup', {
          headers: { Origin: 'http://localhost:8788' },
          data: { email: 'owner@example.test', password: 'local-admin-test-password-2026', token },
        })
      ).ok(),
    ).toBe(true);
  }
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: 'http://localhost:8788', 'CF-Connecting-IP': ip },
    data: { email: 'owner@example.test', password: 'local-admin-test-password-2026' },
  });
  expect(login.ok()).toBe(true);
  await page.route('**/api/admin/orders?**', (route) => route.fulfill({ json: [row] }));
  await page.route('**/api/admin/orders/sync', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/admin/orders');
}
test('calls and actions are visible, coloured and customer receipts download as a private PNG', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page, fixture, '198.18.22.1');
  const row = page.locator('.admin-orders-table tbody tr');
  await expect(row.getByText('محاولة الاتصال الأولى', { exact: true })).toBeVisible();
  await expect(row.locator('.status-warning').first()).toHaveCSS('color', 'rgb(168, 82, 5)');
  await expect(
    row.getByRole('link', { name: 'واتساب', exact: true }).locator('svg path'),
  ).toHaveCount(1);
  await expect(row.getByRole('button', { name: 'التفاصيل', exact: true })).toHaveCSS(
    'border-top-width',
    '1px',
  );
  await page.screenshot({ path: 'test-results/order-actions-and-calls.png', fullPage: true });
  await row.getByRole('button', { name: 'وصل الشراء', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'وصل الشراء للزبون', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.receipt-items tbody tr')).toContainText('129');
  await expect(dialog.locator('.receipt-items tbody tr')).toContainText('258');
  await expect(dialog.locator('.receipt-totals')).toContainText('278');
  for (const text of ['تكلفة', 'الربح', 'مورد', '158'])
    expect(await dialog.innerText()).not.toContain(text);
  await page.screenshot({ path: 'test-results/customer-receipt-preview.png' });
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'تنزيل الوصل كصورة', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('receipt-MDK-2026-00379.png');
  await download.saveAs('test-results/customer-receipt.png');
  const bytes = await readFile('test-results/customer-receipt.png');
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16)).toBe(1600);
  expect(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20),
  ).toBeGreaterThan(1000);
  await dialog.getByRole('button', { name: 'إغلاق', exact: true }).last().click();
  await row.getByRole('button', { name: 'التفاصيل', exact: true }).click();
  await expect(page.getByText('آخر تحديث', { exact: true })).toBeVisible();
  await expect(page.locator('.order-cancellation-reason')).toHaveCount(0);
  await expect(page.getByText('آخر محاولة اتصال', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'تتبع الطلب بمورد', exact: true })).toHaveAttribute(
    'href',
    'https://mowarid.ma/dashboard/orders/MDK-2026-00379',
  );
  await expect(
    page.locator('.order-facts').getByText('محاولة الاتصال الأولى', { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.order-customer-card').getByRole('link', { name: 'واتساب', exact: true }),
  ).toContainText('واتساب');
  await expect(page.getByRole('button', { name: 'العودة إلى الطلبات', exact: true })).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
});
test('cancelled orders keep receipt prices, show red status and never pending calls or false price warnings', async ({
  page,
}) => {
  const cancelled = {
    ...fixture,
    shipping_status: 'cancelled',
    financial_status: 'cancelled',
    last_error: 'remote_cod_changed',
    remote: {
      ...fixture.remote,
      status: {
        ...fixture.remote.status,
        order_status: 'cancelled',
        call_status: 'pending',
        cancellation_reason: 'الزبون ينكر الطلب (لم يسبق له الطلب) <img src=x onerror=alert(1)>',
      },
      financials: {
        products_subtotal: 0,
        customer_shipping_fee: 0,
        total_cod_amount: 0,
        wholesale_subtotal: 0,
        platform_shipping_cost: 0,
        partner_profit: 0,
      },
    },
  };
  await prepare(page, cancelled, '198.18.22.2');
  await expect(page.getByText('ملغى لدى مورد', { exact: true })).toHaveCSS(
    'color',
    'rgb(180, 35, 24)',
  );
  await page.getByRole('button', { name: 'التفاصيل', exact: true }).click();
  await expect(page.getByText(/تغيّر مبلغ التحصيل/)).toHaveCount(0);
  await expect(page.getByText('متابعة الاتصال لدى مورد', { exact: true })).toHaveCount(0);
  await expect(page.getByText('بانتظار بدء الاتصال', { exact: true })).toHaveCount(0);
  await expect(page.locator('.customer-order-pricing')).toContainText('278');
  await expect(page.locator('.order-cancellation-reason')).toContainText(
    'الزبون ينكر الطلب (لم يسبق له الطلب) <img src=x onerror=alert(1)>',
  );
  await expect(page.locator('.order-cancellation-reason img')).toHaveCount(0);
  await page.getByRole('button', { name: 'وصل الشراء', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'وصل الشراء للزبون', exact: true });
  await expect(
    dialog.getByText('طلب ملغى / مرتجع · لا يوجد مبلغ مطلوب من الزبون', { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator('.receipt-totals')).toContainText('278');
  await expect(dialog).not.toContainText('الزبون ينكر الطلب');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'وصل الشراء', exact: true })).toBeFocused();
});
test('a missing provider reason is stated clearly in cancelled order details on desktop and mobile', async ({
  page,
}) => {
  const cancelled = {
    ...fixture,
    shipping_status: 'cancelled',
    financial_status: 'cancelled',
    remote: { ...fixture.remote, status: { order_status: 'cancelled' } },
  };
  await prepare(page, cancelled, '198.18.22.4');
  await page.getByRole('button', { name: 'التفاصيل', exact: true }).click();
  await expect(page.locator('.order-cancellation-reason')).toContainText(
    'لم يرسل مورد سبب الإلغاء أو الإرجاع عبر الربط بعد.',
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.order-cancellation-reason')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test('receipt labels and layout follow the independently selected administration language', async ({
  page,
}) => {
  await page.route('**/api/auth/status', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), adminLanguage: 'fr' } });
  });
  await prepare(page, fixture, '198.18.22.3');
  await page.getByRole('button', { name: 'Reçu d’achat', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reçu d’achat du client', exact: true });
  await expect(dialog).toContainText('Paiement à la livraison');
  await expect(dialog.locator('.receipt-totals')).toContainText('278 MAD');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Télécharger le reçu en image', exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.png$/);
});
