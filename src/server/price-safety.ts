import { maximumShipping } from './shipping-policy';
import { products, settings, setState, type Env } from './db';
import { assertPublishedPrices, assertPricePackage, DomainError } from '../shared/domain';
import { activeOffer, activePromotion, tailPricing } from '../shared/commerce';
import type { Product, Settings } from '../shared/types';

export function protectPrices(rows: Product[], s: Settings, maximum: number | null) {
  const reasons: { id: string; name: string; message: string }[] = [];
  const protectedRows = rows.map((row) => {
    const p = structuredClone(row);
    if (!p.active || !p.verified) return p;
    const pause = (error: unknown) => {
      reasons.push({ id: p.id, name: p.name, message: (error as Error).message });
    };
    if (maximum === null) {
      p.active = 0;
      pause(new Error('لم تصل تكلفة توصيل رسمية موثوقة من مورد.'));
      return p;
    }
    try {
      assertPublishedPrices(
        p.price,
        [],
        p.fulfillment,
        s,
        { ...p, presentation: { ...p.presentation, quantityPricing: undefined } },
        maximum,
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      p.active = 0;
      pause(error);
      return p;
    }
    if (activePromotion(p)) {
      try {
        assertPublishedPrices(
          p.presentation!.promotion!.price,
          [],
          p.fulfillment,
          s,
          { ...p, presentation: { ...p.presentation, quantityPricing: undefined } },
          maximum,
        );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        p.presentation!.promotion = null;
        pause(error);
      }
    }
    p.offers = p.offers.filter((offer) => {
      if (p.presentation?.bundleMode === false) return true;
      if (!activeOffer(offer)) return false;
      try {
        assertPricePackage(
          offer.total,
          p.fulfillment! * offer.quantity,
          offer.freeShipping,
          s,
          p,
          maximum,
        );
        return true;
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        pause(error);
        return false;
      }
    });
    const tail = tailPricing(p);
    if (tail) {
      try {
        for (const quantity of [tail.fromQuantity, 100])
          assertPricePackage(
            tail.unitPrice * quantity,
            p.fulfillment! * quantity,
            tail.freeShipping,
            s,
            p,
            maximum,
          );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        p.presentation!.quantityPricing = undefined;
        pause(error);
      }
    }
    return p;
  });
  return { products: protectedRows, reasons };
}
export async function safeProducts(env: Env, rows: Product[], s?: Settings) {
  const [all, configured, maximum] = await Promise.all([
    Promise.resolve(rows),
    s ? Promise.resolve(s) : settings(env.DB),
    maximumShipping(env).catch(() => null),
  ]);
  return protectPrices(all, configured, maximum).products;
}
export async function reviewPrices(env: Env) {
  const [rows, s, maximum] = await Promise.all([
    products(env.DB),
    settings(env.DB),
    maximumShipping(env).catch(() => null),
  ]);
  const review = protectPrices(rows, s, maximum);
  await setState(env.DB, 'pricing_paused', {
    at: new Date().toISOString(),
    products: review.reasons,
  });
}
