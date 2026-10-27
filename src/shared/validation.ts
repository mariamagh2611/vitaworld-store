import type { ZodIssue } from 'zod';
export type FieldIssue = { field: string; label: string; message: string };
const labels: Record<string, string> = {
  sku: 'كود المنتج لدى مورد',
  slug: 'رابط المنتج',
  name: 'اسم المنتج',
  description: 'الوصف',
  descriptionHtml: 'الوصف',
  image: 'صورة المنتج',
  price: 'السعر بالدرهم',
  categoryId: 'قسم المنتج',
  pageMode: 'طريقة عرض المنتج',
  landingLanguage: 'لغة اللاندينج باج',
  storefrontVisible: 'إظهار في واجهة المتجر',
  gallery: 'صور الصفحة العادية',
  keywords: 'الكلمات المفتاحية للبحث',
  cartFreeShippingThreshold: 'مبلغ الشحن المجاني للسلة',
  shippingCasa: 'التوصيل داخل الدار البيضاء',
  shippingOther: 'التوصيل خارج الدار البيضاء',
  label: 'اسم العرض',
  quantity: 'الكمية',
  total: 'إجمالي العرض بالدرهم',
  color: 'لون الأزرار',
  formColor: 'خلفية الاستمارة',
  textColor: 'لون النص',
  text: 'نص الزر',
  alt: 'وصف الصورة',
  width: 'عرض الصورة الأصلي',
  height: 'ارتفاع الصورة الأصلي',
  size: 'حجم النص',
  margin: 'المسافة حول الزر',
  formTitle: 'عنوان الاستمارة',
  formSubtitle: 'وصف أعلى الاستمارة',
  submitText: 'نص زر تأكيد الطلب',
  nameLabel: 'تسمية خانة الاسم',
  namePlaceholder: 'النص داخل خانة الاسم',
  phoneLabel: 'تسمية خانة الهاتف',
  phonePlaceholder: 'النص داخل خانة الهاتف',
  cityLabel: 'تسمية خانة المدينة',
  cityPlaceholder: 'النص داخل خانة المدينة',
  addressLabel: 'تسمية خانة العنوان',
  addressPlaceholder: 'النص داخل خانة العنوان',
  notesLabel: 'تسمية خانة الملاحظات',
  notesPlaceholder: 'النص داخل خانة الملاحظات',
  blocks: 'وحدات صفحة الهبوط',
  offers: 'عروض الكميات',
  storeLanguage: 'اللغة الافتراضية للمتجر',
  storeLanguages: 'اللغات المتاحة للزائر',
  brand: 'اسم المتجر',
  whatsapp: 'رقم واتساب',
  facebookPixel: 'معرّف بكسل Meta',
  tiktokPixel: 'معرّف بكسل TikTok',
  googleAdsId: 'معرّف تحويل Google Ads',
  googleAdsLeadLabel: 'تصنيف تحويل Google Ads',
  googleId: 'معرّف Google',
  snapPixel: 'معرّف Snapchat',
};
export function fieldIssues(
  issues: ZodIssue[],
  category = false,
  t: (key: string, values?: Record<string, string | number>) => string = (key, values = {}) =>
    key.replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match,
    ),
): FieldIssue[] {
  return issues.map((issue) => {
    const path = issue.path.map(String),
      key = path.at(-1) || '',
      field = path.join('.');
    const prefix =
      path[0] === 'blocks'
        ? t('وحدة صفحة الهبوط {number}: ', { number: Number(path[1]) + 1 })
        : path[0] === 'offers' && path.length > 1
          ? t('العرض {number}: ', { number: Number(path[1]) + 1 })
          : '';
    const label =
      prefix +
      t(
        (category
          ? (
              {
                name: 'اسم القسم',
                image: 'صورة القسم',
                icon: 'رمز القسم',
                position: 'ترتيب القسم',
              } as Record<string, string>
            )[key]
          : undefined) ||
          labels[key] ||
          'الخانة المدخلة',
      );
    let message = t('تحقق من القيمة المدخلة.');
    if (issue.code === 'too_big')
      message =
        issue.origin === 'string'
          ? t('الحد الأقصى {number} حرفًا.', { number: String(issue.maximum) })
          : t('القيمة تتجاوز الحد المسموح ({number}).', { number: String(issue.maximum) });
    else if (issue.code === 'too_small')
      message =
        issue.origin === 'string'
          ? t('أكمل هذه الخانة؛ الحد الأدنى {number} حرفًا.', { number: String(issue.minimum) })
          : t('أدخل قيمة لا تقل عن {number}{exclusive}.', {
              number: String(issue.minimum),
              exclusive: issue.inclusive ? '' : t('، ولا تساويها'),
            });
    else if (issue.code === 'custom' && ['storeLanguage', 'storeLanguages'].includes(key))
      message = issue.message;
    else if (key === 'slug')
      message =
        'استخدم حروفًا إنجليزية صغيرة وأرقامًا وشرطات فقط؛ يمكنك اختيار منتج من الكتالوج لتعبئته آليًا.';
    else if (['image', 'logo', 'favicon'].includes(key))
      message = 'ارفع صورة أو أدخل رابطًا آمنًا يبدأ بـ https://.';
    else if (issue.code === 'invalid_type') message = 'أدخل قيمة صحيحة بهذه الخانة.';
    else if (/^#[a-f0-9]{6}$/i.test(issue.message)) message = 'اختر لونًا صحيحًا.';
    return { field, label, message: t(message) };
  });
}
