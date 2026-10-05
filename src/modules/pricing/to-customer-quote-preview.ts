import { Quote } from './quote.interface';

export interface CustomerQuotePreview {
  price: number;
  currency: string;
  pricingType: Quote['breakdown']['pricingType'];
  hours?: number;
  roomCount?: number;
}

/**
 * The only shape a quote may take once it's headed to a customer. Same
 * allowlist discipline as toPublicWorkerProfile() in the workers module:
 * commissionAmount, workerEarnings, and commissionRateBasisPoints have no
 * code path into this object, named field by field, not spread from the
 * internal Quote.
 */
export function toCustomerQuotePreview(quote: Quote): CustomerQuotePreview {
  return {
    price: quote.basePrice,
    currency: quote.currency,
    pricingType: quote.breakdown.pricingType,
    hours: quote.breakdown.hours,
    roomCount: quote.breakdown.roomCount,
  };
}
