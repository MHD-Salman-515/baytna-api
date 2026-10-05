import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { CountriesService } from '../countries/countries.service';
import { ServicePricingRulesService } from '../services/service-pricing-rules.service';
import { ServicesService } from '../services/services.service';
import { WorkerService } from './schemas/worker-service.schema';
import { WorkerServicesService } from './worker-services.service';

describe('WorkerServicesService', () => {
  let service: WorkerServicesService;
  let workerServiceModel: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    updateOne: jest.Mock;
  };
  let servicesService: { findActiveById: jest.Mock };
  let pricingRulesService: { findActiveRule: jest.Mock };
  let countriesService: { findActiveById: jest.Mock };

  const serviceId = 'service-1';
  const countryId = 'country-1';
  const workerProfileId = 'profile-1';

  const cleaningService = {
    key: 'CLEANING',
    allowedPricingTypes: [PricingType.HOURLY, PricingType.BY_SIZE, PricingType.FIXED],
  };
  const syria = { currencyCode: 'SYP' };
  const rule = { minPrice: 1000, maxPrice: 5000 };

  beforeEach(async () => {
    workerServiceModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn(),
    };
    servicesService = { findActiveById: jest.fn().mockResolvedValue(cleaningService) };
    pricingRulesService = { findActiveRule: jest.fn().mockResolvedValue(rule) };
    countriesService = { findActiveById: jest.fn().mockResolvedValue(syria) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerServicesService,
        { provide: getModelToken(WorkerService.name), useValue: workerServiceModel },
        { provide: ServicesService, useValue: servicesService },
        { provide: ServicePricingRulesService, useValue: pricingRulesService },
        { provide: CountriesService, useValue: countriesService },
      ],
    }).compile();

    service = module.get(WorkerServicesService);
  });

  function noExisting() {
    workerServiceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
  }

  describe('range validation (FIXED, simplest case to isolate the boundary)', () => {
    beforeEach(() => noExisting());

    it('rejects a price below the minimum', async () => {
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.FIXED,
          fixed: { price: 999 },
        }),
      ).rejects.toThrow(/must be between 1000 and 5000/);
    });

    it('rejects a price above the maximum', async () => {
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.FIXED,
          fixed: { price: 5001 },
        }),
      ).rejects.toThrow(/must be between 1000 and 5000/);
    });

    it('accepts a price exactly at the minimum bound', async () => {
      workerServiceModel.create.mockResolvedValue({ id: 'ws-1' });
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.FIXED,
          fixed: { price: 1000 },
        }),
      ).resolves.toBeDefined();
    });

    it('accepts a price exactly at the maximum bound', async () => {
      workerServiceModel.create.mockResolvedValue({ id: 'ws-1' });
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.FIXED,
          fixed: { price: 5000 },
        }),
      ).resolves.toBeDefined();
    });

    it('rejects outright when no active pricing rule exists for this (service, country, pricingType)', async () => {
      pricingRulesService.findActiveRule.mockResolvedValue(null);
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.FIXED,
          fixed: { price: 2000 },
        }),
      ).rejects.toThrow(/not yet available/);
    });
  });

  describe('pricingType must be allowed by the service', () => {
    beforeEach(() => noExisting());

    it('rejects a pricingType the service does not allow', async () => {
      servicesService.findActiveById.mockResolvedValue({
        key: 'IRONING',
        allowedPricingTypes: [PricingType.FIXED],
      });
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.HOURLY,
          hourly: { rate: 1500, minHours: 1 },
        }),
      ).rejects.toThrow(/HOURLY is not an allowed pricing type for IRONING/);
    });
  });

  describe('HOURLY validation', () => {
    beforeEach(() => noExisting());

    it('rejects minHours < 1', async () => {
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.HOURLY,
          hourly: { rate: 2000, minHours: 0 },
        }),
      ).rejects.toThrow(/minHours must be >= 1/);
    });

    it('rejects a rate outside the range', async () => {
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.HOURLY,
          hourly: { rate: 9000, minHours: 1 },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid hourly offer', async () => {
      workerServiceModel.create.mockResolvedValue({ id: 'ws-1' });
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.HOURLY,
          hourly: { rate: 2000, minHours: 2 },
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('BY_SIZE tier validation', () => {
    beforeEach(() => noExisting());

    it('rejects an empty tier list', async () => {
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.BY_SIZE,
          bySize: { tiers: [] },
        }),
      ).rejects.toThrow(/at least one tier is required/);
    });

    it('rejects unsorted tiers', async () => {
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.BY_SIZE,
          bySize: {
            tiers: [
              { maxRooms: 5, price: 3000 },
              { maxRooms: 2, price: 2000 },
            ],
          },
        }),
      ).rejects.toThrow(/strictly ascending/);
    });

    it('rejects duplicate/overlapping maxRooms', async () => {
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.BY_SIZE,
          bySize: {
            tiers: [
              { maxRooms: 3, price: 2000 },
              { maxRooms: 3, price: 2500 },
            ],
          },
        }),
      ).rejects.toThrow(/strictly ascending/);
    });

    it('rejects an out-of-range tier price', async () => {
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.BY_SIZE,
          bySize: {
            tiers: [{ maxRooms: 2, price: 50 }],
          },
        }),
      ).rejects.toThrow(/must be between 1000 and 5000/);
    });

    it('accepts valid ascending non-overlapping in-range tiers', async () => {
      workerServiceModel.create.mockResolvedValue({ id: 'ws-1' });
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.BY_SIZE,
          bySize: {
            tiers: [
              { maxRooms: 2, price: 1500 },
              { maxRooms: 5, price: 3000 },
            ],
          },
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('currency', () => {
    beforeEach(() => noExisting());

    it('rejects a currency that does not match the country currency', async () => {
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.FIXED,
          fixed: { price: 2000 },
          currency: 'USD',
        }),
      ).rejects.toThrow(/currency must be SYP/);
    });

    it('accepts a currency that matches, case-insensitively', async () => {
      workerServiceModel.create.mockResolvedValue({ id: 'ws-1' });
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.FIXED,
          fixed: { price: 2000 },
          currency: 'syp',
        }),
      ).resolves.toBeDefined();
    });

    it('derives currency from the country automatically when omitted', async () => {
      workerServiceModel.create.mockResolvedValue({ id: 'ws-1' });
      await service.create(workerProfileId, countryId, {
        serviceId,
        pricingType: PricingType.FIXED,
        fixed: { price: 2000 },
      });
      expect(workerServiceModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'SYP' }),
      );
    });
  });

  describe('create — uniqueness', () => {
    it('rejects a duplicate (workerProfileId, serviceId)', async () => {
      workerServiceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ id: 'existing' }),
      });
      await expect(
        service.create(workerProfileId, countryId, {
          serviceId,
          pricingType: PricingType.FIXED,
          fixed: { price: 2000 },
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the worker service does not belong to this worker', async () => {
      workerServiceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(
        service.update(workerProfileId, countryId, 'ws-1', { fixed: { price: 2000 } }),
      ).rejects.toThrow(NotFoundException);
    });

    it('re-validates fully when only isActive changes, using the existing pricing block', async () => {
      const existing = {
        pricingType: PricingType.FIXED,
        serviceId: { toString: () => serviceId },
        hourly: null,
        bySize: null,
        fixed: { price: 2000 },
        isActive: true,
        save: jest.fn().mockResolvedValue(undefined),
      };
      workerServiceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      await service.update(workerProfileId, countryId, 'ws-1', { isActive: false });

      expect(existing.isActive).toBe(false);
      expect(existing.fixed).toEqual({ price: 2000 });
      expect(existing.save).toHaveBeenCalled();
    });

    it('discards the old pricing block when pricingType changes, requiring a fresh one', async () => {
      const existing = {
        pricingType: PricingType.FIXED,
        serviceId: { toString: () => serviceId },
        hourly: null,
        bySize: null,
        fixed: { price: 2000 },
        isActive: true,
        save: jest.fn().mockResolvedValue(undefined),
      };
      workerServiceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      await expect(
        service.update(workerProfileId, countryId, 'ws-1', { pricingType: PricingType.HOURLY }),
      ).rejects.toThrow(/hourly pricing details are required/);
    });

    it('never touches currency', async () => {
      const existing = {
        pricingType: PricingType.FIXED,
        serviceId: { toString: () => serviceId },
        hourly: null,
        bySize: null,
        fixed: { price: 2000 },
        currency: 'SYP',
        isActive: true,
        save: jest.fn().mockResolvedValue(undefined),
      };
      workerServiceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      await service.update(workerProfileId, countryId, 'ws-1', { fixed: { price: 3000 } });

      expect(existing.currency).toBe('SYP');
    });
  });

  describe('findActiveById', () => {
    it('throws NotFoundException when missing or inactive — used by PricingService, not scoped to any worker', async () => {
      workerServiceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.findActiveById('ws-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the worker service when active and non-deleted', async () => {
      const doc = { id: 'ws-1', isActive: true };
      workerServiceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
      await expect(service.findActiveById('ws-1')).resolves.toEqual(doc);
      expect(workerServiceModel.findOne).toHaveBeenCalledWith({
        _id: 'ws-1',
        isActive: true,
        isDeleted: false,
      });
    });
  });

  describe('delete', () => {
    it('throws NotFoundException if nothing matched (not hers, or already deleted)', async () => {
      workerServiceModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ matchedCount: 0 }),
      });
      await expect(service.delete(workerProfileId, 'ws-1')).rejects.toThrow(NotFoundException);
    });

    it('soft-deletes, scoped to workerProfileId', async () => {
      workerServiceModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      });
      await service.delete(workerProfileId, 'ws-1');
      expect(workerServiceModel.updateOne).toHaveBeenCalledWith(
        { _id: 'ws-1', workerProfileId, isDeleted: false },
        { isDeleted: true, deletedAt: expect.any(Date) },
      );
    });
  });
});
