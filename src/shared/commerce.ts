import type { Product, Offer, PublicProduct, PublicQuantityPricing } from './types';
export function activeOffer(offer: Pick<Offer, 'enabled' | 'endsAt'>, at = Date.now()) {
  return offer.enabled !== false && (!offer.endsAt || Date.parse(offer.endsAt) > at);
}
export function activePromotion(p: Product, at = Date.now()) {
  const promotion = p.presentation?.promotion;
  return (
    !!promotion &&
    promotion.price > 0 &&
    promotion.price < p.price &&
    (!promotion.endsAt || Date.parse(promotion.endsAt) > at)
  );
}
export const QUANTITY_TAIL_ID = 'quantity:more';
export function tailPricing(p: Product, at = Date.now()): PublicQuantityPricing | undefined {
  const rule = p.presentation?.quantityPricing;
  if (
    p.presentation?.bundleMode !== undefined ||
    !rule ||
    !activeOffer(rule, at) ||
    !p.offers.some((o) => o.enabled !== false)
  )
    return;
  const largest = Math.max(
    1,
    ...p.offers.filter((o) => o.enabled !== false).map((o) => o.quantity),
  );
  const fromQuantity = rule.fromQuantity ?? largest + 1;
  if (fromQuantity > 100) return;
  return {
    ...rule,
    fromQuantity,
    freeShipping: rule.freeShipping || !!p.presentation?.freeShipping,
  };
}
export function quantityPrice(
  p: Pick<PublicProduct, 'price' | 'revision' | 'offers' | 'freeShipping' | 'quantityPricing'>,
  quantity: number,
) {
  const exact = p.offers.find((o) => o.quantity === quantity);
  const tail =
    !exact && p.quantityPricing && quantity >= p.quantityPricing.fromQuantity
      ? p.quantityPricing
      : undefined;
  const total = exact ? exact.total : (tail?.unitPrice ?? p.price) * quantity;
  return {
    quantity,
    total,
    unitPrice: Math.round(total / quantity),
    offerId: exact?.id ?? (tail ? QUANTITY_TAIL_ID : ''),
    freeShipping: !!p.freeShipping || !!exact?.freeShipping || !!tail?.freeShipping,
    revision: exact?.revision ?? p.revision,
    label: exact?.label || '',
  };
}
export function pricedProduct(
  p: Product,
  at = Date.now(),
): Product & { freeShipping: boolean; quantityPricing?: PublicQuantityPricing } {
  const active = activePromotion(p, at);
  return {
    ...p,
    freeShipping: !!p.presentation?.freeShipping,
    quantityPricing: tailPricing(p, at),
    offers: p.offers
      .filter((o) => p.presentation?.bundleMode !== false && activeOffer(o, at))
      .map((o) => (p.presentation?.freeShipping ? { ...o, freeShipping: true } : o)),
    price: active ? p.presentation!.promotion!.price : p.price,
    revision: p.presentation?.promotion
      ? 1_000_000_000 + p.revision * 2 + Number(active)
      : p.revision,
  };
}
export function cartOffers(p: PublicProduct): Offer[] {
  // Keep a selected snapshot until the customer explicitly reviews server changes.
  return p.offers;
}

export function promotionClock(endsAt: string, at = Date.now()) {
  const seconds = Math.max(0, Math.ceil((Date.parse(endsAt) - at) / 1000));
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
    expired: !Number.isFinite(seconds) || seconds === 0,
  };
}
export function promotionRemaining(
  startsAt: string,
  endsAt: string,
  at = Date.now(),
): number | null {
  const start = Date.parse(startsAt),
    end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(0, Math.min(1, (end - at) / (end - start)));
}

export function bundleChoices(p: Pick<PublicProduct, 'offers' | 'stock'>) {
  return [1, ...p.offers.map((o) => o.quantity)]
    .filter((q, i, values) => q <= p.stock && values.indexOf(q) === i)
    .sort((a, b) => a - b);
}
