import { it, expect } from 'vitest';
import { merchantOrder, merchantQuoteProof, merchantCatalog } from '../src/shared/merchant-order';
it('retains merchant billing and own order fields while discarding unrelated upstream secrets and real procurement fields', () => {
  const result = merchantOrder({
    order_id: 'own-order',
    external_order_id: 'own-external',
    status: {
      shipping_status: 'delivered',
      financial_status: 'awaiting_settlement',
      order_status: 'delivered',
      call_status: 'postponed',
      last_call_at: '2026-10-09T00:00:00Z',
      postponed_note: 'Call later',
      postponed_until: '2026-10-15T09:00:00.000Z',
      internal_note: 'secret',
    },
    financials: {
      total_cod_amount: 299,
      platform_shipping_cost: 30,
      wholesale_subtotal: 175,
      partner_profit: 94,
      actual_carrier_cost: 18,
      supplier_purchase_cost: 120,
    },
    customer: { name: 'Own customer', phone: '0600000000', other_customer: { phone: 'private' } },
    shipping: {
      carrier: 'Carrier',
      delivery_agent_name: 'Own delivery agent',
      delivery_agent_phone: '0654321098',
      actual_delivery_invoice: 18,
    },
    items: [{ sku: 'OWN', quantity: 1, fulfillment_price: 175, supplier_bank: 'private' }],
    api_key: 'private',
    notes: 'Customer delivery instructions',
    store: { name: 'Own store', url: 'https://store.example.test', secret: 'private' },
    other_merchants: [{ bank: 'private' }],
  });
  expect(result?.financials).toEqual({
    total_cod_amount: 299,
    wholesale_subtotal: 175,
    platform_shipping_cost: 30,
    partner_profit: 94,
  });
  expect(result?.items[0]).toEqual({ sku: 'OWN', quantity: 1, fulfillment_price: 175 });
  expect(result?.customer.name).toBe('Own customer');
  expect(result?.shipping.delivery_agent_phone).toBe('0654321098');
  expect(result?.store).toEqual({ name: 'Own store', url: 'https://store.example.test' });
  expect(result?.notes).toBe('Customer delivery instructions');
  expect(result?.status.call_status).toBe('postponed');
  expect(result?.status.postponed_until).toBe('2026-10-15T09:00:00.000Z');
  expect(result?.shipping).not.toHaveProperty('actual_delivery_invoice');
  expect(JSON.stringify(result)).not.toMatch(
    /private|actual_carrier|supplier_purchase|internal_note|other_merchants/,
  );
});
it('preserves the validated quote proof wrapper and billed financials used by admin review', () => {
  const result = merchantQuoteProof({
    approved: true,
    checked_at: '2026-10-08T08:00:00Z',
    request_fingerprint: 'fingerprint',
    error: null,
    secret: 'private',
    raw: {
      quote_id: 'quote',
      expires_at: '2026-10-08T09:00:00Z',
      financials: {
        currency: 'MAD',
        total_wholesale: 175,
        platform_shipping_cost: 30,
        platform_due_break_even: 205,
        proposed_cod_to_collect: 299,
        estimated_partner_profit: 94,
        customer_shipping_fee: 0,
        internal_platform_margin: 20,
      },
      validation: { reason: 'Approved', private_note: 'private' },
      api_key: 'private',
    },
  });
  expect(result?.approved).toBe(true);
  expect(result?.raw?.financials.estimated_partner_profit).toBe(94);
  expect(result?.raw?.validation.reason).toBe('Approved');
  expect(JSON.stringify(result)).not.toMatch(/private|internal_platform/);
});
it('retains explicit cancellation and return reasons without accepting nested private records', () => {
  expect(
    merchantOrder({
      status: {
        cancellation_reason: 'Cancelled',
        return_reason: 'Returned',
        internal_note: 'private',
      },
    })?.status,
  ).toEqual({ cancellation_reason: 'Cancelled', return_reason: 'Returned' });
  expect(
    merchantOrder({
      status: { cancellation_reason: { private: true }, return_reason: ['private'] },
    })?.status,
  ).toEqual({});
});
it('exposes catalog marketing and affiliate prices without forwarding arbitrary supplier contacts or keys', () => {
  const result = merchantCatalog({
    sku: 'OWN',
    name: 'Product',
    description: '<b>Details</b>',
    supplier_key: 'group',
    fulfillment_price: 175,
    images: ['https://mowarid.ma/media.jpg', {}],
    search_keywords: 'word',
    supplier_email: 'private',
    api_key: 'private',
    internal_purchase_cost: 125,
    key_fingerprint: 'private',
  });
  expect(result.images).toEqual(['https://mowarid.ma/media.jpg']);
  expect(result.fulfillment_price).toBe(175);
  expect(JSON.stringify(result)).not.toContain('private');
});
