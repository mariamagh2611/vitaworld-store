/** Keep configured copy separate from the actual shipping calculation. */
export function productDeliveryText(template: string, casa: string, other: string) {
  return template.replaceAll('{casa}', casa).replaceAll('{other}', other);
}
