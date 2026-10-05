import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { ServicePricingRule } from './schemas/service-pricing-rule.schema';
import { ServicePricingRulesService } from './service-pricing-rules.service';

describe('ServicePricingRulesService', () => {
  let service: ServicePricingRulesService;
  let model: { find: jest.Mock; findOne: jest.Mock; updateOne: jest.Mock; create: jest.Mock };

  const validId = new Types.ObjectId().toString();
  const serviceId = new Types.ObjectId().toString();
  const countryId = new Types.ObjectId().toString();

  beforeEach(async () => {
    model = { find: jest.fn(), findOne: jest.fn(), updateOne: jest.fn(), create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServicePricingRulesService,
        { provide: getModelToken(ServicePricingRule.name), useValue: model },
      ],
    }).compile();

    service = module.get(ServicePricingRulesService);
  });

  const dto = {
    serviceId,
    countryId,
    pricingType: PricingType.HOURLY,
    minPrice: 1000,
    maxPrice: 5000,
  };

  describe('create', () => {
    it('rejects minPrice > maxPrice', async () => {
      await expect(service.create({ ...dto, minPrice: 6000 })).rejects.toThrow(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate (serviceId, countryId, pricingType)', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: validId }) });
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('creates when valid and unique', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      model.create.mockResolvedValue({ ...dto, _id: validId });
      await service.create(dto);
      expect(model.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findActiveRule', () => {
    it('queries by the exact (serviceId, countryId, pricingType) combination, active and non-deleted', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await service.findActiveRule(serviceId, countryId, PricingType.HOURLY);
      expect(model.findOne).toHaveBeenCalledWith({
        serviceId,
        countryId,
        pricingType: PricingType.HOURLY,
        isActive: true,
        isDeleted: false,
      });
    });

    it('returns null when no rule exists — the caller decides what that means', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(
        service.findActiveRule(serviceId, countryId, PricingType.FIXED),
      ).resolves.toBeNull();
    });
  });

  describe('update', () => {
    it('rejects a resulting minPrice > maxPrice even when only one bound is being changed', async () => {
      model.findOne.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue({ _id: validId, minPrice: 1000, maxPrice: 5000, isDeleted: false }),
      });
      await expect(service.update(validId, { minPrice: 6000 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException if nothing matched', async () => {
      model.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ matchedCount: 0 }) });
      await expect(service.remove(validId)).rejects.toThrow(NotFoundException);
    });
  });
});
