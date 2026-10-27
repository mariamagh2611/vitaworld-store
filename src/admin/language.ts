import entries from '../shared/translations.json';
import { languageOf, translator, direction } from '../shared/i18n';
import { money as formatMoney, type Language } from '../shared/types';
let current = languageOf(localStorage.getItem('store-admin-language'));
export const adminLanguage = () => current;
export const t = (key: string, values?: Record<string, string | number>) =>
  translator(current, {}, entries)(key, values);
export const money = (cents: number) => formatMoney(cents, current);
export function setAdminLanguage(language: Language) {
  current = language;
  localStorage.setItem('store-admin-language', language);
  document.documentElement.lang = language;
  document.documentElement.dir = direction(language);
  window.dispatchEvent(new Event('admin-language'));
}
setAdminLanguage(current);
