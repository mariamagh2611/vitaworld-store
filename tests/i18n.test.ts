import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { defaults, money, type Product } from '../src/shared/types';
import {
  languageOf,
  enabledStoreLanguages,
  visitorLanguage,
  direction,
  translator,
  storefrontSettings,
  localizedForm,
  localizedProduct,
  landingSettings,
  localizedLandingButton,
  updateContent,
} from '../src/shared/i18n';
import { settingsSchema, productSchema } from '../src/server/schemas';
import entries from '../src/shared/translations.json';
import storeEntries from '../src/shared/store-translations.json';
import { fieldIssues } from '../src/shared/validation';
import { OrderForm } from '../src/server/views';

describe('independent dashboard and storefront languages', () => {
  it('defaults legacy search to visible and keeps its visibility global across translated appearance', () => {
    const { showSearch: _, ...legacyHome } = defaults.home;
    expect(settingsSchema.parse({ ...defaults, home: legacyHome }).home.showSearch).toBe(true);
    const configured = {
      ...defaults,
      home: { ...defaults.home, showSearch: false },
      contentTranslations: { fr: { home: { showSearch: true } } },
    };
    expect(storefrontSettings({ ...configured, storeLanguage: 'fr' }).home.showSearch).toBe(false);
  });
  it('translates built-in store content and form labels without changing dashboard preference', () => {
    const s = { ...defaults, adminLanguage: 'en' as const, storeLanguage: 'fr' as const };
    const localized = storefrontSettings(s);
    expect(localized.adminLanguage).toBe('en');
    expect(localized.heroTitle).toBe('Des choix qui vous ressemblent.\nLivrés chez vous.');
    expect(localized.brand).toBe(defaults.brand);
    expect(localizedForm(s).nameLabel).toBe('Nom complet');
    expect(localizedForm(s).cityLabel).toBe('Ville');
    for (const language of ['ar', 'fr', 'en'] as const)
      expect(
        localizedForm(s, { formSubtitle: translator(language)('خطوة واحدة تفصلك عن طلبك') })
          .formSubtitle,
      ).toBe('');
    expect(localizedForm(s, { formSubtitle: 'Votre routine' }).formSubtitle).toBe('Votre routine');
    expect(translator('fr')('إغلاق')).toBe('Fermer');
    expect(localizedForm(s, { nameLabel: 'الاسم الكامل' }).nameLabel).toBe('Nom complet');
    expect(localizedForm(s, { nameLabel: 'Votre prénom' }).nameLabel).toBe('Votre prénom');
    expect(
      localizedForm({ ...s, storeLanguage: 'ar' }, { nameLabel: 'Nom complet' }).nameLabel,
    ).toBe('الاسم الكامل');
    expect(localizedForm(s, { submitText: 'Confirm order · Pay on delivery →' }).submitText).toBe(
      'Confirmer la commande · Paiement à la livraison →',
    );
    expect(direction(s.storeLanguage)).toBe('ltr');
  });
  it('preserves merchant prose and stores overrides separately for each language', () => {
    const original = { ...defaults, heroTitle: 'عنوان خاص بالمسوّق' };
    const fr = updateContent(
      { ...original, storeLanguage: 'fr' },
      { heroTitle: 'Bienvenue chez nous', copy: { 'متابعة التسوق': 'Poursuivre mes achats' } },
    );
    expect(storefrontSettings(fr).heroTitle).toBe('Bienvenue chez nous');
    expect(storefrontSettings({ ...fr, storeLanguage: 'ar' }).heroTitle).toBe(original.heroTitle);
    expect(translator('fr', fr.contentTranslations.fr?.copy)('متابعة التسوق')).toBe(
      'Poursuivre mes achats',
    );
    expect(translator('en')('متابعة التسوق')).toBe('Continue shopping');
    expect(original.contentTranslations).toEqual({});
  });
  it('uses translated product prose when supplied, keeping supplier identity and amounts', () => {
    const p = productSchema.parse({
      id: 'p',
      slug: 'test',
      sku: 'SKU-1',
      name: 'المنتج الأصلي',
      description: 'الوصف الأصلي',
      image: '',
      price: 14900,
      active: 1,
      featured: 0,
      offers: [],
      blocks: [],
      color: '#173d35',
      formColor: '#f3f0e9',
      presentation: {
        deliveryReturns: 'الأصل',
        translations: {
          fr: {
            name: 'Sac quotidien',
            description: 'Une description française',
            deliveryReturns: 'Livraison et retours personnalisés',
          },
        },
      },
    });
    const product = {
      ...p,
      parentId: null,
      minimum: 0,
      fulfillment: 8000,
      stock: 10,
      supplier: 'one',
      verified: 1,
      revision: 1,
    };
    expect(localizedProduct(product, 'fr').name).toBe('Sac quotidien');
    expect(localizedProduct(product, 'en').name).toBe(product.name);
    expect(localizedProduct(product, 'fr').price).toBe(product.price);
    expect(localizedProduct(product, 'fr').supplier).toBe(product.supplier);
  });
  it('validates language and content keys, rejects settings injection, and formats MAD by locale', () => {
    expect(languageOf('unsupported')).toBe('ar');
    expect(money(29550, 'fr')).toBe('295,5 MAD');
    expect(money(29550, 'en')).toBe('295.5 MAD');
    expect(settingsSchema.safeParse({ ...defaults, storeLanguage: 'de' }).success).toBe(false);
    expect(
      settingsSchema.safeParse({ ...defaults, contentTranslations: { fr: { shippingOther: 0 } } })
        .success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({
        ...defaults,
        contentTranslations: { fr: { copy: { '<script>': 'x' } } },
      }).success,
    ).toBe(false);
  });
  it('keeps default labels for empty custom fields and spaces between policy links', async () => {
    const html = await OrderForm({
      s: { ...defaults, storeLanguage: 'en' },
      content: { nameLabel: '', submitText: '' },
    }).toString();
    expect(html).toContain('Full name');
    expect(html).toContain('Confirm order · Pay on delivery');
    expect(html).toContain('By submitting, you accept <a');
    expect(html).toContain('Terms</a> and <a');
  });
  it('localizes validation messages with their actual numeric limits', () => {
    const invalid = productSchema.safeParse({ description: 'x'.repeat(20001) });
    if (invalid.success) throw new Error('Expected validation');
    const issue = fieldIssues(invalid.error.issues, false, translator('fr', {}, entries)).find(
      (i) => i.field === 'description',
    );
    expect(issue?.label).toBe('Description');
    expect(issue?.message).toBe('Maximum 20000 caractères.');
  });
  it('has French and English translations for every literal interface translation call', async () => {
    for (const file of [
      'src/admin/main.tsx',
      'src/admin/analytics.tsx',
      'src/admin/profit-preview.tsx',
      'src/admin/bundles.tsx',
      'src/admin/recommendations.tsx',
      'src/admin/rich-text-editor.tsx',
      'src/admin/image-guide.tsx',
      'src/admin/order-pricing.tsx',
      'src/admin/order-receipt.tsx',
      'src/server/views.tsx',
      'src/client/store.ts',
      'src/client/city-picker.ts',
    ]) {
      const source = ts.createSourceFile(
        file,
        await readFile(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const check = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === 't' &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0]) &&
          /[\u0600-\u06ff]/.test(node.arguments[0].text)
        ) {
          expect(
            (
              (file.includes('/admin/') ? entries : storeEntries) as Record<
                string,
                { fr: string; en: string }
              >
            )[node.arguments[0].text],
            file + ': ' + node.arguments[0].text,
          ).toMatchObject({ fr: expect.any(String), en: expect.any(String) });
        }
        ts.forEachChild(node, check);
      };
      check(source);
    }
  });
});

describe('fixed image landing language', () => {
  it('uses the merchant-selected landing locale even when it is not a published store language', () => {
    const s = { ...defaults, adminLanguage: 'en' as const, storeLanguages: ['ar'] as const };
    const p = { pageMode: 'landing', presentation: { landingLanguage: 'fr' } } as Product;
    const fixed = landingSettings({ ...s, storeLanguages: [...s.storeLanguages] }, p);
    expect(fixed.storeLanguage).toBe('fr');
    expect(enabledStoreLanguages(fixed)).toEqual(['fr']);
    expect(fixed.adminLanguage).toBe('en');
    expect(localizedForm(fixed).nameLabel).toBe('Nom complet');
    expect(localizedLandingButton(fixed, 'اطلب الآن')).toBe('Commander maintenant');
    expect(localizedLandingButton(fixed, 'Shop now')).toBe('Shop now');
    expect(s.storeLanguages).toEqual(['ar']);
    expect(productSchema.shape.presentation.safeParse({ landingLanguage: 'de' }).success).toBe(
      false,
    );
  });
  it('keeps the original default for legacy image pages and leaves regular visitor settings intact', () => {
    const s = { ...defaults, storeLanguage: 'en' as const };
    expect(landingSettings(s, { pageMode: 'landing' } as Product).storeLanguage).toBe('en');
    expect(
      landingSettings(s, {
        pageMode: 'product',
        presentation: { landingLanguage: 'ar' },
      } as Product),
    ).toBe(s);
  });
});

describe('visitor language choice', () => {
  it('uses the previous single language for stores without published language settings', () => {
    expect(enabledStoreLanguages({ ...defaults, storeLanguage: 'fr' })).toEqual(['fr']);
    expect(visitorLanguage({ ...defaults, storeLanguage: 'fr' }, 'en')).toBe('fr');
  });
  it('honors only enabled languages and keeps visitor choices separate from merchant preferences', () => {
    const settings = {
      ...defaults,
      adminLanguage: 'en' as const,
      storeLanguage: 'ar' as const,
      storeLanguages: ['ar', 'fr'] as const,
    };
    const s = { ...settings, storeLanguages: [...settings.storeLanguages] };
    expect(visitorLanguage(s, 'fr', 'ar')).toBe('fr');
    expect(visitorLanguage(s, undefined, 'fr')).toBe('fr');
    expect(visitorLanguage(s, 'en', 'fr')).toBe('fr');
    expect(visitorLanguage(s, 'bad')).toBe('ar');
    expect(s.adminLanguage).toBe('en');
    expect(s.storeLanguage).toBe('ar');
  });
  it('rejects empty lists, duplicates and defaults outside the enabled languages', () => {
    for (const storeLanguages of [[], ['ar', 'ar'], ['fr']])
      expect(settingsSchema.safeParse({ ...defaults, storeLanguages }).success).toBe(false);
    expect(
      settingsSchema.safeParse({ ...defaults, storeLanguage: 'fr', storeLanguages: ['ar', 'fr'] })
        .success,
    ).toBe(true);
  });
  it('edits a translated version without changing the default storefront language', () => {
    const settings = { ...defaults, storeLanguages: ['ar', 'fr'] as ('ar' | 'fr')[] };
    const result = updateContent(settings, { heroTitle: 'Bienvenue' }, 'fr');
    expect(result.storeLanguage).toBe('ar');
    expect(result.contentTranslations.fr?.heroTitle).toBe('Bienvenue');
    expect(storefrontSettings({ ...result, storeLanguage: 'fr' }).heroTitle).toBe('Bienvenue');
  });
});
