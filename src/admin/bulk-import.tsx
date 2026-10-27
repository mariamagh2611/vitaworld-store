import React, { useEffect, useRef, useState } from 'react';
import type { Product } from '../shared/types';
import { t, money } from './language';
type Item = {
  sku: string;
  name: string;
  status: 'published' | 'draft' | 'skipped' | 'failed';
  reason: string;
};
type Progress = {
  version: 1;
  scope: string;
  mode: 'published' | 'draft';
  skus: string[];
  requests: string[];
  offset: number;
  items: Item[];
};
const storageKey = 'dar-catalog-import-v1';
const batchSize = 8;
function remembered(scope: string): Progress | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (p && Array.isArray(p.skus) && p.offset >= p.skus.length) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    return p?.version === 1 &&
      p.scope === scope &&
      ['published', 'draft'].includes(p.mode) &&
      Array.isArray(p.skus) &&
      p.skus.every((sku: unknown) => typeof sku === 'string' && sku.length <= 100) &&
      Array.isArray(p.requests) &&
      p.requests.length === Math.ceil(p.skus.length / batchSize) &&
      p.requests.every((id: unknown) => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) &&
      Number.isInteger(p.offset) &&
      p.offset >= 0 &&
      p.offset <= p.skus.length &&
      Array.isArray(p.items)
      ? p
      : null;
  } catch {
    return null;
  }
}
export function BulkImporter({
  scope,
  existing,
  query,
  onQuery,
  request,
  onImported,
  children,
}: {
  scope: string;
  existing: Product[];
  query: string;
  onQuery: (query: string) => void;
  request: (path: string, body?: unknown) => Promise<any>;
  onImported: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1),
    [catalog, setCatalog] = useState<any[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]),
    [progress, setProgress] = useState<Progress | null>(() => remembered(scope)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const mounted = useRef(true),
    working = useRef(false);
  const existingSkus = new Set(existing.map((p) => p.sku));
  const choices = selected.filter((sku) => !existingSkus.has(sku));
  const available = catalog.filter((c) => !existingSkus.has(c.sku));
  const count = (status: Item['status']) =>
    progress?.items.filter((item) => item.status === status).length || 0;
  const persist = (p: Progress) => {
    try {
      if (p.offset >= p.skus.length) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify(p));
    } catch {}
    if (mounted.current) setProgress(p);
  };
  async function execute(initial: Progress) {
    if (working.current) return;
    working.current = true;
    if (mounted.current) {
      setBusy(true);
      setError('');
    }
    let current = initial;
    try {
      while (mounted.current && current.offset < current.skus.length) {
        const result = await request('/admin/catalog/import', {
          requestId: current.requests[Math.floor(current.offset / batchSize)],
          mode: current.mode,
          skus: current.skus.slice(current.offset, current.offset + batchSize),
        });
        current = {
          ...current,
          offset: Math.min(current.skus.length, current.offset + batchSize),
          items: [...current.items, ...result.items],
        };
        persist(current);
      }
      if (mounted.current) {
        setSelected([]);
        await onImported();
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function start(mode: Progress['mode']) {
    if (working.current || busy) return;
    setBusy(true);
    setError('');
    try {
      const skus = choices.length ? [...choices] : (await request('/admin/catalog/skus')).skus;
      const next: Progress = {
        version: 1,
        scope,
        mode,
        skus,
        requests: Array.from({ length: Math.ceil(skus.length / batchSize) }, () =>
          crypto.randomUUID(),
        ),
        offset: 0,
        items: [],
      };
      persist(next);
      await execute(next);
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (progress && progress.offset < progress.skus.length) void execute(progress);
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!progress || busy || progress.offset < progress.skus.length) return;
    const timer = setTimeout(() => setProgress(null), 12000);
    return () => clearTimeout(timer);
  }, [progress, busy]);
  useEffect(() => {
    setPage(1);
  }, [query]);
  useEffect(() => {
    if (!open) return;
    let current = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        void request('/admin/catalog?page=' + page + '&q=' + encodeURIComponent(query))
          .then((r) => {
            if (current) {
              setCatalog(r.products);
              setMore(r.hasMore);
            }
          })
          .catch((e) => {
            if (current) setError(e.message);
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
  }, [open, page, query]);
  return (
    <div className="bulk-importer">
      <div className="toolbar products-list-toolbar">
        {children}
        <button disabled={busy} onClick={() => void start('published')}>
          {t(choices.length ? 'استيراد المحدد مفعّلة' : 'استيراد كل المنتجات مفعّلة')}
        </button>
        <button disabled={busy} onClick={() => void start('draft')}>
          {t(choices.length ? 'استيراد المحدد مسودة' : 'استيراد كل المنتجات مسودة')}
        </button>
      </div>
      <label className="products-list-search">
        {t('البحث باسم أو كود المنتج')}
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('اكتب اسم المنتج أو كوده')}
        />
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {progress && (
        <div className="bulk-import-progress" aria-live="polite">
          <p role="status">
            {t('تمت معالجة {done} من {total} منتج', {
              done: progress.offset,
              total: progress.skus.length,
            })}
          </p>
          {progress.offset >= progress.skus.length && (
            <button type="button" className="small-button" onClick={() => setProgress(null)}>
              {t('إغلاق')}
            </button>
          )}
          <progress value={progress.offset} max={Math.max(1, progress.skus.length)} />
          <div className="toolbar bulk-import-counts">
            <span>
              {t('منشور')}: {count('published')}
            </span>
            <span>
              {t('مسودة')}: {count('draft')}
            </span>
            <span>
              {t('تم تخطيه')}: {count('skipped')}
            </span>
            <span>
              {t('تعذر استيراده')}: {count('failed')}
            </span>
          </div>
          {!busy && progress.offset < progress.skus.length && (
            <button onClick={() => void execute(progress)}>{t('متابعة الاستيراد')}</button>
          )}
          {progress.items.some((item) => item.reason) && (
            <details>
              <summary>{t('تفاصيل الاستيراد')}</summary>
              <ul>
                {progress.items
                  .filter((item) => item.reason)
                  .map((item) => (
                    <li key={item.sku}>
                      <b>
                        {item.name} · {item.sku}
                      </b>
                      : {t(item.reason)}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <details
        className="bulk-catalog-selection"
        open={open}
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary>
          {t('اختيار منتجات من كتالوج مورد')}
          {!!choices.length && ' (' + choices.length + ')'}
        </summary>
        <p className="muted">
          {t(
            'حدّد المنتجات ثم استخدم زري الاستيراد أعلاه. المنتجات المضافة سابقًا تُتخطّى للحفاظ على تعديلاتك.',
          )}
        </p>
        <div className="toolbar">
          <label>
            <input
              type="checkbox"
              disabled={busy || loading || !available.length}
              checked={!!available.length && available.every((c) => choices.includes(c.sku))}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...new Set([...selected, ...available.map((c) => c.sku)])]
                    : selected.filter((sku) => !available.some((c) => c.sku === sku)),
                )
              }
            />
            {t('تحديد المنتجات المتاحة في هذه الصفحة')}
          </label>
          {!!selected.length && (
            <button disabled={busy} onClick={() => setSelected([])}>
              {t('إلغاء التحديد')}
            </button>
          )}
        </div>
        {loading ? (
          <p>{t('جارٍ تحميل المنتجات…')}</p>
        ) : (
          <div className="table-wrap">
            <table className="admin-products-table bulk-catalog-table">
              <thead>
                <tr>
                  <th>{t('اختيار')}</th>
                  <th>{t('المنتج')}</th>
                  <th>{t('السعر المقترح')}</th>
                  <th>{t('الحالة')}</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((c) => (
                  <tr key={c.sku}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t('اختيار المنتج {sku}', { sku: c.sku })}
                        checked={choices.includes(c.sku)}
                        disabled={busy || existingSkus.has(c.sku)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, c.sku]
                              : selected.filter((sku) => sku !== c.sku),
                          )
                        }
                      />
                    </td>
                    <td className="admin-product-title">
                      <div className="product-cell">
                        {c.main_image && (
                          <img src={c.main_image} alt="" width="48" height="48" loading="lazy" />
                        )}
                        <span>
                          {c.name || c.sku}
                          <small>{c.sku}</small>
                        </span>
                      </div>
                    </td>
                    <td data-label={t('السعر المقترح')}>
                      {c.suggested_retail_price > 0
                        ? money(Math.round(c.suggested_retail_price * 100))
                        : t('غير متاح')}
                    </td>
                    <td data-label={t('الحالة')}>
                      {existingSkus.has(c.sku)
                        ? t('مضاف')
                        : c.stock_quantity > 0 && c.is_active
                          ? t('متاح للطلب')
                          : t('غير متوفر حاليًا')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!catalog.length && <p>{t('لا توجد منتجات مطابقة للبحث.')}</p>}
          </div>
        )}
        <div className="toolbar">
          <button disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>
            {t('السابق')}
          </button>
          <span>{page}</span>
          <button disabled={!more || loading} onClick={() => setPage(page + 1)}>
            {t('التالي')}
          </button>
        </div>
      </details>
    </div>
  );
}
