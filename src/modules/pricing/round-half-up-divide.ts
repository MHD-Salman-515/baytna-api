/**
 * Integer division with round-half-up, avoiding any fractional-comparison
 * near the .5 boundary: the quotient comes from a single float division
 * (safe for any numerator/denominator within Number.MAX_SAFE_INTEGER — JS
 * doubles represent integers up to 2^53 exactly), but the ROUNDING DECISION
 * itself is an exact integer comparison (remainder*2 vs denominator), never
 * a float comparison that could be thrown off by representation error.
 */
export function roundHalfUpDivide(numerator: number, denominator: number): number {
  const quotient = Math.trunc(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}
