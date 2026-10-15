import { randomBytes } from 'crypto';

// Excludes visually ambiguous characters (0/O, 1/I) — a support agent reads
// this aloud to a customer over the phone.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const SUFFIX_LENGTH = 6;

/**
 * "BK-XXXXXX", random (crypto, not Math.random) and never sequential — a
 * booking number alone must never let anyone infer how many bookings exist.
 * Collisions are possible (32^6 ≈ 1.07 billion combinations) but vanishingly
 * rare; BookingsService retries on the unique-index violation rather than
 * this function trying to guarantee uniqueness itself.
 */
export function generateBookingNumber(): string {
  const bytes = randomBytes(SUFFIX_LENGTH);
  let suffix = '';
  for (const byte of bytes) {
    suffix += ALPHABET[byte % ALPHABET.length];
  }
  return `BK-${suffix}`;
}
