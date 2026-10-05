import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { CountriesService } from '../countries/countries.service';
import { ServicesService } from '../services/services.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { WorkerServicesService } from '../workers/worker-services.service';
import { Quote, QuoteParams } from './quote.interface';
import { roundHalfUpDivide } from './round-half-up-divide';

/**
 * The ONLY place pricing maths lives — bookings (a later phase) call this
 * too, so every rule (commission fallback, rounding, tier resolution) is
 * defined exactly once, here.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly workerServicesService: WorkerServicesService,
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly servicesService: ServicesService,
    private readonly countriesService: CountriesService,
  ) {}

  /** Pre-booking estimate — the price may still change (e.g. HOURLY, before actual hours are known). */
  async quote(workerServiceId: string, params: QuoteParams): Promise<Quote> {
    return this.computeQuote(workerServiceId, params, 'estimate');
  }

  /**
   * Post-completion recompute with actual values — same maths as quote(),
   * different mode label. No booking phase calls this yet; it exists now so
   * that phase only ever has one pricing entry point to call, never its own
   * copy of this arithmetic.
   */
  async recomputeFinal(workerServiceId: string, params: QuoteParams): Promise<Quote> {
    return this.computeQuote(workerServiceId, params, 'final');
  }

  private async computeQuote(
    workerServiceId: string,
    params: QuoteParams,
    mode: 'estimate' | 'final',
  ): Promise<Quote> {
    const workerService = await this.workerServicesService.findActiveById(workerServiceId);

    // Same visibility gate as the public listing — a quote must never exist
    // for a worker a customer couldn't otherwise see.
    const profile = await this.workerProfilesService.findApprovedById(
      workerService.workerProfileId.toString(),
    );
    if (!profile) {
      throw new NotFoundException('Worker service not found');
    }

    let basePrice: number;
    const breakdown: Quote['breakdown'] = {
      pricingType: workerService.pricingType,
      mode,
      commissionRateBasisPoints: 0, // filled in below, once we know the rate
    };

    switch (workerService.pricingType) {
      case PricingType.HOURLY: {
        const minHours = workerService.hourly!.minHours;
        const hours = Math.max(params.estimatedHours ?? minHours, minHours);
        basePrice = workerService.hourly!.rate * hours;
        breakdown.hourlyRate = workerService.hourly!.rate;
        breakdown.hours = hours;
        break;
      }
      case PricingType.BY_SIZE: {
        const roomCount = params.roomCount;
        if (!roomCount || roomCount < 1) {
          throw new BadRequestException('roomCount is required for BY_SIZE pricing');
        }
        const tiers = workerService.bySize!.tiers;
        const tier = tiers.find((t) => t.maxRooms >= roomCount);
        if (!tier) {
          const topTier = tiers[tiers.length - 1];
          throw new BadRequestException(
            `roomCount exceeds the highest tier (max ${topTier.maxRooms} rooms)`,
          );
        }
        basePrice = tier.price;
        breakdown.roomCount = roomCount;
        breakdown.tierMaxRooms = tier.maxRooms;
        break;
      }
      case PricingType.FIXED: {
        basePrice = workerService.fixed!.price;
        break;
      }
    }

    const service = await this.servicesService.findActiveById(workerService.serviceId.toString());
    const country = await this.countriesService.findActiveById(profile.countryId.toString());
    const commissionRateBasisPoints = service.commissionRate ?? country.commissionRate;
    breakdown.commissionRateBasisPoints = commissionRateBasisPoints;

    const commissionAmount = roundHalfUpDivide(basePrice * commissionRateBasisPoints, 10000);
    const workerEarnings = basePrice - commissionAmount;

    return {
      basePrice,
      commissionAmount,
      workerEarnings,
      currency: workerService.currency,
      breakdown,
    };
  }
}
