import type { City } from './types';
import { normalizeSearch } from './search';
export const cityKey = (value: string) => normalizeSearch(value).replaceAll(' ', '');
const casaAliases = new Set(
  [
    'Casablanca',
    'Casa Blanca',
    'Casa',
    'Kaza',
    'Caza',
    'Casablanka',
    'Kazablanca',
    'Dar El Beida',
    'Dar Al Baida',
    'Dar El Bayda',
    'Dar El Beïda',
    'الدار البيضاء',
    'الدارالبيضاء',
    'دار البيضاء',
    'دارالبيضاء',
    'البيضاء',
    'البيضا',
    'الدار البيضا',
    'كازا',
    'كازابلانكا',
  ].map(cityKey),
);
export const isCasablancaAlias = (value: string) => casaAliases.has(cityKey(value));
export function canonicalCity(value: string, cities: Pick<City, 'city'>[] = []) {
  if (isCasablancaAlias(value))
    return cities.find((c) => cityKey(c.city) === 'casablanca')?.city || 'CASABLANCA';
  return cities.find((c) => cityKey(c.city) === cityKey(value))?.city || value.trim();
}
export function citySuggestions(names: string[], query: string, limit = 60) {
  const key = cityKey(query);
  const alias = isCasablancaAlias(query);
  return [...new Set(names)]
    .filter((name) => !key || cityKey(name).includes(key) || (alias && isCasablancaAlias(name)))
    .sort(
      (a, b) =>
        Number(alias && isCasablancaAlias(b)) - Number(alias && isCasablancaAlias(a)) ||
        Number(cityKey(b).startsWith(key)) - Number(cityKey(a).startsWith(key)),
    )
    .slice(0, limit);
}
