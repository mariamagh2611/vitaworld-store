import { pricedProduct } from './commerce';
import type { Product } from './types';

/** Only explicitly chosen, published and currently orderable SKUs can be alternatives. */
export function landingProducts(anchor: Product, rows: Product[]): Product[] {
  const ids = [...new Set(anchor.presentation?.landingProductIds || [])].slice(0, 6);
  return [
    anchor,
    ...ids.flatMap((id) => {
      const p = rows.find((p) => p.id === id && p.id !== anchor.id);
      return p?.active && p.verified && p.supplier && p.stock > 0 ? [p] : [];
    }),
  ];
}

/** Merchant confirms these are the pack's individual components, one of each. */
export function landingPackSavings(anchor: Product, rows: Product[]): number {
  const ids = [...new Set(anchor.presentation?.landingPackComponentIds || [])];
  const choices = landingProducts(anchor, rows).slice(1);
  if (ids.length < 2 || !ids.every((id) => choices.some((p) => p.id === id))) return 0;
  return Math.max(
    0,
    ids.reduce((sum, id) => sum + pricedProduct(choices.find((p) => p.id === id)!).price, 0) -
      pricedProduct(anchor).price,
  );
}
