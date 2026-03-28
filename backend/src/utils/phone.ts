/**
 * Normalizes a Rwandan phone number to +250XXXXXXXXX format.
 *
 * Accepts (with optional spaces, dashes, parentheses, or dots):
 *   +250788123456  →  +250788123456
 *   250788123456   →  +250788123456
 *   0788123456     →  +250788123456
 *
 * Throws if the number cannot be normalised. 9-digit inputs without a
 * leading 0 (e.g. 788123456) throw a user-friendly message asking for
 * the leading 0.
 */
export function normalizePhone(raw: string): string {
  // Strip separators (spaces, dashes, parentheses, dots) but keep digits and leading +
  const cleaned = raw.replace(/[\s\-().]/g, '');
  const digits  = cleaned.replace(/^\+/, '');

  // Full E.164 already: +250XXXXXXXXX (13 chars = '+' + 12 digits)
  if (cleaned.startsWith('+250') && cleaned.length === 13) return cleaned;

  // Country code without +: 250XXXXXXXXX (12 digits)
  if (digits.startsWith('250') && digits.length === 12) return `+${digits}`;

  // Local with leading 0: 0XXXXXXXXX (10 digits)
  if (digits.startsWith('0') && digits.length === 10) return `+250${digits.slice(1)}`;

  // 9 digits with no leading 0 — probably forgot the leading 0
  if (!digits.startsWith('0') && !digits.startsWith('250') && digits.length === 9) {
    throw new Error('Please include the leading 0 — e.g. 0700 000 000');
  }

  throw new Error('Invalid phone number format');
}

/**
 * Returns true if phone is already in valid E.164 Rwandan format (+250XXXXXXXXX).
 * Use after normalizePhone to confirm the result is well-formed.
 */
export function validatePhone(phone: string): boolean {
  return /^\+250\d{9}$/.test(phone);
}
