// The merchant view has an explicit v1 contract. Never forward arbitrary
// upstream fields such as internal supplier costs, bank records or secrets.
const scalar = (value: unknown) =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);
function pick(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(value, key) && scalar((value as any)[key]))
      .map((key) => [key, (value as any)[key]]),
  );
}
const financial = [
  'currency',
  'products_subtotal',
  'customer_shipping_fee',
  'total_cod_amount',
  'wholesale_subtotal',
  'platform_shipping_cost',
  'partner_profit',
  'minimum_required_cod',
  'is_break_even_or_profitable',
  'total_wholesale',
  'platform_due_break_even',
  'proposed_cod_to_collect',
  'estimated_partner_profit',
];
export function merchantOrder(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, any>;
  return {
    ...pick(source, [
      'order_id',
      'order_number',
      'external_order_id',
      'created_at',
      'updated_at',
      'delivered_at',
      'supplier_group_id',
      'notes',
    ]),
    ...(source.status
      ? {
          status: pick(source.status, [
            'shipping_status',
            'shipping_status_label',
            'order_status',
            'order_status_label',
            'call_status',
            'call_status_label',
            'last_call_at',
            'postponed_note',
            'postponed_until',
            'financial_status',
            'financial_status_label',
            'hold_reason',
            'cancellation_reason',
            'return_reason',
            'commission_ready_at',
          ]),
        }
      : {}),
    ...(source.financials ? { financials: pick(source.financials, financial) } : {}),
    ...(source.store ? { store: pick(source.store, ['name', 'url']) } : {}),
    ...(source.shipping
      ? {
          shipping: pick(source.shipping, [
            'carrier',
            'tracking_number',
            'tracking_url',
            'delivery_warning',
            'delivery_agent_name',
            'delivery_agent_phone',
          ]),
        }
      : {}),
    ...(source.timestamps
      ? { timestamps: pick(source.timestamps, ['created_at', 'updated_at', 'delivered_at']) }
      : {}),
    ...(source.customer
      ? { customer: pick(source.customer, ['name', 'phone', 'city', 'address', 'notes']) }
      : {}),
    ...(Array.isArray(source.items)
      ? {
          items: source.items
            .slice(0, 30)
            .map((item: unknown) =>
              pick(item, [
                'product_id',
                'sku',
                'product_code',
                'name',
                'quantity',
                'selling_price',
                'retail_price',
                'fulfillment_price',
                'profit_per_unit',
                'subtotal',
              ]),
            ),
        }
      : {}),
  };
}
export function merchantQuote(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, any>;
  return {
    ...pick(source, [
      'success',
      'approved',
      'is_valid',
      'quote_id',
      'expires_at',
      'supplier_group_id',
      'code',
      'message',
      'currency',
      'total',
      'shipping',
      'subtotal',
    ]),
    ...(source.financials ? { financials: pick(source.financials, financial) } : {}),
    ...(source.destination
      ? {
          destination: pick(source.destination, [
            'city',
            'normalized_city',
            'input_city',
            'canonical_city',
            'zone_hub',
            'is_casablanca',
            'shipping_tier',
            'is_shipping_cost_final',
            'platform_shipping_cost',
            'delivery_warning',
          ]),
        }
      : {}),
    ...(source.safety_guarantee
      ? {
          safety_guarantee: pick(source.safety_guarantee, [
            'order_created',
            'stock_reserved',
            'shipping_label_issued',
          ]),
        }
      : {}),
    ...(source.validation ? { validation: pick(source.validation, ['reason', 'code']) } : {}),
    ...(Array.isArray(source.items)
      ? {
          items: source.items
            .slice(0, 30)
            .map((item: unknown) =>
              pick(item, ['sku', 'quantity', 'retail_price', 'fulfillment_price', 'subtotal']),
            ),
        }
      : {}),
  };
}
export function merchantQuoteProof(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, any>;
  return {
    ...pick(source, ['checked_at', 'request_fingerprint', 'approved', 'error']),
    raw: merchantQuote(source.raw),
  };
}
export function merchantCatalog(value: Record<string, any>): Record<string, any> {
  return {
    ...pick(value, [
      'product_id',
      'supplier_group_id',
      'supplier_key',
      'sku',
      'name',
      'parent_id',
      'parent_name',
      'description',
      'description_html',
      'html_description',
      'description_text',
      'plain_description',
      'category',
      'main_image',
      'fulfillment_price',
      'minimum_selling_price',
      'suggested_retail_price',
      'stock_quantity',
      'stock_status',
      'is_active',
      'created_at',
      'updated_at',
      'search_keywords',
    ]),
    ...Object.fromEntries(
      ['images', 'videos', 'keywords', 'tags'].flatMap((key) =>
        Array.isArray(value[key])
          ? [[key, value[key].filter((item: unknown) => typeof item === 'string').slice(0, 100)]]
          : [],
      ),
    ),
  };
}
