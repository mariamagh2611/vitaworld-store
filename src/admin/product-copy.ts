import type { Language, Product } from '../shared/types';
import { localizedProduct } from '../shared/i18n';
export type ProductCopy = {
  name: string;
  description: string;
  keywords: string;
  descriptionFormat: 'text' | 'html';
  descriptionHtml: string;
};
export function productCopy(
  product: Product,
  language: Language,
  baseLanguage: Language,
): ProductCopy {
  if (language === baseLanguage) {
    const p = localizedProduct(product, language);
    return {
      name: p.name,
      description: p.description,
      keywords: p.keywords || '',
      descriptionFormat: p.presentation?.descriptionFormat || 'text',
      descriptionHtml: p.presentation?.descriptionHtml || '',
    };
  }
  const copy = product.presentation?.translations?.[language];
  return {
    name: copy?.name || '',
    description: copy?.description || '',
    keywords: copy?.keywords || '',
    descriptionFormat: copy?.descriptionFormat || 'text',
    descriptionHtml: copy?.descriptionHtml || '',
  };
}
export function updateProductCopy(
  product: Product,
  language: Language,
  baseLanguage: Language,
  change: Partial<ProductCopy>,
): Product {
  const presentation = { ...product.presentation, contentLanguage: baseLanguage };
  if (language !== baseLanguage)
    return {
      ...product,
      presentation: {
        ...presentation,
        translations: {
          ...presentation.translations,
          [language]: { ...presentation.translations?.[language], ...change },
        },
      },
    };
  const { descriptionFormat, descriptionHtml, ...fields } = change;
  return {
    ...product,
    ...fields,
    presentation: {
      ...presentation,
      ...(descriptionFormat !== undefined ? { descriptionFormat } : {}),
      ...(descriptionHtml !== undefined ? { descriptionHtml } : {}),
      ...(presentation.translations?.[language]
        ? {
            translations: {
              ...presentation.translations,
              [language]: { ...presentation.translations[language], ...change },
            },
          }
        : {}),
    },
  };
}
