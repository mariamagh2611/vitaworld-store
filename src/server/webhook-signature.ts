const encoder = new TextEncoder();

export async function verifyMowaridWebhook(
  rawBody: Uint8Array | string,
  header: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!secret || !header || header.length > 256) return false;
  const parts = header.split(',').map((part) => part.trim());
  if (parts.length !== 2) return false;
  const time = parts.find((part) => /^t=\d{1,12}$/.test(part))?.slice(2);
  const hex = parts.find((part) => /^v1=[a-fA-F0-9]{64}$/.test(part))?.slice(3);
  if (!time || !hex || Math.abs(nowSeconds - Number(time)) > 300) return false;
  const prefix = encoder.encode(Number(time) + '.');
  const body = typeof rawBody === 'string' ? encoder.encode(rawBody) : rawBody;
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  const signature = Uint8Array.from(hex.match(/../g)!, (part) => parseInt(part, 16));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, signature, signed);
}
