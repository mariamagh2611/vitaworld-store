import { it, expect } from 'vitest';
import { currentOrderCustomer } from '../src/shared/order-customer';
const original = {
  name: 'Original',
  phone: '0612345678',
  city: 'Rabat',
  address: 'Original address',
  notes: 'Original note',
};
it('uses corrected provider contact details and authoritative label notes without changing the checkout snapshot', () => {
  const latest = currentOrderCustomer(original, {
    customer: {
      name: 'Corrected',
      phone: '+212612345679',
      city: 'Casablanca',
      address: 'New address',
      notes: 'Legacy note',
    },
    notes: 'New delivery note',
  });
  expect(latest).toEqual({
    name: 'Corrected',
    phone: '0612345679',
    city: 'Casablanca',
    address: 'New address',
    notes: 'New delivery note',
  });
  expect(original.address).toBe('Original address');
  expect(
    currentOrderCustomer(original, { notes: '', customer: { notes: 'Old value' } }).notes,
  ).toBe('');
  expect(
    currentOrderCustomer(original, { notes: null, customer: { notes: 'Old value' } }).notes,
  ).toBe('');
  expect(currentOrderCustomer(original, { customer: { notes: 'Legacy note' } }).notes).toBe(
    'Legacy note',
  );
});
it('retains a valid known contact when fields are absent or contain an invalid telephone value', () => {
  expect(currentOrderCustomer(original, null)).toEqual(original);
  expect(
    currentOrderCustomer(original, {
      customer: { phone: 'javascript:alert(1)', name: 123 },
      notes: false,
    }),
  ).toEqual(original);
});
