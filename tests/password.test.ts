import { expect, it } from 'vitest';
import { validNewPassword } from '../src/shared/password';
it('accepts a normal eight-character password with letters and digits, including Arabic', () => {
  expect(validNewPassword('Store123')).toBe(true);
  expect(validNewPassword('متجرنا١٢')).toBe(true);
  expect(validNewPassword('Boutique2026')).toBe(true);
  for (const value of ['Short12', '12345678', 'abcdefgh', 'a'.repeat(129) + '1'])
    expect(validNewPassword(value)).toBe(false);
});
