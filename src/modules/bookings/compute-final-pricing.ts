import { PricingType } from '../../common/enums/pricing-type.enum';
import { roundHalfUpDivide } from '../pricing/round-half-up-divide';
import { BookingPricingSnapshot } from './schemas/booking.schema';

/**
 * Recomputes finalPricing from the booking's own FROZEN creation-time
 * snapshot — deliberately never re-fetches the worker's current
 * WorkerService rate, the service's current commission, or re-checks her
 * current availability (PricingService.recomputeFinal does all three,
 * which is exactly wrong here: a rate change — or her simply toggling
 * isAvailable off while she's out doing this very job — must never affect
 * a booking already in flight). HOURLY recomputes basePrice from the
 * actual elapsed hours (still clamped to the frozen minHours) at the
 * frozen rate; BY_SIZE and FIXED just carry the snapshot forward unchanged.
 */
export function computeFinalPricing(
  snapshot: BookingPricingSnapshot,
  actualElapsedHours: number,
): BookingPricingSnapshot {
  if (snapshot.pricingType !== PricingType.HOURLY) {
    return snapshot;
  }

  const rate = snapshot.hourlyRate as number;
  const minHours = snapshot.minHours as number;
  const hours = Math.max(actualElapsedHours, minHours);
  const basePrice = Math.round(rate * hours);
  const commissionAmount = roundHalfUpDivide(basePrice * snapshot.commissionRate, 10000);
  const workerEarnings = basePrice - commissionAmount;

  return {
    pricingType: snapshot.pricingType,
    hours,
    roomCount: null,
    basePrice,
    commissionRate: snapshot.commissionRate,
    commissionAmount,
    workerEarnings,
    currency: snapshot.currency,
    hourlyRate: rate,
    minHours,
  };
}
