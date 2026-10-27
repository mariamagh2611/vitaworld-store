import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { ProfitPreview } from '../src/admin/profit-preview';
import { defaults, type Product } from '../src/shared/types';

function render(
  quantity: number,
  total: number,
  freeShipping = false,
  fulfillment: number | null = 8000,
) {
  return renderToStaticMarkup(
    createElement(ProfitPreview, {
      product: {
        fulfillment,
        shippingCasa: null,
        shippingOther: null,
        presentation: { bundleMode: true },
      } as Product,
      settings: { ...defaults, cartFreeShippingThreshold: 0 },
      maximumShipping: 3000,
      shippingCosts: { casa: 2000, other: 3000, maximum: 3000 },
      t: (key) => key,
      money: (value) => value / 100 + ' MAD',
      options: [{ label: 'الباقة', quantity, total, freeShipping, bundle: true }],
    }),
  );
}
describe('whole-bundle profit display', () => {
  it('shows the full two-item margin from the actual bundle price, rather than multiplying a single-item margin', () => {
    const html = render(2, 28000);
    expect(html).toContain('إجمالي الربح الصافي للباقة (تقريبي)');
    expect(html).toContain('<strong>120 MAD</strong>');
    expect(html).toContain('متوسط الربح الصافي للحبة (تقريبي)');
    expect(html).toContain('<strong>60 MAD</strong>');
    expect(html).not.toContain('160 MAD');
    expect(html).toContain('للكمية الكاملة');
    expect(html).toContain('2');
  });
  it('recalculates total quantity and subtracts the one delivery charge when the bundle ships free', () => {
    expect(render(3, 28000)).toContain('<strong>40 MAD</strong>');
    const html = render(3, 28000, true);
    expect(html).toContain('<strong>10 MAD</strong>');
    expect(html).toContain('<strong>3.33 MAD</strong>');
  });
  it('keeps zero, losses and unknown supplier costs explicit', () => {
    expect(render(2, 19000, true)).toContain('<strong>0 MAD</strong>');
    expect(render(2, 18000, true)).toContain('<strong>-10 MAD</strong>');
    expect(render(2, 18000, true)).toContain('<strong>-5 MAD</strong>');
    expect(render(2, 28000, false, null)).toContain('غير متاح');
  });
});
