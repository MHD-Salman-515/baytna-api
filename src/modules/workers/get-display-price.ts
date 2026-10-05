import { PricingType } from '../../common/enums/pricing-type.enum';
import { BySizePricing, FixedPricing, HourlyPricing } from './schemas/worker-service.schema';

export interface DisplayPriceInput {
  pricingType: PricingType;
  hourly: HourlyPricing | null;
  bySize: BySizePricing | null;
  fixed: FixedPricing | null;
}

/**
 * The single number shown for a worker's offering before any booking exists
 * — the rate for HOURLY, the cheapest ("starting from") tier for BY_SIZE, or
 * the flat price for FIXED. Pure and DI-free on purpose: both
 * PublicWorkersService (same module) and PricingService (a different
 * module) need this, and importing a plain function doesn't risk a circular
 * module dependency the way importing each other's services would.
 */
export function getDisplayPrice(workerService: DisplayPriceInput): number {
  switch (workerService.pricingType) {
    case PricingType.HOURLY:
      return workerService.hourly!.rate;
    case PricingType.BY_SIZE:
      // tiers are validated ascending-by-maxRooms at write time, so [0] is
      // always the cheapest tier.
      return workerService.bySize!.tiers[0].price;
    case PricingType.FIXED:
      return workerService.fixed!.price;
  }
}
