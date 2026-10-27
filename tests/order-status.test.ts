import { it, expect } from 'vitest';
import {
  deliveredShipping,
  trackingUrl,
  financialLabels,
  financialStatus,
  financialLabel,
  remoteShipping,
  activeCallStatus,
  statusTone,
  postponementNote,
  postponementDate,
  cancellationReason,
} from '../src/shared/order-status';
it('uses explicit closed-order reasons and never substitutes customer, call or hold notes', () => {
  const status = {
    shipping_status: 'cancelled',
    cancellation_reason: '  Customer denies placing the order  ',
  };
  expect(cancellationReason(status)).toBe('Customer denies placing the order');
  expect(cancellationReason({ ...status, shipping_status: 'pending' })).toBe('');
  expect(cancellationReason(status, 'delivered')).toBe('');
  expect(cancellationReason({ order_status: 'cancelled', cancellation_reason: 'Reason' })).toBe(
    'Reason',
  );
  expect(
    cancellationReason({ ...status, shipping_status: 'returned', return_reason: 'Damaged' }),
  ).toBe('Damaged');
  expect(cancellationReason({ ...status, shipping_status: 'returned', return_reason: ' ' })).toBe(
    'Customer denies placing the order',
  );
  for (const value of [null, undefined, '', '  ', {}, ['Reason'], true, 17])
    expect(
      cancellationReason({
        shipping_status: 'cancelled',
        cancellation_reason: value,
        notes: 'Delivery note',
        hold_reason: 'Hold',
        postponed_note: 'Call later',
      }),
    ).toBe('');
  expect(cancellationReason()).toBe('');
  expect(
    cancellationReason({ shipping_status: 'cancelled', cancellation_reason: 'x'.repeat(3000) }),
  ).toHaveLength(2000);
});
it('displays the provider’s postponement date without guessing one from the call timestamp', () => {
  expect(postponementNote({ call_status: 'postponed', postponed_note: '15/10/2026' })).toBe(
    '15/10/2026',
  );
  expect(postponementNote({ call_status: 'postponed', postponed_note: 'Call next week' })).toBe(
    'Call next week',
  );
  expect(postponementNote({ call_status: 'postponed', last_call_at: '2026-10-09T00:00:00Z' })).toBe(
    '',
  );
  expect(
    postponementNote({
      shipping_status: 'cancelled',
      call_status: 'postponed',
      postponed_note: '15/10/2026',
    }),
  ).toBe('');
});
it('uses an explicit ISO postponement appointment and rejects ambiguous or impossible dates', () => {
  const status = {
    shipping_status: 'pending',
    call_status: 'postponed',
    postponed_until: '2026-10-15T09:00:00.000Z',
    postponed_note: 'Call after payday',
    last_call_at: '2026-10-09T11:15:24Z',
  };
  expect(postponementDate(status)).toBe('2026-10-15T09:00:00.000Z');
  expect(postponementDate({ ...status, postponed_until: '2026-10-15T10:00:00+01:00' })).toBe(
    '2026-10-15T09:00:00.000Z',
  );
  for (const postponed_until of [
    null,
    '',
    '15/10/2026',
    '2026-10-15T09:00:00',
    '2026-02-30T09:00:00Z',
    '2026-10-15T24:00:00Z',
    '2026-10-15T09:00:00+25:00',
  ])
    expect(postponementDate({ ...status, postponed_until })).toBeNull();
  for (const shipping_status of ['cancelled', 'returned', 'delivered', 'paid', 'deleted'])
    expect(postponementDate({ ...status, shipping_status })).toBeNull();
  expect(postponementDate({ ...status, call_status: 'call_attempt_1' })).toBeNull();
  expect(postponementNote(status)).toBe('Call after payday');
});
it('shows in-progress calls and stops pending follow-up for closed or delivered orders', () => {
  expect(activeCallStatus({ shipping_status: 'pending', call_status: 'call_attempt_1' })).toBe(
    'call_attempt_1',
  );
  for (const shipping_status of ['cancelled', 'returned', 'deleted', 'delivered', 'paid'])
    expect(activeCallStatus({ shipping_status, call_status: 'pending' })).toBeNull();
  expect(
    activeCallStatus({ order_status: 'pending', call_status: 'call_attempt_2' }, 'cancelled'),
  ).toBeNull();
  expect(financialStatus('pending', 'confirmed', 'cancelled')).toBe('cancelled');
  expect(statusTone('call_attempt_1')).toBe('warning');
  expect(statusTone('cancelled')).toBe('danger');
  expect(statusTone('delivered')).toBe('success');
});
it('presents only four official financial statuses and maps legacy cleared records without changing delivery evidence', () => {
  expect(Object.keys(financialLabels)).toEqual([
    'pending',
    'awaiting_settlement',
    'paid',
    'cancelled',
  ]);
  expect(financialStatus('cleared')).toBe('awaiting_settlement');
  expect(financialLabel('cleared', undefined, 'متاحة في الرصيد للسحب')).toBe('بانتظار التسوية');
  expect(financialLabel('awaiting_settlement', undefined, 'بانتظار تسوية شركة الشحن')).toBe(
    'بانتظار التسوية',
  );
  expect(financialLabel('paid')).toBe('مدفوعة');
  expect(financialStatus(null, 'cancelled')).toBe('cancelled');
  expect(financialStatus(null, 'pending_confirmation')).toBe('pending');
  expect(financialStatus(null, 'confirmed', 'returned')).toBe('cancelled');
});

it('uses documented order lifecycle states as a fallback without treating financial settlement as delivery', () => {
  expect(remoteShipping({ order_status: 'confirmed' })).toBe('confirmed');
  expect(remoteShipping({ order_status: 'delivered' })).toBe('delivered');
  expect(remoteShipping({ shipping_status: 'pending', order_status: 'delivered' })).toBe('pending');
  expect(remoteShipping({ financial_status: 'paid', call_status: 'call_attempt_3' })).toBeNull();
  expect(remoteShipping({ order_status: 'paid' })).toBeNull();
});

it('shipping paid includes delivery, while other shipping states do not', () => {
  expect(deliveredShipping('delivered')).toBe(true);
  expect(deliveredShipping('paid')).toBe(true);
  for (const code of ['pending', 'approved', 'shipped', 'returned', 'cancelled', 'deleted', null])
    expect(deliveredShipping(code)).toBe(false);
});
it('uses the carrier-provided HTTPS tracking link without inventing a carrier URL', () => {
  expect(trackingUrl('https://tracking.carrier.test/parcel?ref=123')).toBe(
    'https://tracking.carrier.test/parcel?ref=123',
  );
  for (const value of [
    'javascript:alert(1)',
    'http://carrier.test/x',
    '/relative',
    'https://user:secret@carrier.test/x',
    '',
    null,
  ])
    expect(trackingUrl(value)).toBeNull();
});
