import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { FindPricingRulesQueryDto } from './dto/find-pricing-rules-query.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';
import { PricingType } from '../../common/enums/pricing-type.enum';
import {
  ServicePricingRule,
  ServicePricingRuleDocument,
} from './schemas/service-pricing-rule.schema';

@Injectable()
export class ServicePricingRulesService {
  constructor(
    @InjectModel(ServicePricingRule.name)
    private readonly ruleModel: Model<ServicePricingRuleDocument>,
  ) {}

  /** Public: the range is shown in the worker's price-setting UI, so it's never admin-only. */
  async findMany(query: FindPricingRulesQueryDto): Promise<ServicePricingRuleDocument[]> {
    const filter: Record<string, unknown> = { isActive: true, isDeleted: false };
    if (query.serviceId) filter.serviceId = query.serviceId;
    if (query.countryId) filter.countryId = query.countryId;
    return this.ruleModel.find(filter).exec();
  }

  /** Used by WorkerServicesService/PricingService — the one active rule for this exact combination, or null if the admin hasn't opened it. */
  async findActiveRule(
    serviceId: string,
    countryId: string,
    pricingType: PricingType,
  ): Promise<ServicePricingRuleDocument | null> {
    return this.ruleModel
      .findOne({ serviceId, countryId, pricingType, isActive: true, isDeleted: false })
      .exec();
  }

  /** Admin listing: includes soft-deleted/inactive rules. */
  async findAllForAdmin(): Promise<ServicePricingRuleDocument[]> {
    return this.ruleModel.find({}).exec();
  }

  async findOne(id: string): Promise<ServicePricingRuleDocument> {
    this.assertValidId(id);
    const rule = await this.ruleModel.findOne({ _id: id }).exec();
    if (!rule) {
      throw new NotFoundException(`Pricing rule ${id} not found`);
    }
    return rule;
  }

  async create(dto: CreatePricingRuleDto): Promise<ServicePricingRuleDocument> {
    if (dto.minPrice > dto.maxPrice) {
      throw new BadRequestException('minPrice must be <= maxPrice');
    }

    const existing = await this.ruleModel
      .findOne({
        serviceId: dto.serviceId,
        countryId: dto.countryId,
        pricingType: dto.pricingType,
        isDeleted: false,
      })
      .exec();
    if (existing) {
      throw new ConflictException(
        'A pricing rule already exists for this service/country/pricingType combination',
      );
    }

    return this.ruleModel.create(dto);
  }

  async update(id: string, dto: UpdatePricingRuleDto): Promise<ServicePricingRuleDocument> {
    const rule = await this.findOne(id);
    if (rule.isDeleted) {
      throw new NotFoundException(`Pricing rule ${id} not found`);
    }

    const nextMin = dto.minPrice ?? rule.minPrice;
    const nextMax = dto.maxPrice ?? rule.maxPrice;
    if (nextMin > nextMax) {
      throw new BadRequestException('minPrice must be <= maxPrice');
    }

    rule.set(dto);
    await rule.save();
    return rule;
  }

  async remove(id: string): Promise<void> {
    this.assertValidId(id);
    const result = await this.ruleModel
      .updateOne({ _id: id, isDeleted: false }, { isDeleted: true, deletedAt: new Date() })
      .exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException(`Pricing rule ${id} not found`);
    }
  }

  private assertValidId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Pricing rule ${id} not found`);
    }
  }
}
