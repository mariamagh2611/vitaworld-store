/** @jsxImportSource hono/jsx */
import { productSort, sortedProducts } from '../shared/product-sort';
import { localizedCategory } from '../shared/i18n';
import { productDeliveryText } from '../shared/product-info';
import { typographyStyle } from '../shared/typography';
import { metaPixelIds } from '../shared/meta-pixels';
import { pricedProduct, promotionClock, promotionRemaining, tailPricing } from '../shared/commerce';
import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import { safeProductHtml } from './product-content';
import { policyKeys, policyLabels, policyVisible } from '../shared/policies';
import { policyHtml } from './policy-content';
import { landingFormAppearance, landingBadgeText } from '../shared/landing-appearance';
declare const __STYLE_VERSION__: string;
declare const __STORE_VERSION__: string;
import { landingProducts, landingPackSavings } from '../shared/landing-products';
import type { Settings, Product, FormContent, Category } from '../shared/types';
import { publicProduct, formDefaults, defaults } from '../shared/types';
import {
  storeTranslator,
  storefrontSettings,
  localizedProduct,
  localizedMoney,
  localizedForm,
  direction,
  enabledStoreLanguages,
  languageNames,
  landingSettings,
  localizedLandingButton,
} from '../shared/i18n';
function policyHref(type: string, p?: Product) {
  return (
    (p?.pageMode === 'landing' ? '/offers/' + encodeURIComponent(p.slug) : '') + '/policies/' + type
  );
}
const buttonColor = (value?: string) =>
  !value || value === defaults.theme.primary ? 'var(--green)' : value;
function onPrimary(hex: string) {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const v = parseInt(hex.slice(at, at + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000000' : '#ffffff';
}
export const safeJson = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    bag: 'M6 7h12l2 13H4L6 7ZM9 8V6a3 3 0 0 1 6 0v2',
    search: 'M21 21l-5-5M19 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    menu: 'M4 6h16M4 12h16M4 18h10',
    home: 'M3 10l9-7 9 7M5 9v12h14V9M9 21v-8h6v8',
    grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
    truck:
      'M3 5h11v12H3ZM14 10h4l3 4v3h-7M8 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0M20 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3ZM8 12l3 3 5-6',
    arrow: 'M19 12H5M10 7l-5 5 5 5',
    close: 'M6 6l12 12M6 18L18 6',
    phone: 'M5 3h4l2 5-3 2c2 4 3 5 7 7l2-3 5 2v4c-8 3-20-9-17-17Z',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.bag} />
    </svg>
  );
}
export function Layout({
  s,
  children,
  title,
  products,
  product,
  development,
  preview = false,
  checkout = false,
  direct = false,
  searchIds,
  pageUrl,
  policyFor,
}: {
  s: Settings;
  children: Child;
  title?: string;
  products: Product[];
  product?: Product;
  development: boolean;
  preview?: boolean;
  checkout?: boolean;
  direct?: boolean;
  searchIds?: string[];
  pageUrl?: string;
  policyFor?: Product;
}) {
  s = storefrontSettings(landingSettings(s, product || policyFor));
  const t = storeTranslator(s),
    money = localizedMoney(s);

  if (product) {
    const localized = localizedProduct(product, s.storeLanguage);
    if (title === product.name) title = localized.name;
    product = localized;
  }
  const landing = product?.pageMode === 'landing' || !!policyFor;
  const publicSettings = {
    storeLanguage: s.storeLanguage,
    storeLanguages: enabledStoreLanguages(s),
    copy: s.contentTranslations?.[s.storeLanguage]?.copy || {},
    brand: s.brand,
    whatsapp: s.whatsapp,
    shippingCasa: s.shippingCasa,
    shippingOther: s.shippingOther,
    cartFreeShippingThreshold: s.cartFreeShippingThreshold,
    facebookPixel: s.facebookPixel,
    facebookPixels: metaPixelIds(s),
    tiktokPixel: s.tiktokPixel,
    googleId: s.googleId,
    googleAdsId: s.googleAdsId,
    googleAdsLeadLabel: s.googleAdsLeadLabel,
    snapPixel: s.snapPixel,
    trackingEnabled: s.trackingEnabled,
    turnstileSiteKey: s.turnstileSiteKey,
    attributionDays: s.attributionDays,
    showPriceSort: s.home.showPriceSort !== false,
    deliveryText: s.productInfo.deliveryText,
  };
  const data = {
    settings: publicSettings,
    products: products.map((p) => publicProduct(localizedProduct(p, s.storeLanguage))),
    landing,
    direct,
    checkout,
    productId: product?.id,
    landingProductIds: product ? landingProducts(product, products).map((p) => p.id) : undefined,
    landingPackComponentIds: product?.presentation?.landingPackComponentIds,
    development,
    searchIds,
  };
  return (
    <html lang={s.storeLanguage} dir={direction(s.storeLanguage)}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {product?.storefrontVisible === 0 && <meta name="robots" content="noindex,follow" />}
        <title>
          {title ? title + ' | ' : ''}
          {s.brand}
        </title>
        <meta name="description" content={(product?.description || s.heroText).slice(0, 300)} />
        {pageUrl &&
          !landing &&
          enabledStoreLanguages(s).length > 1 &&
          enabledStoreLanguages(s).map((language) => {
            const url = new URL(pageUrl);
            url.searchParams.set('lang', language);
            return <link rel="alternate" hreflang={language} href={url.toString()} />;
          })}
        <link rel="icon" href={s.favicon || '/favicon.svg'} />
        {[400, 500, 600, 700].map((weight) => (
          <link
            rel="preload"
            href={'/assets/fonts/store-arabic-' + weight + '.woff2'}
            as="font"
            type="font/woff2"
            crossorigin="anonymous"
          />
        ))}
        <link
          rel="stylesheet"
          href={
            '/assets/style.css?v=' +
            (typeof __STYLE_VERSION__ === 'undefined' ? 'development' : __STYLE_VERSION__)
          }
        />
        <meta property="og:title" content={title || s.brand} />
        <meta
          property="og:description"
          content={(product?.description || s.heroText).slice(0, 300)}
        />
        {product?.image && <meta property="og:image" content={product.image} />}
        {!preview && (
          <script
            type="module"
            src={
              '/assets/store.js?v=' +
              (typeof __STORE_VERSION__ === 'undefined' ? 'development' : __STORE_VERSION__)
            }
          ></script>
        )}
      </head>
      <body
        class={
          'storefront' +
          (landing ? ' focused-landing' : '') +
          (product && !landing ? ' has-product-dock' : '') +
          (checkout ? ' checkout-store' : '') +
          (s.home.showNavigation === false ? ' no-header-navigation' : '')
        }
        style={{
          ...typographyStyle(s),
          '--logo-width': (s.branding?.logoWidth || defaults.branding.logoWidth) + 'px',
          '--logo-zoom': String(s.branding?.logoZoom || defaults.branding.logoZoom),
          '--green': s.theme.primary,
          '--page': s.theme.background,
          '--surface': s.theme.surface,
          '--ink': s.theme.text,
          '--muted': s.theme.muted,
          '--accent': s.theme.accent,
          '--line': s.theme.line,
          '--on-primary': onPrimary(s.theme.primary),
          '--cream': `color-mix(in srgb, ${s.theme.primary} 8%, ${s.theme.background})`,
          background: s.theme.background,
          color: s.theme.text,
        }}
      >
        {development && (
          <div class="demo-banner">
            {t('بيئة تجربة محلية · لا تُرسل الطلبات إلى مورد تلقائيًا')}
          </div>
        )}
        {!landing && (
          <>
            {!checkout && s.announcement && <div class="announcement">{s.announcement}</div>}
            <header class="store-header">
              {!checkout && s.home.showNavigation !== false && (
                <details class="mobile-menu">
                  <summary aria-label={t('فتح قائمة المتجر')}>
                    <Icon name="menu" />
                  </summary>
                  <nav aria-label={t('قائمة المتجر')}>
                    <a href="/">{t('الرئيسية')}</a>
                    <a href="/#categories">{t('الأقسام')}</a>
                    <a href="/#products">{t('جميع المنتجات')}</a>
                    {policyVisible(s, 'contact') && (
                      <a href="/policies/contact">{t('تواصل معنا')}</a>
                    )}
                  </nav>
                </details>
              )}
              <a
                href="/"
                class={'brand' + (s.logo && s.branding?.showName === false ? ' logo-wordmark' : '')}
              >
                {s.logo ? (
                  <span class="brand-logo">
                    <img src={s.logo} alt={s.brand} />
                  </span>
                ) : (
                  <span class="brand-mark">{s.brand.slice(0, 1)}</span>
                )}
                <span class="brand-copy">
                  {(!s.logo || s.branding?.showName !== false) && <strong>{s.brand}</strong>}
                  <small>{s.home.tagline}</small>
                </span>
              </a>
              {s.home.showNavigation !== false && (
                <nav class="desktop-nav">
                  <a href="/#products">{t('تسوق المنتجات')}</a>
                  {s.home.showPromise && <a href="/#promise">{t('لماذا نحن؟')}</a>}
                  {policyVisible(s, 'contact') && <a href="/policies/contact">{t('تواصل معنا')}</a>}
                </nav>
              )}
              <div class="header-actions">
                {!preview && <StoreLanguageSwitcher s={s} />}
                <button class="cart-button" data-open-cart aria-label={t('فتح سلة المشتريات')}>
                  <Icon name="bag" />
                  <span class="cart-label">{t('السلة')}</span>
                  <span data-cart-count>0</span>
                </button>
              </div>
              {!checkout && s.home.showSearch !== false && (
                <form class="store-search" action="/" role="search">
                  <Icon name="search" size={20} />
                  <input
                    id="store-search"
                    maxlength={200}
                    type="search"
                    name="q"
                    aria-label={t('البحث عن منتج')}
                    placeholder={t('ما الذي تبحث عنه اليوم؟')}
                  />
                  <button type="submit" aria-label={t('بحث')}>
                    <Icon name="arrow" size={18} />
                  </button>
                </form>
              )}
            </header>
          </>
        )}
        {children}
        {landing ? (
          <footer class="landing-footer">
            <StoreContacts
              s={s}
              showContact={(product || policyFor)?.presentation?.landingFooter?.contact !== false}
              showSocials={(product || policyFor)?.presentation?.landingFooter?.socials !== false}
            />
            {policyKeys.some((key) => policyVisible(s, key)) && (
              <details>
                <summary>{t('السياسات')}</summary>
                <p>{s.brand}</p>
                <nav class="footer-links" aria-label={t('السياسات')}>
                  {policyKeys
                    .filter((key) => policyVisible(s, key))
                    .map((key) => (
                      <a href={policyHref(key, product || policyFor)}>{t(policyLabels[key])}</a>
                    ))}
                  {s.whatsapp && (
                    <a
                      href={'https://wa.me/' + s.whatsapp}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('واتساب')}
                    </a>
                  )}
                </nav>
              </details>
            )}
          </footer>
        ) : (
          <>
            <footer class="store-footer">
              <StoreContacts s={s} />
              <div>
                <a class="brand" href="/">
                  {s.brand}
                </a>
                <p>{s.home.footerText}</p>
                <span class="footer-cod">
                  <Icon name="shield" size={18} />
                  {t('الدفع عند الاستلام')}
                </span>
              </div>
              {policyKeys.some((key) => policyVisible(s, key)) && (
                <div class="footer-column">
                  <h3>{t('السياسات')}</h3>
                  <div class="footer-links">
                    {policyKeys
                      .filter((key) => policyVisible(s, key))
                      .map((key) => (
                        <a href={policyHref(key)}>{t(policyLabels[key])}</a>
                      ))}
                  </div>
                </div>
              )}
              <div class="footer-column">
                <h3>{t('نحن هنا لمساعدتك')}</h3>
                <p>{t('استفسار عن منتج أو طلبك؟ تواصل معنا.')}</p>
                {(s.whatsapp || policyVisible(s, 'contact')) && (
                  <a
                    href={s.whatsapp ? 'https://wa.me/' + s.whatsapp : '/policies/contact'}
                    class="footer-contact"
                  >
                    <Icon name="phone" size={18} />
                    {s.whatsapp ? t('تواصل عبر واتساب') : t('اتصل بنا')}
                  </a>
                )}
              </div>
              <small>
                © {new Date().getFullYear()} {s.brand}
                {t('· الدفع عند الاستلام')}
              </small>
            </footer>
          </>
        )}
        {s.turnstileSiteKey && !policyVisible(s, 'privacy') && (
          <p class="policy-service-disclosure">
            {t('نستخدم Cloudflare Turnstile للحماية من الطلبات الآلية. تخضع هذه الخدمة إلى')}{' '}
            <a
              href="https://www.cloudflare.com/privacypolicy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('سياسة خصوصية Cloudflare')}
            </a>{' '}
            {t('و')}{' '}
            <a
              href="https://www.cloudflare.com/turnstile-privacy-policy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('ملحق خصوصية Turnstile')}
            </a>
            .
          </p>
        )}
        {s.whatsapp && (
          <a
            class="whatsapp"
            href={'https://wa.me/' + s.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('تواصل عبر واتساب')}
          >
            <SocialIcon name="whatsapp" />
          </a>
        )}
        {!landing && (
          <>
            {!product && !checkout && (
              <nav class="mobile-store-nav" aria-label={t('التنقل في المتجر')}>
                <a href="/">
                  <Icon name="home" />
                  <span>{t('الرئيسية')}</span>
                </a>
                <a href="/#categories">
                  <Icon name="grid" />
                  <span>{t('الأقسام')}</span>
                </a>
                <a href="/#products">
                  <Icon name="search" />
                  <span>{t('المنتجات')}</span>
                </a>
                <button data-open-cart>
                  <Icon name="bag" />
                  <span>
                    {t('السلة')}
                    <b data-cart-count>0</b>
                  </span>
                </button>
              </nav>
            )}
            <dialog id="cart-dialog" aria-labelledby="cart-title">
              <div class="dialog-heading">
                <div>
                  <small>{t('كل اختياراتك في مكان واحد')}</small>
                  <h2 id="cart-title">
                    {t('سلة المشتريات')}
                    <span data-cart-count>0</span>
                  </h2>
                </div>
                <button data-close-cart aria-label={t('إغلاق')}>
                  <Icon name="close" />
                </button>
              </div>
              <ShippingProgress s={s} />
              <div id="cart-items"></div>
              <div class="cart-drawer-bottom">
                <div class="summary-row">
                  <span>{t('مجموع المنتجات')}</span>
                  <strong data-cart-subtotal>—</strong>
                </div>
                <a class="primary cart-checkout" href="/checkout" data-cart-checkout>
                  {t('إتمام الطلب')}
                  <Icon name="arrow" size={18} />
                </a>
                <div class="cart-secondary-actions">
                  <button class="primary cart-continue" data-close-cart>
                    {t('متابعة التسوق')}
                  </button>
                  <button data-empty-cart>{t('إفراغ السلة')}</button>
                </div>
                <p class="cart-reassurance">
                  <Icon name="shield" size={16} />
                  {t('الدفع عند الاستلام · تأكيد هاتفي للطلب')}
                </p>
              </div>
            </dialog>
            <dialog id="replace-cart-dialog" aria-labelledby="replace-cart-title">
              <h2 id="replace-cart-title">{t('بدء سلة جديدة؟')}</h2>
              <p>
                {t(
                  'سلتك الحالية تحتوي على منتجات من مستودع مختلف. هل ترغب في إفراغ السلة وبدء طلب جديد لهذا المنتج؟',
                )}
              </p>
              <div class="dialog-actions">
                <button class="primary" data-confirm-replace>
                  {t('نعم، بدء طلب جديد بهذا المنتج')}
                </button>
                <button class="secondary" data-cancel-replace>
                  {t('الاحتفاظ بالسلة الحالية')}
                </button>
              </div>
            </dialog>
          </>
        )}
        <dialog id="thanks-dialog">
          <span class="success-icon">✓</span>
          <h2>{t('وصلنا طلبك!')}</h2>
          <p>{t('سيتواصل معك فريقنا قريبًا لتأكيد الطلب والعنوان.')}</p>
          <p class="muted">{t('رقم طلبك في المتجر')}</p>
          <strong id="order-ref"></strong>
          {!landing && (
            <p id="saved-cart-reminder" hidden>
              {t('سلتك السابقة ما زالت محفوظة.')}
              <a href="/checkout">{t('أكمل طلب السلة لاحقًا ←')}</a>
            </p>
          )}
          <button class="primary" data-close-thanks>
            {landing ? t('إغلاق الرسالة') : t('متابعة التسوق')}
          </button>
        </dialog>
        <div id="toast" role="status" aria-live="polite"></div>

        <script
          id="store-data"
          type="application/json"
          dangerouslySetInnerHTML={{ __html: safeJson(data) }}
        ></script>
      </body>
    </html>
  );
}
export function ProductCard({
  p,
  s,
  priority = false,
  hidden = false,
  rank,
}: {
  p: Product;
  s: Settings;
  priority?: boolean;
  hidden?: boolean;
  rank?: number;
}) {
  s = storefrontSettings(s);
  const t = storeTranslator(s),
    money = localizedMoney(s);
  const originalPrice = p.price;
  p = pricedProduct(localizedProduct(p, s.storeLanguage));

  return (
    <article
      class="product-card"
      data-supplier={p.supplier || ''}
      data-product-card={p.id}
      data-category-id={p.categoryId || ''}
      data-product-name={p.name}
      hidden={hidden}
      style={rank !== undefined ? { order: rank } : undefined}
    >
      <a class="product-image" href={'/shop/' + p.slug}>
        {p.image ? (
          <img
            src={p.image}
            alt={p.name}
            width="480"
            height="480"
            loading={priority ? 'eager' : 'lazy'}
          />
        ) : (
          <span class="image-placeholder">
            <Icon name="bag" size={48} />
          </span>
        )}
        {p.featured === 1 && <span class="product-badge">{s.home.featuredBadge}</span>}
      </a>
      <div class="product-info">
        <a href={'/shop/' + p.slug}>
          <h3>{p.name}</h3>
        </a>
        <div class="product-bottom">
          <strong data-card-price={p.id}>{money(p.price)}</strong>
          {originalPrice > p.price && <del data-sale-original={p.id}>{money(originalPrice)}</del>}
        </div>
        <button
          data-add-product={p.id}
          class="primary card-add"
          aria-label={t('إضافة ') + p.name}
          disabled={!p.verified || !p.supplier || p.stock < 1}
        >
          <Icon name="bag" size={17} />
          {t('أضف إلى السلة')}
        </button>
      </div>
    </article>
  );
}
export function Home({
  s,
  products,
  categories = [],
  selectedCategory = '',
  sort = '',
  searchIds,
}: {
  s: Settings;
  products: Product[];
  categories?: Category[];
  selectedCategory?: string;
  sort?: string;
  searchIds?: string[];
}) {
  s = storefrontSettings(s);
  const t = storeTranslator(s),
    money = localizedMoney(s);

  categories = categories.map((category) => localizedCategory(category, s.storeLanguage));
  const selected = categories.some((c) => c.id === selectedCategory) ? selectedCategory : '';
  const selectedSort = productSort(sort, s.home.showPriceSort !== false);
  const ordered = sortedProducts(products, selectedSort, (p) => pricedProduct(p).price, searchIds);
  const heroCards = [0, 1].map((index) => ({
    custom: s.home.heroCardImages?.[index] || '',
    product: products[index],
  }));
  const legacyHero = s.home.heroImage && !heroCards.some((card) => card.custom);
  return (
    <main class="shop-home">
      {s.home.showHero && (
        <section class={'hero shop-hero' + (legacyHero ? ' custom-hero' : '')}>
          <div class="hero-copy">
            <span class="eyebrow">{s.home.heroEyebrow}</span>
            <h1 style={{ whiteSpace: 'pre-line' }}>{s.heroTitle}</h1>
            <p>{s.heroText}</p>
            <a href="#products" class="primary">
              {s.home.heroButtonText}
              <Icon name="arrow" size={18} />
            </a>
            <div class="hero-proof">
              {s.home.heroProof.map((text) => (
                <span>{text}</span>
              ))}
            </div>
          </div>
          {legacyHero ? (
            <img
              class="hero-image"
              src={s.home.heroImage}
              alt={s.brand}
              width={s.home.heroImageWidth}
              height={s.home.heroImageHeight}
              fetchpriority="high"
            />
          ) : (
            <div class="hero-collection" data-hero-collection aria-hidden="true">
              {heroCards.map(
                ({ custom, product: p }, i) =>
                  (custom || p) && (
                    <div
                      class={'hero-product hero-product-' + i}
                      data-hero-product
                      data-hero-index={i}
                      data-hero-custom={custom ? 'true' : undefined}
                      data-supplier={custom ? undefined : p?.supplier || ''}
                    >
                      {custom || p?.image ? (
                        <img src={custom || p!.image} alt="" width="480" height="480" />
                      ) : (
                        <Icon name="bag" size={70} />
                      )}
                    </div>
                  ),
              )}
              {!products.length && !heroCards.some((card) => card.custom) && (
                <div class="hero-empty-mark">
                  <Icon name="bag" size={72} />
                  <span>{s.home.tagline}</span>
                </div>
              )}
              <span class="hero-collection-note">
                <Icon name="truck" size={18} />
                {t('إلى باب بيتك')}
              </span>
            </div>
          )}
        </section>
      )}
      {s.home.showBenefits && (
        <div class="benefits-strip">
          {s.home.benefits.map(
            (text, i) =>
              text.trim() && (
                <span>
                  <Icon name={['shield', 'truck', 'bag', 'phone'][i % 4]} size={28} />
                  {text.replace(/^[◈♧✓♡]\s*/, '')}
                </span>
              ),
          )}
        </div>
      )}
      {s.home.licenseCard.enabled && (
        <section class="license-card" aria-label={s.home.licenseCard.title}>
          {s.home.licenseCard.title && <h2>{s.home.licenseCard.title}</h2>}
          <div class="license-logos">
            <img src="/trust/onssa.png" alt="ONSSA" width="160" height="74" loading="lazy" />
            <img src="/trust/ammps.png" alt="AMMPS" width="160" height="98" loading="lazy" />
          </div>
          {s.home.licenseCard.text && <p>{s.home.licenseCard.text}</p>}
          {s.home.licenseCard.documentUrl && (
            <a href={s.home.licenseCard.documentUrl} target="_blank" rel="noopener noreferrer">
              {t('عرض بيانات التسجيل والشهادات ↗')}
            </a>
          )}
        </section>
      )}
      {!!categories.length && (
        <section class="categories-section" id="categories" aria-label={t('أقسام المنتجات')}>
          <nav class="category-list" aria-label={t('اختر قسم المنتجات')}>
            <a
              class="category-link"
              href="/#products"
              data-category=""
              aria-current={!selected ? 'true' : undefined}
            >
              <span class="category-icon" aria-hidden="true">
                <Icon name="grid" size={28} />
              </span>
              <span>{t('كل الأقسام')}</span>
            </a>
            {categories.map((category) => (
              <a
                class="category-link"
                href={'/?category=' + category.id + '#products'}
                data-category={category.id}
                aria-current={selected === category.id ? 'true' : undefined}
              >
                <span class="category-icon" aria-hidden="true">
                  {category.image ? (
                    <img src={category.image} alt="" width="64" height="64" loading="lazy" />
                  ) : (
                    category.icon || '🛍️'
                  )}
                </span>
                <span>{category.name}</span>
              </a>
            ))}
          </nav>
        </section>
      )}
      <section class="products-section" id="products">
        <div class="section-heading">
          <div>
            <span class="eyebrow">{s.home.productsEyebrow}</span>
            <h2>{s.home.productsTitle}</h2>
          </div>
          {s.home.showPriceSort !== false && (
            <label class="price-sort">
              <select data-price-sort aria-label={t('ترتيب المنتجات')}>
                <option value="" selected={selectedSort === ''}>
                  {t('الترتيب الافتراضي')}
                </option>
                <option value="price-asc" selected={selectedSort === 'price-asc'}>
                  {t('السعر: من الأقل إلى الأعلى')}
                </option>
                <option value="price-desc" selected={selectedSort === 'price-desc'}>
                  {t('السعر: من الأعلى إلى الأقل')}
                </option>
              </select>
            </label>
          )}
          <span class="product-count" data-product-count>
            {products.length}
            {t('منتج')}
          </span>
        </div>
        <p
          class="search-status muted"
          id="search-status"
          role="status"
          aria-live="polite"
          hidden
        ></p>
        <div class="product-grid">
          {products.length ? (
            ordered.map((p, i) => (
              <ProductCard
                p={p}
                s={s}
                priority={i < 2 && !s.home.showHero}
                hidden={
                  (!!selected && p.categoryId !== selected) ||
                  (searchIds !== undefined && !searchIds.includes(p.id))
                }
                rank={i}
              />
            ))
          ) : (
            <div class="empty-state">
              <Icon name="bag" size={44} />
              <h3>{s.home.emptyTitle}</h3>
              <p>{s.home.emptyText}</p>
            </div>
          )}
        </div>
        <p id="product-filter-empty" class="empty-state" hidden>
          {t('لا توجد منتجات متاحة بهذا الاختيار. جرّب قسمًا أو بحثًا آخر.')}
        </p>
      </section>
      {s.home.showPromise && (
        <section id="promise" class="promise">
          <div>
            <span class="eyebrow">{s.home.promiseEyebrow}</span>
            <h2 style={{ whiteSpace: 'pre-line' }}>{s.home.promiseTitle}</h2>
          </div>
          <div class="promise-cards">
            {s.home.promiseCards.map((card, i) => (
              <article>
                <span class="promise-icon">
                  <Icon name={['bag', 'phone', 'truck'][i % 3]} size={26} />
                </span>
                <h3>{card.title}</h3>
                <p>{card.text}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
function OfferChoices({ p, s }: { p: Product; s: Settings }) {
  const t = storeTranslator(s),
    money = localizedMoney(s),
    tail = tailPricing(p);
  return (
    <>
      <div class="offer-cards" data-offer-choices>
        {(p.offers.length || p.presentation?.bundleMode
          ? [
              {
                id: '',
                label: p.presentation?.bundleLabel || t('السعر الحالي للمنتج'),
                quantity: 1,
                total: p.price,
                freeShipping: !!p.presentation?.freeShipping,
              },
              ...p.offers,
            ]
          : []
        )
          .filter((o) => !p.presentation?.bundleMode || o.quantity <= p.stock)
          .map((o, i) => (
            <label class="offer-card">
              <input type="radio" name="offer" value={o.id} checked={i === 0} />
              <span>
                <b>{o.label || t('الكمية') + ': ' + o.quantity}</b>
                <small>
                  {t('الكمية')}: {o.quantity}
                  {o.freeShipping ? t('· توصيل مجاني') : ''}
                </small>
              </span>
              <strong>{money(o.total)}</strong>
            </label>
          ))}
      </div>
      <p class="quantity-tail-note" data-quantity-tail hidden={!tail}>
        {tail &&
          t('من الكمية {quantity}: {price} لكل منتج', {
            quantity: tail.fromQuantity,
            price: money(tail.unitPrice),
          })}
      </p>
    </>
  );
}
export function ProductPage({
  p,
  s,
  preview = false,
  recommendations = [],
}: {
  p: Product;
  s: Settings;
  preview?: boolean;
  recommendations?: Product[];
}) {
  s = storefrontSettings(landingSettings(s, p));
  const t = storeTranslator(s),
    money = localizedMoney(s);
  const originalPrice = p.price;
  p = pricedProduct(localizedProduct(p, s.storeLanguage));

  const landing = p.pageMode === 'landing';
  const blocks = [...p.blocks].filter((b) => b.enabled).sort((a, b) => a.order - b.order);
  const hasForm = blocks.some((b) => b.type === 'ORDER_FORM');
  const firstImage = blocks.find((b) => b.type === 'IMAGE')?.id;
  const gallery = [...new Set([p.image, ...(p.gallery || [])].filter(Boolean))];
  const available = !!p.verified && !!p.supplier && p.stock > 0;
  const eligible = recommendations.filter(
    (item) =>
      item.id !== p.id &&
      item.active &&
      item.verified &&
      item.stock > 0 &&
      item.storefrontVisible !== 0 &&
      item.supplier === p.supplier,
  );
  const related =
    p.presentation?.recommendationMode === 'hidden'
      ? []
      : p.presentation?.recommendationMode === 'manual'
        ? (p.presentation.recommendedIds || [])
            .flatMap((id) => eligible.find((item) => item.id === id) || [])
            .slice(0, 8)
        : eligible.slice(0, 4);
  if (landing)
    return (
      <main class="landing">
        <h1 class="sr-only">{p.name}</h1>
        {!p.blocks.some((b) => b.type === 'IMAGE') && p.image && (
          <img
            class="image-slice"
            src={p.image}
            alt={p.name}
            width="1000"
            height="1000"
            fetchpriority="high"
          />
        )}
        {blocks.map((b) =>
          b.type === 'IMAGE' ? (
            <img
              class="image-slice"
              src={b.settings.image || p.image}
              alt={b.settings.alt || p.name}
              width={b.settings.width || 1000}
              height={b.settings.height || 1000}
              loading={b.id === firstImage ? 'eager' : 'lazy'}
              fetchpriority={b.id === firstImage ? 'high' : 'auto'}
            />
          ) : b.type === 'CTA' ? (
            <div
              class="cta-block"
              style={{
                padding: String(b.settings.margin ?? 24) + 'px',
                background: b.settings.backgroundColor || 'transparent',
              }}
            >
              <a
                href={preview ? 'about:srcdoc#order-form' : '#order-form'}
                data-scroll-order
                class="primary"
                style={{
                  background: buttonColor(b.settings.color || p.color),
                  color: b.settings.textColor || '#ffffff',
                  fontSize: String(b.settings.size || 18) + 'px',
                }}
              >
                {localizedLandingButton(s, b.settings.text as string | undefined)}
              </a>
            </div>
          ) : (
            <OrderForm
              p={p}
              s={s}
              content={b.settings}
              preview={preview}
              choices={recommendations}
            />
          ),
        )}
        {!hasForm && !p.blocks.some((b) => b.type === 'ORDER_FORM') && (
          <OrderForm p={p} s={s} preview={preview} choices={recommendations} />
        )}
      </main>
    );
  return (
    <main class="regular-product">
      <div class="breadcrumb">
        <a href="/">{t('الرئيسية')}</a>
        <span>›</span>
        <a href="/#products">{t('المنتجات')}</a>
        <span>›</span>
        <span>{p.name}</span>
      </div>
      <section class="product-detail">
        <div class="product-gallery">
          <button
            type="button"
            class="gallery-main"
            data-zoom-image
            aria-label={t('تكبير صورة المنتج')}
          >
            {gallery[0] ? (
              <img
                id="product-main-image"
                src={gallery[0]}
                alt={p.name}
                width="600"
                height="600"
                fetchpriority="high"
              />
            ) : (
              <span class="image-placeholder">
                <Icon name="bag" size={80} />
              </span>
            )}
            <span class="gallery-zoom-hint">{t('عرض الصورة')}</span>
          </button>
          {gallery.length > 1 && (
            <div class="gallery-thumbnails" aria-label={t('صور المنتج')}>
              {gallery.map((image, i) => (
                <button
                  type="button"
                  data-gallery-image={image}
                  aria-label={t('صورة المنتج ') + (i + 1)}
                  aria-pressed={i === 0 ? 'true' : 'false'}
                >
                  <img src={image} alt="" width="80" height="80" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div class="product-purchase">
          <div class="product-heading">
            {!available && <span class="availability">{t('غير متاح حاليًا')}</span>}
            <button type="button" class="text-button" data-share-product>
              {t('مشاركة ↗')}
            </button>
          </div>
          <h1>{p.name}</h1>
          <div class="product-price-line">
            <strong data-product-price>{money(p.price)}</strong>
            {originalPrice > p.price && (
              <>
                <del data-sale-original={p.id}>{money(originalPrice)}</del>
                <span class="promotion-badge" data-sale-badge={p.id}>
                  −{Math.round((1 - p.price / originalPrice) * 100)}%
                </span>
              </>
            )}
            <span>{t('الدفع عند الاستلام')}</span>
          </div>
          {originalPrice > p.price && p.presentation?.promotion?.endsAt && (
            <PromotionCard p={p} s={s} originalPrice={originalPrice} />
          )}
          <ProductChoices p={p} choices={recommendations} s={s} />
          <div
            class="product-offers"
            data-product-offers
            hidden={!p.offers.length && !p.presentation?.bundleMode}
          >
            <h2>{t('اختر ما يناسبك')}</h2>
            <OfferChoices p={p} s={s} />
          </div>
          <div class="product-buy" id="product-buy">
            <div
              class="product-quantity"
              data-product-quantity
              hidden={!!p.presentation?.bundleMode}
            >
              <span>{t('الكمية')}</span>
              <div class="quantity-stepper">
                <button type="button" data-product-step="-1" aria-label={t('تقليل كمية المنتج')}>
                  −
                </button>
                <input
                  id="product-quantity"
                  type="number"
                  min="1"
                  max={Math.min(p.stock || 1, 100)}
                  value="1"
                  aria-label={t('كمية المنتج')}
                />
                <button type="button" data-product-step="1" aria-label={t('زيادة كمية المنتج')}>
                  +
                </button>
              </div>
            </div>
            <button
              type="button"
              id="buy-now"
              class="primary"
              data-product-id={p.id}
              disabled={!available || preview}
            >
              <Icon name="arrow" />
              {t('شراء الآن')}
            </button>
            <button
              type="button"
              id="add-offer"
              class="secondary"
              data-product-id={p.id}
              disabled={!available || preview}
            >
              <Icon name="bag" />
              <span data-add-label>{t('أضف للسلة')}</span>
            </button>
          </div>
          <p id="supplier-conflict" class="error-text" hidden>
            {t(
              'سلتك تحتوي على منتجات من مستودع آخر. لإضافة هذا المنتج، ابدأ سلة جديدة بعد تأكيدك.',
            )}
          </p>
          <div class="product-delivery">
            <div>
              <Icon name="truck" />
              <span>
                <b>{s.productInfo.deliveryTitle}</b>
                <small data-product-delivery>
                  {productDeliveryText(
                    s.productInfo.deliveryText,
                    money(s.shippingCasa),
                    money(s.shippingOther),
                  )}
                </small>
              </span>
            </div>
            <div>
              <Icon name="shield" />
              <span>
                <b>{s.productInfo.paymentTitle}</b>
                <small>{s.productInfo.paymentText}</small>
              </span>
            </div>
          </div>
          {p.presentation?.descriptionFormat !== 'html' && <DescriptionPanel p={p} s={s} />}
          {s.productInfo.showDeliveryReturns &&
            (s.productInfo.deliveryReturnsTitle.trim() ||
              s.productInfo.deliveryReturnsText.trim()) && (
              <details class="product-description-panel product-service-summary">
                <summary>
                  {s.productInfo.deliveryReturnsTitle}
                  <span>＋</span>
                </summary>
                <p style={{ whiteSpace: 'pre-line' }}>{s.productInfo.deliveryReturnsText}</p>
              </details>
            )}
        </div>
      </section>
      {p.presentation?.descriptionFormat === 'html' && (
        <section class="product-rich-details">
          <DescriptionPanel p={p} s={s} />
        </section>
      )}
      {!!related.length && (
        <section class="products-section related-products" data-related-products>
          <div class="section-heading">
            <div>
              <span class="eyebrow">{t('أكمل اختياراتك')}</span>
              <h2>{t('قد يعجبك أيضًا')}</h2>
            </div>
            <a href="/#products" class="text-button">
              {t('عرض الكل ←')}
            </a>
          </div>
          <div class="product-grid">
            {related.map((item) => (
              <ProductCard p={item} s={s} />
            ))}
          </div>
        </section>
      )}
      <div class="product-dock" id="product-dock">
        <div>
          {p.image && <img src={p.image} alt="" width="48" height="48" />}
          <span>
            <b data-purchase-name>{p.name}</b>
            <strong data-product-price>{money(p.price)}</strong>
            {originalPrice > p.price && (
              <>
                <del data-sale-original={p.id}>{money(originalPrice)}</del>
                <span class="promotion-badge" data-sale-badge={p.id}>
                  −{Math.round((1 - p.price / originalPrice) * 100)}%
                </span>
              </>
            )}
          </span>
        </div>
        <button
          type="button"
          class="primary"
          data-buy-now
          data-product-id={p.id}
          disabled={!available || preview}
        >
          <Icon name="bag" size={19} />
          <span>{t('شراء الآن')}</span>
        </button>
      </div>
      <dialog id="image-dialog" aria-label={t('صورة المنتج مكبرة')}>
        <button type="button" data-close-image aria-label={t('إغلاق الصورة')}>
          <Icon name="close" />
        </button>
        <img id="zoomed-product-image" src={gallery[0] || ''} alt={p.name} />
      </dialog>
    </main>
  );
}
function ProductChoices({ p, choices, s }: { p: Product; choices: Product[]; s: Settings }) {
  const alternatives = landingProducts(p, choices);
  if (alternatives.length < 2) return null;
  const packSavings = landingPackSavings(p, choices);
  const t = storeTranslator(s),
    money = localizedMoney(s);
  return (
    <fieldset class="landing-product-choices" data-landing-products>
      <legend>{t('اختر المنتج الذي تريد طلبه')}</legend>
      <div class="offer-choices">
        {alternatives.map((choice) => {
          const item = pricedProduct(localizedProduct(choice, s.storeLanguage));
          return (
            <label class="offer-card landing-product-choice">
              <input
                type="radio"
                name="landing-product"
                value={item.id}
                checked={item.id === p?.id}
                disabled={!item.active || !item.verified || !item.supplier || item.stock < 1}
              />
              {item.image && <img src={item.image} alt="" width="56" height="56" loading="lazy" />}
              <span>
                <b>{item.name}</b>
                {item.id === p?.id &&
                  (p.presentation?.landingPackComponentIds?.length || 0) >= 2 && (
                    <small data-pack-savings hidden={packSavings <= 0}>
                      {t('توفير {amount} مقارنة بشراء المكونات منفصلة', {
                        amount: money(packSavings),
                      })}
                    </small>
                  )}
              </span>
              <strong data-choice-price={item.id}>{money(item.price)}</strong>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function OrderForm({
  choices = [],
  p,
  s,
  content = {},
  preview = false,
  direct = false,
}: {
  p?: Product;
  direct?: boolean;
  s: Settings;
  content?: FormContent;
  choices?: Product[];
  preview?: boolean;
}) {
  s = storefrontSettings(landingSettings(s, p));
  if (p) p = pricedProduct(p);
  const t = storeTranslator(s),
    money = localizedMoney(s);

  const formDefault = localizedForm(s);
  const f = localizedForm(s, content);
  const appearance = p?.pageMode === 'landing' ? landingFormAppearance(p, s) : null;
  const badgeText = landingBadgeText(p, content, s);
  return (
    <section
      id="order-form"
      class={
        'checkout-section' +
        (!p ? ' cart-checkout-section' : '') +
        (appearance ? ' landing-order-form' : '')
      }
      style={
        appearance
          ? {
              background: appearance.background,
              color: appearance.text,
              '--ink': appearance.text,
              '--green': appearance.text,
              '--muted': appearance.muted,
              '--surface': appearance.surface,
              '--cream': appearance.background,
              '--line': appearance.border,
              '--landing-field-background': appearance.fieldBackground,
              '--landing-field-text': appearance.fieldText,
              '--landing-placeholder': appearance.placeholder,
              '--landing-accent': appearance.accent,
              '--landing-button-background': appearance.buttonBackground,
              '--landing-button-text': appearance.buttonText,
            }
          : { background: 'var(--cream)' }
      }
    >
      {!p && (
        <div class="checkout-progress">
          <span>{t('١ السلة')}</span>
          <b>{t('٢ بيانات التوصيل')}</b>
          <span>{t('٣ تأكيد الطلب')}</span>
        </div>
      )}
      <div class="section-heading">
        <div>
          {f.formSubtitle.trim() && <span class="eyebrow">{f.formSubtitle}</span>}
          <h2>
            {p
              ? (content.formTitle ?? (!direct && p.offers.length ? f.formTitle : t('أكمل طلبك')))
              : t('إتمام طلبك')}
          </h2>
        </div>
        {badgeText.trim() && <span class="cod-badge">{badgeText}</span>}
      </div>
      {p && <ProductChoices p={p} choices={choices} s={s} />}
      {p && !direct && (
        <div class="offer-options">
          <OfferChoices p={p} s={s} />
          {p.pageMode !== 'landing' && !direct && (
            <>
              <button
                class="primary"
                id="add-offer"
                data-product-id={p.id}
                style={{ background: buttonColor(p.color) }}
                disabled={!p.verified || !p.supplier || p.stock < 1}
              >
                {p.offers.length ? t('أضف العرض إلى السلة') : t('أضف المنتج إلى السلة')}
              </button>
              <p id="supplier-conflict" class="error-text" hidden>
                {t(
                  'يمكنك طلب هذا العرض مباشرة مع بقاء سلتك محفوظة. إضافته إلى السلة يتطلب بدء سلة جديدة.',
                )}
              </p>
            </>
          )}
        </div>
      )}
      {!p && <ShippingProgress s={s} />}
      <div class="checkout-layout">
        <form id="checkout-form" method="post" action="/api/orders">
          {!p && (
            <h3 class="checkout-form-title">
              <Icon name="truck" />
              {t('بيانات التوصيل')}
            </h3>
          )}
          <div class="form-grid">
            <label>
              {f.nameLabel || formDefault.nameLabel}
              <input
                name="name"
                required
                autocomplete="name"
                maxlength={120}
                placeholder={f.namePlaceholder}
              />
            </label>
            <label>
              {f.phoneLabel || formDefault.phoneLabel}
              <input
                name="phone"
                required
                inputmode="tel"
                autocomplete="tel"
                maxlength={40}
                placeholder={f.phonePlaceholder}
                dir="ltr"
              />
            </label>
            <div class="city-field">
              <label for="checkout-city">{f.cityLabel || formDefault.cityLabel}</label>
              <div class="city-picker" data-city-picker>
                <input
                  id="checkout-city"
                  name="city"
                  required
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded="false"
                  aria-controls="city-suggestions"
                  autocomplete="address-level2"
                  maxlength={100}
                  placeholder={f.cityPlaceholder}
                />
                <button
                  type="button"
                  data-city-toggle
                  aria-label={t('عرض قائمة المدن')}
                  aria-controls="city-suggestions"
                  aria-expanded="false"
                >
                  ⌄
                </button>
                <ul
                  id="city-suggestions"
                  class="city-options"
                  role="listbox"
                  aria-label={t('المدن')}
                  hidden
                ></ul>
              </div>
            </div>
            <label>
              {f.addressLabel || formDefault.addressLabel}
              <input
                name="address"
                required
                autocomplete="street-address"
                maxlength={500}
                placeholder={f.addressPlaceholder}
              />
            </label>
          </div>
          {f.showNotes && (
            <div class="order-notes">
              <label>
                {f.notesLabel} <small>{t('(اختياري)')}</small>
                <textarea name="notes" maxlength={500} placeholder={f.notesPlaceholder}></textarea>
              </label>
            </div>
          )}
          <div class="checkout-methods">
            <div class="checkout-method">
              <Icon name="truck" />
              <span>
                <b>{t('التوصيل إلى عنوانك')}</b>
                <small>{t('سيتواصل معك رجل التوصيل')}</small>
              </span>
              <strong data-delivery-price>—</strong>
            </div>
            <div class="checkout-method">
              <Icon name="shield" />
              <span>
                <b>{t('الدفع عند الاستلام')}</b>
                <small>{t('ادفع نقدًا عندما يصلك طلبك')}</small>
              </span>
              <span class="method-selected">✓</span>
            </div>
          </div>
          <div id="turnstile-order"></div>
          <p id="checkout-error" class="error-text" role="alert"></p>
          <button
            type="submit"
            disabled={preview}
            class="primary submit-order"
            style={
              appearance
                ? { background: appearance.buttonBackground, color: appearance.buttonText }
                : { background: buttonColor(p?.color) }
            }
          >
            {f.submitText || formDefault.submitText}
          </button>
          {(policyVisible(s, 'terms') || policyVisible(s, 'privacy')) && (
            <p class="muted checkout-consent">
              {t('بالإرسال توافق على')}{' '}
              {policyVisible(s, 'terms') && <a href={policyHref('terms', p)}>{t('الشروط')}</a>}
              {policyVisible(s, 'terms') && policyVisible(s, 'privacy') && <> {t('و')} </>}
              {policyVisible(s, 'privacy') && (
                <a href={policyHref('privacy', p)}>{t('سياسة الخصوصية')}</a>
              )}
              .
            </p>
          )}
        </form>
        <aside class="order-summary">
          <details open class="checkout-summary-details">
            <summary>
              <span>
                {t('ملخص طلبك')}
                <small data-checkout-count></small>
              </span>
              <strong data-quote-total>—</strong>
              <span class="summary-chevron">⌄</span>
            </summary>
            <div class="checkout-summary-content">
              <div id="checkout-items"></div>
              <div class="summary-row">
                <span>{t('المنتجات')}</span>
                <strong id="subtotal">—</strong>
              </div>
              <div class="summary-row">
                <span>{t('التوصيل')}</span>
                <strong id="shipping">—</strong>
              </div>
              <div class="summary-row total">
                <span>{t('الإجمالي عند الاستلام')}</span>
                <strong id="total">—</strong>
              </div>
              <div class="summary-trust">
                {t('✓ رسم توصيل واحد')}
                <br />
                {t('✓ تأكيد هاتفي قبل الشحن')}
                <br />
                {t('✓ ادفع عندما يصل طلبك')}
              </div>
              {!p && (
                <button class="secondary" data-open-cart>
                  {t('تعديل السلة')}
                </button>
              )}
            </div>
          </details>
        </aside>
      </div>
    </section>
  );
}
function DescriptionPanel({ p, s }: { p: Product; s: Settings }) {
  const t = storeTranslator(s);
  return (
    <details class="product-description-panel" open>
      <summary>
        {t('وصف المنتج')}
        <span>＋</span>
      </summary>
      <div
        class={
          'product-description' +
          (p.presentation?.descriptionFormat === 'html' ? ' formatted-description' : '')
        }
      >
        {p.presentation?.descriptionFormat === 'html' && p.presentation.descriptionHtml
          ? raw(safeProductHtml(p.presentation.descriptionHtml))
          : p.description || t('تواصل معنا لأي استفسار عن هذا المنتج.')}
      </div>
    </details>
  );
}
export async function previewHTML(
  p: Product,
  s: Settings,
  language?: Settings['storeLanguage'],
  choices: Product[] = [],
) {
  if (language && p.pageMode !== 'landing') s = { ...s, storeLanguage: language };
  s = storefrontSettings(landingSettings(s, p));
  if (p) p = pricedProduct(p);
  const t = storeTranslator(s),
    money = localizedMoney(s);

  return (
    '<!doctype html>' +
    (await (
      <Layout
        s={s}
        products={landingProducts(p, choices)}
        product={p}
        title={t('معاينة · ') + p.name}
        development={false}
        preview
      >
        <ProductPage p={p} s={s} recommendations={choices} preview />
      </Layout>
    ).toString())
  );
}

function ShippingProgress({ s }: { s: Settings }) {
  const t = storeTranslator(s);
  return (
    <div class="cart-threshold" data-cart-threshold hidden aria-live="polite">
      <p data-threshold-message></p>
      <div
        class="threshold-track"
        role="progressbar"
        aria-label={t('التقدم نحو الشحن المجاني')}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="0"
      >
        <span data-threshold-progress></span>
      </div>
    </div>
  );
}

function StoreLanguageSwitcher({ s }: { s: Settings }) {
  const enabled = enabledStoreLanguages(s),
    t = storeTranslator(s);
  if (enabled.length < 2) return null;
  return (
    <label class="store-language-switcher">
      <select data-store-language aria-label={t('لغة المتجر')} value={s.storeLanguage}>
        {enabled.map((language) => (
          <option value={language} lang={language} selected={language === s.storeLanguage}>
            {languageNames[language]}
          </option>
        ))}
      </select>
    </label>
  );
}

function SocialIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    whatsapp:
      'M12 2a10 10 0 0 0-8.65 15.02L2 22l5.12-1.34A10 10 0 1 0 12 2Zm0 18a7.95 7.95 0 0 1-4.06-1.1l-.29-.17-3.04.8.81-2.96-.19-.3A8 8 0 1 1 12 20Zm4.4-5.98c-.24-.12-1.43-.7-1.65-.79-.22-.08-.38-.12-.54.12-.16.24-.62.79-.76.95-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.19-.47-.39-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.83-.84 2.02s.86 2.34.98 2.5c.12.16 1.7 2.6 4.12 3.64.57.24 1.02.39 1.37.5.57.18 1.09.15 1.5.1.46-.07 1.43-.59 1.63-1.15.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z',
    facebook: 'M14 22v-9h3l.5-4H14V7c0-1 .4-2 2-2h2V1h-3c-4 0-6 2-6 6v2H6v4h3v9Z',
    instagram:
      'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3Zm5 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm5-4h2v2h-2Z',
    youtube: 'M3 5q9-2 18 0v14q-9 2-18 0Zm6 3v8l7-4Z',
    tiktok: 'M14 2h4q0 4 4 5v4q-3 0-5-2v8a6 6 0 1 1-6-6v4a2 2 0 1 0 3 2Z',
    linkedin: 'M3 3h4v4H3Zm0 6h4v13H3Zm6 0h4v2q2-3 5-2t3 5v8h-4v-7q0-3-2-3t-2 3v7H9Z',
    x: 'M3 3h5l5 7 6-7h3l-7 9 7 10h-5l-6-8-6 8H2l7-10Zm4 2 12 15h-2L5 5Z',
    snapchat: 'M12 2q-6 0-6 7v3l-3 2 3 2-2 3 4 1 4 2 4-2 4-1-2-3 3-2-3-2V9q0-7-6-7Z',
  };
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      fill-rule="evenodd"
    >
      <path d={paths[name] || paths.whatsapp} />
    </svg>
  );
}
function StoreContacts({
  s,
  showContact = true,
  showSocials = true,
}: {
  s: Settings;
  showContact?: boolean;
  showSocials?: boolean;
}) {
  const socials = showSocials ? Object.entries(s.socials).filter(([, url]) => url) : [];
  if (!(showContact && (s.contactEmail || s.contactPhone)) && !socials.length) return null;
  return (
    <div class="store-contacts">
      {showContact && s.contactEmail && (
        <a href={'mailto:' + s.contactEmail}>
          <span aria-hidden="true">✉</span>
          {s.contactEmail}
        </a>
      )}
      {showContact && s.contactPhone && (
        <a href={'tel:' + s.contactPhone.replace(/[^+\d]/g, '')}>
          <Icon name="phone" />
          <bdi dir="ltr">{s.contactPhone}</bdi>
        </a>
      )}
      {!!socials.length && (
        <nav class="social-links" aria-label={storeTranslator(s)('تابعنا')}>
          {socials.map(([name, url]) => (
            <a href={url} target="_blank" rel="noopener noreferrer" aria-label={name} title={name}>
              <SocialIcon name={name} />
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

function PromotionCard({
  p,
  s,
  originalPrice,
}: {
  p: Product;
  s: Settings;
  originalPrice: number;
}) {
  const t = storeTranslator(s),
    promo = p.presentation!.promotion!,
    end = promo.endsAt!;
  const clock = promotionClock(end),
    remaining = promo.startsAt ? promotionRemaining(promo.startsAt, end) : null;
  return (
    <section
      class="promotion-countdown"
      data-promo-countdown
      data-sale-deadline={p.id}
      data-end={end}
      data-start={promo.startsAt || ''}
      aria-label={t('عرض لفترة محدودة')}
      hidden={clock.expired}
    >
      <div class="promotion-countdown-heading">
        <strong>{t('عرض لفترة محدودة')}</strong>
        <b>−{Math.round((1 - p.price / originalPrice) * 100)}%</b>
      </div>
      <div class="promotion-countdown-body">
        <p>
          {t('ينتهي العرض في')}{' '}
          <time dateTime={end}>
            {new Date(end).toLocaleString(s.storeLanguage, {
              timeZone: 'Africa/Casablanca',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </time>
        </p>
        <div class="promotion-clock" dir="ltr">
          {(
            [
              ['days', 'يوم'],
              ['hours', 'ساعة'],
              ['minutes', 'دقيقة'],
              ['seconds', 'ثانية'],
            ] as const
          ).map(([part, label]) => (
            <div>
              <b data-clock-part={part}>{String(clock[part]).padStart(2, '0')}</b>
              <small>{t(label)}</small>
            </div>
          ))}
        </div>
        {remaining !== null && (
          <div
            class="promotion-time-bar"
            role="progressbar"
            aria-label={t('الوقت المتبقي للعرض')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(remaining * 100)}
          >
            <span style={{ width: remaining * 100 + '%' }} />
          </div>
        )}
      </div>
    </section>
  );
}
