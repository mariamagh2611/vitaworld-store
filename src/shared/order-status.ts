// Shipping `paid` includes physical delivery in the Mowarid v1 contract.
// Financial `paid` alone must never be used as proof of delivery.
export const shippingLabels: Record<string, string> = {
  pending: 'قيد الانتظار لدى مورد',
  approved: 'مقبول',
  accepted: 'مقبول',
  confirmed: 'مؤكد لدى مورد',
  in_transit: 'تم الشحن',
  shipped: 'تم الشحن',
  delivered: 'تم التوصيل',
  paid: 'تم التوصيل (مدفوعة الأرباح)',
  returned: 'مرتجع',
  cancelled: 'ملغى لدى مورد',
  deleted: 'محذوف لدى مورد',
};
export const financialLabels: Record<string, string> = {
  pending: 'قيد التجهيز',
  awaiting_settlement: 'بانتظار التسوية',
  paid: 'مدفوعة',
  cancelled: 'ملغاة / مرتجع',
};
export const callLabels: Record<string, string> = {
  pending: 'بانتظار بدء الاتصال',
  call_attempt_1: 'محاولة الاتصال الأولى',
  call_attempt_2: 'محاولة الاتصال الثانية',
  call_attempt_3: 'محاولة الاتصال الثالثة',
  postponed: 'مؤجل بطلب الزبون',
};
export function closedOrder(shipping?: string | null, local?: string) {
  return local === 'cancelled' || ['cancelled', 'returned', 'deleted'].includes(shipping || '');
}
// Explicit partner fields only. Customer notes, call notes and financial
// holds do not describe why an order was cancelled or returned.
export function cancellationReason(status?: Record<string, any> | null, shipping?: string | null) {
  const phase = shipping || remoteShipping(status);
  if (!closedOrder(phase)) return '';
  const fields =
    phase === 'returned' ? ['return_reason', 'cancellation_reason'] : ['cancellation_reason'];
  for (const key of fields) {
    const value = status?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 2000);
  }
  return '';
}
// Call attempts describe work still in progress, never a cancelled or delivered order.
export function activeCallStatus(status?: Record<string, any> | null, local?: string) {
  const shipping = remoteShipping(status);
  if (closedOrder(shipping, local) || deliveredShipping(shipping)) return null;
  return typeof status?.call_status === 'string' && callLabels[status.call_status]
    ? status.call_status
    : null;
}
export function statusTone(code?: string | null) {
  if (['cancelled', 'returned', 'deleted', 'error'].includes(code || '')) return 'danger';
  if (['delivered', 'paid'].includes(code || '')) return 'success';
  if (['confirmed', 'approved', 'accepted', 'shipped', 'in_transit', 'sent'].includes(code || ''))
    return 'info';
  if (
    ['pending', 'pending_confirmation', 'awaiting_settlement', 'postponed'].includes(code || '') ||
    code?.startsWith('call_attempt_')
  )
    return 'warning';
  return 'neutral';
}
// Prefer explicit physical shipping evidence. The new order status is a
// compatible fallback only when shipping_status is absent.
export function remoteShipping(status: Record<string, any> | null | undefined): string | null {
  if (typeof status?.shipping_status === 'string' && status.shipping_status)
    return status.shipping_status;
  return typeof status?.order_status === 'string' &&
    ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned'].includes(
      status.order_status,
    )
    ? status.order_status
    : null;
}
export const orderPhaseLabels: Record<string, string> = {
  not_sent: 'غير مرسل لمورد',
  sent: 'مرسل لمورد',
  pending: 'قيد الانتظار',
  confirmed: 'مقبول',
  shipped: 'تم الشحن',
  delivered: 'تم التوصيل',
  returned: 'مرتجع',
  cancelled: 'ملغى',
  deleted: 'محذوف',
};
export function postponementNote(status?: Record<string, any> | null) {
  return activeCallStatus(status) === 'postponed' && typeof status?.postponed_note === 'string'
    ? status.postponed_note.trim().slice(0, 1000)
    : '';
}
// Only the provider's explicit, zoned timestamp describes the next appointment.
// Keep legacy notes readable without inferring a date from a previous call.
export function postponementDate(status?: Record<string, any> | null): string | null {
  const value = status?.postponed_until;
  if (
    activeCallStatus(status) !== 'postponed' ||
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return null;
  const date = new Date(value),
    day = new Date(value.slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) &&
    Number.isFinite(day.getTime()) &&
    day.toISOString().slice(0, 10) === value.slice(0, 10)
    ? date.toISOString()
    : null;
}
// Old records remain readable without exposing a withdrawn settlement state.
export function financialStatus(
  code: unknown,
  localStatus?: string,
  shippingStatus?: string | null,
) {
  if (closedOrder(shippingStatus, localStatus)) return 'cancelled';
  if (code === 'cleared') return 'awaiting_settlement';
  return typeof code === 'string' && code
    ? code
    : localStatus === 'cancelled' ||
        ['cancelled', 'returned', 'deleted'].includes(shippingStatus || '')
      ? 'cancelled'
      : 'pending';
}
export function financialLabel(
  code: unknown,
  localStatus?: string,
  fallback?: string,
  shippingStatus?: string | null,
) {
  const normalized = financialStatus(code, localStatus, shippingStatus);
  return financialLabels[normalized] || fallback || normalized;
}
export function deliveredShipping(status: string | null) {
  return status === 'delivered' || status === 'paid';
}
export function trackingUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
