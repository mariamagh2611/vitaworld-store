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
test('shipping and profit filters remain independent and Meta setup needs no version field', async ({
  page,
}) => {
  await owner(page, '198.18.17.1');
  await page.goto('/admin/orders');
  const shipping = page.getByLabel('حالة الشحن والتوريد', { exact: true }),
    financial = page.getByLabel('حالة الأرباح', { exact: true });
  await expect(shipping.locator('option')).toHaveCount(10);
  await expect(financial.locator('option')).toHaveCount(5);
  await shipping.selectOption('delivered');
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/admin/orders?') &&
      new URL(r.url()).searchParams.get('financial') === 'awaiting_settlement',
  );
  await financial.selectOption('awaiting_settlement');
  const url = new URL((await response).url());
  expect(url.searchParams.get('shipping')).toBe('delivered');
  await expect(shipping).toHaveValue('delivered');
  await page.goto('/admin/pixels');
  await page.getByText('إعداد حدث الشراء عند التوصيل إلى Meta', { exact: true }).click();
  await expect(
    page.getByLabel('نسخة Graph API المعتمدة في حساب Meta', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel(/^Meta CAPI Token/)).toBeVisible();
  await page.goto('/admin/integration');
  await expect(
    page.getByLabel('إرسال الطلبات تلقائيًا إلى مورد', { exact: true }),
  ).not.toBeChecked();
});
test('a landing campaign survives shopping and reload and is submitted with a locally pending order', async ({
  page,
}) => {
  await page.goto('/?utm_source=facebook&utm_campaign=provider-campaign&utm_content=ad-17');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('dar-attribution') || '{}').last?.utm_campaign,
      ),
    )
    .toBe('provider-campaign');
  await page.goto('/shop/daily-bag');
  await page.locator('#add-offer').click();
  await page.locator('[data-cart-checkout]').click();
  await page.reload();
  const attribution = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dar-attribution') || '{}'),
  );
  expect(attribution.first.utm_source).toBe('facebook');
  expect(attribution.last.utm_campaign).toBe('provider-campaign');
  expect(attribution.last.utm_content).toBe('ad-17');
  await page.getByLabel('الاسم الكامل', { exact: true }).fill('عميل اختبار الإسناد');
  await page.getByLabel('رقم الهاتف', { exact: true }).fill('0612345678');
  await page.getByLabel('المدينة', { exact: true }).fill('Rabat');
  await page.getByLabel('العنوان بالتفصيل', { exact: true }).fill('عنوان اختبار محلي');
  const posted = page.waitForResponse(
    (r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST',
  );
  await page.locator('#checkout-form button[type=submit]').click();
  const response = await posted;
  expect(response.ok()).toBe(true);
  const body = response.request().postDataJSON();
  expect(body.attribution.last.utm_campaign).toBe('provider-campaign');
  expect(body.attribution.last.utm_source).toBe('facebook');
  await owner(page, '198.18.17.2');
  const orders = await (await page.request.get('/api/admin/orders')).json();
  const ref = (await response.json()).ref,
    saved = orders.find((o: any) => o.ref === ref);
  expect(saved.status).toBe('pending_confirmation');
  expect(saved.sync_status).toBe('not_sent');
  expect(saved.mowarid_id).toBeNull();
  expect(saved.attribution.last.utm_campaign).toBe('provider-campaign');
});
test('upload guidance explains dimensions and automatic WebP preparation preserves image proportions', async ({
  page,
}) => {
  // This checks image conversion and dimensions, not a 30-second upload SLA.
  // Native encoding of the large fixture shares the browser's image workload.
  test.setTimeout(60000);
  await owner(page, '198.18.17.3');
  await page.goto('/admin/categories');
  await page.getByRole('button', { name: 'إضافة قسم +', exact: true }).click();
  await expect(page.locator('[data-image-purpose=category]')).toContainText('600 × 600');
  await expect(page.locator('[data-image-purpose=category]')).toContainText('أيقونة صغيرة');
  await page.goto('/admin/appearance');
  await expect(page.locator('[data-image-purpose=hero]')).toContainText('1200 × 800');
  await page.goto('/admin/media');
  await page.getByText('دليل مقاسات الصور ورفعها', { exact: true }).click();
  await expect(page.locator('.image-guide')).toContainText('لا تحتاج ضغطها في موقع آخر');
  const file = Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2400;
      canvas.height = 1600;
      const ctx = canvas.getContext('2d')!,
        gradient = ctx.createLinearGradient(0, 0, 2400, 1600);
      gradient.addColorStop(0, '#117762');
      gradient.addColorStop(1, '#ee8866');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 2400, 1600);
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }),
  );
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/media') && r.request().method() === 'POST',
  );
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'proportions.png', mimeType: 'image/png', buffer: file });
  const r = await uploaded;
  expect(r.status()).toBe(200);
  const image = await r.json();
  expect(image.width).toBe(1200);
  expect(image.height).toBe(800);
  const bytes = await page.request.get(image.url);
  expect(bytes.headers()['content-type']).toBe('image/webp');
  expect((await bytes.body()).length).toBeLessThanOrEqual(2 * 1024 * 1024);
});

test('provider call follow-up filters independently and corrected contacts and notes retain an original snapshot', async ({
  page,
}) => {
  await owner(page, '198.18.17.90');
  const original = {
    name: 'Original customer',
    phone: '0612345678',
    city: 'Rabat',
    address: 'Original address',
    notes: 'Original note',
  };
  const current = {
    name: 'Corrected customer',
    phone: '0612345679',
    city: 'Casablanca',
    address: 'Corrected address',
    notes: 'Customer delivery note',
  };
  const row = {
    id: 'CALL-UI',
    ref: 'REF-CALL-UI',
    status: 'confirmed',
    sync_status: 'sent',
    mowarid_id: 'call-ui',
    shipping_status: 'confirmed',
    financial_status: 'pending',
    customer: current,
    original_customer: original,
    attribution: {},
    supplier: 'demo-a',
    quote: {
      total: 14900,
      storeIdentity: { name: 'Own store', url: 'https://store.example.test' },
      items: [{ name: 'Test product', quantity: 1 }],
    },
    remote: {
      store: { name: 'Own store', url: 'https://store.example.test' },
      status: {
        order_status: 'confirmed',
        call_status: 'postponed',
        last_call_at: '2026-10-09T00:00:00Z',
        postponed_note: 'Call next week',
      },
      shipping: {
        carrier: 'Ozone',
        delivery_agent_name: 'Own courier',
        delivery_agent_phone: '0654321098',
      },
    },
  };
  await page.route('**/api/admin/orders?**', (route) => route.fulfill({ json: [row] }));
  await page.route('**/api/admin/orders/sync', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/admin/orders');
  await expect(
    page.getByLabel('حالة الاتصال لدى مورد', { exact: true }).locator('option'),
  ).toHaveCount(6);
  await page.getByLabel('حالة الشحن والتوريد', { exact: true }).selectOption('confirmed');
  await page.getByLabel('حالة الأرباح', { exact: true }).selectOption('pending');
  const request = page.waitForRequest(
    (r) =>
      r.url().includes('/api/admin/orders?') &&
      new URL(r.url()).searchParams.get('call') === 'postponed',
  );
  await page.getByLabel('حالة الاتصال لدى مورد', { exact: true }).selectOption('postponed');
  const url = new URL((await request).url());
  expect(url.searchParams.get('shipping')).toBe('confirmed');
  expect(url.searchParams.get('financial')).toBe('pending');
  await expect(page.getByRole('link', { name: 'اتصال', exact: true })).toHaveAttribute(
    'href',
    'tel:0612345679',
  );
  await expect(page.getByRole('link', { name: 'واتساب', exact: true })).toHaveAttribute(
    'href',
    /^https:\/\/wa.me\/212612345679\?/,
  );
  await page.getByRole('button', { name: 'التفاصيل', exact: true }).click();
  await expect(page.getByText('Call next week', { exact: true })).toBeVisible();
  await expect(page.getByText('Customer delivery note', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'https://store.example.test', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Own courier/ })).toHaveAttribute(
    'href',
    'tel:0654321098',
  );
  await page.getByText('عرض البيانات الأصلية', { exact: true }).click();
  await expect(page.locator('.order-detail details')).toContainText('Original address');
  await expect(page.locator('.order-detail details')).toContainText('Original note');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
