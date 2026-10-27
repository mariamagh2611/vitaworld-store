import { useEffect, useRef, useState } from 'react';
import { orderReceipt } from '../shared/order-receipt';
import type { OrderReceiptData } from '../shared/order-receipt';
import { t, money, adminLanguage } from './language';
import { OrderIcon } from './order-icons';
const value = (cents: number | null) => (cents === null ? '—' : money(cents));
const receiptDate = (at: string, time = false) =>
  at && Number.isFinite(Date.parse(at))
    ? new Date(at).toLocaleString(adminLanguage() === 'ar' ? 'ar-MA' : adminLanguage(), {
        timeZone: 'Africa/Casablanca',
        ...(time
          ? { hour: '2-digit', minute: '2-digit' }
          : { year: 'numeric', month: 'long', day: 'numeric' }),
      })
    : '—';
const fields = (data: OrderReceiptData) => [
  [t('العميل'), data.customer.name],
  [t('رقم الطلب'), data.number],
  [t('رقم الهاتف'), data.customer.phone],
  [t('التاريخ'), receiptDate(data.createdAt)],
  [t('عنوان التوصيل'), data.customer.city + ' · ' + data.customer.address],
  [t('وسيلة الدفع'), t('الدفع عند الاستلام')],
];

// Draw text directly using the store's local font. No screenshot service,
// uploaded customer data, third-party images or injected HTML are needed.
async function receiptImage(data: OrderReceiptData): Promise<Blob> {
  await Promise.all([
    document.fonts.load('400 18px "IBM Plex Sans Arabic"'),
    document.fonts.load('600 18px "IBM Plex Sans Arabic"'),
  ]);
  const canvas = document.createElement('canvas'),
    context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  const ctx = context,
    width = 800,
    margin = 44,
    right = width - margin,
    rtl = adminLanguage() === 'ar';
  const commands: (() => void)[] = [];
  const text = (
    content: string,
    x: number,
    y: number,
    maxWidth: number,
    size = 18,
    weight = 400,
    align: CanvasTextAlign = 'right',
    color = '#263d35',
  ) => {
    ctx.font = `${weight} ${size}px "IBM Plex Sans Arabic", Arial, sans-serif`;
    const lines: string[] = [];
    let line = '';
    for (const word of content.split(/\s+/)) {
      if (line && ctx.measureText(line + ' ' + word).width > maxWidth) {
        lines.push(line);
        line = '';
      }
      if (ctx.measureText(word).width <= maxWidth) {
        line += (line ? ' ' : '') + word;
        continue;
      }
      for (const char of word) {
        if (ctx.measureText(line + char).width > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    if (line) lines.push(line);
    commands.push(() => {
      ctx.font = `${weight} ${size}px "IBM Plex Sans Arabic", Arial, sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = 'top';
      ctx.direction = /[\u0600-\u06ff]/.test(content) ? 'rtl' : 'ltr';
      lines.forEach((part, index) => ctx.fillText(part, x, y + index * (size * 1.6)));
    });
    return Math.max(1, lines.length) * size * 1.6;
  };
  const box = (x: number, y: number, w: number, h: number, color: string, border = false) =>
    commands.push(() => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      if (border) {
        ctx.strokeStyle = '#dedfd6';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
      }
    });
  let y = 42;
  if (data.brand) y += text(data.brand, width / 2, y, 650, 20, 600, 'center') + 12;
  y += text(t('وصل شراء'), width / 2, y, 650, 34, 600, 'center') + 4;
  y +=
    text(
      data.closed ? t('طلب ملغى / مرتجع · لا يوجد مبلغ مطلوب من الزبون') : t('شكرًا لتسوقكم معنا'),
      width / 2,
      y,
      650,
      16,
      400,
      'center',
      data.closed ? '#b42318' : '#79847c',
    ) + 28;
  const metaTop = y;
  let metaY = y + 22;
  const metadata = fields(data);
  // Content order and alignment follow the selected dashboard language.
  const metaCommandsStart = commands.length;
  for (let i = 0; i < metadata.length; i += 2) {
    let rowHeight = 0;
    for (let j = 0; j < 2; j++) {
      const [label, content] = metadata[i + j];
      const x = rtl ? right - 22 - j * 356 : margin + 22 + j * 356;
      text(label, x, metaY, 310, 14, 400, rtl ? 'right' : 'left', '#79847c');
      rowHeight = Math.max(
        rowHeight,
        text(content, x, metaY + 26, 310, 18, 600, rtl ? 'right' : 'left'),
      );
    }
    metaY += rowHeight + 45;
  }
  const metaCommands = commands.splice(metaCommandsStart);
  box(margin, metaTop, width - margin * 2, metaY - metaTop, '#ffffff', true);
  commands.push(...metaCommands);
  y = metaY + 26;
  const columns = rtl ? [right - 18, 343, 249, 125] : [margin + 18, 457, 551, 675];
  box(margin, y, width - margin * 2, 50, '#173d35');
  [t('المنتج'), t('الكمية'), t('السعر'), t('الإجمالي')].forEach((label, i) =>
    text(
      label,
      columns[i],
      y + 11,
      i ? 100 : 340,
      16,
      600,
      i ? 'center' : rtl ? 'right' : 'left',
      '#ffffff',
    ),
  );
  y += 50;
  for (const item of data.items) {
    const at = commands.length;
    const height = Math.max(
      70,
      text(item.name, columns[0], y + 18, 335, 18, 600, rtl ? 'right' : 'left') + 36,
    );
    [String(item.quantity), value(item.unitPrice), value(item.subtotal)].forEach((content, i) =>
      text(content, columns[i + 1], y + 18, 108, 15, 400, 'center'),
    );
    const row = commands.splice(at);
    box(margin, y, width - margin * 2, height, '#ffffff', true);
    commands.push(...row);
    y += height;
  }
  y += 24;
  box(margin, y, width - margin * 2, 174, '#f7f9f7', true);
  [
    [t('مجموع السلع'), value(data.subtotal)],
    [t('مصاريف التوصيل'), value(data.shipping)],
    [
      data.closed ? t('قيمة الطلب قبل الإلغاء / الاسترجاع') : t('المبلغ الإجمالي'),
      value(data.total),
    ],
  ].forEach(([label, total], i) => {
    text(
      label,
      rtl ? right - 22 : margin + 22,
      y + 20 + i * 49,
      440,
      i === 2 ? 20 : 17,
      i === 2 ? 600 : 400,
      rtl ? 'right' : 'left',
    );
    text(
      total,
      rtl ? margin + 22 : right - 22,
      y + 20 + i * 49,
      190,
      i === 2 ? 23 : 18,
      600,
      rtl ? 'left' : 'right',
    );
  });
  y += 200;
  text(
    t('الدفع عند الاستلام · هذا الوصل لا يثبت تسديد المبلغ'),
    width / 2,
    y,
    650,
    14,
    400,
    'center',
    '#79847c',
  );
  y += 64;
  canvas.width = width * 2;
  canvas.height = Math.ceil(y) * 2;
  ctx.scale(2, 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, y);
  commands.forEach((draw) => draw());
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('image'))), 'image/png'),
  );
}

export function OrderReceipt({
  order,
  onClose,
}: {
  order: Parameters<typeof orderReceipt>[0];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const data = orderReceipt(order);
  useEffect(() => {
    const previous = document.body.style.overflow;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => {
      document.body.style.overflow = previous;
      element?.close();
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    };
  }, []);
  const download = async () => {
    setBusy(true);
    setError(false);
    try {
      const url = URL.createObjectURL(await receiptImage(data));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'receipt-' + String(data.number).replace(/[^a-zA-Z0-9_-]/g, '') + '.png';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="order-receipt-dialog"
      aria-label={t('وصل الشراء للزبون')}
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="receipt-modal-heading">
        <h2>
          <OrderIcon name="receipt" />
          {t('وصل الشراء للزبون')}
        </h2>
        <button className="order-button icon-only" aria-label={t('إغلاق')} onClick={onClose}>
          <OrderIcon name="close" />
        </button>
      </header>
      <div className="receipt-scroll">
        <article className="customer-receipt" aria-label={t('معاينة وصل الشراء')}>
          {data.brand && <p className="receipt-brand">{data.brand}</p>}
          <h3>{t('وصل شراء')}</h3>
          <p className={data.closed ? 'error-text' : 'muted'}>
            {data.closed
              ? t('طلب ملغى / مرتجع · لا يوجد مبلغ مطلوب من الزبون')
              : t('شكرًا لتسوقكم معنا')}
          </p>
          <dl className="receipt-meta">
            {fields(data).map(([label, content]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{content}</dd>
              </div>
            ))}
          </dl>
          <table className="receipt-items">
            <thead>
              <tr>
                {['المنتج', 'الكمية', 'السعر', 'الإجمالي'].map((label) => (
                  <th key={label}>{t(label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={i}>
                  <td>{item.name}</td>
                  <td>{item.quantity}</td>
                  <td>{value(item.unitPrice)}</td>
                  <td>{value(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="receipt-totals">
            <div>
              <dt>{t('مجموع السلع')}</dt>
              <dd>{value(data.subtotal)}</dd>
            </div>
            <div>
              <dt>{t('مصاريف التوصيل')}</dt>
              <dd>{value(data.shipping)}</dd>
            </div>
            <div className="receipt-total">
              <dt>
                {data.closed ? t('قيمة الطلب قبل الإلغاء / الاسترجاع') : t('المبلغ الإجمالي')}
              </dt>
              <dd>{value(data.total)}</dd>
            </div>
          </dl>
          <p className="receipt-payment-note">
            {t('الدفع عند الاستلام · هذا الوصل لا يثبت تسديد المبلغ')}
          </p>
        </article>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {t('تعذر تنزيل الوصل. أعد المحاولة.')}
        </p>
      )}
      <footer>
        <button
          className="order-button order-button-primary"
          disabled={busy}
          onClick={() => void download()}
        >
          <OrderIcon name="download" />
          {busy ? t('جارٍ تجهيز الوصل…') : t('تنزيل الوصل كصورة')}
        </button>
        <button className="order-button" onClick={onClose}>
          {t('إغلاق')}
        </button>
      </footer>
    </dialog>
  );
}
