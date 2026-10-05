import { PricingType } from '../../common/enums/pricing-type.enum';

export interface QuoteBreakdown {
  pricingType: PricingType;
  mode: 'estimate' | 'final';
  hourlyRate?: number;
  hours?: number;
  roomCount?: number;
  tierMaxRooms?: number;
  commissionRateBasisPoints: number;
}

/**
 * The full internal representation — includes commissionAmount and
 * workerEarnings, which must NEVER reach a customer-facing response as-is.
 * See toCustomerQuotePreview() for the filtered, customer-safe projection.
 */
export interface Quote {
  basePrice: number;
  commissionAmount: number;
  workerEarnings: number;
  currency: string;
  breakdown: QuoteBreakdown;
}

export interface QuoteParams {
  estimatedHours?: number;
  roomCount?: number;
}
