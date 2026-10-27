import { it, expect, vi, afterEach } from 'vitest';
import type { Context } from 'hono';
import type { Env } from '../src/server/db';
import { sameOrigin, turnstile } from '../src/server/security';
import { defaults } from '../src/shared/types';
import { settingsSchema } from '../src/server/schemas';
import { storefrontSettings } from '../src/shared/i18n';
import { Layout, Home } from '../src/server/views';
import { typographyStyle } from '../src/shared/typography';
afterEach(() => vi.unstubAllGlobals());
it('custom-domain same-origin requests work while missing and foreign Origins remain forbidden', () => {
  const context = (origin?: string, configured?: string) =>
    ({
      req: { url: 'https://shop.example/api/checkout/quote', header: () => origin },
      env: { APP_ORIGIN: configured },
    }) as unknown as Context;
  expect(() =>
    sameOrigin(context('https://shop.example', 'https://original.workers.dev')),
  ).not.toThrow();
  expect(() =>
    sameOrigin(context('https://original.workers.dev', 'https://original.workers.dev')),
  ).not.toThrow();
  for (const bad of [undefined, 'null', 'https://evil.example', 'https://shop.example.evil'])
    expect(() => sameOrigin(context(bad, 'https://original.workers.dev'))).toThrow();
  expect(() => sameOrigin(context(undefined))).toThrow();
});
it('Turnstile verifies the actual custom hostname and continues rejecting a different hostname', async () => {
  const env = {
    ENVIRONMENT: 'production',
    TURNSTILE_SECRET: 'unit-test-secret',
    APP_ORIGIN: 'https://original.workers.dev',
  } as Env;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, action: 'order', hostname: 'shop.example' })),
    ),
  );
  await expect(
    turnstile(env, 'unit-token', 'order', { origin: 'https://shop.example' }),
  ).resolves.toBeUndefined();
  await expect(
    turnstile(env, 'unit-token', 'order', { origin: 'https://foreign.example' }),
  ).rejects.toThrow();
});
it('font choices and sizes are bounded and defaults do not leak through translated settings', () => {
  expect(typographyStyle(defaults)['--store-mobile-size']).toBe('16px');
  for (const typography of [
    { ...defaults.typography, mobileSize: 12 },
    { ...defaults.typography, desktopSize: 99 },
    { ...defaults.typography, family: 'url(https://evil)' },
    { ...defaults.typography, weight: 100 },
  ])
    expect(settingsSchema.safeParse({ ...defaults, typography }).success).toBe(false);
  const { branding, typography, ...legacy } = defaults;
  expect(settingsSchema.parse(legacy).typography).toEqual(typography);
  expect(
    storefrontSettings({
      ...defaults,
      home: { ...defaults.home, showNavigation: false },
      contentTranslations: { fr: { home: { showNavigation: true } } },
      storeLanguage: 'fr',
    }).home.showNavigation,
  ).toBe(false);
});
it('header navigation hides on desktop and mobile without hiding search or cart, and wordmark controls avoid a duplicate name', async () => {
  const s = {
    ...defaults,
    logo: '/demo/bag.svg',
    branding: { logoWidth: 176, logoZoom: 4, showName: false },
    home: { ...defaults.home, showNavigation: false },
  };
  const html = await Layout({
    s,
    products: [],
    development: false,
    children: Home({ s, products: [] }),
  }).toString();
  expect(html).not.toContain('class="desktop-nav"');
  expect(html).not.toContain('class="mobile-menu"');
  expect(html).toContain('class="store-search"');
  expect(html).toContain('class="cart-button"');
  expect(html).toContain('class="brand-logo"');
  expect(html).toContain('logo-wordmark');
  expect(html).toContain('--logo-zoom:4');
});
