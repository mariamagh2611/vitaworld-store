import type { Settings } from './types';

export const policyKeys = ['terms', 'privacy', 'returns', 'contact'] as const;
export type PolicyKey = (typeof policyKeys)[number];
export const policyLabels: Record<PolicyKey, string> = {
  terms: 'الشروط',
  privacy: 'الخصوصية',
  returns: 'الاسترجاع',
  contact: 'اتصل بنا',
};

export function policyVisible(s: Pick<Settings, 'policyVisibility'>, key: PolicyKey): boolean {
  return s.policyVisibility?.[key] !== false;
}
