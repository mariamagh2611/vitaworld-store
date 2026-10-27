import { cityKey, isCasablancaAlias } from './cities';
import {
  pricedProduct,
  activeOffer,
  quantityPrice,
  tailPricing,
  QUANTITY_TAIL_ID,
} from './commerce';
import type { CartLine, Customer, Product, Quote, Settings, LocalCartLine, City } from './types';
import type { FieldIssue } from './validation';
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: FieldIssue[],
  ) {
    super(message);
  }
}
export function normalizePhone(value: string) {
  let s = value
    .replace(/[٠-٩۰-۹]/g, (c) => String(c.charCodeAt(0) - (c >= '۰' ? 1776 : 1632)))
    .replace(/[\s()+.-]/g, '');
  if (s.startsWith('00212')) s = '0' + s.slice(5);
  else if (s.startsWith('212')) s = '0' + s.slice(3);
  if (!/^0[567]\d{8}$/.test(s))
    throw new DomainError('invalid_phone', 'أدخل رقمًا مغربيًا من 10 أرقام يبدأ بـ05 أو06 أو07.');
  return s;
}
export function customerInput(c: Customer): Customer {
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const r = {
    name: clean(c.name, 120),
    phone: normalizePhone(c.phone || ''),
    city: clean(c.city, 100),
    address: clean(c.address, 500),
    notes: clean(c.notes, 500),
  };
  if (r.name.length < 2 || r.city.length < 2 || r.address.length < 5)
    throw new DomainError('invalid_customer', 'أكمل الاسم والمدينة والعنوان بالتفصيل.');
  return r;
}
export function isCasa(city: string, cities: City[] = []) {
  if (isCasablancaAlias(city)) return true;
  const matched = cities.find((c) => cityKey(c.city) === cityKey(city));
  if (typeof matched?.is_casablanca === 'boolean') return matched.is_casablanca;
  return false;
}
export function offerUnitPrice(total: number, quantity: number) {
  return Math.round(total / quantity);
}
export function wholesaleTotal(items: Quote['items'], products: Product[]) {
  let wholesale = 0;
  for (const item of items) {
    const cost = products.find((p) => p.id === item.productId)?.fulfillment;
    if (!Number.isSafeInteger(cost) || cost === null || cost === undefined || cost < 0)
      throw new DomainError('missing_fulfillment_price', 'أحد المنتجات غير متاح للطلب حاليًا.');
    wholesale += cost * item.quantity;
  }
  return wholesale;
}
export function platformShipping(city: string, cities: City[] = []) {
  const matched = cities.find((c) => cityKey(c.city) === cityKey(city));
  if (
    matched &&
    typeof matched.shipping_fee_mad === 'number' &&
    Number.isFinite(matched.shipping_fee_mad) &&
    matched.shipping_fee_mad >= 0
  )
    return Math.round(matched.shipping_fee_mad * 100);
  return isCasa(city, cities) ? 2000 : 3000;
}
export function assertOrderMargin(
  items: Quote['items'],
  products: Product[],
  total: number,
  shippingCost: number,
) {
  if (total < wholesaleTotal(items, products) + shippingCost)
    throw new DomainError(
      'negative_order_margin',
      'هذا العرض غير متاح حاليًا. اختر عرضًا آخر أو تواصل معنا.',
    );
}
// The same conservative projection drives the editor and authoritative guard.
export function priceProjection(
  total: number,
  wholesale: number | null,
  freeShipping: boolean,
  s: Settings,
  productShipping: Pick<Product, 'shippingCasa' | 'shippingOther' | 'presentation'> = {},
  maximumShipping: number | null = 3000,
) {
  freeShipping = freeShipping || !!productShipping.presentation?.freeShipping;
  const thresholdFree = s.cartFreeShippingThreshold > 0 && total >= s.cartFreeShippingThreshold;
  const fees = [
    thresholdFree ? 0 : s.shippingCasa,
    thresholdFree ? 0 : s.shippingOther,
    productShipping.shippingCasa ?? s.shippingCasa,
    productShipping.shippingOther ?? s.shippingOther,
  ];
  const shipping = freeShipping ? 0 : Math.min(...fees);
  return {
    total: total + shipping,
    customerShipping: shipping,
    wholesale,
    shippingCost: maximumShipping,
    profit:
      wholesale === null || maximumShipping === null
        ? null
        : total + shipping - wholesale - maximumShipping,
  };
}
export function minimumPackagePrice(
  wholesale: number,
  freeShipping: boolean,
  s: Settings,
  productShipping: Pick<Product, 'shippingCasa' | 'shippingOther' | 'presentation'> = {},
  maximumShipping = 3000,
) {
  freeShipping = freeShipping || !!productShipping.presentation?.freeShipping;
  const fees = [
    s.shippingCasa,
    s.shippingOther,
    productShipping.shippingCasa ?? s.shippingCasa,
    productShipping.shippingOther ?? s.shippingOther,
  ];
  let minimum = Math.max(1, wholesale + maximumShipping - (freeShipping ? 0 : Math.min(...fees)));
  if (s.cartFreeShippingThreshold > 0) {
    const threshold = s.cartFreeShippingThreshold;
    const discountedBound =
      threshold > maximumShipping
        ? Number(
            (BigInt(threshold) * BigInt(wholesale) + BigInt(threshold - maximumShipping) - 1n) /
              BigInt(threshold - maximumShipping),
          )
        : Infinity;
    minimum = Math.max(
      minimum,
      discountedBound <= threshold ? discountedBound : wholesale + maximumShipping,
    );
    if (minimum >= threshold) minimum = Math.max(minimum, wholesale + maximumShipping);
  }
  return minimum;
}
export function shippingScenarios(
  total: number,
  wholesale: number | null,
  freeShipping: boolean,
  s: Settings,
  productShipping: Pick<Product, 'shippingCasa' | 'shippingOther' | 'presentation'>,
  costs: { casa: number; other: number } | null,
) {
  freeShipping = freeShipping || !!productShipping.presentation?.freeShipping;
  return (['direct', 'cart'] as const).flatMap((mode) =>
    (['casa', 'other'] as const).map((area) => {
      const customerShipping =
        freeShipping ||
        (mode === 'cart' && s.cartFreeShippingThreshold > 0 && total >= s.cartFreeShippingThreshold)
          ? 0
          : mode === 'direct'
            ? area === 'casa'
              ? (productShipping.shippingCasa ?? s.shippingCasa)
              : (productShipping.shippingOther ?? s.shippingOther)
            : area === 'casa'
              ? s.shippingCasa
              : s.shippingOther;
      const shippingCost = costs?.[area] ?? null;
      return {
        mode,
        area,
        products: total,
        customerShipping,
        total: total + customerShipping,
        wholesale,
        shippingCost,
        profit:
          wholesale === null || shippingCost === null
            ? null
            : total + customerShipping - wholesale - shippingCost,
      };
    }),
  );
}
export function assertPricePackage(
  total: number,
  wholesale: number,
  freeShipping: boolean,
  s: Settings,
  productShipping: Pick<Product, 'shippingCasa' | 'shippingOther' | 'presentation'> = {},
  maximumShipping = 3000,
) {
  const projection = priceProjection(
    total,
    wholesale,
    freeShipping,
    s,
    productShipping,
    maximumShipping,
  );
  if (projection.profit! < 0)
    throw new DomainError(
      'invalid_offer_price',
      'السعر لا يغطي التكلفة الإجمالية القصوى لمورد. ارفع السعر أو رسوم التوصيل.',
      400,
    );
  const threshold = s.cartFreeShippingThreshold || 0,
    margin = total - wholesale;
  if (
    threshold > 0 &&
    (margin < 0 ||
      (margin === 0 && maximumShipping > 0) ||
      BigInt(Math.max(threshold, total)) * BigInt(margin) < BigInt(maximumShipping) * BigInt(total))
  )
    throw new DomainError(
      'unsafe_free_shipping_threshold',
      'ارفع السعر أو مبلغ أهلية التوصيل المجاني لضمان تغطية تكلفة مورد لكل سلة.',
    );
}
export function assertPublishedPrices(
  price: number,
  offers: Product['offers'],
  cost: number | null,
  s: Settings,
  productShipping: Pick<Product, 'shippingCasa' | 'shippingOther' | 'presentation'> = {},
  maximumShipping = 3000,
) {
  if (cost === null || !Number.isSafeInteger(cost) || cost < 0)
    throw new DomainError('missing_fulfillment_price', 'تكلفة الجملة غير متاحة لنشر المنتج.');
  if (productShipping.presentation?.bundleMode === false) offers = [];
  const active = offers.filter((o) => activeOffer(o));
  const tail = tailPricing({ offers, presentation: productShipping.presentation } as Product);
  const checks = [
    { total: price, quantity: 1, freeShipping: false, field: 'price' },
    ...(!productShipping.presentation?.bundleMode
      ? [{ total: price * 100, quantity: 100, freeShipping: false, field: 'price' }]
      : []),
    ...active.map((o) => ({ ...o, field: `offers.${offers.indexOf(o)}.total` })),
    ...(tail
      ? [tail.fromQuantity, 100].map((quantity) => ({
          total: tail.unitPrice * quantity,
          quantity,
          freeShipping: tail.freeShipping,
          field: 'presentation.quantityPricing.unitPrice',
        }))
      : []),
  ];
  for (const option of checks) {
    try {
      if (offerUnitPrice(option.total, option.quantity) <= 0)
        throw new DomainError('invalid_offer_price', 'المبلغ صغير جدًا للكمية المحددة.');
      assertPricePackage(
        option.total,
        cost * option.quantity,
        option.freeShipping,
        s,
        productShipping,
        maximumShipping,
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      throw new DomainError(error.code, error.message, 400, [
        {
          field: option.field,
          label: option.field === 'price' ? 'السعر بالدرهم' : 'إجمالي العرض بالدرهم',
          message: error.message,
        },
      ]);
    }
  }
}
export function quoteCart(
  lines: CartLine[],
  products: Product[],
  city: string,
  s: Settings,
  cities: City[] = [],
  checkoutMode: 'cart' | 'direct' = 'cart',
  maximumShipping = 3000,
): Omit<Quote, 'fingerprint'> {
  const pricedProducts = products.map((p) => pricedProduct(p));
  if (lines.some((l) => l.offerId.startsWith('checkout:')))
    throw new DomainError(
      'invalid_checkout_offer',
      'انتهى هذا العرض. راجع بيانات السلة قبل تأكيد الطلب.',
      409,
    );
  if (checkoutMode === 'direct' && lines.length !== 1)
    throw new DomainError('invalid_direct_order', 'الطلب المباشر مخصص لعرض منتج واحد.');
  if (!lines.length || lines.length > 30)
    throw new DomainError('invalid_cart', 'السلة فارغة أو تجاوزت الحد المسموح.');
  const seen = new Set<string>();
  let supplier: string | undefined;
  const items = lines.map((l) => {
    const p = pricedProducts.find((p) => p.id === l.productId);
    if (!p || !p.active || !p.verified || !p.supplier)
      throw new DomainError('unavailable_product', 'أحد المنتجات غير متاح للشراء.');
    if (seen.has(p.sku)) throw new DomainError('duplicate_sku', 'اختر عرضًا واحدًا لكل صنف.');
    seen.add(p.sku);
    if (supplier && supplier !== p.supplier)
      throw new DomainError(
        'mixed_suppliers_not_allowed',
        'لا يمكن جمع منتجات موردين مختلفين في سلة واحدة.',
      );
    supplier = p.supplier;
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 100)
      throw new DomainError('invalid_quantity', 'الكمية غير صالحة.');
    if (
      p.presentation?.bundleMode &&
      l.quantity !== 1 &&
      !p.offers.some((o) => o.quantity === l.quantity)
    )
      throw new DomainError(
        'bundle_quantity_unavailable',
        'اختر إحدى الباقات المتاحة لهذا المنتج.',
        409,
      );
    const selected = quantityPrice(p, l.quantity);
    const expectedRevision = selected.revision;
    if (l.revision !== expectedRevision)
      throw new DomainError(
        'cart_changed',
        'تغيرت بيانات أحد المنتجات. راجع السلة قبل المتابعة.',
        409,
      );
    if (l.offerId && l.offerId !== selected.offerId) {
      const exists =
        l.offerId === QUANTITY_TAIL_ID
          ? !!p.quantityPricing
          : p.offers.some((o) => o.id === l.offerId);
      throw new DomainError(
        exists ? 'invalid_offer' : 'offer_changed',
        exists ? 'كمية العرض غير مطابقة.' : 'العرض لم يعد متاحًا.',
        409,
      );
    }
    const unitPrice = selected.unitPrice,
      subtotal = selected.total;
    if (
      !Number.isSafeInteger(unitPrice) ||
      unitPrice <= 0 ||
      !Number.isSafeInteger(subtotal) ||
      subtotal <= 0
    )
      throw new DomainError('invalid_price', 'قيمة العرض غير صالحة.');
    if (l.quantity > p.stock)
      throw new DomainError('out_of_stock', 'الكمية المطلوبة غير متوفرة حاليًا.');
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      offerId: selected.offerId,
      quantity: l.quantity,
      unitPrice,
      subtotal,
      freeShipping: selected.freeShipping,
      revision: expectedRevision,
    };
  });
  const subtotal = items.reduce((a, l) => a + l.subtotal, 0),
    directProduct =
      checkoutMode === 'direct' ? products.find((p) => p.id === items[0].productId) : undefined,
    shippingReason: 'standard' | 'offer' | 'threshold' = items.some((i) => i.freeShipping)
      ? 'offer'
      : checkoutMode === 'cart' &&
          s.cartFreeShippingThreshold > 0 &&
          subtotal >= s.cartFreeShippingThreshold
        ? 'threshold'
        : 'standard',
    shipping =
      shippingReason !== 'standard'
        ? 0
        : isCasa(city, cities)
          ? (directProduct?.shippingCasa ?? s.shippingCasa)
          : (directProduct?.shippingOther ?? s.shippingOther);
  const total = subtotal + shipping;
  assertOrderMargin(items, products, total, maximumShipping);
  return { supplier: supplier!, items, subtotal, shipping, total, shippingReason };
}
export function addToCart(cart: LocalCartLine[], line: LocalCartLine) {
  if (cart.length && cart[0].supplier !== line.supplier)
    throw new DomainError(
      'mixed_suppliers_not_allowed',
      'هذا المنتج من مورد مختلف. أفرغ السلة أولًا لإضافته.',
    );
  return [...cart.filter((l) => l.sku !== line.sku), line];
}
export function checkoutIntent(cart: CartLine[], customer: Record<string, string>) {
  let phone = customer.phone || '';
  try {
    phone = normalizePhone(phone);
  } catch {}
  return JSON.stringify({
    cart: cart
      .map(({ productId, offerId, quantity }) => ({ productId, offerId, quantity }))
      .sort((a, b) => a.productId.localeCompare(b.productId)),
    customer: Object.fromEntries(
      ['name', 'city', 'address', 'notes'].map((k) => [
        k,
        (customer[k] || '').trim().normalize('NFKC').toLowerCase(),
      ]),
    ),
    phone,
  });
}
export function mowaridPayload(
  order: { id: string; customer: Customer; quote: Quote },
  quoteId?: string,
) {
  return {
    external_order_id: order.id,
    ...(order.quote.storeIdentity
      ? { store: { name: order.quote.storeIdentity.name, url: order.quote.storeIdentity.url } }
      : {}),
    ...(quoteId ? { quote_id: quoteId } : {}),
    customer_name: order.customer.name,
    customer_phone: order.customer.phone,
    city: order.customer.city,
    address: order.customer.address,
    // These instructions are printed on the parcel's delivery label.
    // Store identity is sent only in the dedicated store object.
    notes: order.customer.notes,
    customer_shipping_fee: order.quote.shipping / 100,
    cod_to_collect: order.quote.total / 100,
    items: order.quote.items.map((i) => ({
      product_code: i.sku,
      quantity: i.quantity,
      retail_price: i.unitPrice / 100,
    })),
  };
}
