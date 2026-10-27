import type { OrderPricing } from '../shared/order-pricing';
import { t, money, adminLanguage } from './language';
import { OrderIcon } from './order-icons';
const display = (value: number | null) => (value === null ? t('غير متاح بعد') : money(value));
export function OrderPricingPanel({
  pricing,
  view = 'summary',
}: {
  pricing: OrderPricing;
  view?: 'summary' | 'products';
}) {
  const costSource = {
    order: 'تكاليف معتمدة من طلبك لدى مورد',
    quote: 'تكاليف أكدها مورد قبل الإرسال',
    snapshot: 'تكاليف تقديرية محفوظة عند إنشاء الطلب',
    estimate: 'تكاليف تقديرية حسب آخر بيانات مورد',
    unavailable: 'تظهر تكاليف مورد عند توفر بيانات التوريد',
  };
  if (view === 'products')
    return (
      <section className="order-products-card" aria-label={t('المنتجات')}>
        <h3>
          <OrderIcon name="receipt" />
          {t('المنتجات')}
        </h3>
        <div className="order-price-lines">
          {pricing.items.map((item, index) => (
            <article className="order-price-line" key={item.sku + ':' + index}>
              <header>
                <span className="badge">×{item.quantity}</span>
                <h4>{item.name}</h4>
              </header>
              <div className="order-price-line-values">
                <dl>
                  <div>
                    <dt>{t('تكلفة المنتج الواحد لدى مورد')}</dt>
                    <dd>{display(item.unitCost)}</dd>
                  </div>
                  <div>
                    <dt>{t('سعر المنتج الواحد للزبون')}</dt>
                    <dd>{display(item.unitPrice)}</dd>
                  </div>
                  {item.quantity > 1 && (
                    <>
                      <div>
                        <dt>{t('مجموع تكلفة هذا المنتج')}</dt>
                        <dd>{display(item.costSubtotal)}</dd>
                      </div>
                      <div>
                        <dt>{t('مجموع بيع هذا المنتج')}</dt>
                        <dd>{display(item.subtotal)}</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>{t('الربح لكل منتج')}</dt>
                    <dd>
                      {display(
                        item.unitPrice === null || item.unitCost === null
                          ? null
                          : item.unitPrice - item.unitCost,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  return (
    <section
      className="order-pricing order-financial-card"
      aria-label={t('الملخص المالي')}
      dir={adminLanguage() === 'ar' ? 'rtl' : 'ltr'}
    >
      <h3>
        <OrderIcon name="receipt" />
        {t('الملخص المالي')}
      </h3>
      <p className="muted order-cost-source">{t(costSource[pricing.merchant.source])}</p>
      <section className="merchant-order-pricing" aria-label={t('ما تدفعه لمورد')}>
        <dl>
          <div>
            <dt>{t('تكلفة المنتجات لدى مورد')}</dt>
            <dd>{display(pricing.merchant.subtotal)}</dd>
          </div>
          <div>
            <dt>{t('تكلفة توصيل مورد')}</dt>
            <dd>{display(pricing.merchant.shipping)}</dd>
          </div>
          <div className="pricing-total">
            <dt>{t('إجمالي المستحق لمورد')}</dt>
            <dd>{display(pricing.merchant.total)}</dd>
          </div>
        </dl>
      </section>
      <section className="customer-order-pricing" aria-label={t('ما يدفعه الزبون')}>
        <dl>
          <div>
            <dt>{t('مجموع أسعار المنتجات')}</dt>
            <dd>{display(pricing.customer.subtotal)}</dd>
          </div>
          <div>
            <dt>{t('التوصيل للزبون')}</dt>
            <dd>{display(pricing.customer.shipping)}</dd>
          </div>
          <div className="pricing-total">
            <dt>
              {pricing.closed
                ? t('قيمة الطلب قبل الإلغاء / الاسترجاع')
                : t('الإجمالي الذي يدفعه الزبون')}
            </dt>
            <dd>{display(pricing.customer.total)}</dd>
          </div>
        </dl>
      </section>
      <dl>
        <div
          className={'pricing-profit' + ((pricing.merchant.profit ?? 0) < 0 ? ' error-text' : '')}
        >
          <dt>{pricing.closed ? t('صافي الربح') : t('صافي الربح المتوقع')}</dt>
          <dd>{display(pricing.merchant.profit)}</dd>
        </div>
      </dl>
      {pricing.closed && (
        <p className="order-cancelled-note">
          {t('الطلب ملغى أو مرتجع. أسعار الطلب الأصلية محفوظة، ولا يوجد مبلغ مطلوب من الزبون.')}
        </p>
      )}
      {pricing.customer.total !== pricing.customer.originalTotal && (
        <dl className="pricing-original">
          <dt>{t('مبلغ التحصيل الأصلي')}</dt>
          <dd>{money(pricing.customer.originalTotal)}</dd>
        </dl>
      )}
    </section>
  );
}
