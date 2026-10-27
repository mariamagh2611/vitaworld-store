import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('owner uses password and recovery file without biometric controls, with old credentials and codes revoked', async ({
  page,
}) => {
  const password = 'local-admin-test-password-2026';
  const email = 'owner@example.test';
  const headers = { Origin: 'http://localhost:8788', 'CF-Connecting-IP': '198.18.12.90' };
  const passkeyRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(?:auth\/passkey|admin\/passkeys)/.test(request.url()))
      passkeyRequests.push(request.method());
  });
  expect(
    (await page.request.post('/api/auth/login', { headers, data: { email, password } })).ok(),
  ).toBe(true);
  await page.goto('/admin/account');
  await expect(page.getByText('استعادة الحساب ببصمة الجهاز', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'حفظ مفتاح دخول على جهازي', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('كلمة المرور الحالية', { exact: true }).fill(password);
  await page
    .getByLabel('كلمة المرور الجديدة (8 أحرف على الأقل)', { exact: true })
    .fill(password + '-reset');
  await page.getByRole('button', { name: 'تغيير كلمة المرور', exact: true }).click();
  await expect(page.getByText('ملف الاسترداد الجديد', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'تنزيل ملف الاسترداد', exact: true }).click();
  const file = await download;
  const data = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(data.email).toBe(email);
  expect(data.codes).toHaveLength(8);
  await page.getByRole('button', { name: 'فتح قائمة الإدارة', exact: true }).click();
  await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
  await expect(page.getByRole('button', { name: 'الدخول ببصمة الجهاز', exact: true })).toHaveCount(
    0,
  );
  expect(
    (await page.request.post('/api/auth/login', { headers, data: { email, password } })).status(),
  ).toBe(401);
  await page.getByRole('button', { name: 'نسيت كلمة المرور', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'استعادة الحساب ببصمة الجهاز', exact: true }),
  ).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles({
    name: 'store-recovery.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByLabel('البريد الإلكتروني', { exact: true })).toHaveValue(email);
  await page.getByLabel('كلمة المرور الجديدة', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'استعادة الحساب بالملف', exact: true }).click();
  await expect(page.getByText('احفظ وسيلة استعادة حسابك', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'حفظ مفتاح دخول على جهازي', exact: true }),
  ).toHaveCount(0);
  const newFile = page.waitForEvent('download');
  await page.getByRole('button', { name: 'تنزيل ملف الاسترداد', exact: true }).click();
  await newFile;
  await page.getByRole('button', { name: 'حفظت الملف · دخول الإدارة', exact: true }).click();
  await expect(page.locator('.admin-header h1')).toBeVisible();
  expect(
    (
      await page.request.post('/api/auth/recover', {
        headers,
        data: { email, password, code: data.codes[0] },
      })
    ).status(),
  ).toBe(401);
  expect(passkeyRequests).toEqual([]);
});
