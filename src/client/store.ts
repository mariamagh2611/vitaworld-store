import { productSort, sortedProducts } from '../shared/product-sort';
import { productDeliveryText } from '../shared/product-info';
import {
  cartOffers,
  bundleChoices,
  promotionClock,
  promotionRemaining,
  quantityPrice,
  QUANTITY_TAIL_ID,
} from '../shared/commerce';
import { marketingSource } from '../shared/marketing';
import { setupCityPicker } from './city-picker';
import { isCasablancaAlias } from '../shared/cities';
import { compatibleCartLine } from '../shared/cart-review';
import { normalizeSearch, searchTokens } from '../shared/search';
import '../styles.css';
import type { PublicProduct, LocalCartLine, Quote, CartLine } from '../shared/types';
import { money as formatMoney, type Language } from '../shared/types';
import { translator, languageOf } from '../shared/i18n';
import { addToCart, checkoutIntent } from '../shared/domain';
type Config = {
  settings: {
    attributionDays: number;
    showPriceSort: boolean;
    deliveryText: string;
    storeLanguage: Language;
    storeLanguages: Language[];
    copy: Record<string, string>;
    brand: string;
    whatsapp: string;
    facebookPixel: string;
    facebookPixels?: string[];
    tiktokPixel: string;
    googleId: string;
    googleAdsId: string;
    googleAdsLeadLabel: string;
    snapPixel: string;
    trackingEnabled: boolean;
    turnstileSiteKey: string;
    shippingCasa: number;
    shippingOther: number;
    cartFreeShippingThreshold: number;
  };
  products: PublicProduct[];
  landing?: boolean;
  direct?: boolean;
  checkout?: boolean;
  productId?: string;
  landingProductIds?: string[];
  landingPackComponentIds?: string[];
  development: boolean;
  searchIds?: string[];
};
const config = JSON.parse(document.getElementById('store-data')!.textContent!) as Config;
const directCheckout = !!(config.landing || config.direct);
const t = translator(languageOf(config.settings.storeLanguage), config.settings.copy);
const money = (cents: number) => formatMoney(cents, languageOf(config.settings.storeLanguage));
const languageDraftKey = 'dar-language-draft';
let restoredDirectQuantity = 0;
const landingChoiceKey = 'dar-landing-product:' + config.productId;
let selectedPurchaseId = config.productId;
const allowedLandingIds = new Set(config.landingProductIds || [config.productId]);
try {
  const saved = sessionStorage.getItem(landingChoiceKey);
  const p = config.products.find((p) => p.id === saved);
  if (
    config.productId &&
    saved &&
    allowedLandingIds.has(saved) &&
    p?.active &&
    p.verified &&
    p.stock > 0
  )
    selectedPurchaseId = saved;
} catch {}
function purchaseProductId() {
  return selectedPurchaseId;
}
let selectedOfferId = config.direct ? new URLSearchParams(location.search).get('offer') || '' : '';
function currentOfferId() {
  return selectedOfferId;
}
function purchaseQuantity() {
  return Math.max(
    1,
    Math.min(
      100,
      Number(document.querySelector<HTMLInputElement>('#product-quantity')?.value) ||
        directQuantity,
    ),
  );
}
function setPurchaseQuantity(quantity: number) {
  const p = config.products.find((p) => p.id === purchaseProductId());
  const q = Math.max(1, Math.min(100, p?.stock || 100, quantity));
  directQuantity = q;
  const input = document.querySelector<HTMLInputElement>('#product-quantity');
  if (input) input.value = String(q);
  selectedOfferId = p ? quantityPrice(p, q).offerId : '';
}
function saveLanguageDraft() {
  try {
    const form = document.querySelector<HTMLFormElement>('#checkout-form');
    const fields: Record<string, string> = {};
    for (const name of ['name', 'phone', 'city', 'address', 'notes']) {
      const input = form?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[name="' + name + '"]',
      );
      if (input) fields[name] = input.value;
    }
    sessionStorage.setItem(
      languageDraftKey,
      JSON.stringify({
        path: location.pathname,
        productId: config.productId,
        selectedProductId: purchaseProductId(),
        at: Date.now(),
        fields,
        offer: currentOfferId(),
        quantity:
          document.querySelector<HTMLInputElement>('#product-quantity')?.value ??
          String(directQuantity),
      }),
    );
  } catch {}
}
function restoreLanguageDraft() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(languageDraftKey) || 'null');
    if (!saved) return;
    sessionStorage.removeItem(languageDraftKey);
    if (
      saved.path !== location.pathname ||
      saved.productId !== config.productId ||
      !Number.isFinite(saved.at) ||
      Date.now() - saved.at > 600000
    )
      return;
    if (
      config.productId &&
      allowedLandingIds.has(saved.selectedProductId) &&
      config.products.some(
        (p) => p.id === saved.selectedProductId && p.active && p.verified && p.stock > 0,
      )
    )
      selectedPurchaseId = saved.selectedProductId;
    for (const name of ['name', 'phone', 'city', 'address', 'notes']) {
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '#checkout-form [name="' + name + '"]',
      );
      if (input && typeof saved.fields?.[name] === 'string') input.value = saved.fields[name];
    }
    if (typeof saved.offer === 'string') {
      selectedOfferId = saved.offer;
      const choice = document.querySelector<HTMLInputElement>(
        'input[name=offer][value="' + CSS.escape(saved.offer) + '"]',
      );
      if (choice) choice.checked = true;
    }
    if (directCheckout && typeof saved.quantity === 'string' && /^\d{1,3}$/.test(saved.quantity))
      restoredDirectQuantity = Math.max(1, Math.min(100, Number(saved.quantity)));
    const quantity = document.querySelector<HTMLInputElement>('#product-quantity');
    if (quantity && typeof saved.quantity === 'string' && /^\d{1,3}$/.test(saved.quantity))
      quantity.value = saved.quantity;
  } catch {}
}
restoreLanguageDraft();
document.querySelectorAll<HTMLSelectElement>('[data-store-language]').forEach((select) =>
  select.addEventListener('change', () => {
    if (!config.settings.storeLanguages.includes(select.value as Language)) return;
    saveLanguageDraft();
    const url = new URL(location.href);
    url.searchParams.set('lang', select.value);
    location.assign(url.toString());
  }),
);
let selectedCategory = new URL(location.href).searchParams.get('category') || '';
let selectedSort = productSort(
  new URL(location.href).searchParams.get('sort'),
  config.settings.showPriceSort !== false,
);
let searchTerm = new URL(location.href).searchParams.get('q') || '';
let searchIds: string[] | null = config.searchIds ?? null;
let searchSerial = 0;
let searchController: AbortController | undefined;
if (
  ![...document.querySelectorAll<HTMLElement>('[data-category]')].some(
    (el) => el.dataset.category === selectedCategory,
  )
)
  selectedCategory = '';
const KEY = 'dar-cart-v1',
  ATTR = 'dar-attribution';
let attributionMemory: Record<string, any> = {};
// Capture the landing campaign before cart, search and checkout initialization.
captureAttribution();
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
const escape = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
let memoryCart: LocalCartLine[] = [];
let cartStorageAvailable = true;
function read(): LocalCartLine[] {
  if (!cartStorageAvailable) return memoryCart;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return (memoryCart =
      Array.isArray(v) && v.length <= 30
        ? v.filter(
            (x) =>
              x &&
              typeof x.productId === 'string' &&
              typeof x.supplier === 'string' &&
              typeof x.sku === 'string' &&
              Number.isInteger(x.quantity) &&
              x.quantity > 0,
          )
        : []);
  } catch {
    cartStorageAvailable = false;
    return memoryCart;
  }
}
let cart = read(),
  quote: Quote | null = null,
  reviewProducts: PublicProduct[] | null = null,
  quoteSerial = 0,
  captcha = '',
  widget: string | undefined;
let quotedIntent = '',
  quotedAt = 0;
const quoteIntent = () =>
  JSON.stringify({
    cart: payload(),
    city: $<HTMLInputElement>('[name=city]')?.value || '',
    checkoutMode: directCheckout ? 'direct' : 'cart',
  });
let shippingRates = { casa: config.settings.shippingCasa, other: config.settings.shippingOther };
let replacement: LocalCartLine | null = null;
const attemptKey =
  directCheckout && config.productId
    ? 'dar-direct-order-attempt:' + config.productId
    : 'dar-order-attempt';
function toast(message: string) {
  const el = $('#toast')!;
  el.textContent = message;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3500);
}
function write(next: LocalCartLine[]) {
  const changedSupplier = cart[0]?.supplier !== next[0]?.supplier;
  const changed = checkoutIntent(cart, {}) !== checkoutIntent(next, {});
  cart = next;
  memoryCart = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(cart));
    if (changed) localStorage.removeItem('dar-order-attempt');
  } catch {
    cartStorageAvailable = false;
  }
  render();
  void updateQuote();
  if (changedSupplier && searchTerm.trim() && $('.shop-home')) void runSearch();
}
function chosen(p: PublicProduct, id = '', quantity?: number): LocalCartLine {
  const selected = quantityPrice(
    p,
    quantity ?? cartOffers(p).find((o) => o.id === id)?.quantity ?? 1,
  );
  const invalid =
    id &&
    !cartOffers(p).some((o) => o.id === id) &&
    (id !== QUANTITY_TAIL_ID || !p.quantityPricing);
  return {
    productId: p.id,
    sku: p.sku,
    name: p.name,
    image: p.image,
    supplier: p.supplier!,
    offerId: invalid ? id : selected.offerId,
    quantity: selected.quantity,
    unitPrice: selected.unitPrice,
    subtotal: selected.total,
    freeShipping: selected.freeShipping,
    offerLabel:
      selected.label ||
      (selected.offerId === QUANTITY_TAIL_ID
        ? t('سعر الكميات الأكبر')
        : p.offers.length
          ? t('السعر الحالي للمنتج')
          : ''),
    revision: selected.revision,
  };
}
if (config.direct) {
  const selected = new URLSearchParams(location.search).get('offer');
  const radio = Array.from(document.querySelectorAll<HTMLInputElement>('input[name=offer]')).find(
    (el) => el.value === selected,
  );
  if (radio) radio.checked = true;
}
function directQuantityKey() {
  return 'dar-direct-quantity:' + purchaseProductId() + ':' + location.search;
}
let directQuantity = Math.max(
  1,
  Math.min(
    100,
    restoredDirectQuantity || Number(new URLSearchParams(location.search).get('quantity')) || 1,
  ),
);
try {
  directQuantity = Math.max(
    1,
    Math.min(
      100,
      restoredDirectQuantity ||
        Number(sessionStorage.getItem(directQuantityKey())) ||
        Number(
          sessionStorage.getItem(
            'dar-direct-addons:' + config.productId + ':' + location.search + ':quantity',
          ),
        ) ||
        directQuantity,
    ),
  );
} catch {}
if (config.direct && !restoredDirectQuantity && directQuantity === 1) {
  const p = config.products.find((p) => p.id === purchaseProductId());
  const oldOffer = p?.offers.find((o) => o.id === selectedOfferId);
  if (oldOffer) directQuantity = oldOffer.quantity;
}
function checkoutLines() {
  if (!directCheckout) return cart;
  const p = config.products.find((p) => p.id === purchaseProductId());
  return p ? [chosen(p, currentOfferId(), directQuantity)] : [];
}
function add(id: string, offerId = '', increment = false, quantity = 1) {
  const p = config.products.find((p) => p.id === id);
  if (!p?.verified || !p.supplier || !p.active || p.stock < 1) {
    toast(t('المنتج غير متاح حاليًا.'));
    return false;
  }
  try {
    cart = read();
    const old = cart.find((l) => l.sku === p.sku);
    const offered = cartOffers(p).find((o) => o.id === offerId);
    const requested = offered?.quantity ?? quantity;
    if (p.bundleMode && increment && old) {
      toast(t('المنتج موجود في السلة. اختر الباقة من السلة.'));
      $<HTMLDialogElement>('#cart-dialog')?.showModal();
      return false;
    }
    if (p.bundleMode && !bundleChoices(p).includes(requested)) {
      toast(t('اختر إحدى الباقات المتاحة لهذا المنتج.'));
      return false;
    }
    const l = chosen(p, '', increment && old ? old.quantity + requested : requested);
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > Math.min(p.stock, 100)) {
      toast(t('الكمية المطلوبة غير متوفرة. جرّب كمية أقل.'));
      return false;
    }
    if (cart.length && cart[0].supplier !== l.supplier) {
      replacement = l;
      $<HTMLDialogElement>('#replace-cart-dialog')!.showModal();
      return false;
    }
    write(addToCart(cart, l));
    track('AddToCart', {
      content_ids: [p.sku],
      content_type: 'product',
      value: (l.subtotal ?? l.unitPrice * l.quantity) / 100,
    });
    toast(t('تمت الإضافة إلى السلة'));
    return true;
  } catch (e) {
    toast(t((e as Error).message));
    return false;
  }
}
function bundleControls(l: LocalCartLine, direct: boolean) {
  const p = config.products.find((p) => p.id === l.productId);
  if (!p?.bundleMode) return '';
  const values = bundleChoices(p),
    options = values.map((quantity) => {
      const priced = quantityPrice(p, quantity);
      const label =
        priced.label || (quantity === 1 ? p.bundleLabel : '') || t('الكمية') + ': ' + quantity;
      return `<option value="${quantity}" ${quantity === l.quantity ? 'selected' : ''}>${escape(label)} · ${money(priced.total)}${priced.freeShipping ? ' ' + escape(t('· توصيل مجاني')) : ''}</option>`;
    });
  if (!values.includes(l.quantity))
    options.unshift(
      `<option disabled selected value="${l.quantity}">${escape(t('راجع الباقات المتاحة'))}</option>`,
    );
  return `<label class="cart-bundle-selector">${escape(t('الباقة'))}<select data-bundle-quantity="${escape(l.sku)}" data-bundle-direct="${direct}">${options.join('')}</select></label>`;
}
function linesHtml(lines: LocalCartLine[], editable = true, direct = false) {
  return lines
    .map(
      (l) =>
        `<div class="cart-line">${l.image ? `<img class="cart-line-image" src="${escape(l.image)}" alt="" width="64" height="64" loading="lazy">` : ''}<div class="cart-line-info"><b>${escape((reviewProducts || config.products).find((product) => product.id === l.productId)?.name || l.name)}</b><small>${l.offerLabel ? escape(l.offerLabel) + ' · ' : ''}${money(l.offerId && l.subtotal !== undefined ? l.subtotal : l.unitPrice * l.quantity)}</small>${l.freeShipping ? `<span class="bundle-shipping-benefit">${escape(t('توصيل مجاني مع هذا العرض'))}</span>` : ''}<div class="quantity-controls">${editable && config.products.find((p) => p.id === l.productId)?.bundleMode ? bundleControls(l, direct) : !editable || l.offerId.startsWith('checkout:') ? `<span>${escape(t('الكمية'))}: ${l.quantity}</span>` : `<button type="button" ${direct ? 'data-direct-quantity' : 'data-quantity'}="${escape(l.sku)}" data-change="-1" aria-label="${escape(t('تقليل الكمية'))}">−</button><span>${l.quantity}</span><button type="button" ${direct ? 'data-direct-quantity' : 'data-quantity'}="${escape(l.sku)}" data-change="1" aria-label="${escape(t('زيادة الكمية'))}">+</button>`}</div></div>${editable && !direct ? `<button type="button" class="remove-line" data-remove="${escape(l.sku)}" aria-label="${escape(t('حذف المنتج'))}">×</button>` : ''}</div>`,
    )
    .join('');
}
function render() {
  document.querySelectorAll<HTMLElement>('[data-card-price]').forEach((el) => {
    const p = config.products.find((p) => p.id === el.dataset.cardPrice);
    if (p) el.textContent = money(p.price);
  });
  const pricingProduct = config.products.find((p) => p.id === purchaseProductId());
  const selectedSaleBundle =
    !!pricingProduct && !!quantityPrice(pricingProduct, purchaseQuantity()).offerId;
  document.querySelectorAll<HTMLElement>('[data-sale-original]').forEach((el) => {
    const p = config.products.find((p) => p.id === el.dataset.saleOriginal);
    el.hidden =
      (el.dataset.saleOriginal === config.productId && config.productId !== purchaseProductId()) ||
      !p?.originalPrice ||
      p.originalPrice <= p.price ||
      (p.id === purchaseProductId() && selectedSaleBundle);
    if (p?.originalPrice)
      el.textContent = money(
        p.originalPrice * (p.id === purchaseProductId() ? purchaseQuantity() : 1),
      );
  });
  document.querySelectorAll<HTMLElement>('[data-sale-badge]').forEach((el) => {
    const p = config.products.find((p) => p.id === el.dataset.saleBadge);
    el.hidden =
      (el.dataset.saleBadge === config.productId && config.productId !== purchaseProductId()) ||
      !p?.originalPrice ||
      p.originalPrice <= p.price ||
      (p.id === purchaseProductId() && selectedSaleBundle);
    if (p?.originalPrice)
      el.textContent = '−' + Math.round((1 - p.price / p.originalPrice) * 100) + '%';
  });
  document.querySelectorAll<HTMLElement>('[data-sale-deadline]').forEach((el) => {
    const p = config.products.find((p) => p.id === el.dataset.saleDeadline);
    el.hidden =
      (el.dataset.saleDeadline === config.productId && config.productId !== purchaseProductId()) ||
      !p?.priceEndsAt ||
      Date.parse(p.priceEndsAt) <= Date.now() ||
      (p.id === purchaseProductId() && selectedSaleBundle);
  });
  const heroProducts = config.products
    .filter((p) => p.storefrontVisible !== 0 && (!cart.length || p.supplier === cart[0].supplier))
    .slice(0, 2);
  document.querySelectorAll<HTMLElement>('[data-hero-product]').forEach((el, index) => {
    if (el.dataset.heroCustom === 'true') return;
    const p = heroProducts[Number(el.dataset.heroIndex ?? index)];
    el.hidden = !p;
    if (!p) return;
    const image = el.querySelector<HTMLImageElement>('img');
    if (image && image.getAttribute('src') !== p.image) image.src = p.image;
    el.dataset.supplier = p.supplier || '';
  });
  document
    .querySelectorAll('[data-cart-count]')
    .forEach((el) => (el.textContent = String(cart.reduce((a, l) => a + l.quantity, 0))));
  const productsById = new Map(config.products.map((p) => [p.id, p]));
  const terms = searchTokens(searchTerm);
  const ranked = new Map((searchIds || []).map((id, index) => [id, index]));
  document.querySelectorAll<HTMLElement>('[data-product-card]').forEach((el) => {
    const product = productsById.get(el.dataset.productCard!);
    const localSearch =
      searchTerm.trim() && searchIds === null
        ? normalizeSearch(
            (product?.name || '') + ' ' + (product?.keywords || '') + ' ' + (product?.sku || ''),
          )
        : '';
    el.hidden =
      (!!cart.length && el.dataset.supplier !== cart[0].supplier) ||
      (!!selectedCategory && el.dataset.categoryId !== selectedCategory) ||
      (!!searchTerm.trim() &&
        (searchIds
          ? !ranked.has(el.dataset.productCard!)
          : !terms.every((term) => localSearch.includes(term))));
    el.style.order =
      searchTerm.trim() && searchIds ? String(ranked.get(el.dataset.productCard!) ?? -1) : '';
  });
  const grid = document.querySelector<HTMLElement>('.shop-home .product-grid');
  if (grid) {
    const ordered = sortedProducts(
      config.products,
      selectedSort,
      (p) => p.price,
      searchTerm.trim() ? (searchIds ?? undefined) : undefined,
    );
    const cards = new Map(
      [...grid.querySelectorAll<HTMLElement>('[data-product-card]')].map((card) => [
        card.dataset.productCard!,
        card,
      ]),
    );
    ordered.forEach((p) => {
      const card = cards.get(p.id);
      if (card) {
        card.style.order = '';
        grid.append(card);
      }
    });
  }
  document.querySelectorAll<HTMLElement>('[data-category]').forEach((el) => {
    const category = el.dataset.category || '';
    el.hidden =
      !!category &&
      !!cart.length &&
      !config.products.some(
        (p) =>
          p.storefrontVisible !== 0 && p.categoryId === category && p.supplier === cart[0].supplier,
      );
    if (category === selectedCategory) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  });
  if ($('#product-filter-empty'))
    $('#product-filter-empty')!.hidden =
      !document.querySelector('[data-product-card]') ||
      [...document.querySelectorAll<HTMLElement>('[data-product-card]')].some((el) => !el.hidden);
  const html = cart.length
    ? linesHtml(cart)
    : `<div class="empty-state"><span>♧</span><h3>${escape(t('السلة تنتظر اختياراتك'))}</h3><a href="/#products">${escape(t('اكتشف المنتجات ←'))}</a></div>`;
  if ($('#cart-items')) $('#cart-items')!.innerHTML = html;
  const cartSubtotal = cart.reduce(
    (sum, l) =>
      sum + (l.offerId && l.subtotal !== undefined ? l.subtotal : l.unitPrice * l.quantity),
    0,
  );
  document
    .querySelectorAll('[data-cart-subtotal]')
    .forEach((el) => (el.textContent = money(cartSubtotal)));
  renderPromotion(cartSubtotal);
  const checkoutLink = $<HTMLAnchorElement>('[data-cart-checkout]');
  if (checkoutLink) {
    checkoutLink.hidden = !cart.length;
  }
  renderCheckout(html);
}
function renderPromotion(cartSubtotal: number, qualified?: boolean) {
  const threshold = config.settings.cartFreeShippingThreshold || 0;
  for (const promotion of document.querySelectorAll<HTMLElement>('[data-cart-threshold]')) {
    promotion.hidden = !threshold || !cart.length;
    const freeOffer = qualified ?? cart.some((line) => line.freeShipping);
    const remaining = Math.max(0, threshold - cartSubtotal);
    const progress = freeOffer ? 100 : Math.min(100, Math.floor((cartSubtotal / threshold) * 100));
    promotion.querySelector<HTMLElement>('[data-threshold-message]')!.textContent =
      freeOffer || !remaining
        ? t('مبروك! سلتك مؤهلة للتوصيل المجاني')
        : t('أضف منتجات بقيمة {amount} لتحصل على توصيل مجاني', { amount: money(remaining) });
    promotion.querySelector<HTMLElement>('[data-threshold-progress]')!.style.width = progress + '%';
    promotion
      .querySelector('[role=progressbar]')
      ?.setAttribute('aria-valuenow', String(progress || 0));
  }
}
function renderCheckout(html: string) {
  document
    .querySelectorAll('[data-checkout-count]')
    .forEach(
      (el) =>
        (el.textContent =
          '(' + checkoutLines().reduce((sum, line) => sum + line.quantity, 0) + ')'),
    );
  document
    .querySelectorAll('[data-product-count]')
    .forEach(
      (el) =>
        (el.textContent =
          [...document.querySelectorAll<HTMLElement>('.shop-home [data-product-card]')].filter(
            (el) => !el.hidden,
          ).length + t(' منتج')),
    );
  document
    .querySelectorAll<HTMLElement>('[data-related-products]')
    .forEach(
      (section) =>
        (section.hidden = ![...section.querySelectorAll<HTMLElement>('[data-product-card]')].some(
          (card) => !card.hidden,
        )),
    );
  if ($('#checkout-items'))
    $('#checkout-items')!.innerHTML = directCheckout
      ? linesHtml(checkoutLines(), true, true)
      : html;
  const p = config.products.find((p) => p.id === purchaseProductId()),
    conflict = !!p && !!cart.length && p.supplier !== cart[0].supplier;
  document.querySelectorAll<HTMLInputElement>('input[name="landing-product"]').forEach((input) => {
    const item = config.products.find((p) => p.id === input.value);
    input.checked = input.value === purchaseProductId();
    input.disabled = !item?.active || !item.verified || !item.supplier || item.stock < 1;
    const price = input.closest('label')?.querySelector<HTMLElement>('[data-choice-price]');
    if (price && item) price.textContent = money(item.price);
  });
  const savings = $('[data-pack-savings]');
  if (savings) {
    const components = [...new Set(config.landingPackComponentIds || [])];
    const main = config.products.find((p) => p.id === config.productId);
    const items = components.map((id) => config.products.find((p) => p.id === id));
    const amount =
      main &&
      components.length >= 2 &&
      components.every((id) => allowedLandingIds.has(id) && id !== config.productId) &&
      items.every((p) => p?.active && p.verified && p.supplier && p.stock > 0)
        ? items.reduce((sum, p) => sum + p!.price, 0) - main.price
        : 0;
    savings.hidden = amount <= 0;
    if (amount > 0)
      savings.textContent = t('توفير {amount} مقارنة بشراء المكونات منفصلة', {
        amount: money(amount),
      });
  }
  if (p) {
    const quantityInput = $<HTMLInputElement>('#product-quantity');
    if (quantityInput) quantityInput.max = String(Math.min(100, p.stock));
    document
      .querySelectorAll<HTMLElement>('[data-purchase-name]')
      .forEach((el) => (el.textContent = p.name));
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '#buy-now, [data-buy-now], #add-offer',
    )) {
      button.dataset.productId = p.id;
      button.disabled = !p.active || !p.verified || !p.supplier || p.stock < 1;
    }
    const offerSection = $('[data-product-offers]');
    if (offerSection) offerSection.hidden = !p.offers.length && !p.bundleMode;
    const choices = $('[data-offer-choices]');
    const signature = JSON.stringify([
      p.id,
      p.price,
      p.offers,
      p.bundleMode,
      p.bundleLabel,
      p.stock,
    ]);
    if (choices && choices.dataset.signature !== signature) {
      const selected = currentOfferId();
      const chosenOffer = p.offers.some((offer) => offer.id === selected) ? selected : '';
      choices.innerHTML =
        p.offers.length || p.bundleMode
          ? [
              {
                id: '',
                label: p.bundleLabel || t('السعر الحالي للمنتج'),
                quantity: 1,
                total: p.price,
                freeShipping: !!p.freeShipping,
              },
              ...p.offers,
            ]
              .filter((o) => !p.bundleMode || o.quantity <= p.stock)
              .map(
                (offer) =>
                  `<label class="offer-card"><input type="radio" name="offer" value="${escape(offer.id)}" ${offer.id === chosenOffer ? 'checked' : ''}><span><b>${escape(offer.label || t('الكمية') + ': ' + offer.quantity)}</b><small>${escape(t('الكمية'))}: ${offer.quantity} ${offer.freeShipping ? escape(t('· توصيل مجاني')) : ''}</small></span><strong>${money(offer.total)}</strong></label>`,
              )
              .join('')
          : '';
      choices.dataset.signature = signature;
    }
    const priced = quantityPrice(p, purchaseQuantity());
    document.querySelectorAll<HTMLInputElement>('input[name=offer]').forEach((radio) => {
      radio.checked =
        radio.value === priced.offerId ||
        (!p.offers.some((o) => o.id === priced.offerId) && radio.value === '');
    });
    document
      .querySelectorAll<HTMLElement>('[data-product-price]')
      .forEach((element) => (element.textContent = money(priced.total)));
    if ($('[data-product-quantity]')) $('[data-product-quantity]')!.hidden = !!p.bundleMode;
    const tail = $('[data-quantity-tail]');
    if (tail) {
      tail.hidden = !p.quantityPricing;
      if (p.quantityPricing)
        tail.textContent = t('من الكمية {quantity}: {price} لكل منتج', {
          quantity: p.quantityPricing.fromQuantity,
          price: money(p.quantityPricing.unitPrice),
        });
    }
    if ($('[data-product-delivery]'))
      $('[data-product-delivery]')!.textContent = priced.freeShipping
        ? t('توصيل مجاني مع هذا العرض')
        : productDeliveryText(
            config.settings.deliveryText,
            money(config.settings.shippingCasa),
            money(config.settings.shippingOther),
          );
  }
  if ($('#supplier-conflict')) $('#supplier-conflict')!.hidden = !conflict;
  const addButton = $<HTMLButtonElement>('#add-offer');
  if (addButton && p)
    (addButton.querySelector('[data-add-label]') || addButton).textContent = t('أضف للسلة');
  if (addButton) addButton.disabled = !p?.verified || !p.supplier || p.stock < 1;
  if ($('#saved-cart-reminder'))
    $('#saved-cart-reminder')!.hidden = !directCheckout || !cart.length;
}
async function request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-UI-Language': config.settings.storeLanguage },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.message || t('تعذر الاتصال. حاول مجددًا.')), {
      code: data.error,
    });
  return data;
}
const payload = (): CartLine[] =>
  checkoutLines().map(({ productId, offerId, quantity, revision }) => ({
    productId,
    offerId,
    quantity,
    revision,
  }));
function paintQuote(subtotal: number, shipping: number) {
  $('#subtotal')!.textContent = money(subtotal);
  $('#shipping')!.textContent = shipping ? money(shipping) : t('مجاني');
  $('#total')!.textContent = money(subtotal + shipping);
  document
    .querySelectorAll('[data-quote-total]')
    .forEach((el) => (el.textContent = money(subtotal + shipping)));
  document
    .querySelectorAll('[data-delivery-price]')
    .forEach((el) => (el.textContent = shipping ? money(shipping) : t('مجاني')));
}
async function updateQuote(refreshRevision = true) {
  if (!$('#checkout-form')) return;
  const sequence = ++quoteSerial;
  const errorBox = $('#checkout-error');
  errorBox?.querySelectorAll('button').forEach((button) => (button.disabled = true));
  quote = null;
  const lines = checkoutLines();
  if (!lines.length) {
    paintQuote(0, 0);
    return;
  }
  const city = $<HTMLInputElement>('[name=city]')?.value || '';
  const subtotal = lines.reduce(
    (sum, line) =>
      sum +
      (line.offerId && line.subtotal !== undefined
        ? line.subtotal
        : line.unitPrice * line.quantity),
    0,
  );
  const free =
    lines.some((line) => line.freeShipping) ||
    (!directCheckout &&
      config.settings.cartFreeShippingThreshold > 0 &&
      subtotal >= config.settings.cartFreeShippingThreshold);
  paintQuote(
    subtotal,
    free ? 0 : isCasablancaAlias(city) ? shippingRates.casa : shippingRates.other,
  );
  try {
    const intent = quoteIntent();
    const data = await request<Quote>('/api/checkout/quote', {
      cart: payload(),
      city,
      checkoutMode: directCheckout ? 'direct' : 'cart',
    });
    if (sequence !== quoteSerial) return;
    quote = data;
    quotedIntent = intent;
    quotedAt = Date.now();
    if (data.shippingRates) shippingRates = data.shippingRates;
    if (!directCheckout) renderPromotion(data.subtotal, data.shippingReason !== 'standard');
    paintQuote(data.subtotal, data.shipping);
    $('#checkout-error')!.textContent = '';
  } catch (e) {
    if (sequence !== quoteSerial) return;
    const catalogChanged = [
      'bundle_quantity_unavailable',
      'cart_changed',
      'offer_changed',
      'invalid_checkout_offer',
      'unavailable_product',
    ].includes((e as { code?: string }).code || '');
    if (!catalogChanged) reviewProducts = null;
    if (catalogChanged) {
      try {
        const ids = [...new Set(checkoutLines().map((line) => line.productId))];
        const updated = await request<PublicProduct[]>(
          '/api/products?ids=' + encodeURIComponent(ids.join(',')),
        );
        if (sequence === quoteSerial) reviewProducts = updated;
        if (
          refreshRevision &&
          sequence === quoteSerial &&
          lines.every((line) =>
            compatibleCartLine(
              line,
              updated.find((p) => p.id === line.productId),
            ),
          )
        ) {
          config.products = [
            ...config.products.filter((p) => !updated.some((latest) => latest.id === p.id)),
            ...updated,
          ];
          reviewProducts = null;
          if (!directCheckout) {
            cart = cart.map((line) => ({
              ...chosen(
                updated.find((p) => p.id === line.productId)!,
                '',
                line.quantity,
              ),
            }));
            localStorage.setItem(KEY, JSON.stringify(cart));
          }
          render();
          return await updateQuote(false);
        }
      } catch {}
    }
    if (sequence !== quoteSerial) return;
    $('#checkout-error')!.textContent =
      e instanceof TypeError ? t('تعذر الاتصال. حاول مجددًا.') : t((e as Error).message);
    const changed =
      catalogChanged &&
      (directCheckout
        ? true
        : cart.some((l) => {
            const p = (reviewProducts || config.products).find((p) => p.id === l.productId);
            return (
              !p ||
              (p.bundleMode && !bundleChoices(p).includes(l.quantity)) ||
              (!!l.offerId && !cartOffers(p).some((offer) => offer.id === l.offerId)) ||
              (cartOffers(p).find((o) => o.id === l.offerId)?.revision ?? p.revision) !== l.revision
            );
          }));
    if (!catalogChanged) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'secondary';
      retry.textContent = t('إعادة حساب الإجمالي');
      retry.onclick = async () => {
        retry.disabled = true;
        await updateQuote();
      };
      $('#checkout-error')!.append(retry);
    } else if (changed) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = directCheckout
        ? t('مراجعة بيانات العرض وتحديثها')
        : t('تحديث بيانات السلة');
      button.onclick = () => {
        if (reviewProducts) {
          config.products = [
            ...config.products.filter((p) => !reviewProducts!.some((v) => v.id === p.id)),
            ...reviewProducts,
          ];
          reviewProducts = null;
        }
        if (directCheckout) {
          const p = config.products.find((p) => p.id === purchaseProductId());
          if (p?.bundleMode && !bundleChoices(p).includes(directQuantity))
            setPurchaseQuantity(bundleChoices(p)[0] || 1);
          if (selectedOfferId && !p?.offers.some((o) => o.id === selectedOfferId)) {
            selectedOfferId = p ? quantityPrice(p, directQuantity).offerId : '';
            const regular = $<HTMLInputElement>('input[name=offer][value=""]');
            if (regular) regular.checked = true;
          }
          render();
          void updateQuote();
          return;
        }
        const updated = cart
          .filter((l) => !l.offerId.startsWith('checkout:'))
          .map((l) => {
            const p = config.products.find((p) => p.id === l.productId);
            if (!p || !p.active || !p.verified) return l;
            return chosen(
              p,
              '',
              p.bundleMode && !bundleChoices(p).includes(l.quantity)
                ? bundleChoices(p)[0] || 1
                : Math.min(l.quantity, p.stock),
            );
          });
        if (new Set(updated.map((l) => l.supplier)).size > 1) {
          toast(t('تغير مورد أحد المنتجات. احذف المنتج غير المتوافق يدويًا.'));
          return;
        }
        write(updated);
      };
      $('#checkout-error')!.append(button);
    }
  }
}
document.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('button,a');
  if (!el) return;
  if (el.hasAttribute('data-open-cart')) {
    $<HTMLDialogElement>('#cart-dialog')!.showModal();
  }
  if (el.closest('.mobile-menu nav'))
    $<HTMLDetailsElement>('.mobile-menu')?.removeAttribute('open');
  if (el.hasAttribute('data-close-cart')) $<HTMLDialogElement>('#cart-dialog')!.close();
  if (el.hasAttribute('data-empty-cart')) write([]);
  if (el.hasAttribute('data-cancel-replace')) $<HTMLDialogElement>('#replace-cart-dialog')!.close();
  if (el.hasAttribute('data-confirm-replace') && replacement) {
    const line = replacement;
    $<HTMLDialogElement>('#replace-cart-dialog')!.close();
    cart = read();
    write([line]);
    toast(t('بدأت سلة جديدة لهذا المنتج'));
    $<HTMLDialogElement>('#cart-dialog')?.showModal();
  }
  if (el.id === 'buy-now' || el.hasAttribute('data-buy-now')) {
    const query = new URLSearchParams({
      product: el.dataset.productId!,
      quantity: String(purchaseQuantity()),
      offer: currentOfferId(),
    });
    location.href = '/checkout?' + query;
    return;
  }
  if (el.dataset.directQuantity) {
    const p = config.products.find((p) => p.id === purchaseProductId());
    const next = directQuantity + Number(el.dataset.change);
    if (next < 1) return;
    if (next > Math.min(100, p?.stock || 0)) {
      toast(t('الكمية المطلوبة غير متوفرة حاليًا.'));
      return;
    }
    setPurchaseQuantity(next);
    try {
      sessionStorage.setItem(directQuantityKey(), String(next));
    } catch {}
    quote = null;
    render();
    void updateQuote();
  }
  if (el.dataset.addProduct) add(el.dataset.addProduct, '', true);
  if (el.dataset.remove) {
    const line = read().find((l) => l.sku === el.dataset.remove);
    write(
      read().filter(
        (l) =>
          l.sku !== el.dataset.remove &&
          (!line?.offerId.startsWith('checkout:') || l.offerId !== line.offerId),
      ),
    );
  }
  if (el.dataset.quantity) {
    const next = read().flatMap((l) => {
      if (l.sku !== el.dataset.quantity) return [l];
      const quantity = l.quantity + Number(el.dataset.change),
        p = config.products.find((p) => p.id === l.productId);
      return quantity <= 0 ? [] : [p ? chosen(p, '', quantity) : { ...l, quantity }];
    });
    if (
      next.some(
        (l) =>
          l.quantity >
          Math.min(100, config.products.find((p) => p.id === l.productId)?.stock ?? 100),
      )
    ) {
      toast(t('الحد الأقصى للكمية هو 100.'));
      return;
    }
    write(next);
  }
  if (el.hasAttribute('data-scroll-order')) {
    e.preventDefault();
    $('#order-form')?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }
  if (el.id === 'add-offer' || el.hasAttribute('data-add-offer')) {
    const offer = currentOfferId();
    const quantity = purchaseQuantity();
    if (add(el.dataset.productId!, offer, !offer, quantity))
      $<HTMLDialogElement>('#cart-dialog')?.showModal();
  }
  if (el.dataset.productStep) {
    setPurchaseQuantity(purchaseQuantity() + Number(el.dataset.productStep));
    render();
    void updateQuote();
  }
  if (el.dataset.galleryImage) {
    const main = $<HTMLImageElement>('#product-main-image');
    if (main) main.src = el.dataset.galleryImage;
    document
      .querySelectorAll('[data-gallery-image]')
      .forEach((button) => button.setAttribute('aria-pressed', button === el ? 'true' : 'false'));
  }
  if (el.hasAttribute('data-zoom-image')) {
    const main = $<HTMLImageElement>('#product-main-image'),
      zoomed = $<HTMLImageElement>('#zoomed-product-image');
    if (main && zoomed) {
      zoomed.src = main.src;
      $<HTMLDialogElement>('#image-dialog')?.showModal();
    }
  }
  if (el.hasAttribute('data-close-image')) $<HTMLDialogElement>('#image-dialog')?.close();
  if (el.hasAttribute('data-share-product')) {
    if (navigator.share)
      void navigator.share({ title: document.title, url: location.href }).catch(() => {});
    else
      void navigator.clipboard
        ?.writeText(location.href)
        .then(() => toast(t('تم نسخ رابط المنتج')))
        .catch(() => toast(t('انسخ رابط المنتج من شريط العنوان.')));
  }
  if (el.hasAttribute('data-close-thanks')) {
    $<HTMLDialogElement>('#thanks-dialog')!.close();
    location.href = '/';
  }
});
$<HTMLDialogElement>('#replace-cart-dialog')?.addEventListener('close', () => {
  replacement = null;
});
document.querySelector<HTMLInputElement>('#product-quantity')?.addEventListener('input', () => {
  const p = config.products.find((p) => p.id === purchaseProductId());
  if (p) selectedOfferId = quantityPrice(p, purchaseQuantity()).offerId;
  render();
  void updateQuote();
});
document
  .querySelector<HTMLInputElement>('#product-quantity')
  ?.addEventListener('change', () => setPurchaseQuantity(purchaseQuantity()));
document.addEventListener('change', (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement) || !select.dataset.bundleQuantity) return;
  const quantity = Number(select.value);
  if (select.dataset.bundleDirect === 'true') {
    const p = config.products.find((p) => p.id === purchaseProductId());
    if (!p || !bundleChoices(p).includes(quantity)) return;
    setPurchaseQuantity(quantity);
    sessionStorage.setItem(directQuantityKey(), String(quantity));
    quote = null;
    render();
    void updateQuote();
  } else {
    const current = read();
    const line = current.find((l) => l.sku === select.dataset.bundleQuantity);
    const p = config.products.find((p) => p.id === line?.productId);
    if (!line || !p || !bundleChoices(p).includes(quantity)) return;
    write(current.map((l) => (l.sku === line.sku ? chosen(p, '', quantity) : l)));
  }
});
document.addEventListener('change', (event) => {
  const input = event.target;
  if (
    !(input instanceof HTMLInputElement) ||
    input.name !== 'landing-product' ||
    !config.productId ||
    !allowedLandingIds.has(input.value)
  )
    return;
  const p = config.products.find((p) => p.id === input.value);
  if (!p?.active || !p.verified || !p.supplier || p.stock < 1) return;
  selectedPurchaseId = p.id;
  setPurchaseQuantity(1);
  selectedOfferId = '';
  quoteSerial++;
  quote = null;
  reviewProducts = null;
  shippingRates = { casa: config.settings.shippingCasa, other: config.settings.shippingOther };
  try {
    sessionStorage.setItem(landingChoiceKey, p.id);
    sessionStorage.setItem(directQuantityKey(), '1');
  } catch {}
  render();
  void updateQuote();
});
// Offer controls may be rebuilt after a reviewed price/offer update.
document.addEventListener('change', (event) => {
  const input = event.target;
  if (
    !(input instanceof HTMLInputElement) ||
    input.name !== 'offer' ||
    !input.closest('[data-offer-choices]')
  )
    return;
  const p = config.products.find((p) => p.id === purchaseProductId());
  const chosen = p?.offers.find((o) => o.id === input.value);
  setPurchaseQuantity(chosen?.quantity ?? 1);
  quote = null;
  render();
  void updateQuote();
});
window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    const previousSupplier = cart[0]?.supplier;
    cart = read();
    quoteSerial++;
    quote = null;
    render();
    void updateQuote();
    if (previousSupplier !== cart[0]?.supplier && searchTerm.trim() && $('.shop-home'))
      void runSearch();
  }
});
let debounce: ReturnType<typeof setTimeout>;
let memoryAttempt: { payload: string; id: string } | null = null;
$<HTMLInputElement>('[name=city]')?.addEventListener('input', () => {
  clearTimeout(debounce);
  quote = null;
  debounce = setTimeout(() => void updateQuote(), 200);
});
$<HTMLFormElement>('#checkout-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement,
    button = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  if (button.disabled) return;
  const buttonContent = button.innerHTML;
  clearTimeout(debounce);
  button.disabled = true;
  button.textContent = t('جارٍ تسجيل طلبك…');
  form.setAttribute('aria-busy', 'true');
  try {
    const latest = read();
    if (!directCheckout && JSON.stringify(latest) !== JSON.stringify(cart)) {
      cart = latest;
      render();
      await updateQuote();
      throw new Error(t('تغيرت السلة في نافذة أخرى. راجعها ثم أعد الإرسال.'));
    }
    const f = new FormData(form),
      customer = Object.fromEntries(
        ['name', 'phone', 'city', 'address', 'notes'].map((k) => [k, String(f.get(k) || '')]),
      );
    const intendedCart = payload();
    let attempt: { payload: string; id: string } | null = memoryAttempt;
    try {
      attempt = JSON.parse(localStorage.getItem(attemptKey) || 'null') || memoryAttempt;
    } catch {}
    let sameIntent = false;
    if (attempt) {
      try {
        const previous = JSON.parse(attempt.payload);
        sameIntent =
          checkoutIntent(previous.cart, previous.customer) ===
          checkoutIntent(intendedCart, customer);
      } catch {}
    }
    const done = (ref: string) => {
      const acceptedQuote = quote;
      if (!directCheckout && checkoutIntent(read(), {}) === checkoutIntent(intendedCart, {}))
        write([]);
      else {
        cart = read();
        render();
      }
      memoryAttempt = null;
      try {
        localStorage.removeItem(attemptKey);
      } catch {}
      if (directCheckout) {
        try {
          sessionStorage.removeItem(directQuantityKey());
        } catch {}
      }
      form.reset();
      $('#order-ref')!.textContent = ref;
      $<HTMLDialogElement>('#thanks-dialog')!.showModal();
      // A blocked advertising SDK must never hide a successfully saved order.
      if (!trackedLeads.has(ref)) {
        trackedLeads.add(ref);
        let sent = false;
        try {
          sent = sessionStorage.getItem('dar-lead:' + ref) === 'sent';
        } catch {}
        if (!sent) {
          track('Lead', {
            event_id: 'lead:' + ref,
            transaction_id: ref,
            ...(acceptedQuote ? { value: acceptedQuote.total / 100 } : {}),
          });
          try {
            sessionStorage.setItem('dar-lead:' + ref, 'sent');
          } catch {}
        }
      }
    };
    if (attempt && sameIntent) {
      const previous = await request<{ ref: string | null }>('/api/orders/attempt/' + attempt.id);
      if (previous.ref) {
        done(previous.ref);
        return;
      }
    }
    // The server revalidates the quote before saving. Avoid repeating an
    // unchanged, recently displayed quote merely because Submit was clicked.
    if (!quote || quotedIntent !== quoteIntent() || Date.now() - quotedAt > 60000)
      await updateQuote();
    if (!quote) {
      if (!$('#checkout-error')!.textContent)
        $('#checkout-error')!.textContent = t('راجع محتويات الطلب وأكمل بياناتك.');
      return;
    }
    if (checkoutIntent(payload(), customer) !== checkoutIntent(intendedCart, customer))
      throw new Error(t('تغيرت محتويات الطلب. راجعها ثم أعد الإرسال.'));
    const trackingEnabled = config.settings.trackingEnabled;
    const cookie = (key: string) =>
      document.cookie
        .split('; ')
        .find((v) => v.startsWith(key + '='))
        ?.slice(key.length + 1) || '';
    const stable = { cart: payload(), customer, fingerprint: quote.fingerprint };
    const serialized = JSON.stringify(stable);
    attempt = { payload: serialized, id: attempt && sameIntent ? attempt.id : crypto.randomUUID() };
    memoryAttempt = attempt;
    try {
      localStorage.setItem(attemptKey, JSON.stringify(attempt));
    } catch {}
    const result = await request<{ ref: string }>('/api/orders', {
      ...stable,
      checkoutMode: directCheckout ? 'direct' : 'cart',
      idempotency: attempt.id,
      attribution: attribution(),
      matching: {
        path: location.pathname,
        fbp: trackingEnabled ? cookie('_fbp') : '',
        fbc: trackingEnabled
          ? cookie('_fbc') ||
            (attribution().last?.fbclid
              ? 'fb.1.' + attribution().last.timestamp + '.' + attribution().last.fbclid
              : '')
          : '',
      },
      turnstileToken: captcha,
    }).catch(async (error) => {
      if (error.code !== 'idempotency_conflict') throw error;
      const existing = await request<{ ref: string | null }>('/api/orders/attempt/' + attempt!.id);
      if (!existing.ref) throw error;
      return { ref: existing.ref };
    });
    done(result.ref);
  } catch (e) {
    if (
      [
        'quote_changed',
        'cart_changed',
        'offer_changed',
        'unavailable_product',
        'bundle_quantity_unavailable',
      ].includes((e as { code?: string }).code || '')
    )
      await updateQuote();
    $('#checkout-error')!.textContent = (e as Error).message;
  } finally {
    button.disabled = false;
    button.innerHTML = buttonContent;
    form.removeAttribute('aria-busy');
    captcha = '';
    if (widget && (window as any).turnstile) (window as any).turnstile.reset(widget);
  }
});
function attribution() {
  let best = attributionMemory;
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const value = JSON.parse(window[name].getItem(ATTR) || '{}');
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (!Object.keys(best).length ||
          Number(value.last?.timestamp || 0) > Number(best.last?.timestamp || 0))
      )
        best = value;
    } catch {}
  }
  return (attributionMemory = best);
}
function captureAttribution() {
  const current = attribution(),
    params = new URLSearchParams(location.search),
    keys = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'utm_id',
      'fbclid',
      'ttclid',
      'gclid',
      'ScCid',
    ];
  const touch: Record<string, string> = {};
  for (const k of keys) {
    const v = params.get(k);
    if (v) touch[k] = v.slice(0, 500);
  }
  const source = marketingSource(params, document.referrer, location.origin);
  if (source) touch.utm_source = source.slice(0, 500);
  const time = Date.now();
  if (
    current.last &&
    time - Number(current.last.timestamp) > config.settings.attributionDays * 86400000
  )
    delete current.last;
  if (
    current.first &&
    time - Number(current.first.timestamp) > config.settings.attributionDays * 86400000
  )
    delete current.first;
  if (Object.keys(touch).length) {
    touch.timestamp = String(time);
    touch.landing = location.pathname;
    touch.referrer = document.referrer.slice(0, 500);
    current.first ||= touch;
    current.last = touch;
  }
  attributionMemory = current;
  try {
    localStorage.setItem(ATTR, JSON.stringify(current));
  } catch {
    try {
      sessionStorage.setItem(ATTR, JSON.stringify(current));
    } catch {}
  }
}
function script(src: string, onload?: () => void) {
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  s.onload = () => onload?.();
  document.head.append(s);
}
let tracking = false,
  checkoutTracked = false;
const trackedLeads = new Set<string>();
type MetaBootstrap = {
  enabled: boolean;
  pixel?: string;
  ticket?: string;
  pixels?: { pixel: string; ticket: string }[];
};
const metaPixels = () =>
  [...new Set([config.settings.facebookPixel, ...(config.settings.facebookPixels || [])])].filter(
    Boolean,
  );
let metaBootstrap: Promise<MetaBootstrap> | undefined;
const trackingCookie = (key: string) =>
  document.cookie
    .split('; ')
    .find((value) => value.startsWith(key + '='))
    ?.slice(key.length + 1) || '';
async function serverTrack(event: string, eventId: string, pixel: string) {
  if (!['PageView', 'ViewContent', 'InitiateCheckout'].includes(event)) return;
  const load = () => request<MetaBootstrap>('/api/meta/bootstrap');
  for (let attempt = 0; attempt < 2; attempt++) {
    const bootstrap = await (metaBootstrap ||= load());
    const destination = (
      bootstrap.pixels || [{ pixel: bootstrap.pixel, ticket: bootstrap.ticket }]
    ).find((p) => p.pixel === pixel);
    if (!bootstrap.enabled || !destination) return;
    try {
      await request('/api/meta/events', {
        event,
        eventId,
        pixel,
        ticket: destination.ticket,
        path: location.pathname,
        fbp: trackingCookie('_fbp'),
        fbc:
          trackingCookie('_fbc') ||
          (attribution().last?.fbclid
            ? 'fb.1.' + attribution().last.timestamp + '.' + attribution().last.fbclid
            : ''),
      });
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== 'tracking_expired' || attempt) throw error;
      metaBootstrap = undefined;
    }
  }
}
function track(event: string, params: Record<string, unknown> = {}) {
  if (!tracking) return;
  const eventId = typeof params.event_id === 'string' ? params.event_id : crypto.randomUUID();
  const w = window as any,
    p = config.products.find((p) => p.id === purchaseProductId()),
    data = {
      currency: 'MAD',
      ...(p ? { content_ids: [p.sku], content_type: 'product', value: p.price / 100 } : {}),
      ...params,
    };
  for (const pixel of metaPixels()) {
    try {
      if (w.fbq) w.fbq('trackSingle', pixel, event, data, { eventID: eventId });
    } catch {}
    void serverTrack(event, eventId, pixel).catch(() => {
      metaBootstrap = undefined;
    });
  }
  try {
    if (w.ttq)
      event === 'PageView' ? w.ttq.page() : w.ttq.track(event, data, { event_id: eventId });
  } catch {}
  try {
    if (w.gtag) {
      const googleEvent = (
        {
          PageView: 'page_view',
          ViewContent: 'view_item',
          AddToCart: 'add_to_cart',
          InitiateCheckout: 'begin_checkout',
          Lead: 'generate_lead',
        } as Record<string, string>
      )[event];
      if (config.settings.googleId && googleEvent)
        w.gtag('event', googleEvent, { ...data, send_to: config.settings.googleId });
      const adsId =
        config.settings.googleAdsId ||
        (config.settings.googleId?.startsWith('AW-') ? config.settings.googleId : '');
      if (event === 'Lead' && adsId && config.settings.googleAdsLeadLabel)
        w.gtag('event', 'conversion', {
          send_to: adsId + '/' + config.settings.googleAdsLeadLabel,
          currency: 'MAD',
          value: typeof data.value === 'number' ? data.value : 0,
          transaction_id: params.transaction_id,
        });
    }
  } catch {}
  try {
    if (w.snaptr)
      w.snaptr(
        'track',
        (
          {
            PageView: 'PAGE_VIEW',
            ViewContent: 'VIEW_CONTENT',
            InitiateCheckout: 'START_CHECKOUT',
            Lead: 'SIGN_UP',
          } as Record<string, string>
        )[event],
        data,
      );
  } catch {}
}
function startTracking() {
  if (tracking || !config.settings.trackingEnabled) return;
  tracking = true;
  const w = window as any,
    s = config.settings;
  if (metaPixels().length) {
    if (!trackingCookie('_fbp'))
      document.cookie =
        '_fbp=fb.1.' +
        Date.now() +
        '.' +
        crypto.getRandomValues(new Uint32Array(1))[0] +
        '; Path=/; Max-Age=7776000; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    const f: any = function (...args: unknown[]) {
      f.callMethod ? f.callMethod(...args) : f.queue.push(args);
    };
    f.queue = [];
    f.push = f;
    w._fbq ||= f;
    f.loaded = true;
    f.version = '2.0';
    if (!w.fbq) {
      w.fbq = f;
      script('https://connect.facebook.net/en_US/fbevents.js');
    }
    for (const pixel of metaPixels()) {
      try {
        w.fbq('init', pixel);
      } catch {}
    }
  }
  if (s.tiktokPixel) {
    const ttq: any = [];
    for (const method of [
      'page',
      'track',
      'identify',
      'instances',
      'debug',
      'on',
      'off',
      'once',
      'ready',
      'alias',
      'group',
      'enableCookie',
      'disableCookie',
    ])
      ttq[method] = (...args: unknown[]) => ttq.push([method, ...args]);
    w.TiktokAnalyticsObject = 'ttq';
    w.ttq = ttq;
    ttq._i = { [s.tiktokPixel]: [] };
    ttq._i[s.tiktokPixel]._u = 'https://analytics.tiktok.com/i18n/pixel/events.js';
    ttq._t = { [s.tiktokPixel]: Date.now() };
    ttq._o = { [s.tiktokPixel]: {} };
    ttq.methods = [
      'page',
      'track',
      'identify',
      'debug',
      'on',
      'off',
      'once',
      'ready',
      'alias',
      'group',
      'enableCookie',
      'disableCookie',
    ];
    ttq.instances = (id: string) => {
      const instance = ttq._i[id] || [];
      for (const method of ttq.methods)
        instance[method] = (...args: unknown[]) => instance.push([method, ...args]);
      return instance;
    };
    script('https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=' + s.tiktokPixel + '&lib=ttq');
  }
  const googleTags = [...new Set([s.googleId, s.googleAdsId].filter(Boolean))];
  if (googleTags.length) {
    w.dataLayer = w.dataLayer || [];
    w.gtag = function () {
      w.dataLayer.push(arguments);
    };
    w.gtag('js', new Date());
    for (const id of googleTags) w.gtag('config', id, { send_page_view: false });
    script('https://www.googletagmanager.com/gtag/js?id=' + googleTags[0]);
  }
  if (s.snapPixel) {
    const f: any = function (...args: unknown[]) {
      f.handleRequest ? f.handleRequest(...args) : f.queue.push(args);
    };
    f.queue = [];
    w.snaptr = f;
    f('init', s.snapPixel, {});
    script('https://sc-static.net/scevent.min.js');
  }
  track('PageView');
  if (config.productId) track('ViewContent');
  const form = $('#checkout-form');
  if (form)
    new IntersectionObserver(
      (entries, observer) => {
        if (entries.some((e) => e.isIntersecting) && !checkoutTracked) {
          checkoutTracked = true;
          track('InitiateCheckout');
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    ).observe(form);
}
if (config.settings.trackingEnabled) startTracking();

if ($('#checkout-form')) {
  const picker = $<HTMLElement>('[data-city-picker]');
  if (picker) setupCityPicker(picker, request<string[]>('/api/cities'), t);
  if (config.settings.turnstileSiteKey)
    script('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', () => {
      widget = (window as any).turnstile.render('#turnstile-order', {
        sitekey: config.settings.turnstileSiteKey,
        action: 'order',
        callback: (token: string) => (captcha = token),
        'expired-callback': () => (captcha = ''),
      });
    });
}
render();
void updateQuote();
const storeSearch = $<HTMLInputElement>('#store-search');
let searchDebounce: ReturnType<typeof setTimeout>;
async function runSearch() {
  const serial = ++searchSerial;
  searchController?.abort();
  searchController = new AbortController();
  const status = $('#search-status');
  if (!searchTerm.trim()) {
    searchIds = null;
    if (status) status.hidden = true;
    render();
    return;
  }
  if (status) {
    status.hidden = false;
    status.textContent = t('جارٍ البحث…');
  }
  try {
    const results = await request<PublicProduct[]>(
      '/api/products?q=' +
        encodeURIComponent(searchTerm) +
        (cart[0]?.supplier ? '&supplier=' + encodeURIComponent(cart[0].supplier) : ''),
      undefined,
      searchController.signal,
    );
    if (serial !== searchSerial) return;
    searchIds = results.map((p) => p.id);
    render();
    if (status) {
      status.hidden = !!results.length;
      status.textContent = results.length
        ? ''
        : t('لم نجد منتجًا مطابقًا. جرّب اسمًا أو كلمة أخرى.');
    }
  } catch (error) {
    if (serial !== searchSerial || (error as Error).name === 'AbortError') return;
    if (status) status.textContent = t('تعذر إكمال البحث الآن. اضغط بحث للمحاولة مجددًا.');
  }
}
if (storeSearch) {
  storeSearch.value = searchTerm;
  if ($('.shop-home')) {
    storeSearch.addEventListener('input', () => {
      searchTerm = storeSearch.value;
      searchIds = null;
      searchSerial++;
      searchController?.abort();
      clearTimeout(searchDebounce);
      render();
      searchDebounce = setTimeout(() => void runSearch(), 250);
    });
    storeSearch.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      clearTimeout(searchDebounce);
      void runSearch();
      const url = new URL(location.href);
      if (searchTerm.trim()) url.searchParams.set('q', searchTerm.trim());
      else url.searchParams.delete('q');
      history.replaceState({}, '', url);
      $('#products')?.scrollIntoView({ behavior: 'smooth' });
    });
  }
}
const productBuy = $('#product-buy');
if (searchTerm.trim() && cart.length && $('.shop-home')) void runSearch();
if (productBuy && $('#product-dock')) {
  new IntersectionObserver(
    (entries) => {
      const dock = $('#product-dock')!;
      dock.classList.toggle('dock-visible', !entries[0].isIntersecting);
      dock.inert = entries[0].isIntersecting;
      dock.setAttribute('aria-hidden', String(entries[0].isIntersecting));
    },
    { threshold: 0 },
  ).observe(productBuy);
}
for (const selector of ['#cart-dialog', '#image-dialog']) {
  $<HTMLDialogElement>(selector)?.addEventListener('click', (event) => {
    const dialog = event.currentTarget as HTMLDialogElement;
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  });
}

document.querySelectorAll<HTMLAnchorElement>('[data-category]').forEach((el) =>
  el.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectedCategory = el.dataset.category || '';
    const url = new URL(location.href);
    if (selectedCategory) url.searchParams.set('category', selectedCategory);
    else url.searchParams.delete('category');
    history.pushState({}, '', url);
    render();
    $('#products')?.scrollIntoView({ behavior: 'smooth' });
  }),
);
const priceSort = document.querySelector<HTMLSelectElement>('[data-price-sort]');
priceSort?.addEventListener('change', () => {
  selectedSort = productSort(priceSort.value, config.settings.showPriceSort !== false);
  const url = new URL(location.href);
  if (selectedSort) url.searchParams.set('sort', selectedSort);
  else url.searchParams.delete('sort');
  history.pushState({}, '', url);
  render();
});
window.addEventListener('popstate', () => {
  selectedSort = productSort(
    new URL(location.href).searchParams.get('sort'),
    config.settings.showPriceSort !== false,
  );
  if (priceSort) priceSort.value = selectedSort;
  const nextTerm = new URL(location.href).searchParams.get('q') || '';
  if (nextTerm !== searchTerm) {
    searchTerm = nextTerm;
    if (storeSearch) storeSearch.value = searchTerm;
    searchIds = null;
    void runSearch();
  }
  selectedCategory = new URL(location.href).searchParams.get('category') || '';
  if (
    ![...document.querySelectorAll<HTMLElement>('[data-category]')].some(
      (el) => el.dataset.category === selectedCategory,
    )
  )
    selectedCategory = '';
  render();
});

// First-party session funnel, independent of configured advertising pixels.
function recordFunnel(stage: 'visit' | 'checkout') {
  try {
    let id = sessionStorage.getItem('dar-funnel-session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('dar-funnel-session', id);
    }
    const last = attribution().last || {};
    void request('/api/visits', {
      session: id,
      source: (last.utm_source || 'direct').slice(0, 100),
      campaign: (last.utm_campaign || '').slice(0, 200),
      stage,
      attribution: last,
    }).catch(() => {});
  } catch {}
}
recordFunnel('visit');
const funnelForm = $('#checkout-form');
if (funnelForm)
  new IntersectionObserver(
    (entries, observer) => {
      if (entries.some((e) => e.isIntersecting)) {
        recordFunnel('checkout');
        observer.disconnect();
      }
    },
    { threshold: 0.1 },
  ).observe(funnelForm);

let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let knownDeadlines = new Set<number>();
let refreshingExpiry = false;
let expiryRetryAt = 0;
function offerDeadlines() {
  return config.products
    .flatMap((p) => [p.priceEndsAt, ...p.offers.map((o) => o.endsAt)])
    .map((value) => Date.parse(value || ''))
    .filter(Number.isFinite);
}
async function refreshExpiredOffers() {
  if (refreshingExpiry) return;
  refreshingExpiry = true;
  try {
    const ids = [
      ...new Set([
        ...(config.productId ? [config.productId] : []),
        ...config.products.map((p) => p.id),
        ...checkoutLines().map((line) => line.productId),
      ]),
    ].slice(0, 30);
    const updated = await request<PublicProduct[]>(
      '/api/products?ids=' + encodeURIComponent(ids.join(',')),
    );
    const checkout = !!$('#checkout-form');
    if (
      checkout &&
      !checkoutLines().every((line) =>
        compatibleCartLine(
          line,
          updated.find((p) => p.id === line.productId),
        ),
      )
    ) {
      reviewProducts = updated;
      // Preserve the selected discount until explicit review; the server rejects it.
      await updateQuote();
      document.querySelectorAll<HTMLInputElement>('input[name=offer]').forEach((radio) => {
        const offer = config.products
          .find((p) => p.id === purchaseProductId())
          ?.offers.find((o) => o.id === radio.value);
        if (offer?.endsAt && Date.parse(offer.endsAt) <= Date.now()) {
          radio.disabled = true;
          if (!radio.checked) radio.closest<HTMLElement>('label')!.hidden = true;
        }
      });
    } else {
      config.products = [
        ...config.products.filter((p) => !updated.some((v) => v.id === p.id)),
        ...updated,
      ];
      render();
      if (checkout) await updateQuote();
    }
    knownDeadlines = new Set(offerDeadlines().filter((at) => at > Date.now()));
  } catch {
    expiryRetryAt = Date.now() + 5000;
  } finally {
    refreshingExpiry = false;
    scheduleOfferExpiry();
  }
}
function scheduleOfferExpiry() {
  if (expiryTimer) clearTimeout(expiryTimer);
  const pending = [...knownDeadlines];
  if (!pending.length) return;
  const delay = Math.max(
    50,
    Math.min(2147483647, Math.max(Math.min(...pending), expiryRetryAt) - Date.now() + 50),
  );
  expiryTimer = setTimeout(() => void refreshExpiredOffers(), delay);
}
knownDeadlines = new Set(offerDeadlines().filter((at) => at > Date.now()));
scheduleOfferExpiry();
function resumeOffers() {
  if (document.visibilityState !== 'visible') return;
  if ([...knownDeadlines].some((at) => at <= Date.now())) void refreshExpiredOffers();
}
document.addEventListener('visibilitychange', resumeOffers);
window.addEventListener('pageshow', resumeOffers);

function tickPromotions() {
  document.querySelectorAll<HTMLElement>('[data-promo-countdown]').forEach((card) => {
    const clock = promotionClock(card.dataset.end!);
    if (clock.expired) {
      card.hidden = true;
      return;
    }
    for (const part of ['days', 'hours', 'minutes', 'seconds'] as const) {
      const number = card.querySelector('[data-clock-part="' + part + '"]');
      if (number) number.textContent = String(clock[part]).padStart(2, '0');
    }
    const remaining = promotionRemaining(card.dataset.start || '', card.dataset.end!);
    const bar = card.querySelector<HTMLElement>('.promotion-time-bar');
    if (remaining !== null && bar) {
      bar.setAttribute('aria-valuenow', String(Math.round(remaining * 100)));
      bar.querySelector<HTMLElement>('span')!.style.width = remaining * 100 + '%';
    }
  });
}
if (document.querySelector('[data-promo-countdown]')) {
  tickPromotions();
  setInterval(() => {
    if (document.visibilityState === 'visible') tickPromotions();
  }, 1000);
  document.addEventListener('visibilitychange', tickPromotions);
}
