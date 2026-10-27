// Fold common Arabic spelling variants and Latin accents for both search paths.
export function normalizeSearch(value: string) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
export function searchTokens(value: string) {
  return normalizeSearch(value).split(' ').filter(Boolean).slice(0, 10);
}
