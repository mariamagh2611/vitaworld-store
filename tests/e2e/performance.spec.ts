import { test, expect } from '@playwright/test';
test('first content under specified mobile network profile', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 80,
    downloadThroughput: 10_000_000 / 8,
    uploadThroughput: 2_000_000 / 8,
  });
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    (window as any).__lcp = 0;
    (window as any).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as any).__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as any)
        if (!e.hadRecentInput) (window as any).__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
  await page.waitForTimeout(1000);
  const metrics = await page.evaluate(() => ({
    fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
    lcp: (window as any).__lcp,
    cls: (window as any).__cls,
  }));
  console.log('Local mobile performance:', JSON.stringify(metrics));
  expect(metrics.fcp).toBeLessThan(1000);
  expect(metrics.cls).toBeLessThan(0.1);
  expect(metrics.lcp).toBeLessThan(2500);
});
