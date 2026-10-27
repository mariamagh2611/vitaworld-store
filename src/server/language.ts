import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Settings, Product } from '../shared/types';
import {
  visitorLanguage,
  enabledStoreLanguages,
  landingSettings,
  languages,
  languageOf,
} from '../shared/i18n';
const preference = 'store-language';
export function requestStoreLanguage(c: Context, s: Settings) {
  const requested =
    c.req.query('lang') ||
    (c.req.path.startsWith('/api/') ? c.req.header('X-UI-Language') : undefined);
  const selected = visitorLanguage(s, requested, getCookie(c, preference));
  // Preferences affect only this visitor, never the merchant's store settings.
  if (
    c.req.method === 'GET' &&
    c.req.query('lang') &&
    enabledStoreLanguages(s).includes(c.req.query('lang') as any)
  )
    setCookie(c, preference, selected, {
      path: '/',
      maxAge: 31536000,
      httpOnly: true,
      secure: new URL(c.req.url).protocol === 'https:',
      sameSite: 'Lax',
    });
  c.header('Content-Language', selected);
  c.header('Cache-Control', 'private, no-store');
  return selected;
}
export function visitorSettings(c: Context, s: Settings): Settings {
  return { ...s, storeLanguage: requestStoreLanguage(c, s) };
}
export function productSettings(c: Context, s: Settings, p: Product): Settings {
  if (p.pageMode !== 'landing') return visitorSettings(c, s);
  const fixed = landingSettings(s, p);
  c.header('Content-Language', fixed.storeLanguage);
  c.header('Cache-Control', 'private, no-store');
  return fixed;
}
// The fixed landing locale can differ from the published storefront languages.
// This header changes API display text only, never store settings or order amounts.
export function requestInterfaceLanguage(c: Context, s: Settings) {
  const requested = c.req.header('X-UI-Language');
  if (c.req.path.startsWith('/api/') && languages.includes(requested as any)) {
    const language = languageOf(requested);
    c.header('Content-Language', language);
    c.header('Cache-Control', 'private, no-store');
    return language;
  }
  return requestStoreLanguage(c, s);
}
