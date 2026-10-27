import sanitizeHtml from 'sanitize-html';
import type { ProductPresentation } from '../shared/types';
const color =
  '(?:#[\\da-f]{3,8}|rgb\\(\\d{1,3},\\s*\\d{1,3},\\s*\\d{1,3}\\)|rgba\\(\\d{1,3},\\s*\\d{1,3},\\s*\\d{1,3},\\s*(?:0?(?:\\.\\d{1,3})?|1)\\)|transparent|white|black)';
const colors = [new RegExp('^' + color + '$', 'i')];
const spacing = [/^(?:0|(?:[0-6]?\d)px)(?:\s+(?:0|(?:[0-6]?\d)px)){0,3}$/];
const margins = [/^(?:0|(?:[0-6]?\d)px|auto)(?:\s+(?:0|(?:[0-6]?\d)px|auto)){0,3}$/];
const borders = [
  new RegExp('^(?:none|0|[1-8]px\\s+(?:solid|dashed|dotted)\\s+' + color + ')$', 'i'),
];

export function safeProductHtml(source: string): string {
  return sanitizeHtml(source, {
    allowedTags: [
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'div',
      'span',
      'br',
      'hr',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'small',
      'ul',
      'ol',
      'li',
      'blockquote',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'figure',
      'figcaption',
      'img',
      'a',
      'sup',
      'sub',
    ],
    allowedAttributes: {
      '*': ['style', { name: 'dir', values: ['ltr', 'rtl', 'auto'] }],
      img: ['src', 'alt', 'title', 'loading', 'decoding'],
      a: ['href', 'title', 'target', 'rel'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
    nonTextTags: [
      'script',
      'style',
      'textarea',
      'option',
      'iframe',
      'object',
      'svg',
      'math',
      'template',
    ],
    allowedStyles: {
      '*': {
        color: colors,
        background: colors,
        'background-color': colors,
        'text-align': [/^(?:left|right|center|justify|start|end)$/],
        'font-weight': [/^(?:bold|normal|[1-9]00)$/],
        'font-style': [/^(?:normal|italic)$/],
        'text-decoration': [/^(?:none|underline|line-through|underline line-through)$/],
        'font-size': [/^(?:1[2-9]|[23]\d|40)px$/],
        'font-family': [/^[\w '"-]+(?:,\s*[\w '"-]+){0,5}$/],
        'line-height': [/^(?:1(?:\.\d+)?|2)$/],
        'max-width': [/^(?:100%|\d{1,4}px)$/],
        width: [/^(?:auto|100%|[1-9]\d?%)$/],
        display: [
          /^(?:block|inline|inline-block|flex|inline-flex|grid|table|table-row|table-cell)$/,
        ],
        'flex-wrap': [/^(?:wrap|nowrap)$/],
        'flex-direction': [/^(?:row|column|row-reverse|column-reverse)$/],
        'align-items': [/^(?:start|end|center|stretch|flex-start|flex-end)$/],
        'justify-content': [
          /^(?:start|end|center|space-between|space-around|space-evenly|flex-start|flex-end)$/,
        ],
        'grid-template-columns': [
          /^(?:repeat\((?:[1-6]|auto-fit|auto-fill),\s*minmax\((?:[1-9]\d{1,2}px|0),\s*(?:[1-3](?:\.\d+)?fr|100%)\)\)|repeat\([1-6],\s*[1-3]fr\)|(?:[1-3]fr|auto)(?:\s+(?:[1-3]fr|auto)){0,5})$/,
        ],
        flex: [/^[0-3](?:\s+[0-3]\s+(?:auto|0|[1-9]\d{1,2}px))?$/],
        'flex-basis': [/^(?:auto|[1-9]\d{1,2}px)$/],
        gap: spacing,
        padding: spacing,
        'padding-top': spacing,
        'padding-right': spacing,
        'padding-bottom': spacing,
        'padding-left': spacing,
        margin: margins,
        'margin-top': margins,
        'margin-right': margins,
        'margin-bottom': margins,
        'margin-left': margins,
        border: borders,
        'border-top': borders,
        'border-right': borders,
        'border-bottom': borders,
        'border-left': borders,
        'border-color': colors,
        'border-radius': [/^(?:0|(?:[0-6]?\d)px|50%)(?:\s+(?:0|(?:[0-6]?\d)px|50%)){0,3}$/],
        'border-collapse': [/^(?:collapse|separate)$/],
        'box-sizing': [/^border-box$/],
        'unicode-bidi': [/^(?:normal|isolate)$/],
        'list-style': [/^(?:none|disc|decimal)$/],
        overflow: [/^(?:auto|hidden)$/],
        'overflow-x': [/^(?:auto|hidden)$/],
      },
    },
    transformTags: {
      h1: 'h2',
      a: (_tag, attributes) => ({
        tagName: 'a',
        attribs: { ...attributes, target: '_blank', rel: 'noopener noreferrer' },
      }),
      img: (_tag, attributes) => ({
        tagName: 'img',
        attribs: { ...attributes, loading: 'lazy', decoding: 'async' },
      }),
    },
    exclusiveFilter: (frame) => {
      if (!['a', 'img'].includes(frame.tag)) return false;
      const value = frame.attribs[frame.tag === 'img' ? 'src' : 'href'];
      if (!value) return frame.tag === 'img';
      try {
        const url = new URL(value, 'https://mowarid.ma');
        return !!url.username || !!url.password;
      } catch {
        return true;
      }
    },
  });
}
export function plainProductDescription(html: string): string {
  const separated = safeProductHtml(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:h[2-6]|p|div|li|tr|blockquote)>/gi, '\n');
  const plain = sanitizeHtml(separated, { allowedTags: [], allowedAttributes: {} });
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    '#39': "'",
  };
  return plain
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, key) => entities[key])
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}
// Keep searchable/SEO prose plain; rich content is stored separately in the existing JSON metadata.
export function normalizeProductContent<
  T extends { description: string; presentation?: ProductPresentation },
>(p: T): T {
  const presentation = { ...p.presentation };
  let description = p.description;
  if (presentation.descriptionFormat === 'html') {
    presentation.descriptionHtml = safeProductHtml(presentation.descriptionHtml || '');
    description = plainProductDescription(presentation.descriptionHtml);
  }
  if (presentation.translations) {
    presentation.translations = Object.fromEntries(
      Object.entries(presentation.translations).map(([language, original]) => {
        const version = { ...original };
        if (version.descriptionFormat === 'html') {
          version.descriptionHtml = safeProductHtml(version.descriptionHtml || '');
          version.description = plainProductDescription(version.descriptionHtml);
        }
        return [language, version];
      }),
    );
  }
  return { ...p, description, presentation };
}
