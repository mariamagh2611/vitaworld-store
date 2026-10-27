export function marketingSource(params: URLSearchParams, referrer: string, origin: string) {
  if (params.get('utm_source')) return params.get('utm_source')!;
  let host = '';
  try {
    const url = new URL(referrer);
    if (url.origin !== origin) host = url.hostname.toLowerCase();
  } catch {}
  const on = (domain: string) => host === domain || host.endsWith('.' + domain);
  if (on('instagram.com')) return 'instagram';
  if (on('facebook.com') || on('fb.com')) return 'facebook';
  if (params.has('fbclid')) return 'meta';
  if (params.has('ttclid') || on('tiktok.com')) return 'tiktok';
  if (params.has('gclid') || /^(?:[a-z0-9-]+\.)?google\.[a-z.]+$/.test(host)) return 'google';
  if (params.has('ScCid') || on('snapchat.com')) return 'snapchat';
  return host ? 'referral' : '';
}
