import { describe, it, expect } from 'vitest';
import { policyHtml } from '../src/server/policy-content';
import { policyVisible } from '../src/shared/policies';
import { defaults } from '../src/shared/types';
import { settingsSchema } from '../src/server/schemas';

describe('formatted policy pages', () => {
  it('renders pasted Arabic headings, spaced bold, paragraphs, lists and links', () => {
    const html = policyHtml(
      '# الشروط والأحكام\n\nمرحبا في **Rovesti**.\n\n### 1. المنتجات\n\n** أولوياتنا.**\n\n- منتج أول\n- منتج ثان\n\n1. تأكيد الطلب\n2. التوصيل\n\n[المتجر](http://www.rovesti.com)\nسطر آخر',
    );
    expect(html).toContain('<h2>الشروط والأحكام</h2>');
    expect(html).toContain('<h3>1. المنتجات</h3>');
    expect(html).toContain('<strong>أولوياتنا.</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>منتج أول</li>');
    expect(html).toContain('href="http://www.rovesti.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<br />سطر آخر');
    expect(html).not.toMatch(/###|\*\*/);
  });
  it('removes scripts, executable URLs, embedded forms and unsafe layout from policy content', () => {
    const html = policyHtml(
      '<h1 onclick="alert(1)">عنوان</h1>\n\n<script>alert(2)</script>\n\n[خطر](javascript:alert%281%29)\n\n[سر](https://user:password@example.test)\n\n<img src="x" onerror="alert(3)"><form action="https://evil.test"><input></form><p style="position:fixed">نص آمن</p>',
    );
    expect(html).toContain('<h2>عنوان</h2>');
    expect(html).toContain('نص آمن');
    expect(html).not.toMatch(/script|onclick|onerror|javascript|password|<img|<form|<input|style=/);
  });
  it('retains plain text line breaks and supports French and English headings', () => {
    expect(policyHtml('الهاتف\n+212 612 345 678')).toContain(
      'الهاتف<br /><bdi dir="ltr" class="phone-number">+212 612 345 678</bdi>',
    );
    expect(policyHtml('## Conditions\n\n**Livraison**')).toContain('<h2>Conditions</h2>');
  });
  it('defaults existing stores to visible pages and accepts independent switches without changing prose', () => {
    const { policyVisibility: _, ...legacy } = defaults;
    expect(settingsSchema.parse(legacy).policyVisibility).toEqual(defaults.policyVisibility);
    const saved = settingsSchema.parse({
      ...defaults,
      terms: '# Texte sauvegardé',
      policyVisibility: { terms: false, privacy: true, returns: false, contact: true },
    });
    expect(saved.terms).toBe('# Texte sauvegardé');
    expect(policyVisible(saved, 'terms')).toBe(false);
    expect(policyVisible(saved, 'privacy')).toBe(true);
    expect(policyVisible({ policyVisibility: undefined } as any, 'contact')).toBe(true);
    expect(
      settingsSchema.safeParse({
        ...defaults,
        policyVisibility: { ...defaults.policyVisibility, terms: 'false' },
      }).success,
    ).toBe(false);
  });
});
