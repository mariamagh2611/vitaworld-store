// Read real WebP dimensions; never trust dimensions supplied by an upload form.
export function webpDimensions(buffer: ArrayBuffer) {
  const v = new DataView(buffer);
  const tag = (at: number) => String.fromCharCode(...new Uint8Array(buffer, at, 4));
  if (
    buffer.byteLength < 30 ||
    tag(0) !== 'RIFF' ||
    tag(8) !== 'WEBP' ||
    v.getUint32(4, true) + 8 !== buffer.byteLength
  )
    throw new Error('ملف الصورة غير صالح.');
  const u24 = (at: number) =>
    v.getUint8(at) + (v.getUint8(at + 1) << 8) + (v.getUint8(at + 2) << 16);
  let width = 0,
    height = 0,
    extended: { width: number; height: number } | undefined;
  for (let at = 12; at + 8 <= buffer.byteLength;) {
    const kind = tag(at),
      size = v.getUint32(at + 4, true),
      data = at + 8;
    if (data + size > buffer.byteLength) throw new Error('ملف الصورة غير مكتمل.');
    if (kind === 'VP8X' && size >= 10) {
      if (v.getUint8(data) & 2) throw new Error('ارفع صورة ثابتة بدل الصورة المتحركة.');
      extended = { width: u24(data + 4) + 1, height: u24(data + 7) + 1 };
    } else if (
      kind === 'VP8 ' &&
      size >= 10 &&
      v.getUint8(data + 3) === 0x9d &&
      v.getUint8(data + 4) === 1 &&
      v.getUint8(data + 5) === 0x2a
    ) {
      width = v.getUint16(data + 6, true) & 0x3fff;
      height = v.getUint16(data + 8, true) & 0x3fff;
    } else if (kind === 'VP8L' && size >= 5 && v.getUint8(data) === 0x2f) {
      const bits = v.getUint32(data + 1, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    at = data + size + (size % 2);
  }
  if (!width || !height || (extended && (extended.width !== width || extended.height !== height)))
    throw new Error('تعذر قراءة أبعاد الصورة.');
  return { width, height };
}
export const mediaLimits = {
  bytes: 2 * 1024 * 1024,
  width: 2000,
  height: 16383,
  pixels: 24_000_000,
};
