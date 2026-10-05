import { PricingType } from '../../common/enums/pricing-type.enum';

export interface ServiceSeed {
  key: string;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  allowedPricingTypes: PricingType[];
  commissionRate: number | null;
  isActive: boolean;
  displayOrder: number;
}

export const servicesSeedData: ServiceSeed[] = [
  {
    key: 'CLEANING',
    name: { ar: 'تنظيف', en: 'Cleaning' },
    description: { ar: 'تنظيف المنزل الشامل', en: 'General home cleaning' },
    allowedPricingTypes: [PricingType.HOURLY, PricingType.BY_SIZE],
    commissionRate: null, // falls back to the country's commissionRate
    isActive: true,
    displayOrder: 1,
  },
  {
    key: 'COOKING',
    name: { ar: 'طبخ', en: 'Cooking' },
    description: { ar: 'تحضير وجبات منزلية', en: 'Home meal preparation' },
    allowedPricingTypes: [PricingType.HOURLY, PricingType.FIXED],
    commissionRate: null,
    isActive: true,
    displayOrder: 2,
  },
  {
    key: 'IRONING',
    name: { ar: 'كوي الملابس', en: 'Ironing' },
    description: { ar: 'كوي وطي الملابس', en: 'Clothes ironing and folding' },
    allowedPricingTypes: [PricingType.HOURLY, PricingType.FIXED],
    commissionRate: null,
    isActive: true,
    displayOrder: 3,
  },
];
