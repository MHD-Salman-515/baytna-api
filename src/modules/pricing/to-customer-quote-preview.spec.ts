import { PricingType } from '../../common/enums/pricing-type.enum';
import { Quote } from './quote.interface';
import { toCustomerQuotePreview } from './to-customer-quote-preview';

describe('toCustomerQuotePreview', () => {
  const fullQuote: Quote = {
    basePrice: 10000,
    commissionAmount: 1500,
    workerEarnings: 8500,
    currency: 'SYP',
    breakdown: {
      pricingType: PricingType.HOURLY,
      mode: 'estimate',
      hourlyRate: 2000,
      hours: 5,
      commissionRateBasisPoints: 1500,
    },
  };

  it('returns exactly the allowlisted keys', () => {
    const preview = toCustomerQuotePreview(fullQuote);
    expect(Object.keys(preview).sort()).toEqual(
      ['currency', 'hours', 'price', 'pricingType', 'roomCount'].sort(),
    );
  });

  it('never includes commissionAmount, workerEarnings, or commissionRateBasisPoints', () => {
    const preview = toCustomerQuotePreview(fullQuote);
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain('1500');
    expect(serialized).not.toContain('8500');
    expect(serialized).not.toContain('commission');
  });

  it('maps basePrice to price', () => {
    expect(toCustomerQuotePreview(fullQuote).price).toBe(10000);
  });
});
