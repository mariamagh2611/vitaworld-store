import { defaults, type Settings } from './types';
const families = {
  plex: '"IBM Plex Sans Arabic", system-ui, sans-serif',
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};
export function typographyStyle(s: Settings) {
  const typography = { ...defaults.typography, ...s.typography };
  return {
    '--store-font': families[typography.family],
    '--store-size': typography.desktopSize + 'px',
    '--store-mobile-size': typography.mobileSize + 'px',
    '--store-weight': String(typography.weight),
  };
}
