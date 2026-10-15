import { PricingType } from '../../common/enums/pricing-type.enum';
import { computeFinalPricing } from './compute-final-pricing';
import { BookingPricingSnapshot } from './schemas/booking.schema';

function hourlySnapshot(overrides: Partial<BookingPricingSnapshot> = {}): BookingPricingSnapshot {
  return {
    pricingType: PricingType.HOURLY,
    hours: 3,
    roomCount: null,
    basePrice: 9000,
    commissionRate: 1500,
    commissionAmount: 1350,
    workerEarnings: 7650,
    currency: 'SYP',
    hourlyRate: 3000,
    minHours: 2,
    ...overrides,
  };
}

describe('computeFinalPricing', () => {
  it('BY_SIZE carries the original snapshot forward unchanged', () => {
    const snapshot: BookingPricingSnapshot = {
      pricingType: PricingType.BY_SIZE,
      hours: null,
      roomCount: 3,
      basePrice: 20000,
      commissionRate: 1500,
      commissionAmount: 3000,
      workerEarnings: 17000,
      currency: 'SYP',
      hourlyRate: null,
      minHours: null,
    };
    expect(computeFinalPricing(snapshot, 5)).toEqual(snapshot);
  });

  it('FIXED carries the original snapshot forward unchanged', () => {
    const snapshot: BookingPricingSnapshot = {
      pricingType: PricingType.FIXED,
      hours: null,
      roomCount: null,
      basePrice: 15000,
      commissionRate: 1500,
      commissionAmount: 2250,
      workerEarnings: 12750,
      currency: 'SYP',
      hourlyRate: null,
      minHours: null,
    };
    expect(computeFinalPricing(snapshot, 5)).toEqual(snapshot);
  });

  it('HOURLY recomputes basePrice from actual elapsed hours at the frozen rate', () => {
    const result = computeFinalPricing(hourlySnapshot(), 4);

    expect(result.hours).toBe(4);
    expect(result.basePrice).toBe(12000); // 3000 * 4
    expect(result.commissionAmount).toBe(1800); // 15% of 12000
    expect(result.workerEarnings).toBe(10200);
    expect(result.commissionAmount + result.workerEarnings).toBe(result.basePrice);
  });

  it('clamps actual elapsed hours below minHours up to minHours', () => {
    const result = computeFinalPricing(hourlySnapshot({ minHours: 2 }), 0.5);

    expect(result.hours).toBe(2);
    expect(result.basePrice).toBe(6000); // 3000 * 2, not 3000 * 0.5
  });

  it('is unaffected by a rate stored on a different snapshot (immutability — never re-reads any live rate)', () => {
    const snapshot = hourlySnapshot({ hourlyRate: 3000, commissionRate: 1500 });
    const result = computeFinalPricing(snapshot, 3);
    // Even though "the worker's current rate" might now be, say, 9000, this
    // function never looks at anything but the snapshot passed in.
    expect(result.hourlyRate).toBe(3000);
    expect(result.basePrice).toBe(9000);
  });

  it('rounds a fractional basePrice to the nearest integer (money is always integer)', () => {
    const result = computeFinalPricing(hourlySnapshot({ hourlyRate: 3333, minHours: 1 }), 1.5);
    expect(result.basePrice).toBe(Math.round(3333 * 1.5));
    expect(Number.isInteger(result.basePrice)).toBe(true);
    expect(result.commissionAmount + result.workerEarnings).toBe(result.basePrice);
  });
});
