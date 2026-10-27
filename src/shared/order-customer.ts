import type { Customer } from './types';
import { normalizePhone } from './domain';

// Preserve the checkout snapshot; derive the latest operational contact
// details from the accepted provider snapshot for both the UI and CAPI.
export function currentOrderCustomer(
  original: Customer,
  remote: Record<string, any> | null,
): Customer {
  const current = { ...original },
    source = remote?.customer;
  for (const field of ['name', 'city', 'address'] as const)
    if (typeof source?.[field] === 'string') current[field] = source[field];
  if (typeof source?.phone === 'string') {
    try {
      current.phone = normalizePhone(source.phone);
    } catch {
      /* retain a valid known phone */
    }
  }
  const notes = remote && Object.hasOwn(remote, 'notes') ? remote.notes : source?.notes;
  if (typeof notes === 'string') current.notes = notes;
  else if (notes === null) current.notes = '';
  return current;
}
