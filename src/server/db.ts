import type { Product, Settings, Quote, Customer, City, Category } from '../shared/types';
import { enabledStoreLanguages } from '../shared/i18n';
import { defaults } from '../shared/types';
import { merchantOrder, merchantQuoteProof } from '../shared/merchant-order';
import {
  closedOrder,
  financialStatus,
  financialLabel,
  remoteShipping,
} from '../shared/order-status';
import { currentOrderCustomer } from '../shared/order-customer';
import { META_GRAPH_VERSION } from './meta';
import { orderPricing } from '../shared/order-pricing';
export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  BACKUPS: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  MEDIA_ORIGIN: string;
  APP_ORIGIN?: string;
  ENCRYPTION_KEY: string;
  AUTH_PEPPER: string;
  SETUP_TOKEN: string;
  INSTALLATION_MODE?: string;
  TURNSTILE_SECRET?: string;
  AUTH_CPU_VERIFIED?: string;
  PASSWORD_HASHER?: DurableObjectNamespace;
  OPERATIONS?: DurableObjectNamespace;
};
export type OrderRow = {
  post_attempted: number;
  id: string;
  ref: string;
  idempotency: string;
  request_hash: string;
  customer: string;
  supplier: string;
  quote: string;
  attribution: string;
  matching: string;
  status: string;
  sync_status: string;
  shipping_status: string | null;
  financial_status: string | null;
  mowarid_id: string | null;
  remote: string | null;
  remote_quote: string | null;
  dry_run_result: string | null;
  last_error: string | null;
  created_at: string;
  confirmed_at: string | null;
  delivered_at: string | null;
  delivered_total: number | null;
  delivery_time_source: string | null;
  next_poll: number;
};
export const now = () => new Date().toISOString();
export async function settings(db: D1Database): Promise<Settings> {
  const r = await db.prepare('SELECT json FROM settings WHERE id=1').first<{ json: string }>();
  const saved = r ? JSON.parse(r.json) : {};
  return {
    ...defaults,
    ...saved,
    metaVersion: META_GRAPH_VERSION,
    storeLanguages: enabledStoreLanguages({
      storeLanguage: saved.storeLanguage || defaults.storeLanguage,
      storeLanguages: saved.storeLanguages,
    }),
    home: {
      ...defaults.home,
      ...saved.home,
      licenseCard: { ...defaults.home.licenseCard, ...saved.home?.licenseCard },
    },
    theme: { ...defaults.theme, ...saved.theme },
    productInfo: { ...defaults.productInfo, ...saved.productInfo },
    branding: { ...defaults.branding, ...saved.branding },
    typography: { ...defaults.typography, ...saved.typography },
    socials: { ...defaults.socials, ...saved.socials },
    policyVisibility: { ...defaults.policyVisibility, ...saved.policyVisibility },
    trackingEnabled: !!(
      saved.facebookPixel ||
      saved.facebookAdditionalPixels?.some((p: { enabled: boolean }) => p.enabled) ||
      saved.tiktokPixel ||
      saved.googleId ||
      saved.googleAdsId ||
      saved.snapPixel
    ),
  };
}
export function productRow(r: Record<string, unknown>): Product {
  return {
    id: r.id,
    slug: r.slug,
    sku: r.sku,
    parentId: r.parent_id,
    name: r.name,
    description: r.description,
    image: r.image,
    price: r.price,
    minimum: r.minimum,
    fulfillment: r.fulfillment ?? null,
    stock: r.stock,
    active: r.active,
    featured: r.featured,
    supplier: r.supplier,
    verified: r.verified,
    offers: JSON.parse(r.offers as string),
    blocks: JSON.parse(r.blocks as string),
    color: r.color,
    formColor: r.form_color,
    revision: r.revision,
    shippingCasa: r.shipping_casa ?? null,
    shippingOther: r.shipping_other ?? null,
    categoryId: r.category_id ?? null,
    pageMode: r.page_mode ?? 'product',
    storefrontVisible: r.storefront_visible ?? 1,
    gallery: JSON.parse((r.gallery as string) || '[]'),
    keywords: r.keywords || '',
    presentation: JSON.parse((r.presentation as string) || '{}'),
  } as Product;
}
export async function products(db: D1Database, onlyPublic = false) {
  const r = await db
    .prepare(
      'SELECT ' +
        (onlyPublic ? galleryColumns : '*') +
        ' FROM products' +
        (onlyPublic ? ' WHERE active=1 AND storefront_visible=1' : '') +
        ' ORDER BY featured DESC,name',
    )
    .all<Record<string, unknown>>();
  return r.results.map(productRow);
}
export const galleryColumns =
  "id,slug,sku,parent_id,name,substr(description,1,300) AS description,image,price,minimum,fulfillment,stock,active,featured,supplier,verified,offers,'[]' AS blocks,color,form_color,revision,shipping_casa,shipping_other,category_id,page_mode,storefront_visible,'[]' AS gallery,keywords,presentation";
export async function categories(db: D1Database, onlyPublic = false): Promise<Category[]> {
  return (
    await db
      .prepare(
        'SELECT * FROM categories' +
          (onlyPublic ? ' WHERE active=1' : '') +
          ' ORDER BY position,name,id',
      )
      .all<Omit<Category, 'translations'> & { translations?: string }>()
  ).results.map((row) => ({
    ...row,
    translations: typeof row.translations === 'string' ? JSON.parse(row.translations) : {},
  }));
}
export async function cities(db: D1Database): Promise<City[]> {
  const r = await db.prepare('SELECT json FROM cities WHERE id=1').first<{ json: string }>();
  return r
    ? JSON.parse(r.json).map((c: string | City) => (typeof c === 'string' ? { city: c } : c))
    : [];
}
export async function productBySlug(db: D1Database, slug: string) {
  const r = await db
    .prepare('SELECT * FROM products WHERE slug=? AND active=1')
    .bind(slug)
    .first<Record<string, unknown>>();
  return r ? productRow(r) : null;
}
export async function cartProducts(db: D1Database, ids: string[]) {
  if (!ids.length) return [];
  const r = await db
    .prepare(
      'SELECT ' +
        galleryColumns +
        ' FROM products WHERE id IN (' +
        ids.map(() => '?').join(',') +
        ')',
    )
    .bind(...ids)
    .all<Record<string, unknown>>();
  return r.results.map(productRow);
}
export async function order(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first<OrderRow>();
}
export const parsedOrder = (o: OrderRow) => {
  const remote = o.remote ? merchantOrder(JSON.parse(o.remote)) : null;
  const original = JSON.parse(o.customer) as Customer;
  const shipping = o.shipping_status || remoteShipping(remote?.status);
  if (remote?.status) {
    remote.status.financial_status = financialStatus(o.financial_status, o.status, shipping);
    remote.status.financial_status_label = financialLabel(
      o.financial_status,
      o.status,
      remote.status.financial_status_label,
      shipping,
    );
  }
  const parsed = {
    ...o,
    last_error:
      o.last_error === 'remote_cod_changed' && closedOrder(shipping, o.status)
        ? null
        : o.last_error,
    customer: currentOrderCustomer(original, remote),
    original_customer: original,
    quote: JSON.parse(o.quote) as Quote,
    attribution: JSON.parse(o.attribution),
    remote,
    shipping_status: shipping,
    financial_status: financialStatus(o.financial_status, o.status, shipping),
    hold_reason:
      o.shipping_status === 'pending' && typeof remote?.status?.hold_reason === 'string'
        ? remote.status.hold_reason.trim() || null
        : null,
    remote_quote: o.remote_quote ? merchantQuoteProof(JSON.parse(o.remote_quote)) : null,
    dry_run_result: o.dry_run_result ? JSON.parse(o.dry_run_result) : null,
    matching: undefined,
    idempotency: undefined,
    request_hash: undefined,
  };
  return { ...parsed, pricing: orderPricing(parsed) };
};
export async function audit(db: D1Database, admin: string, action: string, target = '') {
  await db
    .prepare('INSERT INTO audit VALUES(?,?,?,?,?)')
    .bind(crypto.randomUUID(), admin, action, target, now())
    .run();
}
export async function state(db: D1Database, name: string) {
  const r = await db
    .prepare('SELECT json FROM sync_state WHERE name=?')
    .bind(name)
    .first<{ json: string }>();
  return r ? JSON.parse(r.json) : null;
}
export async function setState(db: D1Database, name: string, value: unknown) {
  await db
    .prepare(
      'INSERT INTO sync_state VALUES(?,?) ON CONFLICT(name) DO UPDATE SET json=excluded.json',
    )
    .bind(name, JSON.stringify(value))
    .run();
}
