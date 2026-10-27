import type { Env } from './db';
import { settings, state, now } from './db';
import { credential, digest } from './security';
import { maximumShipping } from './shipping-policy';
import { catalogMedia, catalogDescriptions, catalogSearchKeywords } from '../shared/catalog';
import { normalizeProductContent } from './product-content';
import { productSchema } from './schemas';
import { assertPublishedPrices, DomainError } from '../shared/domain';
import type { Product } from '../shared/types';
import { z } from 'zod';
export const catalogImportSchema = z
  .object({
    requestId: z.string().uuid(),
    mode: z.enum(['published', 'draft']),
    skus: z.array(z.string().min(1).max(100)).min(1).max(8),
  })
  .strict();
export type ImportItem = {
  sku: string;
  name: string;
  status: 'published' | 'draft' | 'skipped' | 'failed';
  reason: string;
};
const receiptKey = (id: string) => 'catalog_import:' + id;
export async function importCatalogBatch(
  env: Env,
  admin: string,
  requestId: string,
  mode: 'published' | 'draft',
  requested: string[],
) {
  const skus = [...new Set(requested)].sort();
  const fingerprint = await digest(JSON.stringify({ mode, skus }));
  const cached = await state(env.DB, receiptKey(requestId));
  if (cached) {
    if (cached.fingerprint !== fingerprint)
      throw new DomainError(
        'import_request_changed',
        'بيانات محاولة الاستيراد مختلفة. ابدأ استيرادًا جديدًا.',
        409,
      );
    return { items: cached.items as ImportItem[] };
  }
  const s = await settings(env.DB);
  const [catalog, existing, maximum, keyFingerprint] = await Promise.all([
    env.DB.prepare('SELECT json FROM catalog WHERE sku IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(skus))
      .all<{ json: string }>(),
    env.DB.prepare('SELECT sku FROM products WHERE sku IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(skus))
      .all<{ sku: string }>(),
    mode === 'published' ? maximumShipping(env).catch(() => null) : Promise.resolve(null),
    mode === 'published' && env.ENVIRONMENT !== 'development'
      ? credential(env, 'mowarid').then(digest)
      : Promise.resolve(''),
  ]);
  const bySku = new Map(
    catalog.results.map(({ json }) => {
      const p = JSON.parse(json);
      return [p.sku, p];
    }),
  );
  const present = new Set(existing.results.map((p) => p.sku));
  const parentIds = [...new Set([...bySku.values()].map((c) => c.parent_id).filter(Boolean))];
  const parents = parentIds.length
    ? await env.DB.prepare(
        "SELECT json FROM catalog WHERE json_extract(json,'$.product_id') IN (SELECT value FROM json_each(?)) AND json_extract(json,'$.parent_id') IS NULL",
      )
        .bind(JSON.stringify(parentIds))
        .all<{ json: string }>()
    : { results: [] };
  const byParent = new Map(
    parents.results.map(({ json }) => {
      const p = JSON.parse(json);
      return [p.product_id, p];
    }),
  );
  const results: (ImportItem & { id: string })[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const [index, sku] of skus.entries()) {
    const c = bySku.get(sku),
      id = requestId + '-' + index;
    const item = {
      sku,
      name: c?.name || c?.parent_name || sku,
      status: 'failed' as ImportItem['status'],
      reason: '',
      id,
    };
    if (present.has(sku)) {
      results.push({
        ...item,
        status: 'skipped',
        reason: 'المنتج مضاف سابقًا؛ احتفظنا بتعديلاته.',
      });
      continue;
    }
    if (!c) {
      results.push({ ...item, reason: 'المنتج غير موجود في كتالوج مورد الحالي.' });
      continue;
    }
    try {
      const parent = byParent.get(c.parent_id),
        media = catalogMedia(c, parent);
      let html = catalogDescriptions(c, parent).html;
      if (!/<[a-z][\s\S]*>/i.test(html))
        html = html
          .split(/\n\s*\n/)
          .map(
            (part: string) =>
              '<p>' +
              part
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('\n', '<br>') +
              '</p>',
          )
          .join('');
      const price =
        typeof c.suggested_retail_price === 'number' && c.suggested_retail_price > 0
          ? Math.round(c.suggested_retail_price * 100)
          : typeof c.minimum_selling_price === 'number' && c.minimum_selling_price > 0
            ? Math.round(c.minimum_selling_price * 100)
            : 10000;
      const fulfillment =
        c.fulfillment_price == null ? null : Math.round(c.fulfillment_price * 100);
      const verified = Number(!!c.supplier_key && s.contractVerified && fulfillment !== null);
      const slug =
        (sku
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 70) || 'product') +
        '-' +
        requestId.slice(0, 8) +
        '-' +
        index;
      const p = productSchema.parse(
        normalizeProductContent({
          id,
          slug,
          sku,
          name: item.name,
          description: '',
          image: media.main_image || '',
          price,
          active: 0,
          featured: 0,
          offers: [],
          blocks: [],
          color: s.theme.primary,
          formColor: '#f3f0e9',
          shippingCasa: null,
          shippingOther: null,
          categoryId: null,
          pageMode: 'product',
          storefrontVisible: 1,
          gallery: media.images.slice(0, 12),
          keywords: catalogSearchKeywords(c, parent),
          presentation: {
            descriptionFormat: 'html',
            descriptionHtml: html,
            landingLanguage: s.storeLanguage,
          },
        }),
      );
      item.status = 'draft';
      if (mode === 'published') {
        if (
          !verified ||
          c.is_active !== true ||
          (env.ENVIRONMENT !== 'development' && c.key_fingerprint !== keyFingerprint)
        )
          item.reason = 'بيانات مورد غير موثقة أو المنتج غير مفعّل لديه.';
        else if (!(c.stock_quantity > 0)) item.reason = 'المنتج غير متوفر في المخزون.';
        else if (
          !p.image ||
          (!p.description.trim() && !p.presentation?.descriptionHtml?.includes('<img'))
        )
          item.reason = 'الصورة أو وصف المنتج يحتاج مراجعة قبل النشر.';
        else if (!(c.suggested_retail_price > 0))
          item.reason = 'السعر المقترح من مورد غير متاح؛ حدّد السعر قبل النشر.';
        else if (maximum === null)
          item.reason = 'حدّث بيانات مورد للحصول على تكلفة التوصيل الموثوقة.';
        else {
          try {
            assertPublishedPrices(p.price, [], fulfillment, s, p as Product, maximum);
            p.active = 1;
            item.status = 'published';
          } catch (error) {
            item.reason =
              error instanceof DomainError ? error.message : 'راجع السعر وتكلفة التوصيل قبل النشر.';
          }
        }
      }
      statements.push(
        env.DB.prepare(
          'INSERT INTO products(id,slug,sku,parent_id,name,description,image,price,minimum,fulfillment,stock,active,featured,supplier,verified,offers,blocks,color,form_color,shipping_casa,shipping_other,category_id,page_mode,storefront_visible,gallery,keywords,presentation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sku) DO NOTHING',
        ).bind(
          p.id,
          p.slug,
          p.sku,
          c.parent_id || null,
          p.name,
          p.description,
          p.image,
          p.price,
          Math.round((c.minimum_selling_price || 0) * 100),
          fulfillment,
          c.stock_quantity || 0,
          p.active,
          0,
          c.supplier_key || null,
          verified,
          '[]',
          '[]',
          p.color,
          p.formColor,
          null,
          null,
          null,
          'product',
          1,
          JSON.stringify(p.gallery),
          p.keywords,
          JSON.stringify(p.presentation),
        ),
      );
      results.push(item);
    } catch {
      results.push({
        ...item,
        status: 'failed',
        reason: 'بيانات المنتج أو حجم وصفه غير صالح للاستيراد. راجعه يدويًا.',
      });
    }
  }
  // Product inserts and their receipt commit together. Lost responses and overlapping imports are safe to retry.
  statements.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO sync_state(name,json) SELECT ?,json_object('fingerprint',?,'at',?,'items',json_group_array(json_object('sku',json_extract(item.value,'$.sku'),'name',json_extract(item.value,'$.name'),'status',CASE WHEN json_extract(item.value,'$.status') IN ('draft','published') AND COALESCE(p.id,'')<>json_extract(item.value,'$.id') THEN 'skipped' ELSE json_extract(item.value,'$.status') END,'reason',CASE WHEN json_extract(item.value,'$.status') IN ('draft','published') AND COALESCE(p.id,'')<>json_extract(item.value,'$.id') THEN 'المنتج مضاف سابقًا؛ احتفظنا بتعديلاته.' ELSE json_extract(item.value,'$.reason') END))) FROM json_each(?) item LEFT JOIN products p ON p.sku=json_extract(item.value,'$.sku')`,
    ).bind(receiptKey(requestId), fingerprint, now(), JSON.stringify(results)),
  );
  statements.push(
    env.DB.prepare(
      'INSERT OR IGNORE INTO audit(id,admin_id,action,target,created_at) VALUES(?,?,?,?,?)',
    ).bind(requestId, admin, 'catalog_batch_imported', mode + ':' + skus.length, now()),
  );
  await env.DB.batch(statements);
  const receipt = await state(env.DB, receiptKey(requestId));
  return { items: receipt.items as ImportItem[] };
}
