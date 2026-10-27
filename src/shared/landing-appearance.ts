import { localizedForm } from './i18n';
import {
  defaults,
  type FormContent,
  type LandingFormAppearance,
  type Product,
  type Settings,
} from './types';

export const landingAppearanceLabels: Record<keyof LandingFormAppearance, string> = {
  background: 'خلفية منطقة الطلب',
  surface: 'خلفية الاستمارة والملخص والباقات',
  text: 'لون العناوين والنصوص',
  muted: 'لون النصوص الثانوية',
  fieldBackground: 'خلفية الخانات',
  fieldText: 'لون النص داخل الخانات',
  placeholder: 'لون النص الإرشادي داخل الخانات',
  border: 'لون حدود الخانات والبطاقات',
  accent: 'لون تحديد الباقة المختارة',
  buttonBackground: 'خلفية زر تأكيد الطلب',
  buttonText: 'لون نص زر تأكيد الطلب',
};

/** Old formColor belongs to the landing form; ordinary checkout uses the store theme. */
export function landingFormAppearance(p: Product, s: Settings): LandingFormAppearance {
  const theme = { ...defaults.theme, ...s.theme };
  return {
    background: p.formColor && p.formColor !== '#f3f0e9' ? p.formColor : theme.background,
    surface: theme.surface,
    text: theme.text,
    muted: theme.muted,
    fieldBackground: theme.surface,
    fieldText: theme.text,
    placeholder: theme.muted,
    border: theme.line,
    accent: theme.primary,
    buttonBackground: theme.primary,
    buttonText: '#ffffff',
    ...p.presentation?.landingFormAppearance,
  };
}

/** Empty text hides the badge; retain settings saved by the previous editor. */
export function landingBadgeText(p: Product | undefined, content: FormContent, s: Settings) {
  const standard = localizedForm(s).codBadgeText;
  if (p?.pageMode !== 'landing') return standard;
  const value =
    content.codBadgeText ??
    (p.presentation?.landingCodBadge?.visible === false
      ? ''
      : (p.presentation?.landingCodBadge?.text ?? standard));
  return localizedForm(s, { codBadgeText: value }).codBadgeText;
}
