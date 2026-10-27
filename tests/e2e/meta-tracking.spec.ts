import { test, expect, type Page } from '@playwright/test';
async function enableMeta(page: Page, pixels = ['123456']) {
  await page.route('**/offers/daily-bag', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      /(<script[^>]*id="store-data"[^>]*>)([\s\S]*?)(<\/script>)/,
      (_, start, json, end) => {
        const data = JSON.parse(json);
        data.settings.facebookPixel = pixels[0];
        data.settings.facebookPixels = pixels;
        data.settings.trackingEnabled = true;
        return start + JSON.stringify(data).replace(/</g, '\\u003c') + end;
      },
    );
    await route.fulfill({ response, body: html });
  });
  await page.route('https://connect.facebook.net/**', (route) =>
    route.fulfill({ body: '', contentType: 'application/javascript' }),
  );
}

for (const expired of [false, true])
  test(`Meta browser/server events share IDs and refresh expired tickets: ${expired}`, async ({
    page,
  }) => {
    const events: any[] = [];
    let bootstraps = 0,
      rejected = false;
    await enableMeta(page);
    await page.route('**/api/meta/bootstrap', (route) => {
      bootstraps++;
      return route.fulfill({
        json: { enabled: true, pixel: '123456', ticket: 'ticket-' + bootstraps },
      });
    });
    await page.route('**/api/meta/events', (route) => {
      const body = route.request().postDataJSON();
      events.push(body);
      if (expired && !rejected) {
        rejected = true;
        return route.fulfill({
          status: 403,
          json: { error: 'tracking_expired', message: 'Refresh' },
        });
      }
      return route.fulfill({ status: 202, json: { queued: true } });
    });
    await page.goto('/offers/daily-bag');
    await page.locator('#checkout-form').scrollIntoViewIfNeeded();
    await expect.poll(() => new Set(events.map((e) => e.event)).size).toBe(3);
    const browser = await page.evaluate(() =>
      ((window as any).fbq.queue as any[])
        .filter((e) => e[0] === 'trackSingle')
        .map((e) => ({ event: e[2], id: e[4].eventID })),
    );
    for (const event of browser) {
      expect(events.some((e) => e.event === event.event && e.eventId === event.id)).toBe(true);
    }
    expect(browser.map((e) => e.event).sort()).toEqual([
      'InitiateCheckout',
      'PageView',
      'ViewContent',
    ]);
    for (const e of events) {
      expect(e.path).toBe('/offers/daily-bag');
      expect(e.fbp).toMatch(/^fb\.1\.\d+\.\d+$/);
      expect(e.pixel).toBe('123456');
    }
    if (expired) {
      await expect.poll(() => bootstraps).toBe(2);
      expect(events.filter((e) => e.eventId === events[0].eventId)).toHaveLength(2);
    } else expect(bootstraps).toBe(1);
    await expect(page.locator('#checkout-error')).toHaveText('');
  });

test('CAPI connection failures do not prevent the landing checkout from working', async ({
  page,
}) => {
  await enableMeta(page);
  let attempted = false;
  await page.route('**/api/meta/bootstrap', (route) => {
    attempted = true;
    return route.abort('failed');
  });
  await page.goto('/offers/daily-bag');
  await expect.poll(() => attempted).toBe(true);
  await page.locator('input[name=name]').fill('اختبار');
  await page.locator('input[name=phone]').fill('0612345678');
  await expect(page.locator('#checkout-error')).toHaveText('');
  await expect(page.locator('input[name=name]')).toHaveValue('اختبار');
});

test('CSP permits Meta pixel fallback transport and blocks unrelated form destinations', async ({
  page,
}) => {
  let transmitted = false;
  await page.route('https://www.facebook.com/tr/', (route) => {
    transmitted = true;
    return route.fulfill({ body: 'OK', contentType: 'text/html' });
  });
  await page.goto('/');
  await page.evaluate(() => {
    (window as any).blockedDirectives = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).blockedDirectives.push(e.effectiveDirective),
    );
    const frame = document.createElement('iframe');
    frame.name = 'meta-transport-test';
    frame.hidden = true;
    document.body.appendChild(frame);
    const form = document.createElement('form');
    form.method = 'POST';
    form.target = frame.name;
    form.action = 'https://www.facebook.com/tr/';
    document.body.appendChild(form);
    form.submit();
  });
  await expect.poll(() => transmitted).toBe(true);
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.target = 'meta-transport-test';
    form.action = 'https://untrusted.example/events';
    document.body.appendChild(form);
    form.submit();
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).blockedDirectives))
    .toContain('form-action');
});

test('two Meta destinations receive each event once with matching browser/server IDs and isolated failures', async ({
  page,
}) => {
  const events: any[] = [];
  await enableMeta(page, ['123456', '654321']);
  await page.route('**/api/meta/bootstrap', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        pixels: [
          { pixel: '123456', ticket: 'first' },
          { pixel: '654321', ticket: 'second' },
        ],
      },
    }),
  );
  await page.route('**/api/meta/events', (route) => {
    const body = route.request().postDataJSON();
    events.push(body);
    return body.pixel === '654321'
      ? route.fulfill({ status: 502, json: { error: 'temporary_meta_error' } })
      : route.fulfill({ status: 202, json: { queued: true } });
  });
  await page.goto('/offers/daily-bag');
  await page.locator('#checkout-form').scrollIntoViewIfNeeded();
  await expect.poll(() => events.length).toBe(6);
  const browser = await page.evaluate(() => (window as any).fbq.queue as any[]);
  expect(browser.filter((e) => e[0] === 'init').map((e) => e[1])).toEqual(['123456', '654321']);
  expect(browser.filter((e) => e[0] === 'track')).toHaveLength(0);
  const tracked = browser.filter((e) => e[0] === 'trackSingle');
  expect(tracked).toHaveLength(6);
  for (const e of tracked)
    expect(
      events.filter(
        (server) =>
          server.pixel === e[1] && server.event === e[2] && server.eventId === e[4].eventID,
      ),
    ).toHaveLength(1);
  for (const name of ['PageView', 'ViewContent', 'InitiateCheckout'])
    expect(new Set(tracked.filter((e) => e[2] === name).map((e) => e[4].eventID)).size).toBe(1);
  expect(
    await page.locator('script[src="https://connect.facebook.net/en_US/fbevents.js"]').count(),
  ).toBe(1);
  await page.locator('input[name=name]').fill('اختبار');
  await expect(page.locator('#checkout-error')).toHaveText('');
});

test('additional pixel controls save encrypted credentials, preserve blank tokens, disable and remove a destination', async ({
  page,
}) => {
  const { readFile } = await import('node:fs/promises');
  const origin = 'http://localhost:8788';
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
    headers: { Origin: origin, 'CF-Connecting-IP': '198.18.97.1' },
    data: account,
  });
  expect(login.ok()).toBe(true);
  const headers = { Origin: origin, 'X-CSRF-Token': (await login.json()).csrf };
  const original = (await (await page.request.get('/api/admin/settings')).json()).settings;
  try {
    expect(
      (
        await page.request.put('/api/admin/settings', {
          headers,
          data: { ...original, facebookPixel: '123456', facebookAdditionalPixels: [] },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin/pixels');
    const extra = page.locator('.additional-meta-settings');
    await extra.locator('summary').click();
    await extra.getByRole('button', { name: 'إضافة تتبع Meta', exact: true }).click();
    const row = extra.locator('.additional-meta-destination');
    await row.getByLabel('اسم التتبع', { exact: true }).fill('الحساب الثاني');
    await row.getByLabel('معرّف البكسل الإضافي', { exact: true }).fill('654321');
    const token = 'local-second-capi-token-1234567890';
    await row.getByLabel('Meta CAPI Token', { exact: true }).fill(token);
    await row.getByRole('button', { name: 'حفظ التتبع الإضافي', exact: true }).click();
    await expect(row.getByLabel('Meta CAPI Token · محفوظ', { exact: true })).toHaveValue('');
    let saved = await (await page.request.get('/api/admin/settings')).json();
    expect(saved.credentials).toContain('meta:654321');
    expect(JSON.stringify(saved)).not.toContain(token);
    await page.reload();
    await extra.locator('summary').click();
    await expect(row.getByLabel('اسم التتبع', { exact: true })).toHaveValue('الحساب الثاني');
    await row.getByLabel('تفعيل التتبع', { exact: true }).uncheck();
    await row.getByRole('button', { name: 'حفظ التتبع الإضافي', exact: true }).click();
    await expect(row.getByRole('status')).toHaveText('التتبع متوقف.');
    saved = await (await page.request.get('/api/admin/settings')).json();
    expect(saved.settings.facebookAdditionalPixels[0].enabled).toBe(false);
    expect(saved.credentials).toContain('meta:654321');
    await row.getByRole('button', { name: 'حذف', exact: true }).click();
    await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
    await expect(page.getByText('تم حفظ التغييرات.', { exact: true })).toBeVisible();
    saved = await (await page.request.get('/api/admin/settings')).json();
    expect(saved.settings.facebookAdditionalPixels).toEqual([]);
    expect(saved.credentials).not.toContain('meta:654321');
  } finally {
    await page.request.put('/api/admin/settings', { headers, data: original });
  }
});

async function advertisingFixture(page: Page) {
  await page.route('**/offers/daily-bag', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      /(<script[^>]*id="store-data"[^>]*>)([\s\S]*?)(<\/script>)/,
      (_, start, json, end) => {
        const data = JSON.parse(json);
        Object.assign(data.settings, {
          facebookPixel: '',
          facebookPixels: [],
          tiktokPixel: 'TESTTIKTOK123',
          googleId: 'G-TEST123',
          googleAdsId: 'AW-123456789',
          googleAdsLeadLabel: 'Label_Test-123',
          trackingEnabled: true,
        });
        return start + JSON.stringify(data).replace(/</g, '\\u003c') + end;
      },
    );
    await route.fulfill({ response, body: html });
  });
  await page.route(/https:\/\/(analytics\.tiktok\.com|www\.googletagmanager\.com)\//, (route) =>
    route.fulfill({ body: '', contentType: 'application/javascript' }),
  );
}
async function customerFixture(page: Page) {
  await page.locator('[name=name]').fill('Local advertising fixture');
  await page.locator('[name=phone]').fill('0612345678');
  await page.locator('[name=city]').fill('Rabat');
  await page.locator('[name=address]').fill('Local test address');
}
test('Google Ads and TikTok emit a deduplicated Lead only after a successful order, with GA4 kept separate', async ({
  page,
}) => {
  await advertisingFixture(page);
  let posts = 0;
  await page.route('**/api/orders', (route) => {
    posts++;
    return posts === 1
      ? route.fulfill({
          status: 400,
          json: { error: 'fixture_failure', message: 'Fixture failure' },
        })
      : route.fulfill({ status: 201, json: { ref: 'REF-ADS-FIXTURE' } });
  });
  await page.goto('/offers/daily-bag');
  await customerFixture(page);
  const events = () =>
    page.evaluate(() => ({
      google: ((window as any).dataLayer || []).map((x: any) => Array.from(x)),
      tiktok: Array.from((window as any).ttq || []) as any[][],
    }));
  const initial = await events();
  expect(initial.google.filter((e: any) => e[0] === 'config').map((e: any) => e[1])).toEqual([
    'G-TEST123',
    'AW-123456789',
  ]);
  expect(initial.google.filter((e: any) => e[0] === 'js')).toHaveLength(1);
  await page.locator('#checkout-form button[type=submit]').click();
  await expect(page.locator('#checkout-error')).toContainText('Fixture failure');
  expect((await events()).google.filter((e: any) => e[1] === 'conversion')).toHaveLength(0);
  expect((await events()).tiktok.filter((e: any) => e[1] === 'Lead')).toHaveLength(0);
  await page.locator('#checkout-form button[type=submit]').click();
  await expect(page.locator('#thanks-dialog')).toBeVisible();
  const saved = await events();
  const conversions = saved.google.filter((e: any) => e[0] === 'event' && e[1] === 'conversion');
  expect(conversions).toHaveLength(1);
  expect(conversions[0][2]).toMatchObject({
    send_to: 'AW-123456789/Label_Test-123',
    transaction_id: 'REF-ADS-FIXTURE',
    currency: 'MAD',
    value: 179,
  });
  expect(saved.google.find((e: any) => e[1] === 'generate_lead')?.[2]).toMatchObject({
    send_to: 'G-TEST123',
    value: 179,
  });
  const leads = saved.tiktok.filter((e: any) => e[0] === 'track' && e[1] === 'Lead');
  expect(leads).toHaveLength(1);
  expect(leads[0][2]).toMatchObject({ value: 179, currency: 'MAD' });
  expect(leads[0][3]).toEqual({ event_id: 'lead:REF-ADS-FIXTURE' });
  expect(saved.tiktok.some((e: any) => e[1] === 'Purchase')).toBe(false);
  // A repeated success callback for the same accepted reference must not double-count it.
  await page.keyboard.press('Escape');
  await customerFixture(page);
  await page.locator('#checkout-form button[type=submit]').click();
  await expect(page.locator('#thanks-dialog')).toBeVisible();
  expect((await events()).google.filter((e: any) => e[1] === 'conversion')).toHaveLength(1);
});

test('unavailable browser storage and throwing advertising SDKs cannot hide successful checkout', async ({
  page,
}) => {
  await advertisingFixture(page);
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException('Storage blocked', 'SecurityError');
    };
    for (const name of ['getItem', 'setItem', 'removeItem'])
      Object.defineProperty(Storage.prototype, name, { value: blocked, configurable: true });
  });
  await page.route('**/api/orders', (r) =>
    r.fulfill({ status: 201, json: { ref: 'REF-BLOCKED-STORAGE' } }),
  );
  await page.goto('/offers/daily-bag');
  await page.evaluate(() => {
    for (const name of ['fbq', 'gtag', 'snaptr'])
      (window as any)[name] = () => {
        throw Error('SDK blocked');
      };
    (window as any).ttq.track = () => {
      throw Error('SDK blocked');
    };
  });
  await customerFixture(page);
  await page.locator('#checkout-form button[type=submit]').click();
  await expect(page.locator('#thanks-dialog')).toBeVisible();
  await expect(page.locator('#order-ref')).toHaveText('REF-BLOCKED-STORAGE');
  await expect(page.locator('#checkout-error')).toHaveText('');
});

test('CSP allows Google Ads transports and the TikTok IPv6 endpoint', async ({ page }) => {
  const urls = [
    'https://www.googleadservices.com/pagead/conversion/123',
    'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/123',
    'https://www.googletagmanager.com/test',
    'https://anlytics-ipv6.tiktokw.us/test',
  ];
  for (const url of urls)
    await page.route(url, (r) =>
      r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, body: 'ok' }),
    );
  await page.goto('/');
  for (const url of urls)
    expect(
      await page.evaluate(
        (url) =>
          fetch(url)
            .then((r) => r.ok)
            .catch(() => false),
        url,
      ),
    ).toBe(true);
});

test('checkout reuses a current quote but refreshes an authoritative price rejection before retrying', async ({
  page,
}) => {
  let quotes = 0,
    posts = 0;
  await page.route('**/api/checkout/quote', async (route) => {
    quotes++;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  await page.route('**/api/orders', (route) => {
    posts++;
    return posts === 1
      ? route.fulfill({
          status: 409,
          json: { error: 'quote_changed', message: 'Review updated total' },
        })
      : route.fulfill({ status: 201, json: { ref: 'REF-QUOTE-CACHE' } });
  });
  await page.goto('/offers/daily-bag');
  await customerFixture(page);
  const cityQuote = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/checkout/quote') && r.request().postDataJSON().city === 'CASABLANCA',
  );
  await page.locator('[name=city]').fill('CASABLANCA');
  await cityQuote;
  await expect(page.locator('#shipping')).toContainText('20');
  const current = quotes;
  await page.locator('#checkout-form button[type=submit]').click();
  await expect(page.locator('#checkout-error')).toHaveText('Review updated total');
  expect(quotes).toBe(current + 1); // Only the post-rejection refresh, no duplicate pre-submit quote.
  await expect(page.locator('#thanks-dialog')).not.toBeVisible();
  await page.locator('#checkout-form button[type=submit]').click();
  await expect(page.locator('#thanks-dialog')).toBeVisible();
  expect(quotes).toBe(current + 1);
});
