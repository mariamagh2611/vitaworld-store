import React from 'react';
import { assertPricePackage, shippingScenarios } from '../shared/domain';
import type { Product, Settings, ShippingCosts } from '../shared/types';
export function ProfitPreview({
  product,
  settings,
  maximumShipping,
  shippingCosts,
  options,
  t,
  money,
}: {
  product: Product;
  settings: Settings;
  maximumShipping: number | null;
  shippingCosts: ShippingCosts | null;
  options: {
    label: string;
    total: number;
    quantity: number;
    freeShipping?: boolean;
    repeatable?: boolean;
    bundle?: boolean;
  }[];
  t: (key: string) => string;
  money: (amount: number) => string;
}) {
  return (
    <div className="profit-preview compact-profit" aria-label={t('الربح التقريبي')}>
      {options.map((option, index) => {
        const wholesale =
          product.fulfillment == null ? null : product.fulfillment * option.quantity;
        const profits = shippingScenarios(
          option.total,
          wholesale,
          !!option.freeShipping,
          settings,
          product,
          shippingCosts,
        ).map((p) => p.profit);
        const profit = profits.some((p) => p === null) ? null : Math.min(...(profits as number[]));
        let unsafe = false;
        if (wholesale !== null && maximumShipping !== null) {
          try {
            assertPricePackage(
              option.total,
              wholesale,
              !!option.freeShipping,
              settings,
              product,
              maximumShipping,
            );
            if (option.repeatable && !product.presentation?.bundleMode)
              assertPricePackage(
                option.total * 100,
                wholesale * 100,
                !!option.freeShipping,
                settings,
                product,
                maximumShipping,
              );
          } catch {
            unsafe = true;
          }
        }
        return (
          <div
            className={'profit-line ' + (unsafe ? 'loss' : profit === 0 ? 'break-even' : 'gain')}
            key={index}
          >
            <span className="profit-total">
              {t(option.bundle ? 'إجمالي الربح الصافي للباقة (تقريبي)' : 'ربحك الصافي التقريبي')}:{' '}
              <strong>{profit === null ? t('غير متاح') : money(profit)}</strong>
            </span>
            {option.bundle && (
              <span className="profit-unit">
                {t('متوسط الربح الصافي للحبة (تقريبي)')}:{' '}
                <strong>
                  {profit === null ? t('غير متاح') : money(Math.round(profit / option.quantity))}
                </strong>
              </span>
            )}
            {option.bundle && (
              <small className="profit-scope">
                {t('للكمية الكاملة')}: {option.quantity}
              </small>
            )}
            {profit === 0 && !unsafe && <small>{t('لا يوجد ربح')}</small>}
            {unsafe && (
              <small className="field-error">
                {t('بهذا السعر قد تخسر. ارفع السعر أو رسوم التوصيل قبل التفعيل.')}
              </small>
            )}
            {(wholesale === null || maximumShipping === null) && (
              <small className="field-error">{t('حدّث بيانات مورد قبل تفعيل البيع.')}</small>
            )}
          </div>
        );
      })}
    </div>
  );
}
