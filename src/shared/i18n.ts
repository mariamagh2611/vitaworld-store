import catalog from './store-translations.json';
import {
  defaults,
  formDefaults,
  money as formatMoney,
  type Language,
  type Settings,
  type Product,
  type StoreContent,
  type Category,
} from './types';
export const languages: Language[] = ['ar', 'fr', 'en'];
export const languageNames: Record<Language, string> = {
  ar: 'العربية',
  fr: 'Français',
  en: 'English',
};
export const languageOf = (value: unknown): Language =>
  languages.includes(value as Language) ? (value as Language) : 'ar';
export const direction = (language: Language) => (language === 'ar' ? 'rtl' : 'ltr');
export type Catalog = Record<string, { fr: string; en: string }>;
export function translator(
  language: Language,
  overrides: Record<string, string> = {},
  entries: Catalog = catalog,
) {
  return (key: string, values: Record<string, string | number> = {}) => {
    const text = overrides[key] ?? (language === 'ar' ? key : (entries[key]?.[language] ?? key));
    return text.replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match,
    );
  };
}
export const contentKeys = [
  'announcement',
  'heroTitle',
  'heroText',
  'terms',
  'privacy',
  'returns',
  'contact',
] as const;
export const storeCopyKeys = Object.keys(catalog);
export function storefrontSettings(s: Settings): Settings {
  const language = languageOf(s.storeLanguage),
    t = translator(language, s.contentTranslations?.[language]?.copy);
  const translateDefaults = (value: unknown, original: unknown): any => {
    if (typeof value === 'string') return value === original ? t(value) : value;
    if (Array.isArray(value))
      return value.map((item, i) => translateDefaults(item, (original as unknown[])?.[i]));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          translateDefaults(item, (original as Record<string, unknown>)?.[key]),
        ]),
      );
    return value;
  };
  const localized = {
    ...s,
    storeLanguage: language,
    home: translateDefaults(s.home, defaults.home),
    productInfo: translateDefaults(
      { ...defaults.productInfo, ...s.productInfo },
      defaults.productInfo,
    ),
  };
  for (const key of contentKeys) localized[key] = translateDefaults(s[key], defaults[key]);
  const content = s.contentTranslations?.[language] || {};
  return {
    ...localized,
    ...content,
    productInfo: {
      ...localized.productInfo,
      ...content.productInfo,
      showDeliveryReturns: s.productInfo?.showDeliveryReturns !== false,
    },
    home: {
      ...localized.home,
      ...content.home,
      showSearch: s.home.showSearch !== false,
      showPriceSort: s.home.showPriceSort !== false,
      showNavigation: s.home.showNavigation !== false,
      heroCardImages: s.home.heroCardImages || ['', ''],
      licenseCard: {
        ...localized.home.licenseCard,
        ...content.home?.licenseCard,
        enabled: s.home.licenseCard?.enabled === true,
      },
    },
  } as Settings;
}
export function storeTranslator(s: Settings) {
  return translator(
    languageOf(s.storeLanguage),
    s.contentTranslations?.[languageOf(s.storeLanguage)]?.copy,
  );
}
export function updateContent(
  s: Settings,
  patch: StoreContent,
  editingLanguage: Language = s.storeLanguage,
): Settings {
  const language = languageOf(editingLanguage),
    current = s.contentTranslations?.[language] || {};
  return {
    ...s,
    contentTranslations: {
      ...s.contentTranslations,
      [language]: {
        ...current,
        ...patch,
        ...(patch.home ? { home: { ...current.home, ...patch.home } } : {}),
        ...(patch.productInfo
          ? { productInfo: { ...current.productInfo, ...patch.productInfo } }
          : {}),
      },
    },
  };
}
export function localizedProduct(p: Product, language: Language): Product {
  const translation = p.presentation?.translations?.[language];
  const translatedDescription = !!(
    translation?.description?.trim() || translation?.descriptionHtml?.trim()
  );
  return {
    ...p,
    name: translation?.name?.trim() || p.name,
    keywords: translation?.keywords?.trim() || p.keywords,
    description: translation?.description?.trim() || p.description,
    presentation: {
      ...p.presentation,
      deliveryReturns: translation?.deliveryReturns || p.presentation?.deliveryReturns,
      ...(translatedDescription
        ? {
            descriptionFormat: translation?.descriptionFormat || 'text',
            descriptionHtml: translation?.descriptionHtml,
          }
        : {}),
    },
  };
}
// Landing images are authored in one language. Their surrounding UI stays fixed,
// independently of the languages published for the regular storefront.
export function landingSettings(s: Settings, p?: Product): Settings {
  if (p?.pageMode !== 'landing') return s;
  const language = languageOf(p.presentation?.landingLanguage ?? s.storeLanguage);
  return {
    ...s,
    theme: s.landingTheme || s.theme,
    storeLanguage: language,
    storeLanguages: [language],
  };
}
export function localizedLandingButton(s: Settings, text?: string) {
  const key = 'اطلب الآن';
  return !text || languages.some((language) => text === translator(language)(key))
    ? storeTranslator(s)(key)
    : text;
}
export function localizedForm(
  s: Settings,
  content: typeof formDefaults | Record<string, unknown> = {},
) {
  const t = storeTranslator(s),
    builtins = Object.fromEntries(
      Object.entries(formDefaults).map(([key, value]) => [
        key,
        typeof value === 'string' ? t(value) : value,
      ]),
    ) as typeof formDefaults;
  // Saved built-in labels follow the fixed/selected language, including defaults
  // previously saved in French or English. Merchant-authored labels remain intact.
  const overrides = Object.fromEntries(
    Object.entries(content).map(([key, value]) => [
      key,
      key === 'formSubtitle' &&
      languages.some((language) => value === translator(language)('خطوة واحدة تفصلك عن طلبك'))
        ? ''
        : typeof value === 'string' &&
            typeof (formDefaults as Record<string, unknown>)[key] === 'string' &&
            languages.some(
              (language) =>
                value ===
                translator(language)((formDefaults as Record<string, unknown>)[key] as string),
            )
          ? t((formDefaults as Record<string, unknown>)[key] as string)
          : value,
    ]),
  );
  return { ...builtins, ...overrides } as typeof formDefaults;
}
export const localizedMoney = (s: Settings) => (cents: number) =>
  formatMoney(cents, languageOf(s.storeLanguage));

export function enabledStoreLanguages(
  s: Pick<Settings, 'storeLanguage' | 'storeLanguages'>,
): Language[] {
  const available = [
    ...new Set((s.storeLanguages || []).filter((language) => languages.includes(language))),
  ];
  return available.length ? available : [languageOf(s.storeLanguage)];
}
export function visitorLanguage(
  s: Pick<Settings, 'storeLanguage' | 'storeLanguages'>,
  requested?: string,
  remembered?: string,
): Language {
  const enabled = enabledStoreLanguages(s);
  for (const candidate of [requested, remembered, s.storeLanguage])
    if (enabled.includes(candidate as Language)) return candidate as Language;
  return enabled[0];
}

export function localizedCategory(category: Category, language: Language): Category {
  return { ...category, name: category.translations?.[language]?.trim() || category.name };
}
