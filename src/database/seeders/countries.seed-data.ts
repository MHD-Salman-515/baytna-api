export interface CountrySeed {
  code: string;
  name: { ar: string; en: string };
  currencyCode: string;
  phonePrefix: string;
  enabledPaymentMethods: string[];
  commissionRate: number;
  isActive: boolean;
}

export const countriesSeedData: CountrySeed[] = [
  {
    code: 'SY',
    name: { ar: 'سوريا', en: 'Syria' },
    currencyCode: 'SYP',
    phonePrefix: '+963',
    enabledPaymentMethods: ['CASH'],
    commissionRate: 1500,
    isActive: true,
  },
  {
    code: 'IQ',
    name: { ar: 'العراق', en: 'Iraq' },
    currencyCode: 'IQD',
    phonePrefix: '+964',
    enabledPaymentMethods: ['CASH'],
    commissionRate: 1500,
    isActive: true,
  },
];
