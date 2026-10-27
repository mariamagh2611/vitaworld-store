import { expect, it } from 'vitest';
import { productCopy, updateProductCopy } from '../src/admin/product-copy';
import { localizedProduct } from '../src/shared/i18n';
import type { Product } from '../src/shared/types';
const p = {
  name: 'اسم أصلي',
  description: 'وصف أصلي',
  keywords: 'أصلي',
  presentation: {
    translations: {
      ar: { name: 'اسم عربي محفوظ' },
      fr: {
        name: 'Ancien nom',
        descriptionFormat: 'html',
        descriptionHtml: '<p>Ancienne description</p>',
      },
    },
  },
} as Product;
it('keeps existing translated and original copy when switching one editor between languages', () => {
  expect(productCopy(p, 'ar', 'ar').name).toBe('اسم عربي محفوظ');
  expect(productCopy(p, 'fr', 'ar').descriptionHtml).toBe('<p>Ancienne description</p>');
  const changed = updateProductCopy(p, 'fr', 'ar', {
    name: 'Nom français',
    keywords: 'motfrançais',
    descriptionFormat: 'text',
    description: 'Description française',
  });
  expect(changed.name).toBe(p.name);
  expect(changed.description).toBe(p.description);
  expect(localizedProduct(changed, 'fr')).toMatchObject({
    name: 'Nom français',
    keywords: 'motfrançais',
    description: 'Description française',
  });
  expect(productCopy(changed, 'ar', 'ar').name).toBe('اسم عربي محفوظ');
  expect(productCopy(changed, 'en', 'ar')).toMatchObject({
    name: '',
    description: '',
    keywords: '',
  });
});
it('updates the base copy and its older override together without losing other languages', () => {
  const changed = updateProductCopy(p, 'ar', 'ar', {
    name: 'اسم جديد',
    description: 'وصف جديد',
    keywords: 'بحثجديد',
  });
  expect(changed).toMatchObject({
    name: 'اسم جديد',
    description: 'وصف جديد',
    keywords: 'بحثجديد',
    presentation: { contentLanguage: 'ar' },
  });
  expect(localizedProduct(changed, 'ar').name).toBe('اسم جديد');
  expect(changed.presentation!.translations!.fr).toEqual(p.presentation!.translations!.fr);
});
