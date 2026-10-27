import { describe, it, expect } from 'vitest';
import { storeIdentity } from '../src/server/store-identity';
import { mowaridPayload } from '../src/shared/domain';
import type { Env } from '../src/server/db';
import type { Quote } from '../src/shared/types';

describe('trusted store identity stored independently of delivery label notes', () => {
  const env = { APP_ORIGIN: 'https://shop.example.test', ENVIRONMENT: 'production' } as Env;
  it('uses the configured canonical origin instead of visitor input and removes control characters from the brand', () => {
    expect(storeIdentity(env, ' Boutique\nTest ', 'https://attacker.invalid/')).toEqual({
      name: 'Boutique Test',
      url: 'https://shop.example.test',
    });
    expect(() =>
      storeIdentity({ ...env, APP_ORIGIN: '' }, 'Test', 'https://attacker.invalid'),
    ).toThrow();
    expect(() =>
      storeIdentity(
        { ...env, APP_ORIGIN: 'https://user:password@example.test' },
        'Test',
        'https://shop.example.test',
      ),
    ).toThrow();
    expect(() =>
      storeIdentity(
        { ...env, APP_ORIGIN: 'http://shop.example.test' },
        'Test',
        'https://shop.example.test',
      ),
    ).toThrow();
  });
  it('sends only customer instructions as label notes even when the order has a store identity', () => {
    const customer = {
      name: 'Test',
      phone: '0612345678',
      city: 'Rabat',
      address: 'Street 12',
      notes: 'Please call after 18:00.',
    };
    const quote = {
      supplier: 'vendor',
      items: [],
      subtotal: 10000,
      shipping: 3000,
      total: 13000,
      fingerprint: 'x',
      storeIdentity: storeIdentity(env, 'Original store', env.APP_ORIGIN!),
    } as Quote;
    const order = { id: 'STORE-TEST', customer, quote };
    const first = mowaridPayload(order, 'quot_test');
    storeIdentity(env, 'Renamed store', env.APP_ORIGIN!);
    expect(mowaridPayload(order, 'quot_test')).toEqual(first);
    expect(first.notes).toBe(customer.notes);
    expect(first.notes).not.toContain('Original store');
    expect(first.notes).not.toContain('https://shop.example.test');
    expect(quote.storeIdentity?.name).toBe('Original store');
    expect(first.store).toEqual({ name: 'Original store', url: 'https://shop.example.test' });
    expect(first).not.toHaveProperty('store_name');
    expect(first).not.toHaveProperty('store_url');
    expect(first.customer_shipping_fee).toBe(30);
    expect(first.cod_to_collect).toBe(130);
    expect(mowaridPayload({ ...order, quote: { ...quote, storeIdentity: undefined } }).notes).toBe(
      customer.notes,
    );
    expect(mowaridPayload({ ...order, customer: { ...customer, notes: '' } }).notes).toBe('');
  });
});
