import { catalogDescriptions, catalogSearchKeywords } from '../shared/catalog';
import type { Product, Language } from '../shared/types';
export function emptyProduct(language: Language): Product {
  return {
    id: crypto.randomUUID(),
    slug: '',
    sku: '',
    parentId: null,
    name: '',
    description: '',
    image: '',
    price: 10000,
    minimum: 0,
    fulfillment: null,
    stock: 0,
    active: 0,
    featured: 0,
    supplier: null,
    verified: 0,
    offers: [],
    blocks: [],
    color: '#173d35',
    formColor: '#f3f0e9',
    revision: 1,
    shippingCasa: null,
    shippingOther: null,
    categoryId: null,
    pageMode: 'product',
    presentation: { landingLanguage: language },
    storefrontVisible: 1,
    gallery: [],
    keywords: '',
  };
}

export function catalogText(source: string): string {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  parsed
    .querySelectorAll('script,style,iframe,object,svg,math,template')
    .forEach((element) => element.remove());
  parsed
    .querySelectorAll('p,div,br,li,h1,h2,h3,h4,h5,h6,tr')
    .forEach((element) => element.append('\n'));
  return (parsed.body.textContent || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}
export function importedDescription(c: Record<string, any>, format: 'text' | 'html') {
  const source = catalogDescriptions(c);
  return {
    description: catalogText(source.text),
    descriptionFormat: format,
    descriptionHtml: format === 'html' ? source.html : undefined,
  };
}
export function productFromCatalog(
  base: Product,
  c: Record<string, any>,
  format: 'text' | 'html' = 'text',
): Product {
  const content = importedDescription(c, format);
  return {
    ...base,
    sku: c.sku,
    slug:
      base.slug ||
      c.sku
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100) ||
      'product-' + base.id.slice(0, 8),
    name: c.name || c.parent_name || c.sku,
    description: content.description,
    presentation: {
      ...base.presentation,
      descriptionFormat: content.descriptionFormat,
      descriptionHtml: content.descriptionHtml,
    },
    price:
      typeof c.suggested_retail_price === 'number' && c.suggested_retail_price > 0
        ? Math.round(c.suggested_retail_price * 100)
        : base.price,
    image: c.main_image || c.images?.[0] || '',
    gallery: (c.images || []).slice(0, 12),
    supplier: c.supplier_key || null,
    stock: c.stock_quantity || 0,
    minimum: Math.round((c.minimum_selling_price || 0) * 100),
    fulfillment: c.fulfillment_price == null ? null : Math.round(c.fulfillment_price * 100),
    keywords: catalogSearchKeywords(c) || base.keywords || '',
  };
}
