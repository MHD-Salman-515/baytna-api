import { generateBookingNumber } from './generate-booking-number';

describe('generateBookingNumber', () => {
  it('matches the "BK-XXXXXX" shape using only the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateBookingNumber()).toMatch(/^BK-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    }
  });

  it('never contains visually ambiguous characters (0, O, 1, I)', () => {
    for (let i = 0; i < 200; i++) {
      const suffix = generateBookingNumber().slice(3);
      expect(suffix).not.toMatch(/[01OI]/);
    }
  });

  it('is not sequential or predictable between consecutive calls', () => {
    const numbers = Array.from({ length: 500 }, () => generateBookingNumber());
    const unique = new Set(numbers);
    // With a 32^6 space, 500 draws colliding would be astronomically unlikely.
    expect(unique.size).toBe(numbers.length);
  });
});
