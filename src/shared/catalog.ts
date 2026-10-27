// Support legacy cached relative URLs as well as the current HTTPS contract.
import { normalizeSearch } from './search';
export function catalogImages(images: unknown, parentImages?: unknown): string[] {
  const normalize = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((image) => {
      if (typeof image !== 'string' || !image || image.length > 2000) return [];
      try {
        const url = new URL(image, 'https://mowarid.ma');
        return url.protocol === 'https:' && !url.username && !url.password ? [url.href] : [];
      } catch {
        return [];
      }
    });
  };
  const own = normalize(images);
  return own.length ? own : normalize(parentImages);
}
export function catalogMedia(
  product: { main_image?: unknown; images?: unknown },
  parent?: { main_image?: unknown; images?: unknown },
) {
  const own = catalogImages(product.images);
  const main = catalogImages([product.main_image])[0] || own[0];
  const images = main
    ? [...new Set([main, ...own])]
    : catalogImages([parent?.main_image, ...catalogImages(parent?.images)]);
  return { main_image: images[0] || null, images };
}

// Optional supplier metadata is imported only when explicitly provided.
export function catalogKeywords(
  product: Record<string, unknown>,
  parent?: Record<string, unknown>,
): string {
  for (const source of [
    product.search_keywords,
    product.keywords,
    product.tags,
    parent?.search_keywords,
    parent?.keywords,
    parent?.tags,
  ]) {
    const values = Array.isArray(source)
      ? source
      : typeof source === 'string'
        ? source.split(/[,;،\n]+/)
        : [];
    const words = [
      ...new Set(
        values
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    if (words.length) return words.join(', ').slice(0, 1000);
  }
  return '';
}
export function catalogDescriptions(product: Record<string, any>, parent?: Record<string, any>) {
  const base = product.description ?? parent?.description ?? '';
  const html =
    product.description_html ??
    product.html_description ??
    parent?.description_html ??
    parent?.html_description;
  const text =
    product.description_text ??
    product.plain_description ??
    parent?.description_text ??
    parent?.plain_description;
  return {
    html: typeof html === 'string' && html ? html : typeof base === 'string' ? base : '',
    text: typeof text === 'string' && text ? text : typeof base === 'string' ? base : '',
  };
}

// Search aliases describe product names/ingredients, never inferred health claims.
const searchAliases = [
  ['collagen|collagene|كولاجين', 'collagen, collagène, كولاجين'],
  ['omega|اوميغا|اوميجا', 'omega, oméga, أوميغا, أوميجا'],
  ['gluta|glutawhite|glutathion|غلوتا|جلوتا', 'gluta, glutathion, غلوتا, جلوتا'],
  ['magnesium|مغنيسيوم', 'magnesium, magnésium, مغنيسيوم'],
  ['spiruline|spirulina|سبيرولينا', 'spiruline, spirulina, سبيرولينا'],
  ['probiotic|بروبيوتيك', 'probiotic, probiotiques, بروبيوتيك'],
  ['ashwagandha|اشواغاندا', 'ashwagandha, أشواغاندا'],
  ['shilajit|شيلاجيت', 'shilajit, شيلاجيت'],
  ['melatonine|melatonin|ميلاتونين', 'melatonin, mélatonine, ميلاتونين'],
  ['vitamine|vitamin|فيتامين', 'vitamin, vitamine, فيتامين'],
  ['selenium|سيلينيوم', 'selenium, sélénium, سيلينيوم'],
  ['propolis|بروبوليس', 'propolis, بروبوليس'],
  ['cartilage|غضاريف', 'cartilage, غضاريف'],
  ['foie de morue|كبد الحوت', 'foie de morue, كبد الحوت'],
  ['gelee royale|غذاء الملكات', 'gelée royale, غذاء الملكات'],
  ['mass plus|ماس بلاس', 'mass plus, ماس بلاس'],
  ['bodyform|بودي فورم', 'bodyform, بودي فورم'],
  ['slim flush|سليم فلاش', 'slim flush, سليم فلاش'],
  ['anti poux|قمل', 'anti poux, مضاد القمل'],
  ['ecran solaire|spf|واقي الشمس', 'écran solaire, sunscreen, واقي الشمس'],
  ['levure de biere|خميرة', 'levure de bière, brewer yeast, خميرة البيرة'],
  ['acerola|ايسرولا|اسيرولا', 'acérola, acerola, أيسرولا, أسيرولا'],
  ['charbon vegetal|فحم نباتي', 'charbon végétal, charcoal, فحم نباتي'],
  ['creme|cream|كريم', 'crème, cream, كريم'],
  ['gel|جل', 'gel, جل'],
  ['lait|lotion|لوشن', 'lait, lotion, لوشن'],
  ['contour yeux|محيط العين', 'contour yeux, eye contour, محيط العين'],
  ['nettoyant|cleanser|غسول', 'nettoyant, cleanser, غسول'],
  ['hydratante|hydratant|moisturizing|مرطب', 'hydratant, moisturizer, مرطّب'],
  ['vitamine c|vitamin c', 'vitamin C, vitamine C, فيتامين سي, فيتامين ج'],
  ['vitamine d|vitamin d', 'vitamin D, vitamine D, فيتامين د'],
  ['vitamine d3|vitamin d3', 'vitamin D3, vitamine D3, فيتامين د3'],
] as const;

export function catalogSearchKeywords(
  product: Record<string, unknown>,
  parent?: Record<string, unknown>,
) {
  const name = normalizeSearch(String(product.name || product.parent_name || parent?.name || ''));
  const own = catalogKeywords(product, parent);
  const aliases = searchAliases
    .filter(([needles]) =>
      needles
        .split('|')
        .some((word) => new RegExp('(?:^| )' + normalizeSearch(word) + '(?: |$)').test(name)),
    )
    .map(([, words]) => words);
  return [
    ...new Set(
      [own, String(product.name || product.parent_name || parent?.name || ''), ...aliases].flatMap(
        (value) =>
          value
            .split(',')
            .map((word) => word.trim())
            .filter(Boolean),
      ),
    ),
  ]
    .join(', ')
    .slice(0, 1000);
}
