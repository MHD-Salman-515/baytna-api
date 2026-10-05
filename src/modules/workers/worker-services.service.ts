import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { CountriesService } from '../countries/countries.service';
import { ServicePricingRuleDocument } from '../services/schemas/service-pricing-rule.schema';
import { ServicePricingRulesService } from '../services/service-pricing-rules.service';
import { ServicesService } from '../services/services.service';
import { CreateWorkerServiceDto } from './dto/create-worker-service.dto';
import { UpdateWorkerServiceDto } from './dto/update-worker-service.dto';
import {
  BySizePricing,
  FixedPricing,
  HourlyPricing,
  WorkerService,
  WorkerServiceDocument,
} from './schemas/worker-service.schema';

interface HourlyPricingInput {
  rate: number;
  minHours: number;
}
interface SizeTierInput {
  maxRooms: number;
  price: number;
}
interface BySizePricingInput {
  tiers: SizeTierInput[];
}
interface FixedPricingInput {
  price: number;
}
interface WorkerServicePricingInput {
  serviceId: string;
  pricingType: PricingType;
  hourly?: HourlyPricingInput;
  bySize?: BySizePricingInput;
  fixed?: FixedPricingInput;
  currency?: string;
}
interface ResolvedPricing {
  hourly: HourlyPricing | null;
  bySize: BySizePricing | null;
  fixed: FixedPricing | null;
  currency: string;
}

@Injectable()
export class WorkerServicesService {
  constructor(
    @InjectModel(WorkerService.name)
    private readonly workerServiceModel: Model<WorkerServiceDocument>,
    private readonly servicesService: ServicesService,
    private readonly pricingRulesService: ServicePricingRulesService,
    private readonly countriesService: CountriesService,
  ) {}

  async listOwn(workerProfileId: string): Promise<WorkerServiceDocument[]> {
    return this.workerServiceModel.find({ workerProfileId, isDeleted: false }).exec();
  }

  /** Admin visibility: no isDeleted filter, consistent with every other admin read in this app. */
  async listForAdmin(workerProfileId: string): Promise<WorkerServiceDocument[]> {
    return this.workerServiceModel.find({ workerProfileId }).exec();
  }

  /**
   * Used by PricingService — not scoped to "her own", since any customer may
   * request a quote for any (visible) worker's offering. Keeps the pricing
   * module from needing direct access to the WorkerService Mongoose model,
   * going through this module's own public API instead.
   */
  async findActiveById(workerServiceId: string): Promise<WorkerServiceDocument> {
    const workerService = await this.workerServiceModel
      .findOne({ _id: workerServiceId, isActive: true, isDeleted: false })
      .exec();
    if (!workerService) {
      throw new NotFoundException('Worker service not found');
    }
    return workerService;
  }

  async create(
    workerProfileId: string,
    countryId: string,
    dto: CreateWorkerServiceDto,
  ): Promise<WorkerServiceDocument> {
    const existing = await this.workerServiceModel
      .findOne({ workerProfileId, serviceId: dto.serviceId, isDeleted: false })
      .exec();
    if (existing) {
      throw new ConflictException(
        'You already offer this service — update it instead of creating a duplicate',
      );
    }

    const resolved = await this.validateAndResolvePricing(dto, countryId);

    return this.workerServiceModel.create({
      workerProfileId,
      serviceId: dto.serviceId,
      pricingType: dto.pricingType,
      ...resolved,
      isActive: true,
    });
  }

  async update(
    workerProfileId: string,
    countryId: string,
    workerServiceId: string,
    dto: UpdateWorkerServiceDto,
  ): Promise<WorkerServiceDocument> {
    const existing = await this.workerServiceModel
      .findOne({ _id: workerServiceId, workerProfileId, isDeleted: false })
      .exec();
    if (!existing) {
      throw new NotFoundException('Worker service not found');
    }

    const pricingType = dto.pricingType ?? existing.pricingType;
    // Keep her existing pricing block only if the pricing type itself is
    // unchanged — switching HOURLY -> FIXED (etc.) always requires a fresh
    // block for the new type, never a leftover one from the old type.
    const keepExisting = pricingType === existing.pricingType;
    const merged: WorkerServicePricingInput = {
      serviceId: existing.serviceId.toString(),
      pricingType,
      hourly: dto.hourly ?? (keepExisting ? (existing.hourly ?? undefined) : undefined),
      bySize: dto.bySize ?? (keepExisting ? (existing.bySize ?? undefined) : undefined),
      fixed: dto.fixed ?? (keepExisting ? (existing.fixed ?? undefined) : undefined),
    };

    const resolved = await this.validateAndResolvePricing(merged, countryId);

    existing.pricingType = pricingType;
    existing.hourly = resolved.hourly;
    existing.bySize = resolved.bySize;
    existing.fixed = resolved.fixed;
    // currency is deliberately never touched here — see the schema comment.
    if (dto.isActive !== undefined) {
      existing.isActive = dto.isActive;
    }
    await existing.save();
    return existing;
  }

  async delete(workerProfileId: string, workerServiceId: string): Promise<void> {
    const result = await this.workerServiceModel
      .updateOne(
        { _id: workerServiceId, workerProfileId, isDeleted: false },
        { isDeleted: true, deletedAt: new Date() },
      )
      .exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException('Worker service not found');
    }
  }

  /**
   * Every rule this method enforces is a service-layer rule, not just a DTO
   * shape check: the pricing type must be one the service allows, a price
   * range must actually exist for (service, country, pricingType) or she
   * can't price it at all, every price must fall inside that range, and an
   * explicit currency must match her country's.
   */
  private async validateAndResolvePricing(
    dto: WorkerServicePricingInput,
    countryId: string,
  ): Promise<ResolvedPricing> {
    const service = await this.servicesService.findActiveById(dto.serviceId);
    if (!service.allowedPricingTypes.includes(dto.pricingType)) {
      throw new BadRequestException(
        `${dto.pricingType} is not an allowed pricing type for ${service.key} (allowed: ${service.allowedPricingTypes.join(', ')})`,
      );
    }

    const country = await this.countriesService.findActiveById(countryId);
    if (dto.currency && dto.currency.toUpperCase() !== country.currencyCode) {
      throw new BadRequestException(
        `currency must be ${country.currencyCode} for your country, got ${dto.currency}`,
      );
    }

    const rule = await this.pricingRulesService.findActiveRule(
      dto.serviceId,
      countryId,
      dto.pricingType,
    );
    if (!rule) {
      throw new BadRequestException(
        `${service.key} is not yet available for ${dto.pricingType} pricing in your country`,
      );
    }

    switch (dto.pricingType) {
      case PricingType.HOURLY:
        return {
          ...this.resolveHourly(dto, rule),
          bySize: null,
          fixed: null,
          currency: country.currencyCode,
        };
      case PricingType.BY_SIZE:
        return {
          ...this.resolveBySize(dto, rule),
          hourly: null,
          fixed: null,
          currency: country.currencyCode,
        };
      case PricingType.FIXED:
        return {
          ...this.resolveFixed(dto, rule),
          hourly: null,
          bySize: null,
          currency: country.currencyCode,
        };
    }
  }

  private resolveHourly(
    dto: WorkerServicePricingInput,
    rule: ServicePricingRuleDocument,
  ): { hourly: HourlyPricing } {
    if (!dto.hourly) {
      throw new BadRequestException('hourly pricing details are required for pricingType HOURLY');
    }
    if (dto.bySize || dto.fixed) {
      throw new BadRequestException(
        'only hourly pricing details may be set for pricingType HOURLY',
      );
    }
    if (dto.hourly.minHours < 1) {
      throw new BadRequestException('minHours must be >= 1');
    }
    this.assertInRange(dto.hourly.rate, rule, 'rate');
    return { hourly: dto.hourly };
  }

  private resolveBySize(
    dto: WorkerServicePricingInput,
    rule: ServicePricingRuleDocument,
  ): { bySize: BySizePricing } {
    if (!dto.bySize) {
      throw new BadRequestException('bySize pricing details are required for pricingType BY_SIZE');
    }
    if (dto.hourly || dto.fixed) {
      throw new BadRequestException(
        'only bySize pricing details may be set for pricingType BY_SIZE',
      );
    }
    this.assertValidTiers(dto.bySize.tiers, rule);
    return { bySize: dto.bySize };
  }

  private resolveFixed(
    dto: WorkerServicePricingInput,
    rule: ServicePricingRuleDocument,
  ): { fixed: FixedPricing } {
    if (!dto.fixed) {
      throw new BadRequestException('fixed pricing details are required for pricingType FIXED');
    }
    if (dto.hourly || dto.bySize) {
      throw new BadRequestException('only fixed pricing details may be set for pricingType FIXED');
    }
    this.assertInRange(dto.fixed.price, rule, 'price');
    return { fixed: dto.fixed };
  }

  private assertInRange(price: number, rule: ServicePricingRuleDocument, label: string): void {
    if (price < rule.minPrice || price > rule.maxPrice) {
      throw new BadRequestException(
        `${label} must be between ${rule.minPrice} and ${rule.maxPrice} (inclusive)`,
      );
    }
  }

  /**
   * Strictly ascending maxRooms with no duplicates. There is no separate
   * "gap" check: each tier only carries an upper bound (maxRooms), so every
   * room count from 1 up to the top tier's maxRooms is covered by exactly
   * one tier the moment the sequence is strictly ascending — a "gap" simply
   * isn't representable in this schema.
   */
  private assertValidTiers(tiers: SizeTierInput[], rule: ServicePricingRuleDocument): void {
    if (!tiers || tiers.length === 0) {
      throw new BadRequestException('at least one tier is required for BY_SIZE pricing');
    }
    let previousMaxRooms = 0;
    for (const tier of tiers) {
      if (tier.maxRooms <= previousMaxRooms) {
        throw new BadRequestException(
          'tiers must have strictly ascending maxRooms with no duplicates',
        );
      }
      this.assertInRange(tier.price, rule, `the price for up to ${tier.maxRooms} rooms`);
      previousMaxRooms = tier.maxRooms;
    }
  }
}
