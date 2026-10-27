export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_HINT = '8 أحرف على الأقل، تتضمن حروفًا وأرقامًا.';
export function validNewPassword(value: string) {
  return (
    value.length >= PASSWORD_MIN_LENGTH &&
    value.length <= PASSWORD_MAX_LENGTH &&
    /\p{L}/u.test(value) &&
    /\p{N}/u.test(value)
  );
}
