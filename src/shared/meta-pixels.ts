import type { Settings } from './types';

export const MAX_ADDITIONAL_META_PIXELS = 4;
type MetaSettings = Pick<Settings, 'facebookPixel'> &
  Partial<Pick<Settings, 'facebookAdditionalPixels'>>;
export function metaPixelIds(s: MetaSettings, includeDisabled = false): string[] {
  return [
    ...new Set([
      s.facebookPixel,
      ...(s.facebookAdditionalPixels || [])
        .filter((p) => includeDisabled || p.enabled)
        .map((p) => p.pixel),
    ]),
  ].filter((id) => /^\d{5,30}$/.test(id));
}
export function metaCredentialName(s: MetaSettings, pixel: string): string {
  if (!metaPixelIds(s, true).includes(pixel)) return '';
  return pixel === s.facebookPixel ? 'meta' : 'meta:' + pixel;
}
export function metaHealthName(s: MetaSettings, pixel: string): string {
  return pixel === s.facebookPixel ? 'meta_health' : 'meta_health:' + pixel;
}
