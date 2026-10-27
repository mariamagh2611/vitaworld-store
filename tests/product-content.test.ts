import { describe, it, expect } from 'vitest';
import {
  safeProductHtml,
  plainProductDescription,
  normalizeProductContent,
} from '../src/server/product-content';
import { catalogKeywords, catalogDescriptions } from '../src/shared/catalog';
import { localizedProduct } from '../src/shared/i18n';
import type { Product } from '../src/shared/types';

describe('supplier content and editable rich descriptions', () => {
  it('preserves supplier cards, flex ingredient rows and safe borders without permitting layout or CSS execution escapes', () => {
    const html = safeProductHtml(
      '<div style="max-width:900px;margin:0 auto;padding:24px;font-family:Tahoma, Arial, sans-serif;background:#f3f8f3;border:1px solid #d7e6d8;border-right:5px solid #286b3b;border-radius:14px;box-sizing:border-box;unicode-bidi:isolate"><ul style="list-style:none;display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px"><li style="padding:14px 16px">ميزة</li></ul><div style="display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #d8e6d9"><span>مكوّن</span><strong>1 مليار</strong></div><p style="position:fixed;z-index:9999;margin:-20px;transform:scale(20);background:url(https://evil.test);width:9999px">نص</p></div>',
    );
    for (const style of [
      'margin:0 auto',
      'padding:24px',
      'border-right:5px solid #286b3b',
      'border-radius:14px',
      'display:grid',
      'grid-template-columns:repeat(auto-fit, minmax(220px, 1fr))',
      'display:flex',
      'justify-content:space-between',
      'unicode-bidi:isolate',
    ])
      expect(html).toContain(style);
    expect(html).not.toMatch(/position|z-index|9999|transform|url\(|-20/);
  });
  it('keeps readable headings, lists, valid images and safe colors while removing executable content and layout escapes', () => {
    const html = safeProductHtml(
      '<div dir="rtl" style="color:#123456;position:fixed;width:9000px;background-image:url(https://evil.test)"><h1>العنوان</h1><p>تفاصيل <strong>مهمة</strong></p><ul><li>الأول</li></ul><img src="https://mowarid.ma/image.jpg" onerror="alert(1)"><script>alert(2)</script><iframe src="https://evil.test">غير مرئي</iframe><svg><script>alert(3)</script></svg><a href="javascript:alert(4)">رابط</a></div>',
    );
    expect(html).toContain('<h2>العنوان</h2>');
    expect(html).toContain('<strong>مهمة</strong>');
    expect(html).toContain('color:#123456');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toMatch(
      /script|iframe|svg|onerror|javascript|position|background-image|9000|غير مرئي/,
    );
    expect(plainProductDescription(html)).toBe('العنوان\nتفاصيل مهمة\nالأول\nرابط');
  });
  it('rejects insecure, credential-bearing and protocol-relative image URLs and round-trips entities as plain prose', () => {
    const html = safeProductHtml(
      '<img src="javascript:alert(1)"><img src="http://unsafe.test/p"><img src="https://user:secret@unsafe.test/p"><img src="//unsafe.test/p"><p>A &amp; B &lt; 5 &copy;</p>',
    );
    expect(html).not.toContain('<img');
    expect(plainProductDescription(html)).toBe('A & B < 5 ©');
  });
  it('normalizes rich content into searchable text and keeps language versions independent', () => {
    const p = normalizeProductContent({
      name: 'المنتج',
      description: 'قديم',
      presentation: {
        descriptionFormat: 'html' as const,
        descriptionHtml: '<p>محتوى عربي <b>منسّق</b></p>',
        translations: {
          fr: { description: 'Texte français' },
          en: {
            description: '',
            descriptionFormat: 'html' as const,
            descriptionHtml: '<h2>English details</h2><script>bad()</script>',
          },
        },
      },
    });
    expect(p.description).toBe('محتوى عربي منسّق');
    expect(p.presentation.translations.en.description).toBe('English details');
    expect(localizedProduct(p as Product, 'fr').presentation?.descriptionFormat).toBe('text');
    expect(localizedProduct(p as Product, 'en').presentation?.descriptionHtml).toBe(
      '<h2>English details</h2>',
    );
  });
  it('imports keywords only when provided and supports strings, tag arrays and parent inheritance', () => {
    expect(catalogKeywords({ description: 'محتوى غني', name: 'اسم' })).toBe('');
    expect(catalogKeywords({ keywords: ' حقيبة, sac، سفر, sac' })).toBe('حقيبة, sac, سفر');
    expect(catalogKeywords({ tags: ['sac', 'voyage', 'sac', {}] })).toBe('sac, voyage');
    expect(catalogKeywords({}, { keywords: ['parent'] })).toBe('parent');
    expect(catalogKeywords({ search_keywords: '', keywords: ['sac'] })).toBe('sac');
    expect(catalogDescriptions({ description: '<p>HTML</p>' })).toEqual({
      html: '<p>HTML</p>',
      text: '<p>HTML</p>',
    });
    expect(
      catalogDescriptions({ description_text: 'نص', description_html: '<b>منسق</b>' }),
    ).toEqual({ text: 'نص', html: '<b>منسق</b>' });
  });
});
