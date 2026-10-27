import { mediaLimits, webpDimensions } from '../shared/media';

export async function prepareImage(file: File) {
  if (
    file.size > 20 * 1024 * 1024 ||
    !['image/webp', 'image/jpeg', 'image/png'].includes(file.type)
  )
    throw new Error('اختر صورة PNG أو JPG أو WebP بحجم لا يتجاوز 20MB.');
  if (file.type === 'image/webp') {
    const dimensions = webpDimensions(await file.arrayBuffer());
    if (
      file.size <= mediaLimits.bytes &&
      dimensions.width <= 1200 &&
      dimensions.height <= mediaLimits.height &&
      dimensions.width * dimensions.height <= mediaLimits.pixels
    )
      return { blob: file, ...dimensions }; // Already optimized; preserve every pixel and avoid recompression.
  }
  const image = await createImageBitmap(file);
  if (image.width * image.height > mediaLimits.pixels || image.height > mediaLimits.height) {
    image.close();
    throw new Error('هذه الصورة كبيرة جدًا. قسّمها إلى صور متتابعة وأضفها إلى الصفحة.');
  }
  const factor = Math.min(1, 1200 / image.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * factor));
  canvas.height = Math.max(1, Math.round(image.height * factor));
  const context = canvas.getContext('2d');
  if (!context) {
    image.close();
    throw new Error('تعذر تجهيز الصورة في هذا المتصفح.');
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  try {
    for (const quality of [0.9, 0.82, 0.74, 0.66]) {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('تعذر ضغط الصورة.'))),
          'image/webp',
          quality,
        ),
      );
      if (blob.type !== 'image/webp') throw new Error('استخدم متصفحًا حديثًا يدعم صور WebP.');
      if (blob.size <= mediaLimits.bytes)
        return { blob, width: canvas.width, height: canvas.height };
    }
    throw new Error('الصورة أكبر من 2MB بعد الضغط. قسّمها إلى صور متتابعة للحفاظ على وضوحها.');
  } finally {
    canvas.width = canvas.height = 0;
  }
}
