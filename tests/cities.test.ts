import { describe, it, expect } from 'vitest';
import { cityKey, canonicalCity, citySuggestions } from '../src/shared/cities';
import { isCasa, quoteCart } from '../src/shared/domain';
import { defaults, type Product } from '../src/shared/types';
describe('shared city recognition', () => {
  it('recognizes Arabic and Latin Casablanca names without matching other cities', () => {
    for (const name of [
      'البيضاء',
      'كازا',
      'الدارالبيضاء',
      'الدار البيضاء',
      'البيضا',
      'كَازَا',
      'casa',
      'CASA',
      'Kaza',
      'Casablanca',
      'Casa Blanca',
      'Dar El Beïda',
    ]) {
      expect(isCasa(name), name).toBe(true);
      expect(canonicalCity(name), name).toBe('CASABLANCA');
    }
    for (const name of ['Rabat', 'طنجة', 'Casa Rural', 'Casablanca Sud'])
      expect(isCasa(name)).toBe(false);
    expect(isCasa('BOUSKOURA', [{ city: 'Bouskoura', is_casablanca: true }])).toBe(true);
    expect(cityKey(' دارُ البيضاء ')).toBe(cityKey('دار البيضاء'));
  });
  it('suggests the canonical choice for aliases and keeps manual unlisted cities', () => {
    expect(citySuggestions(['RABAT', 'CASABLANCA', 'FES'], 'كازا')).toEqual(['CASABLANCA']);
    expect(citySuggestions(['RABAT', 'CASABLANCA', 'FES'], 'cas')).toEqual(['CASABLANCA']);
    expect(canonicalCity('قرية غير مدرجة', [{ city: 'RABAT' }])).toBe('قرية غير مدرجة');
  });
  it('quotes aliases with the merchant Casablanca rate before checkout', () => {
    const product = {
      id: 'p',
      slug: 'p',
      parentId: null,
      description: '',
      image: '',
      featured: 0,
      blocks: [],
      color: '#173d35',
      formColor: '#173d35',
      sku: 'P',
      name: 'Product',
      price: 14500,
      minimum: 0,
      fulfillment: 7500,
      supplier: 's',
      stock: 10,
      active: 1,
      verified: 1,
      offers: [],
      revision: 1,
    } as Product;
    for (const city of ['كازا', 'البيضاء', 'Casa', 'CASABLANCA'])
      expect(
        quoteCart(
          [{ productId: 'p', offerId: '', quantity: 1, revision: 1 }],
          [product],
          city,
          defaults,
        ),
      ).toMatchObject({ shipping: 2000, total: 16500 });
    expect(
      quoteCart(
        [{ productId: 'p', offerId: '', quantity: 1, revision: 1 }],
        [product],
        'Rabat',
        defaults,
      ).shipping,
    ).toBe(3000);
  });
});
