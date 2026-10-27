import { searchTokens } from '../shared/search';
import { productRow, galleryColumns } from './db';

export async function searchProducts(db: D1Database, query: string, supplier?: string) {
  const terms = searchTokens(query);
  if (!terms.length) return [];
  const match = terms
    .map((term) => {
      if (!/[\u0621-\u064a]/.test(term)) return '"' + term + '"*';
      const prefix = ['وال', 'بال', 'كال'].find(
        (prefix) => term.startsWith(prefix) && term.length > 6,
      );
      const base = prefix
        ? term.slice(3)
        : term.startsWith('لل') && term.length > 4
          ? term.slice(2)
          : term.startsWith('ال') && term.length > 4
            ? term.slice(2)
            : term;
      return (
        '(' +
        [
          ...new Set([
            term,
            ...['', 'ال', 'و', 'وال', 'ب', 'بال', 'ل', 'لل', 'ك', 'كال'].map(
              (prefix) => prefix + base,
            ),
          ]),
        ]
          .map((word) => '"' + word + '"*')
          .join(' OR ') +
        ')'
      );
    })
    .join(' AND ');
  const priority =
    'product_search.rowid IN (SELECT rowid FROM product_search WHERE product_search MATCH ?)';
  const result = await db
    .prepare(
      'SELECT ' +
        galleryColumns +
        ' FROM product_search JOIN products ON products.id=product_search.product_id WHERE product_search MATCH ? AND products.active=1 AND products.storefront_visible=1' +
        (supplier ? ' AND products.supplier=?' : '') +
        ' ORDER BY CASE WHEN ' +
        priority +
        ' THEN 0 WHEN ' +
        priority +
        ' THEN 1 WHEN ' +
        priority +
        ' THEN 2 ELSE 3 END,bm25(product_search,0,10,6,1,4),products.featured DESC,products.name LIMIT 60',
    )
    .bind(
      match,
      ...(supplier ? [supplier] : []),
      'title : (' + match + ')',
      'terms : (' + match + ')',
      'department : (' + match + ')',
    )
    .all<Record<string, unknown>>();
  return result.results.map(productRow);
}
