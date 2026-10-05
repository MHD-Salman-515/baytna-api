import { PricingType } from '../../common/enums/pricing-type.enum';
import { getDisplayPrice } from './get-display-price';

describe('getDisplayPrice', () => {
  it('returns the hourly rate for HOURLY', () => {
    expect(
      getDisplayPrice({
        pricingType: PricingType.HOURLY,
        hourly: { rate: 2000, minHours: 2 },
        bySize: null,
        fixed: null,
      }),
    ).toBe(2000);
  });

  it('returns the cheapest (first) tier price for BY_SIZE', () => {
    expect(
      getDisplayPrice({
        pricingType: PricingType.BY_SIZE,
        hourly: null,
        bySize: {
          tiers: [
            { maxRooms: 2, price: 3000 },
            { maxRooms: 5, price: 6000 },
          ],
        },
        fixed: null,
      }),
    ).toBe(3000);
  });

  it('returns the flat price for FIXED', () => {
    expect(
      getDisplayPrice({
        pricingType: PricingType.FIXED,
        hourly: null,
        bySize: null,
        fixed: { price: 10000 },
      }),
    ).toBe(10000);
  });
});
