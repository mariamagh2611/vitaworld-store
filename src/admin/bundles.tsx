import React from 'react';
import { pricedProduct } from '../shared/commerce';
import { toLocalDateTime, toUtcDateTime } from './deadline';
import type { Product, ProductPresentation, Settings, ShippingCosts, Offer } from '../shared/types';
import { ProfitPreview } from './profit-preview';

export function BundlesEditor({
  product,
  settings,
  maximumShipping,
  shippingCosts,
  onOffers,
  onPresentation,
  t,
  money,
}: {
  product: Product;
  settings: Settings;
  maximumShipping: number | null;
  shippingCosts: ShippingCosts | null;
  onOffers: (offers: Offer[]) => void;
  onPresentation: (changes: Partial<ProductPresentation>) => void;
  t: (key: string) => string;
  money: (amount: number) => string;
}) {
  const enabled = !!product.presentation?.bundleMode,
    price = pricedProduct(product).price;
  const change = (id: string, changes: Partial<Offer>) =>
    onOffers(product.offers.map((o) => (o.id === id ? { ...o, ...changes } : o)));
  return (
    <div className="bundles-editor" data-field="offers">
      <label className="bundle-mode">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onPresentation({ bundleMode: e.target.checked, quantityPricing: undefined })
          }
        />
        {t('بيع المنتج بالباقات')}
      </label>
      <p className="muted">
        {t(
          enabled
            ? 'الزبون يختار إحدى الباقات فقط. المنتج الواحد وباقتان إضافيتان كحد أقصى.'
            : 'بدون باقات، يختار الزبون الكمية التي يريدها بالسعر الحالي للمنتج.',
        )}
      </p>
      {enabled && (
        <>
          <div className="bundle-base-row">
            <b>
              {t('المنتج الواحد')} · {money(price)}
            </b>
            <label>
              {t('عبارة الباقة (اختياري)')}
              <input
                maxLength={120}
                value={product.presentation?.bundleLabel || ''}
                onChange={(e) => onPresentation({ bundleLabel: e.target.value })}
                placeholder={t('المنتج الواحد')}
              />
            </label>
          </div>
          <div className="bundles-table" role="group" aria-label={t('باقات المنتج')}>
            {product.offers.map((offer, index) => (
              <div className="bundle-edit-row" key={offer.id}>
                <div className="bundle-row-fields">
                  <label data-field={`offers.${index}.quantity`}>
                    {t('الكمية')}
                    <input
                      type="number"
                      min={2}
                      max={100}
                      step={1}
                      value={offer.quantity}
                      onChange={(e) => change(offer.id, { quantity: Number(e.target.value) })}
                    />
                  </label>
                  <label data-field={`offers.${index}.total`}>
                    {t('سعر الباقة بالدرهم')}
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      value={offer.total / 100}
                      onChange={(e) =>
                        change(offer.id, { total: Math.round(Number(e.target.value) * 100) })
                      }
                    />
                  </label>
                  <label>
                    {t('عبارة الباقة (اختياري)')}
                    <input
                      maxLength={120}
                      value={offer.label}
                      placeholder={t('باقة التوفير')}
                      onChange={(e) => change(offer.id, { label: e.target.value })}
                    />
                  </label>
                  <label>
                    {t('التوصيل')}
                    <select
                      value={offer.freeShipping ? 'free' : 'inherit'}
                      onChange={(e) =>
                        change(offer.id, { freeShipping: e.target.value === 'free' })
                      }
                    >
                      <option value="inherit">{t('حسب إعدادات المنتج')}</option>
                      <option value="free">{t('مجاني لهذه الباقة')}</option>
                    </select>
                  </label>
                </div>
                <ProfitPreview
                  product={product}
                  settings={settings}
                  maximumShipping={maximumShipping}
                  shippingCosts={shippingCosts}
                  t={t}
                  money={money}
                  options={[
                    {
                      label: offer.label,
                      total: offer.total,
                      quantity: offer.quantity,
                      bundle: true,
                      freeShipping: offer.freeShipping,
                    },
                  ]}
                />
                <details className="bundle-row-options">
                  <summary>{t('خيارات الباقة')}</summary>
                  <label>
                    {t('نهاية العرض (اختياري، بتوقيت جهازك)')}
                    <input
                      type="datetime-local"
                      value={toLocalDateTime(offer.endsAt)}
                      onChange={(e) => change(offer.id, { endsAt: toUtcDateTime(e.target.value) })}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={offer.enabled !== false}
                      onChange={(e) => change(offer.id, { enabled: e.target.checked })}
                    />
                    {t('مفعّل')}
                  </label>
                  {offer.endsAt && Date.parse(offer.endsAt) <= Date.now() && (
                    <small>{t('انتهى العرض')}</small>
                  )}
                  <button
                    className="danger small-button"
                    type="button"
                    onClick={() => onOffers(product.offers.filter((o) => o.id !== offer.id))}
                  >
                    {t('حذف الباقة')}
                  </button>
                </details>
              </div>
            ))}
          </div>
          {product.offers.length < 2 && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const quantity =
                  [2, 3].find((q) => !product.offers.some((o) => o.quantity === q)) || 2;
                onOffers([
                  ...product.offers,
                  {
                    id: crypto.randomUUID(),
                    label: '',
                    quantity,
                    total: price * quantity,
                    freeShipping: false,
                    enabled: true,
                    endsAt: null,
                  },
                ]);
              }}
            >
              {t('إضافة باقة')}
            </button>
          )}
          {product.offers.length > 2 && (
            <p className="field-error">
              {t('لديك عروض قديمة متعددة. احتفظ بباقتين إضافيتين قبل حفظ وضع الباقات.')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
