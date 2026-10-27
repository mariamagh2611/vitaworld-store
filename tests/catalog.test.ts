import { describe, it, expect } from 'vitest';
import { catalogImages, catalogMedia, catalogSearchKeywords } from '../src/shared/catalog';

describe('catalog image contract', () => {
  it('prefers main_image and retains variant and legacy parent fallbacks', () => {
    expect(
      catalogMedia({ main_image: 'https://mowarid.ma/main.jpg', images: ['/other.jpg'] }),
    ).toEqual({
      main_image: 'https://mowarid.ma/main.jpg',
      images: ['https://mowarid.ma/main.jpg', 'https://mowarid.ma/other.jpg'],
    });
    expect(catalogMedia({ images: [] }, { main_image: '/parent.jpg' }).main_image).toBe(
      'https://mowarid.ma/parent.jpg',
    );
    expect(
      catalogMedia(
        { main_image: 'javascript:alert(1)', images: ['/variant.jpg'] },
        { images: ['/parent.jpg'] },
      ).main_image,
    ).toBe('https://mowarid.ma/variant.jpg');
  });
  it('resolves real relative Mowarid images and falls back to the parent when a variant has no photos', () => {
    expect(catalogImages(['/api/media/product.jpg'])).toEqual([
      'https://mowarid.ma/api/media/product.jpg',
    ]);
    expect(catalogImages([], ['/api/media/parent.webp'])).toEqual([
      'https://mowarid.ma/api/media/parent.webp',
    ]);
    expect(
      catalogImages(['https://cdn.example.test/variant.webp'], ['/api/media/parent.webp']),
    ).toEqual(['https://cdn.example.test/variant.webp']);
  });
  it('does not turn scripts, insecure URLs, credentials or invalid image objects into rendered images', () => {
    expect(
      catalogImages([
        'javascript:alert(1)',
        'data:image/svg+xml,x',
        'http://unsafe.test/x',
        'https://user:password@example.test/x',
        null,
        {},
      ]),
    ).toEqual([]);
  });
});
describe('product search keywords', () => {
  it('retains supplier keywords and adds multilingual aliases for the named ingredients', () => {
    const words = catalogSearchKeywords({
      name: 'Pack Collagène Marin + Sélénium',
      search_keywords: 'marin, مورد',
    });
    expect(words).toContain('مورد');
    expect(words).toContain('كولاجين');
    expect(words).toContain('collagen');
    expect(words).toContain('سيلينيوم');
    expect(catalogSearchKeywords({ name: 'Mass Plus' })).toContain('ماس بلاس');
  });
  it('does not assign another product’s aliases based on generic words or claims in the description', () => {
    const words = catalogSearchKeywords({
      name: 'Vitamin C Plus',
      description: 'alternative to Mass Plus and Collagen',
    });
    expect(words).toContain('فيتامين');
    expect(words).not.toContain('ماس بلاس');
    expect(words).not.toContain('كولاجين');
    expect(catalogSearchKeywords({ parent_name: 'Magnésium Glycinate' })).toContain('مغنيسيوم');
  });
});
