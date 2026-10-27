import React, { useEffect, useState, useRef } from 'react';
import type { Product, Language } from '../shared/types';
import { emptyProduct, productFromCatalog } from './catalog-import';
import { t, money } from './language';
type Request = (path: string, body?: unknown, method?: string) => Promise<any>;
export function RecommendationPicker({
  product,
  products,
  language,
  request,
  run,
  onToggle,
  onImported,
}: {
  product: Product;
  products: Product[];
  language: Language;
  request: Request;
  run: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
  onToggle: (id: string) => void;
  onImported: (rows: Product[], id: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [rows, setRows] = useState<any[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [candidate, setCandidate] = useState<Product | null>(null),
    [price, setPrice] = useState(''),
    [saving, setSaving] = useState(false);
  const ids = product.presentation?.recommendedIds || [];
  const importPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (candidate) importPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [candidate?.id]);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        setError('');
        void request('/admin/catalog?page=' + page + '&q=' + encodeURIComponent(query))
          .then((result) => {
            if (!current) return;
            setRows(result.products);
            setMore(result.hasMore);
          })
          .catch((error) => {
            if (current) setError(error.message);
          })
          .finally(() => {
            if (current) setLoading(false);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [page, query]);
  const selected = ids.flatMap((id) => products.find((p) => p.id === id) || []);
  const fromStore = products.filter(
    (p) =>
      p.id !== product.id &&
      !rows.some((c) => c.sku === p.sku) &&
      (!query || (p.name + ' ' + p.sku).toLocaleLowerCase().includes(query.toLocaleLowerCase())),
  );
  const cards = [
    ...rows
      .filter((c) => c.sku !== product.sku)
      .map((c) => ({ catalog: c, existing: products.find((p) => p.sku === c.sku) })),
    ...fromStore.map((p) => ({ catalog: null, existing: p })),
  ];
  const publish = async () => {
    if (!candidate || saving || ids.length >= 8) return;
    const value = Number(price.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('اكتب سعرًا صحيحًا للمنتج.'));
      return;
    }
    setSaving(true);
    await run(async () => {
      await request(
        '/admin/products/' + candidate.id,
        { ...candidate, price: Math.round(value * 100), active: 1, storefrontVisible: 1 },
        'PUT',
      );
      const updated = await request('/admin/products');
      onImported(updated, candidate.id);
      setCandidate(null);
    }, t('تم نشر المنتج واختياره للمقترحات. احفظ المنتج الحالي لتثبيت الاختيار.'));
    setSaving(false);
  };
  return (
    <div className="recommendation-picker">
      <p className="muted">
        {t(
          'تصفّح منتجات مورد بالصور. اختر المنتج المنشور، أو أضفه إلى متجرك وحدّد سعره قبل اختياره. تظهر المقترحات بعد حفظ المنتج الحالي.',
        )}
      </p>
      <label>
        {t('البحث في المنتجات المقترحة')}
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
      </label>
      {!!selected.length && (
        <div className="selected-recommendations" aria-label={t('المنتجات المقترحة المختارة')}>
          {selected.map((p) => (
            <div className="selected-recommendation" key={p.id}>
              {p.image && <img src={p.image} alt="" loading="lazy" />}
              <span>{p.name}</span>
              <button
                type="button"
                className="small-button"
                onClick={() => onToggle(p.id)}
                aria-label={t('إزالة الاقتراح ') + p.name}
              >
                {t('إزالة')}
              </button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {loading && <p aria-live="polite">{t('جارٍ تحميل المنتجات…')}</p>}
      <div
        className="catalog-grid recommendation-catalog"
        aria-label={t('كتالوج المنتجات المقترحة')}
      >
        {cards.map(({ catalog: c, existing: p }) => {
          const id = p?.id,
            chosen = !!id && ids.includes(id),
            supplier = p?.supplier || c?.supplier_key;
          const compatible = !!product.supplier && product.supplier === supplier;
          const available = p
            ? p.verified && p.stock > 0
            : c?.is_active === true && c.stock_quantity > 0 && c.fulfillment_price != null;
          const ready = !!p?.active && p.storefrontVisible !== 0 && available;
          const name = p?.name || c.name || c.parent_name || c.sku,
            image = p?.image || c?.main_image || c?.images?.[0];
          return (
            <button
              key={p?.sku || c.sku}
              type="button"
              className="catalog-card"
              aria-label={(chosen ? t('إلغاء اقتراح ') : t('اقتراح ')) + name}
              aria-pressed={chosen}
              disabled={(!compatible || !available || ids.length >= 8) && !chosen}
              onClick={() => {
                if (chosen || ready) {
                  if (id) onToggle(id);
                  return;
                }
                const next = p ? structuredClone(p) : productFromCatalog(emptyProduct(language), c);
                if (!p && products.some((other) => other.slug === next.slug))
                  next.slug += '-' + next.id.slice(0, 8);
                setCandidate(next);
                setPrice(String(next.price / 100));
                setError('');
              }}
            >
              {image ? (
                <img src={image} alt="" width="120" height="120" loading="lazy" />
              ) : (
                <span className="catalog-placeholder">{t('لا توجد صورة')}</span>
              )}
              <strong>{name}</strong>
              <small>{p?.sku || c.sku}</small>
              <small>
                {!product.supplier
                  ? t('اربط المنتج بكتالوج مورد أولًا.')
                  : !compatible
                    ? t('من مورد مختلف')
                    : !available
                      ? t('غير متوفر حاليًا')
                      : chosen
                        ? t('✓ المنتج المختار')
                        : ready
                          ? money(p!.price)
                          : t('لم يُنشر في متجرك بعد')}
              </small>
              <span>
                {chosen
                  ? t('إلغاء الاختيار')
                  : ready
                    ? t('اختيار المنتج')
                    : t('إضافة إلى متجري واختياره')}
              </span>
            </button>
          );
        })}
      </div>
      {!loading && !cards.length && <p className="muted">{t('لا توجد منتجات بهذا البحث.')}</p>}
      <div className="toolbar catalog-pagination">
        <button
          type="button"
          className="secondary"
          disabled={page === 1 || loading}
          onClick={() => setPage(page - 1)}
        >
          {t('السابق')}
        </button>
        <span>{t('الصفحة {number}', { number: page })}</span>
        <button
          type="button"
          className="secondary"
          disabled={!more || loading}
          onClick={() => setPage(page + 1)}
        >
          {t('التالي')}
        </button>
      </div>
      {candidate && (
        <div
          ref={importPanel}
          className="recommendation-import"
          role="region"
          aria-label={t('إضافة المنتج المقترح')}
        >
          <h4>{candidate.name}</h4>
          <p>
            {t(
              'سيُنشَر هذا المنتج كصفحة عادية ظاهرة في متجرك. يمكنك تخصيصه لاحقًا من المنتجات والصفحات.',
            )}
          </p>
          <label>
            {t('سعر بيع المنتج المقترح بالدرهم')}
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          <div className="toolbar">
            <button
              type="button"
              className="primary"
              disabled={saving || ids.length >= 8}
              onClick={() => void publish()}
            >
              {saving ? t('جارٍ الحفظ…') : t('نشر المنتج وإضافته للمقترحات')}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => setCandidate(null)}
            >
              {t('إلغاء')}
            </button>
          </div>
        </div>
      )}
      <small className="muted">
        {t('حتى 8 منتجات من المورد نفسه. المنتجات غير المتاحة لا تظهر للزائر.')}
      </small>
    </div>
  );
}
