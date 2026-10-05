import { roundHalfUpDivide } from './round-half-up-divide';

describe('roundHalfUpDivide', () => {
  it("rounds exact .5 up, not to even (banker's rounding) and not down", () => {
    expect(roundHalfUpDivide(1, 2)).toBe(1); // 0.5 -> 1
    expect(roundHalfUpDivide(3, 2)).toBe(2); // 1.5 -> 2
    expect(roundHalfUpDivide(5, 2)).toBe(3); // 2.5 -> 3 (banker's rounding would give 2)
  });

  it('rounds down below .5 and up above .5', () => {
    expect(roundHalfUpDivide(4, 10)).toBe(0); // 0.4 -> 0
    expect(roundHalfUpDivide(6, 10)).toBe(1); // 0.6 -> 1
  });

  it('is exact with no remainder', () => {
    expect(roundHalfUpDivide(100, 10)).toBe(10);
    expect(roundHalfUpDivide(0, 10)).toBe(0);
  });

  describe('commission arithmetic — basis points out of 10000', () => {
    it.each([
      [100, 1500], // 15% of 100 = 15 exactly
      [7, 1500], // 7 * 0.15 = 1.05 -> 1
      [1, 5000], // 0.5 -> 1
      [3, 5000], // 1.5 -> 2
      [33, 3333], // awkward: 1.0999 -> 1
      [12345, 1234], // awkward large numbers
      [999999, 9999], // near the top of both ranges
      [1, 1], // 0.0001 -> 0
      [10000, 1], // 1.0 exactly
    ])(
      'basePrice=%i rateBasisPoints=%i: commission + earnings === basePrice',
      (basePrice, rate) => {
        const commission = roundHalfUpDivide(basePrice * rate, 10000);
        const earnings = basePrice - commission;
        expect(commission + earnings).toBe(basePrice);
        expect(commission).toBeGreaterThanOrEqual(0);
        expect(earnings).toBeGreaterThanOrEqual(0);
      },
    );

    it('holds for a wide random spread of awkward numbers', () => {
      for (let i = 0; i < 500; i++) {
        const basePrice = Math.floor(Math.random() * 10_000_000);
        const rate = Math.floor(Math.random() * 10001); // 0..10000 inclusive
        const commission = roundHalfUpDivide(basePrice * rate, 10000);
        const earnings = basePrice - commission;
        expect(commission + earnings).toBe(basePrice);
      }
    });
  });
});
