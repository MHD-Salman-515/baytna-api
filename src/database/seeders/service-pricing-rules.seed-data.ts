import { PricingType } from '../../common/enums/pricing-type.enum';

export interface PricingRuleSeed {
  serviceKey: string;
  countryCode: string;
  pricingType: PricingType;
  minPrice: number;
  maxPrice: number;
  unit: string;
}

/**
 * PLACEHOLDER RANGES — round numbers picked to be plausible-looking in SYP
 * and IQD, NOT real market research. An admin must replace every one of
 * these (via the admin pricing-rules endpoints) with real values before
 * launch — do not ship these to production as-is.
 */
export const servicePricingRulesSeedData: PricingRuleSeed[] = [
  // --- Syria (SYP) ---
  {
    serviceKey: 'CLEANING',
    countryCode: 'SY',
    pricingType: PricingType.HOURLY,
    minPrice: 5000,
    maxPrice: 20000,
    unit: 'hour',
  },
  {
    serviceKey: 'CLEANING',
    countryCode: 'SY',
    pricingType: PricingType.BY_SIZE,
    minPrice: 10000,
    maxPrice: 80000,
    unit: 'job',
  },
  {
    serviceKey: 'COOKING',
    countryCode: 'SY',
    pricingType: PricingType.HOURLY,
    minPrice: 5000,
    maxPrice: 15000,
    unit: 'hour',
  },
  {
    serviceKey: 'COOKING',
    countryCode: 'SY',
    pricingType: PricingType.FIXED,
    minPrice: 10000,
    maxPrice: 50000,
    unit: 'job',
  },
  {
    serviceKey: 'IRONING',
    countryCode: 'SY',
    pricingType: PricingType.HOURLY,
    minPrice: 3000,
    maxPrice: 10000,
    unit: 'hour',
  },
  {
    serviceKey: 'IRONING',
    countryCode: 'SY',
    pricingType: PricingType.FIXED,
    minPrice: 5000,
    maxPrice: 25000,
    unit: 'job',
  },

  // --- Iraq (IQD) ---
  {
    serviceKey: 'CLEANING',
    countryCode: 'IQ',
    pricingType: PricingType.HOURLY,
    minPrice: 5000,
    maxPrice: 20000,
    unit: 'hour',
  },
  {
    serviceKey: 'CLEANING',
    countryCode: 'IQ',
    pricingType: PricingType.BY_SIZE,
    minPrice: 10000,
    maxPrice: 80000,
    unit: 'job',
  },
  {
    serviceKey: 'COOKING',
    countryCode: 'IQ',
    pricingType: PricingType.HOURLY,
    minPrice: 5000,
    maxPrice: 15000,
    unit: 'hour',
  },
  {
    serviceKey: 'COOKING',
    countryCode: 'IQ',
    pricingType: PricingType.FIXED,
    minPrice: 10000,
    maxPrice: 50000,
    unit: 'job',
  },
  {
    serviceKey: 'IRONING',
    countryCode: 'IQ',
    pricingType: PricingType.HOURLY,
    minPrice: 3000,
    maxPrice: 10000,
    unit: 'hour',
  },
  {
    serviceKey: 'IRONING',
    countryCode: 'IQ',
    pricingType: PricingType.FIXED,
    minPrice: 5000,
    maxPrice: 25000,
    unit: 'job',
  },
];
