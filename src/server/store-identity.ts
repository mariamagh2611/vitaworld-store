import type { Env } from './db';
import type { StoreIdentity } from '../shared/types';
import { DomainError } from '../shared/domain';

export function storeIdentity(env: Env, brand: string, requestUrl: string): StoreIdentity {
  // Production identity comes from the install's canonical origin, not Host,
  // Referer, attribution, or customer-supplied metadata.
  const configured = env.APP_ORIGIN || (env.ENVIRONMENT === 'development' ? requestUrl : '');
  let url: URL;
  try {
    url = new URL(configured);
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' &&
        !(env.ENVIRONMENT === 'development' && url.protocol === 'http:'))
    )
      throw new Error('invalid origin');
  } catch {
    throw new DomainError(
      'store_identity_missing',
      'تعذر التحقق من عنوان المتجر. تواصل مع مسؤول التثبيت.',
      503,
    );
  }
  return {
    name: brand.replace(/[\u0000-\u001f\u007f]/g, ' ').trim(),
    url: url.origin,
  };
}
