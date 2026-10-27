export type ProductSort = '' | 'price-asc' | 'price-desc';
export function productSort(value: string | null, enabled = true): ProductSort {
  return enabled && (value === 'price-asc' || value === 'price-desc') ? value : '';
}
export function sortedProducts<T extends { id: string }>(
  products: T[],
  sort: ProductSort,
  price: (p: T) => number,
  searchIds?: string[],
): T[] {
  const ranks = new Map((searchIds || []).map((id, index) => [id, index]));
  return [...products].sort((a, b) => {
    if (sort) return (price(a) - price(b)) * (sort === 'price-desc' ? -1 : 1);
    if (searchIds)
      return (
        (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      );
    return 0;
  });
}
