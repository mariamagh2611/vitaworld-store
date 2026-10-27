export type Language = 'ar' | 'fr' | 'en';
export type ProductDescription = { descriptionFormat?: 'text' | 'html'; descriptionHtml?: string };
export type ProductPresentation = ProductDescription & {
  freeShipping?: boolean;
  quantityPricing?: QuantityPricing;
  bundleMode?: boolean;
  bundleLabel?: string;
  /** Retired persisted data; ignored by pricing and never exposed to visitors. */
  crossSells?: CrossSell[];
  promotion?: { price: number; endsAt?: string | null; startsAt?: string | null } | null;
  landingLanguage?: Language;
  landingFormAppearance?: Partial<LandingFormAppearance>;
  landingFooter?: { contact?: boolean; socials?: boolean };
  landingProductIds?: string[];
  /** Explicitly selected individual components of the main pack, one of each. */
  landingPackComponentIds?: string[];
  landingCodBadge?: { visible?: boolean; text?: string };
  contentLanguage?: Language;
  deliveryReturns?: string;
  recommendationMode?: 'auto' | 'manual' | 'hidden';
  recommendedIds?: string[];
  translations?: Partial<
    Record<
      Language,
      ProductDescription & {
        name?: string;
        description?: string;
        keywords?: string;
        deliveryReturns?: string;
      }
    >
  >;
};
export type StoreContent = Partial<
  Pick<
    Settings,
    'announcement' | 'heroTitle' | 'heroText' | 'terms' | 'privacy' | 'returns' | 'contact'
  >
> & {
  home?: Partial<Settings['home']>;
  productInfo?: Partial<Settings['productInfo']>;
  copy?: Record<string, string>;
};
export const PRODUCT_DESCRIPTION_LIMIT = 20000;
export type LandingFormAppearance = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  fieldBackground: string;
  fieldText: string;
  placeholder: string;
  border: string;
  accent: string;
  buttonBackground: string;
  buttonText: string;
};
export type FormContent = {
  codBadgeText?: string;
  formTitle?: string;
  formSubtitle?: string;
  submitText?: string;
  nameLabel?: string;
  namePlaceholder?: string;
  phoneLabel?: string;
  phonePlaceholder?: string;
  cityLabel?: string;
  cityPlaceholder?: string;
  addressLabel?: string;
  addressPlaceholder?: string;
  notesLabel?: string;
  notesPlaceholder?: string;
  showNotes?: boolean;
};
export const formDefaults = {
  codBadgeText: 'الدفع عند الاستلام ✓',
  formTitle: 'اختر عرضك وأكمل طلبك',
  formSubtitle: '',
  submitText: 'تأكيد الطلب · الدفع عند الاستلام ←',
  nameLabel: 'الاسم الكامل',
  namePlaceholder: 'الاسم والنسب',
  phoneLabel: 'رقم الهاتف',
  phonePlaceholder: '06XXXXXXXX',
  cityLabel: 'المدينة',
  cityPlaceholder: 'اختر أو اكتب مدينتك',
  addressLabel: 'العنوان بالتفصيل',
  addressPlaceholder: 'الحي، الشارع، رقم المنزل',
  notesLabel: 'ملاحظات التوصيل',
  notesPlaceholder: 'تفاصيل تساعدنا على إيصال طلبك',
  showNotes: true,
};
export type Block = {
  id: string;
  type: 'IMAGE' | 'CTA' | 'ORDER_FORM';
  order: number;
  enabled: boolean;
  settings: FormContent & {
    image?: string;
    alt?: string;
    width?: number;
    height?: number;
    text?: string;
    color?: string;
    textColor?: string;
    backgroundColor?: string;
    size?: number;
    margin?: number;
  };
};
export type QuantityPricing = {
  unitPrice: number;
  fromQuantity?: number;
  freeShipping: boolean;
  enabled?: boolean;
  endsAt?: string | null;
};
export type PublicQuantityPricing = QuantityPricing & { fromQuantity: number };
export type Offer = {
  id: string;
  revision?: number;
  label: string;
  quantity: number;
  total: number;
  freeShipping: boolean;
  enabled?: boolean;
  endsAt?: string | null;
};
export type CheckoutOffer = {
  id: string;
  productId: string;
  title: string;
  quantity: number;
  total: number;
  enabled: boolean;
  endsAt?: string | null;
};
export type ShippingCosts = { casa: number; other: number; maximum: number };
export type CrossSell = {
  freeShipping?: boolean;
  id: string;
  title: string;
  items: { productId: string; quantity: number; total?: number }[];
  total: number;
  enabled: boolean;
  endsAt?: string | null;
};
export type Product = {
  id: string;
  slug: string;
  sku: string;
  parentId: string | null;
  name: string;
  description: string;
  image: string;
  price: number;
  minimum: number;
  fulfillment: number | null;
  stock: number;
  active: number;
  featured: number;
  supplier: string | null;
  verified: number;
  offers: Offer[];
  blocks: Block[];
  color: string;
  formColor: string;
  revision: number;
  shippingCasa?: number | null;
  shippingOther?: number | null;
  categoryId?: string | null;
  pageMode?: 'product' | 'landing';
  storefrontVisible?: number;
  gallery?: string[];
  keywords?: string;
  presentation?: ProductPresentation;
};
export type Category = {
  id: string;
  name: string;
  image: string;
  icon: string;
  position: number;
  active: number;
  translations?: Partial<Record<Language, string>>;
};
export type PublicProduct = Pick<
  Product,
  | 'id'
  | 'slug'
  | 'sku'
  | 'name'
  | 'image'
  | 'price'
  | 'stock'
  | 'active'
  | 'supplier'
  | 'verified'
  | 'offers'
  | 'revision'
  | 'categoryId'
  | 'storefrontVisible'
  | 'keywords'
> & {
  freeShipping?: boolean;
  quantityPricing?: PublicQuantityPricing;
  bundleMode?: boolean;
  bundleLabel?: string;
  originalPrice?: number;
  priceEndsAt?: string | null;
  priceStartsAt?: string | null;
};
import { pricedProduct } from './commerce';
export function publicProduct(raw: Product): PublicProduct {
  const p = pricedProduct(raw);
  return {
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    name: p.name,
    image: p.image,
    price: p.price,
    stock: p.stock,
    active: p.active,
    supplier: p.supplier,
    verified: p.verified,
    offers: p.offers,
    bundleMode: !!p.presentation?.bundleMode,
    bundleLabel: p.presentation?.bundleLabel || '',
    ...(p.quantityPricing ? { quantityPricing: p.quantityPricing } : {}),
    freeShipping: !!p.presentation?.freeShipping,
    revision: p.revision,
    categoryId: p.categoryId ?? null,
    storefrontVisible: p.storefrontVisible ?? 1,
    keywords: p.keywords || '',
    ...(p.price !== raw.price
      ? {
          originalPrice: raw.price,
          priceEndsAt: raw.presentation?.promotion?.endsAt || null,
          priceStartsAt: raw.presentation?.promotion?.startsAt || null,
        }
      : {}),
  };
}
export type CartLine = { productId: string; offerId: string; quantity: number; revision: number };
export type LocalCartLine = CartLine & {
  name: string;
  image: string;
  sku: string;
  supplier: string;
  unitPrice: number;
  freeShipping: boolean;
  offerLabel: string;
  subtotal?: number;
};
export type Customer = {
  name: string;
  phone: string;
  city: string;
  address: string;
  notes: string;
};
export type QuoteLine = {
  productId: string;
  sku: string;
  name: string;
  offerId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  freeShipping: boolean;
  revision: number;
};
export type StoreIdentity = { name: string; url: string };
export type Quote = {
  supplier: string;
  items: QuoteLine[];
  subtotal: number;
  shipping: number;
  total: number;
  fingerprint: string;
  checkoutMode?: 'cart' | 'direct';
  shippingRates?: { casa: number; other: number };
  cartFreeShippingThreshold?: number;
  shippingReason?: 'standard' | 'offer' | 'threshold';
  // Captured by the server when accepting the order, never from checkout input.
  storeIdentity?: StoreIdentity;
  // Private order snapshot. Never included in the public checkout quote.
  merchantPricing?: import('./order-pricing').MerchantPricingSnapshot;
};
export type Settings = {
  adminLanguage: Language;
  storeLanguage: Language;
  storeLanguages?: Language[];
  contentTranslations: Partial<Record<Language, StoreContent>>;
  brand: string;
  whatsapp: string;
  contactEmail: string;
  contactPhone: string;
  socials: Record<
    'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | 'snapchat',
    string
  >;
  checkoutOffers: CheckoutOffer[];
  logo: string;
  favicon: string;
  announcement: string;
  heroTitle: string;
  heroText: string;
  shippingCasa: number;
  shippingOther: number;
  cartFreeShippingThreshold: number;
  autoConfirm: boolean;
  policyVisibility: Record<'terms' | 'privacy' | 'returns' | 'contact', boolean>;
  terms: string;
  privacy: string;
  returns: string;
  contact: string;
  facebookPixel: string;
  facebookAdditionalPixels: { id: string; pixel: string; label: string; enabled: boolean }[];
  tiktokPixel: string;
  googleId: string;
  googleAdsId: string;
  googleAdsLeadLabel: string;
  snapPixel: string;
  trackingEnabled: boolean;
  turnstileSiteKey: string;
  supplierField: string;
  citiesField: string;
  cityNameField: string;
  contractVerified: boolean;
  metaVersion: string;
  attributionDays: number;
  theme: {
    primary: string;
    background: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    line: string;
  };
  branding: { logoWidth: number; logoZoom: number; showName: boolean };
  typography: {
    family: 'plex' | 'system';
    desktopSize: number;
    mobileSize: number;
    weight: 400 | 500 | 600;
  };
  landingTheme?: Settings['theme'];
  productInfo: {
    showDeliveryReturns: boolean;
    deliveryReturnsTitle: string;
    deliveryReturnsText: string;
    deliveryTitle: string;
    deliveryText: string;
    paymentTitle: string;
    paymentText: string;
  };
  home: {
    tagline: string;
    heroEyebrow: string;
    heroImage: string;
    heroImageWidth: number;
    heroImageHeight: number;
    heroCardImages: [string, string];
    heroButtonText: string;
    heroProof: string[];
    showHero: boolean;
    showSearch: boolean;
    showPriceSort: boolean;
    showNavigation: boolean;
    showBenefits: boolean;
    benefits: string[];
    licenseCard: { enabled: boolean; title: string; text: string; documentUrl: string };
    productsEyebrow: string;
    productsTitle: string;
    productTagline: string;
    featuredBadge: string;
    showPromise: boolean;
    promiseEyebrow: string;
    promiseTitle: string;
    promiseCards: { title: string; text: string }[];
    footerText: string;
    emptyTitle: string;
    emptyText: string;
  };
};
export type City = {
  city: string;
  is_casablanca?: boolean;
  is_serviceable?: boolean;
  shipping_fee_mad?: number;
};
export const defaults: Settings = {
  adminLanguage: 'ar',
  storeLanguage: 'ar',
  contentTranslations: {},
  brand: 'دارنا',
  whatsapp: '',
  contactEmail: '',
  contactPhone: '',
  socials: {
    facebook: '',
    instagram: '',
    tiktok: '',
    youtube: '',
    linkedin: '',
    x: '',
    snapchat: '',
  },
  checkoutOffers: [],
  logo: '',
  favicon: '/favicon.svg',
  announcement: 'الدفع عند الاستلام · توصيل إلى جميع مدن المغرب',
  heroTitle: 'اختيارات تُشبهك.\nوتصل إلى بابك.',
  heroText: 'اكتشف منتجات مختارة بعناية، واجمع احتياجاتك في طلب واحد. ادفع فقط عند الاستلام.',
  shippingCasa: 2000,
  shippingOther: 3000,
  cartFreeShippingThreshold: 0,
  autoConfirm: false,
  policyVisibility: { terms: true, privacy: true, returns: true, contact: true },
  terms: 'تُؤكد الطلبات هاتفيًا قبل إرسالها. الدفع عند الاستلام.',
  privacy:
    'نستخدم بياناتك لمعالجة الطلب والتواصل والتوصيل. يمكن طلب حذفها عبر وسيلة التواصل الموضحة.',
  returns: 'يرجى التواصل معنا لمعرفة شروط الاسترجاع قبل إتمام الطلب.',
  contact: 'تواصل معنا عبر واتساب للاستفسار عن منتجاتك وطلباتك.',
  facebookPixel: '',
  facebookAdditionalPixels: [],
  tiktokPixel: '',
  googleId: '',
  googleAdsId: '',
  googleAdsLeadLabel: '',
  snapPixel: '',
  trackingEnabled: false,
  turnstileSiteKey: '',
  supplierField: 'supplier_group_id',
  citiesField: 'cities',
  cityNameField: 'city',
  contractVerified: false,
  metaVersion: '',
  attributionDays: 30,
  theme: {
    primary: '#173d35',
    background: '#fbfaf6',
    surface: '#ffffff',
    text: '#263d35',
    muted: '#79847c',
    accent: '#eac79d',
    line: '#dedfd6',
  },
  branding: { logoWidth: 150, logoZoom: 3, showName: false },
  typography: { family: 'plex', desktopSize: 16, mobileSize: 16, weight: 500 },
  productInfo: {
    showDeliveryReturns: true,
    deliveryReturnsTitle: 'التوصيل والاسترجاع',
    deliveryReturnsText:
      'نؤكد طلبك هاتفيًا قبل إرساله. للاستفسار عن التوصيل أو الاسترجاع، تواصل مع خدمة العملاء.',
    deliveryTitle: 'التوصيل إلى عنوانك',
    deliveryText: 'الدار البيضاء: {casa} · باقي المدن: {other}',
    paymentTitle: 'الدفع عند الاستلام',
    paymentText: 'نؤكد طلبك هاتفيًا قبل إرساله.',
  },
  home: {
    tagline: 'اختيارات لحياة أجمل',
    heroEyebrow: 'مختارة بعناية. من أجل يومك.',
    heroImage: '',
    heroImageWidth: 1080,
    heroImageHeight: 1080,
    heroCardImages: ['', ''],
    heroButtonText: 'اكتشف المنتجات',
    heroProof: ['✓ الدفع عند الاستلام', '✓ تأكيد هاتفي'],
    showHero: true,
    showSearch: true,
    showPriceSort: true,
    showNavigation: true,
    showBenefits: true,
    benefits: [
      '◈ منتجات مختارة',
      '♧ طلب واحد وشحنة واحدة',
      '✓ ادفع عند الاستلام',
      '♡ دعم عبر واتساب',
    ],
    licenseCard: {
      enabled: false,
      title: 'منتجاتنا مرخصة حسب الصنف من :',
      text: '',
      documentUrl: '',
    },
    productsEyebrow: 'اكتشف ما يناسبك',
    productsTitle: 'اختياراتنا لك',
    productTagline: 'اختيار لحياة أجمل',
    featuredBadge: 'اختيار مميز',
    showPromise: true,
    promiseEyebrow: 'تسوق براحة بال',
    promiseTitle: 'من اختيارك،\nإلى باب بيتك.',
    promiseCards: [
      { title: 'اختر ما تحب', text: 'اجمع اختياراتك في طلب واحد.' },
      { title: 'نؤكد طلبك', text: 'نتصل بك لتأكيد اختياراتك والعنوان.' },
      { title: 'استلم وادفع', text: 'رسم توصيل واحد، والدفع عند الاستلام.' },
    ],
    footerText: 'منتجات تختارها بثقة، وتجربة شراء بسيطة.',
    emptyTitle: 'اختيارات جديدة قريبًا',
    emptyText: 'نعمل على تجهيز منتجات المتجر. تابعنا لمعرفة الجديد.',
  },
};
export const money = (cents: number, language: Language = 'ar') =>
  new Intl.NumberFormat(language === 'ar' ? 'ar-MA' : language === 'fr' ? 'fr-MA' : 'en-MA', {
    maximumFractionDigits: 2,
  }).format(cents / 100) + (language === 'ar' ? ' د.م' : ' MAD');
