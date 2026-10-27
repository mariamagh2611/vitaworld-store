import { describe, it, expect } from 'vitest';
import type { Product, Quote } from '../src/shared/types';
import { validateRemoteQuote } from '../src/server/order-checks';

const products = [{ id: 'gift', fulfillment: 2000 }] as Product[];
const quote: Quote = {
  supplier: 'supp_a',
  items: [
    {
      productId: 'gift',
      sku: 'GIFT',
      name: 'Gift',
      offerId: 'three',
      quantity: 3,
      unitPrice: 3333,
      subtotal: 10000,
      freeShipping: true,
      revision: 1,
    },
  ],
  subtotal: 10000,
  shipping: 0,
  total: 10000,
  fingerprint: 'local',
};
function response() {
  return {
    success: true,
    is_valid: true,
    supplier_group_id: 'supp_a',
    quote_id: 'quot_test',
    expires_at: new Date(Date.now() + 600000).toISOString(),
    destination: {
      is_casablanca: false,
      shipping_tier: 'standard',
      platform_shipping_cost: 30,
      is_shipping_cost_final: true,
    },
    financials: {
      total_wholesale: 60,
      platform_shipping_cost: 30,
      customer_shipping_fee: 0,
      platform_due_break_even: 90,
      proposed_cod_to_collect: 100,
      estimated_partner_profit: 10,
      is_break_even_or_profitable: true,
      currency: 'MAD',
    },
    safety_guarantee: { order_created: false, stock_reserved: false, shipping_label_issued: false },
  };
}
describe('authoritative Mowarid quote contract', () => {
  it('accepts total-order pricing and zero profit without changing the promised COD', () => {
    expect(validateRemoteQuote(response(), quote, products).is_valid).toBe(true);
    const raw = response();
    raw.financials.proposed_cod_to_collect = 90;
    raw.financials.estimated_partner_profit = 0;
    expect(validateRemoteQuote(raw, { ...quote, total: 9000 }, products).is_valid).toBe(true);
  });
  it('uses actual Casablanca shipping rather than a nationwide 30 MAD floor', () => {
    const raw = response();
    raw.destination.is_casablanca = true;
    raw.destination.shipping_tier = 'casablanca';
    raw.destination.platform_shipping_cost = 20;
    Object.assign(raw.financials, {
      platform_shipping_cost: 20,
      platform_due_break_even: 80,
      proposed_cod_to_collect: 80,
      estimated_partner_profit: 0,
    });
    expect(validateRemoteQuote(raw, { ...quote, total: 8000 }, products).is_valid).toBe(true);
  });
  it('rejects a Casablanca tier attached to a destination outside Casablanca', () => {
    const raw = response();
    raw.destination.shipping_tier = 'casablanca';
    expect(() => validateRemoteQuote(raw, quote, products)).toThrow('shipping_review_required');
  });
  it('detects a quote that counts only one wholesale unit for a multi-unit order', () => {
    const raw = response();
    Object.assign(raw.financials, {
      total_wholesale: 20,
      platform_due_break_even: 50,
      estimated_partner_profit: 50,
    });
    expect(() => validateRemoteQuote(raw, quote, products)).toThrow(
      'catalog_cost_changed_review_required',
    );
  });
  it('rejects changed totals, mixed supplier identities, and inconsistent financials', () => {
    const total = response();
    total.financials.proposed_cod_to_collect = 101;
    expect(() => validateRemoteQuote(total, quote, products)).toThrow(
      'remote_quote_total_mismatch',
    );
    const group = response();
    group.supplier_group_id = 'supp_b';
    expect(() => validateRemoteQuote(group, quote, products)).toThrow(
      'invalid_remote_quote_contract',
    );
    const inconsistent = response();
    inconsistent.financials.estimated_partner_profit = 11;
    expect(() => validateRemoteQuote(inconsistent, quote, products)).toThrow(
      'invalid_remote_quote_financials',
    );
    expect(() =>
      validateRemoteQuote({ is_valid: false, code: 'MIXED_SUPPLIERS' }, quote, products),
    ).toThrow('mixed_suppliers_not_allowed');
  });
  it('requires final standard shipping, valid currency, and a side-effect-free quote', () => {
    const unfinished = response();
    unfinished.destination.is_shipping_cost_final = false;
    expect(() => validateRemoteQuote(unfinished, quote, products)).toThrow(
      'shipping_review_required',
    );
    const heavy = response();
    heavy.destination.shipping_tier = 'heavy';
    expect(() => validateRemoteQuote(heavy, quote, products)).not.toThrow();
    const currency = response();
    currency.financials.currency = 'USD';
    expect(() => validateRemoteQuote(currency, quote, products)).toThrow(
      'invalid_remote_quote_currency',
    );
    const unsafe = response();
    unsafe.safety_guarantee.stock_reserved = true;
    expect(() => validateRemoteQuote(unsafe, quote, products)).toThrow(
      'unsafe_remote_quote_contract',
    );
  });
  it('rejects expired quotes and accepts an internally consistent new official shipping tariff', () => {
    const expired = response();
    expired.expires_at = new Date(Date.now() - 1000).toISOString();
    expect(() => validateRemoteQuote(expired, quote, products)).toThrow('remote_quote_expired');
    const shipping = response();
    shipping.destination.platform_shipping_cost = 31;
    Object.assign(shipping.financials, {
      platform_shipping_cost: 31,
      platform_due_break_even: 91,
      proposed_cod_to_collect: 91,
      estimated_partner_profit: 0,
    });
    expect(() => validateRemoteQuote(shipping, { ...quote, total: 9100 }, products)).not.toThrow();
    shipping.destination.platform_shipping_cost = 45;
    expect(() => validateRemoteQuote(shipping, { ...quote, total: 9100 }, products)).toThrow(
      'shipping_contract_changed_review_required',
    );
  });
});
