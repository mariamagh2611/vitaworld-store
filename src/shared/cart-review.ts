import type { LocalCartLine, PublicProduct } from './types';

import { quantityPrice, QUANTITY_TAIL_ID } from './commerce';
// Refresh operational revisions without asking customers to approve a change
// when their SKU, supplier, quantity, selling price and shipping offer agree.
export function compatibleCartLine(line: LocalCartLine, product?: PublicProduct) {
  if (
    !product ||
    !product.active ||
    !product.verified ||
    product.sku !== line.sku ||
    product.supplier !== line.supplier ||
    product.stock < line.quantity
  )
    return false;
  if (
    product.bundleMode &&
    line.quantity !== 1 &&
    !product.offers.some((o) => o.quantity === line.quantity)
  )
    return false;
  if (
    line.offerId &&
    line.offerId !== QUANTITY_TAIL_ID &&
    !product.offers.some((o) => o.id === line.offerId && o.quantity === line.quantity)
  )
    return false;
  if (line.offerId === QUANTITY_TAIL_ID && !product.quantityPricing) return false;
  const current = quantityPrice(product, line.quantity);
  return (
    line.unitPrice === current.unitPrice &&
    (line.subtotal ?? line.unitPrice * line.quantity) === current.total &&
    !!line.freeShipping === current.freeShipping
  );
}
