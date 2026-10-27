import type { ShippingCosts } from '../shared/types';
import { cities, state, setState, now, type Env } from './db';
import { isCasa, DomainError } from '../shared/domain';

export function officialAmount(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1000000 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 0.00001
    ? Math.round(value * 100)
    : null;
}
export async function rememberShipping(
  env: Env,
  source: 'catalog' | 'quote',
  values: unknown[],
  keyFingerprint?: string,
) {
  const amounts = values.map(officialAmount);
  if (!amounts.length || amounts.some((value) => value === null)) return;
  const current = (await state(env.DB, 'shipping_policy')) || {};
  // Quote costs only increase the bound until the catalogue/city contract is reviewed.
  if (
    source === 'quote' &&
    current.quote?.keyFingerprint === keyFingerprint &&
    Math.max(...(amounts as number[])) <= current.quote.maximum
  )
    return;
  const maximum = Math.max(
    ...(amounts as number[]),
    source === 'quote' && current.quote?.keyFingerprint === keyFingerprint
      ? current.quote.maximum
      : 0,
  );
  await setState(env.DB, 'shipping_policy', {
    ...current,
    [source]: {
      maximum,
      keyFingerprint,
      checkedAt: now(),
      ...(source === 'catalog' && amounts.length === 2
        ? { casa: amounts[0], other: amounts[1] }
        : {}),
    },
  });
}
export async function shippingCosts(env: Env): Promise<ShippingCosts> {
  const [policy, knownCities, contract] = await Promise.all([
    state(env.DB, 'shipping_policy'),
    cities(env.DB),
    state(env.DB, 'supplier_contract'),
  ]);
  const cityFees = knownCities
    .filter((city) => city.is_serviceable !== false)
    .map((city) => officialAmount(city.shipping_fee_mad))
    .filter((value): value is number => value !== null);
  const amounts = [
    ...cityFees,
    ...['catalog', 'quote'].flatMap((source) => {
      const record = policy?.[source];
      return record &&
        record.keyFingerprint === contract?.keyFingerprint &&
        Number.isSafeInteger(record.maximum) &&
        record.maximum >= 0
        ? [record.maximum]
        : [];
    }),
  ];
  if (amounts.length) {
    const maximum = Math.max(...amounts);
    const catalog =
      policy?.catalog?.keyFingerprint === contract?.keyFingerprint ? policy.catalog : null;
    const area = (casa: boolean) => {
      const fees = knownCities
        .filter(
          (city) =>
            city.is_serviceable !== false &&
            (typeof city.is_casablanca === 'boolean' ? city.is_casablanca : isCasa(city.city)) ===
              casa,
        )
        .map((city) => officialAmount(city.shipping_fee_mad))
        .filter((v): v is number => v !== null);
      const fromCatalog = casa ? catalog?.casa : catalog?.other;
      if (Number.isSafeInteger(fromCatalog) && fromCatalog >= 0) fees.push(fromCatalog);
      return fees.length ? Math.max(...fees) : maximum;
    };
    return { maximum, casa: area(true), other: area(false) };
  }
  if (env.ENVIRONMENT === 'development') return { maximum: 3000, casa: 2000, other: 3000 };
  throw new DomainError(
    'shipping_policy_missing',
    'لم تصل تكلفة توصيل رسمية موثوقة من مورد. حدّث بيانات مورد قبل تفعيل البيع.',
    503,
  );
}

export async function maximumShipping(env: Env): Promise<number> {
  return (await shippingCosts(env)).maximum;
}
