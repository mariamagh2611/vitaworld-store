import React from 'react';
import { t } from './language';
export type ImagePurpose =
  'category' | 'logo' | 'favicon' | 'hero' | 'hero-card' | 'product' | 'landing' | 'general';
function guides() {
  return [
    {
      purpose: 'category',
      name: t('صورة القسم'),
      size: '600 × 600',
      hint: t(
        'صورة مربعة بعنصر واضح في الوسط ومساحة حوله. تظهر كأيقونة صغيرة؛ تجنّب النصوص والتصاميم الطويلة.',
      ),
    },
    {
      purpose: 'logo',
      name: t('اللوجو'),
      size: '512 × 512',
      hint: t(
        'يفضل رمز مربع بخلفية شفافة ومساحة صغيرة حوله. اسم المتجر يظهر بجانبه؛ تجنّب كتابة طويلة داخل الصورة.',
      ),
    },
    {
      purpose: 'favicon',
      name: t('أيقونة المتصفح'),
      size: '512 × 512',
      hint: t('رمز بسيط ومربع، واضح حتى بالحجم الصغير، دون كتابة دقيقة.'),
    },
    {
      purpose: 'hero',
      name: t('صورة الرئيسية'),
      size: '1200 × 800',
      hint: t(
        'صورة أفقية بنسبة 3:2، واضحة دون نصوص صغيرة. تظهر بجانب عنوان الرئيسية وتحافظ على أبعادها.',
      ),
    },
    {
      purpose: 'hero-card',
      name: t('صورتا القسم الرئيسي'),
      size: '1200 × 1200',
      hint: t(
        'اختر صورتين متناسقتين بخلفية هادئة ودون كتابات صغيرة. تظهر كل صورة كاملة داخل بطاقتها دون قص.',
      ),
    },
    {
      purpose: 'product',
      name: t('صور المنتج'),
      size: '1200 × 1200',
      hint: t(
        'يفضل إطار مربع وخلفية هادئة، مع ظهور المنتج كاملًا. الصور الطولية مقبولة وتظهر دون قص.',
      ),
    },
    {
      purpose: 'landing',
      name: t('صور اللاندينج باج'),
      size: t('عرض 1200 بكسل، والارتفاع حسب التصميم'),
      hint: t(
        'لا تحتاج ارتفاعًا ثابتًا. حافظ على وضوح النصوص ووحّد عرض الصور المتتابعة. قسّم الصورة إذا تجاوز ارتفاعها 16383 بكسل أو كانت كبيرة جدًا.',
      ),
    },
  ];
}
export function ImageHint({ purpose }: { purpose: ImagePurpose }) {
  const guide = guides().find((row) => row.purpose === purpose);
  return (
    <small className="image-upload-hint">
      {guide ? (
        <>
          <strong>
            {t('المقاس المنصوح به:')} {guide.size}
            {purpose !== 'landing' ? ' px' : ''}
          </strong>
          <span>{guide.hint}</span>
        </>
      ) : (
        t(
          'PNG أو JPG أو WebP حتى 20MB. نجهّزها تلقائيًا بصيغة WebP، ونضغطها عند الحاجة مع الحفاظ على النسبة دون قص. لا تحتاج ضغطها في موقع آخر.',
        )
      )}
    </small>
  );
}
export function ImageGuide() {
  return (
    <details className="image-guide">
      <summary>{t('دليل مقاسات الصور ورفعها')}</summary>
      <p>
        {t(
          'PNG أو JPG أو WebP حتى 20MB. نجهّزها تلقائيًا بصيغة WebP، ونضغطها عند الحاجة مع الحفاظ على النسبة دون قص. لا تحتاج ضغطها في موقع آخر.',
        )}
      </p>
      <p>
        {t(
          'PNG مناسب للشفافية واللوجو، وJPG للصور الفوتوغرافية، وWebP مناسب إذا كانت الصورة مجهزة مسبقًا. نحتفظ بملف WebP المناسب دون إعادة ضغطه؛ باقي الصور تُجهّز بعرض أقصى 1200 بكسل وحجم حتى 2MB.',
        )}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('موضع الصورة')}</th>
              <th>{t('المقاس المنصوح به')}</th>
              <th>{t('نصيحة التصميم')}</th>
            </tr>
          </thead>
          <tbody>
            {guides().map((row) => (
              <tr key={row.purpose}>
                <td>{row.name}</td>
                <td dir="ltr">
                  {row.size}
                  {row.purpose !== 'landing' ? ' px' : ''}
                </td>
                <td>{row.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
