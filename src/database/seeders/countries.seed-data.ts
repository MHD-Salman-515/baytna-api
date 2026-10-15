export interface CountryBookingPolicySeed {
  responseDeadlineHours: number;
  bookingHorizonDays: number;
  interBookingBufferMinutes: number;
  freeCancellationHours: number;
  cancellationFeeBasisPoints: number;
}

export interface CountrySeed {
  code: string;
  name: { ar: string; en: string };
  currencyCode: string;
  phonePrefix: string;
  enabledPaymentMethods: string[];
  commissionRate: number;
  timezone: string;
  bookingPolicy: CountryBookingPolicySeed;
  isActive: boolean;
}

// Same nominal policy for both markets for now — tune per-country once we
// have real cancellation/no-show data (this is exactly why it lives on the
// Country document and is admin-editable, not hardcoded in bookings code).
const DEFAULT_BOOKING_POLICY: CountryBookingPolicySeed = {
  responseDeadlineHours: 12,
  bookingHorizonDays: 90,
  interBookingBufferMinutes: 30,
  freeCancellationHours: 24,
  cancellationFeeBasisPoints: 2000,
};

export const countriesSeedData: CountrySeed[] = [
  {
    code: 'SY',
    name: { ar: 'سوريا', en: 'Syria' },
    currencyCode: 'SYP',
    phonePrefix: '+963',
    enabledPaymentMethods: ['CASH'],
    commissionRate: 1500,
    timezone: 'Asia/Damascus',
    bookingPolicy: DEFAULT_BOOKING_POLICY,
    isActive: true,
  },
  {
    code: 'IQ',
    name: { ar: 'العراق', en: 'Iraq' },
    currencyCode: 'IQD',
    phonePrefix: '+964',
    enabledPaymentMethods: ['CASH'],
    commissionRate: 1500,
    timezone: 'Asia/Baghdad',
    bookingPolicy: DEFAULT_BOOKING_POLICY,
    isActive: true,
  },
];
